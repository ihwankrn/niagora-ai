import { describe, expect, it } from "vitest";

import type { PaypalOrder } from "@/lib/paypal/client";

import { parseAmountCents, verifyPaypalOrder } from "./verify";

const expected = {
  orderId: "5O190127TN364715T",
  proposalId: "33333333-3333-4333-8333-333333333333",
  paymentId: "44444444-4444-4444-8444-444444444444",
  amountCents: 65_000,
  currency: "USD",
};

function completedOrder(overrides: Partial<PaypalOrder> = {}, capture: Record<string, unknown> = {}): PaypalOrder {
  return {
    id: expected.orderId,
    intent: "CAPTURE",
    status: "COMPLETED",
    purchase_units: [
      {
        reference_id: expected.proposalId,
        custom_id: expected.paymentId,
        amount: { currency_code: "USD", value: "650.00" },
        payments: {
          captures: [{ id: "3C679366HH908993F", status: "COMPLETED", amount: { currency_code: "USD", value: "650.00" }, ...capture }],
        },
      },
    ],
    payer: { payer_id: "QYR5Z8XDVJNXQ", email_address: "payer@example.com" },
    ...overrides,
  };
}

describe("parseAmountCents", () => {
  it.each([
    ["650.00", 65_000],
    ["650", 65_000],
    ["0.5", 50],
    ["0.05", 5],
    ["1234567.89", 123_456_789],
  ])("%s -> %s", (value, cents) => expect(parseAmountCents(value)).toBe(cents));

  it.each(["", "-1.00", "1.234", "1e3", "abc", undefined])("rejects %s", (value) => {
    expect(parseAmountCents(value)).toBeNull();
  });

  it.each([
    ["a major unit beyond the safe integer range", "99999999999999999999.00"],
    ["cents beyond the safe integer range", "90071992547409.92"],
  ])("rejects %s instead of rounding", (_label, value) => {
    expect(parseAmountCents(value)).toBeNull();
  });
});

describe("verifyPaypalOrder", () => {
  it("accepts a completed capture for the expected proposal, payment and amount", () => {
    const result = verifyPaypalOrder(completedOrder(), expected);
    expect(result).toMatchObject({ kind: "completed", capture: { id: "3C679366HH908993F" }, payerId: "QYR5Z8XDVJNXQ" });
  });

  it.each([
    ["another order id", completedOrder({ id: "OTHERORDER" }), "order id"],
    ["intent AUTHORIZE", completedOrder({ intent: "AUTHORIZE" }), "intent"],
    ["a different proposal", completedOrder({ purchase_units: [{ ...completedOrder().purchase_units![0], reference_id: "other" }] }), "reference_id"],
    ["a different payment", completedOrder({ purchase_units: [{ ...completedOrder().purchase_units![0], custom_id: "other" }] }), "custom_id"],
    [
      "a lower order amount",
      completedOrder({ purchase_units: [{ ...completedOrder().purchase_units![0], amount: { currency_code: "USD", value: "6.50" } }] }),
      "order amount",
    ],
    ["a lower capture amount", completedOrder({}, { amount: { currency_code: "USD", value: "1.00" } }), "capture amount"],
    ["another currency", completedOrder({}, { amount: { currency_code: "EUR", value: "650.00" } }), "capture amount"],
    ["two purchase units", completedOrder({ purchase_units: [completedOrder().purchase_units![0], completedOrder().purchase_units![0]] }), "purchase unit count"],
  ])("rejects %s", (_label, order, reason) => {
    expect(verifyPaypalOrder(order, expected)).toEqual({ kind: "mismatch", reason });
  });

  it("rejects an order with more than one capture", () => {
    const unit = completedOrder().purchase_units![0];
    const order = completedOrder({ purchase_units: [{ ...unit, payments: { captures: [...unit.payments!.captures!, ...unit.payments!.captures!] } }] });
    expect(verifyPaypalOrder(order, expected)).toEqual({ kind: "mismatch", reason: "multiple captures" });
  });

  it("reports a declined capture (PayPal can return it with HTTP 201)", () => {
    expect(verifyPaypalOrder(completedOrder({ status: "APPROVED" }, { status: "DECLINED" }), expected).kind).toBe("declined");
    // No money moved, so a mismatched amount must not turn this into an
    // unverifiable/reviewable payment.
    expect(
      verifyPaypalOrder(completedOrder({ status: "APPROVED" }, { status: "DECLINED", amount: { currency_code: "USD", value: "1.00" } }), expected).kind,
    ).toBe("declined");
  });

  it("never treats a DECLINED or FAILED capture on a COMPLETED order as a clean decline", () => {
    for (const status of ["DECLINED", "FAILED"]) {
      expect(verifyPaypalOrder(completedOrder({}, { status }), expected)).toEqual({
        kind: "unexpected",
        capture: expect.objectContaining({ id: "3C679366HH908993F", status }),
        reason: `completed order with ${status} capture`,
      });
    }
  });

  it("treats a pending capture or an uncaptured order as pending, never as paid", () => {
    expect(verifyPaypalOrder(completedOrder({}, { status: "PENDING" }), expected).kind).toBe("pending");
    const approved = completedOrder({ status: "APPROVED", purchase_units: [{ ...completedOrder().purchase_units![0], payments: undefined }] });
    expect(verifyPaypalOrder(approved, expected)).toEqual({ kind: "pending", capture: null });
  });

  it("never treats a refunded capture as a completed payment", () => {
    for (const status of ["REFUNDED", "PARTIALLY_REFUNDED"]) {
      expect(verifyPaypalOrder(completedOrder({}, { status }), expected)).toMatchObject({
        kind: "unexpected",
        reason: `capture status ${status}`,
      });
    }
  });

  it("reports a partially refunded capture with a different amount as unexpected, not mismatch", () => {
    expect(verifyPaypalOrder(completedOrder({}, { status: "REFUNDED", amount: { currency_code: "USD", value: "100.00" } }), expected)).toMatchObject({
      kind: "unexpected",
    });
  });

  it.each([
    ["an unknown status without a capture", completedOrder({ status: "SOMETHING_NEW", purchase_units: [{ ...completedOrder().purchase_units![0], payments: undefined }] }), "unknown order status SOMETHING_NEW"],
    ["an unknown status with a completed capture", completedOrder({ status: "SOMETHING_NEW" }), "unknown order status SOMETHING_NEW"],
  ])("surfaces %s for reconciliation, never as pending", (_label, order, reason) => {
    expect(verifyPaypalOrder(order, expected)).toMatchObject({ kind: "unexpected", reason });
  });

  it("lets an unknown order status win over an amount mismatch", () => {
    const order = completedOrder(
      { status: "SOMETHING_NEW", purchase_units: [{ ...completedOrder().purchase_units![0], amount: { currency_code: "USD", value: "1.00" } }] },
      {},
    );
    expect(verifyPaypalOrder(order, expected)).toEqual({ kind: "unexpected", capture: expect.objectContaining({ id: "3C679366HH908993F" }), reason: "unknown order status SOMETHING_NEW" });
  });

  it.each(["VOIDED", "EXPIRED"])("surfaces a %s order instead of treating it as pending", (status) => {
    const order = completedOrder({ status, purchase_units: [{ ...completedOrder().purchase_units![0], payments: undefined }] });
    expect(verifyPaypalOrder(order, expected)).toMatchObject({ kind: "unexpected", reason: `order status ${status}` });
  });

  it("surfaces an unknown capture status for reconciliation instead of guessing", () => {
    expect(verifyPaypalOrder(completedOrder({}, { status: "SOMETHING_NEW" }), expected)).toMatchObject({
      kind: "unexpected",
      reason: "unknown capture status SOMETHING_NEW",
    });
  });

  it("does not accept a completed capture without an id", () => {
    expect(verifyPaypalOrder(completedOrder({}, { id: "  " }), expected)).toEqual({ kind: "mismatch", reason: "capture id" });
  });

  it("does not accept a COMPLETED order that exposes no capture at all", () => {
    const order = completedOrder({ purchase_units: [{ ...completedOrder().purchase_units![0], payments: undefined }] });
    expect(verifyPaypalOrder(order, expected)).toEqual({ kind: "unexpected", capture: null, reason: "completed order without capture" });
  });

  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])("rejects an unusable expected amount %s", (amountCents) => {
    expect(verifyPaypalOrder(completedOrder(), { ...expected, amountCents })).toEqual({ kind: "mismatch", reason: "expected amount" });
  });
});

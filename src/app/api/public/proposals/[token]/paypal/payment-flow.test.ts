import { beforeEach, describe, expect, it, vi } from "vitest";

import { Prisma } from "@/generated/prisma/client";

// Exercises the real route handlers, HTTP mapping and payment service together.
// Only the database and the PayPal network calls are replaced, so the status
// codes below are what a client actually receives.
const db = vi.hoisted(() => ({
  proposal: { findUnique: vi.fn(), updateMany: vi.fn() },
  payment: { findFirst: vi.fn(), findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), create: vi.fn(), updateMany: vi.fn() },
  $transaction: vi.fn(),
}));
const paypal = vi.hoisted(() => ({ createOrder: vi.fn(), captureOrder: vi.fn(), getOrder: vi.fn() }));

vi.mock("@/lib/db", () => ({ prisma: db }));
vi.mock("@/lib/paypal/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/paypal/client")>()),
  ...paypal,
}));

const orders = await import("./orders/route");
const capture = await import("./capture/route");

const TOKEN = "a".repeat(43);
const PROPOSAL_ID = "33333333-3333-4333-8333-333333333333";
const PAYMENT_ID = "44444444-4444-4444-8444-444444444444";
const ORDER_ID = "5O190127TN364715T";
const now = new Date("2026-11-05T12:00:00.000Z");
const ctx = { params: Promise.resolve({ token: TOKEN }) };

function proposal(status = "APPROVED") {
  return {
    id: PROPOSAL_ID,
    title: "Website",
    summary: null,
    clientName: null,
    clientEmail: null,
    currency: "USD",
    hourlyRateCents: 100,
    subtotalCents: 100,
    totalCents: 100,
    status,
    briefId: null,
    approvedAt: now,
    paidAt: status === "PAID" ? now : null,
    createdAt: now,
    updatedAt: now,
    items: [],
    user: { displayName: null },
  };
}

function payment(status: string, extra: Record<string, unknown> = {}) {
  return {
    id: PAYMENT_ID,
    proposalId: PROPOSAL_ID,
    status,
    amountCents: 100,
    currency: "USD",
    paypalOrderId: ORDER_ID,
    paypalCaptureId: null,
    requestId: "req-1",
    verifiedAt: null,
    ...extra,
  };
}

function paypalOrder(status: string, captureStatus?: string) {
  return {
    id: ORDER_ID,
    intent: "CAPTURE",
    status,
    purchase_units: [
      {
        reference_id: PROPOSAL_ID,
        custom_id: PAYMENT_ID,
        invoice_id: PAYMENT_ID,
        amount: { currency_code: "USD", value: "1.00" },
        ...(captureStatus
          ? { payments: { captures: [{ id: "CAP1", status: captureStatus, final_capture: true, amount: { currency_code: "USD", value: "1.00" } }] } }
          : {}),
      },
    ],
    payer: { payer_id: "PAYER1" },
    links: [{ rel: "approve", href: `https://www.sandbox.paypal.com/checkoutnow?token=${ORDER_ID}` }],
  };
}

const post = (body?: unknown) =>
  new Request("http://localhost/api/x", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const callOrders = () => orders.POST(post(), ctx);
const callCapture = () => capture.POST(post({ orderId: ORDER_ID }), ctx);
const dbDown = () => new Error("connection lost: postgresql://user:secret@host/db");

async function expectApiError(response: Response, status: number, code: string) {
  const body = await response.json();
  expect(response.status).toBe(status);
  expect(body.error.code).toBe(code);
  // Internal details such as connection strings never reach the client.
  expect(JSON.stringify(body)).not.toMatch(/postgresql:|secret/);
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  db.proposal.findUnique.mockResolvedValue(proposal());
  db.payment.updateMany.mockResolvedValue({ count: 1 });
  db.proposal.updateMany.mockResolvedValue({ count: 1 });
  db.$transaction.mockImplementation((work: (tx: typeof db) => unknown) => work(db));
});

describe("POST .../paypal/orders", () => {
  it("answers 409 without moving money while a payment is in REVIEW and PayPal shows no completed order", async () => {
    db.payment.findFirst.mockResolvedValue({ paypalOrderId: ORDER_ID });
    paypal.getOrder.mockResolvedValue(paypalOrder("APPROVED"));

    await expectApiError(await callOrders(), 409, "CONFLICT");

    expect(paypal.getOrder).toHaveBeenCalledWith(ORDER_ID);
    expect(paypal.captureOrder).not.toHaveBeenCalled();
    expect(paypal.createOrder).not.toHaveBeenCalled();
    expect(db.payment.create).not.toHaveBeenCalled();
  });

  it("still answers 409 for a REVIEW payment when PayPal cannot be read", async () => {
    db.payment.findFirst.mockResolvedValue({ paypalOrderId: ORDER_ID });
    paypal.getOrder.mockRejectedValue(new Error("network down"));

    await expectApiError(await callOrders(), 409, "CONFLICT");

    expect(paypal.captureOrder).not.toHaveBeenCalled();
    expect(paypal.createOrder).not.toHaveBeenCalled();
  });

  it("answers 409 when the database index rejects the new row and the winner is in REVIEW", async () => {
    db.payment.findFirst
      .mockResolvedValueOnce(null) // REVIEW lookup
      .mockResolvedValueOnce(null) // open payment lookup
      .mockResolvedValueOnce(payment("REVIEW")); // winner after the unique violation
    paypal.createOrder.mockImplementation(async (input: { paymentId: string }) => {
      const order = paypalOrder("CREATED");
      order.purchase_units[0].custom_id = input.paymentId;
      order.purchase_units[0].invoice_id = input.paymentId;
      return order;
    });
    db.proposal.findUnique.mockResolvedValue(proposal());
    db.payment.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("Unique constraint failed", { code: "P2002", clientVersion: "7.10.1" }),
    );

    await expectApiError(await callOrders(), 409, "CONFLICT");
  });

  it("reuses a still-valid open order instead of answering 409", async () => {
    db.payment.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(payment("CREATED"));
    paypal.getOrder.mockResolvedValue(paypalOrder("CREATED"));

    const response = await callOrders();

    expect(response.status).toBe(201);
    expect((await response.json()).data.orderId).toBe(ORDER_ID);
    expect(paypal.createOrder).not.toHaveBeenCalled();
  });

  describe("after the tab closed before the capture response was recorded", () => {
    const openOrder = (status: string, extra: Record<string, unknown> = {}) => {
      db.payment.findFirst
        .mockResolvedValueOnce(null) // REVIEW lookup
        .mockResolvedValueOnce(payment(status, extra)) // open payment lookup
        .mockResolvedValue(payment(status, extra)); // lookup by order id during reconciliation
    };

    it("records the captured payment without capturing again, then answers 409 already paid", async () => {
      openOrder("CREATED");
      paypal.getOrder.mockResolvedValue(paypalOrder("COMPLETED", "COMPLETED"));
      db.payment.findUniqueOrThrow.mockResolvedValue(payment("COMPLETED", { paypalCaptureId: "CAP1", verifiedAt: now }));

      const response = await callOrders();

      const body = await response.json();
      expect(response.status).toBe(409);
      expect(body.error).toEqual({ code: "CONFLICT", message: "This proposal is already paid" });
      expect(paypal.captureOrder).not.toHaveBeenCalled();
      expect(paypal.createOrder).not.toHaveBeenCalled();
      expect(db.payment.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: "COMPLETED", paypalCaptureId: "CAP1" }) }),
      );
      expect(db.proposal.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: "PAID" }) }),
      );
    });

    it("records a pending capture that has since completed", async () => {
      openOrder("APPROVED", { paypalCaptureId: "CAP1" });
      paypal.getOrder.mockResolvedValue(paypalOrder("COMPLETED", "COMPLETED"));
      db.payment.findUniqueOrThrow.mockResolvedValue(payment("COMPLETED", { paypalCaptureId: "CAP1", verifiedAt: now }));

      await expectApiError(await callOrders(), 409, "CONFLICT");

      expect(db.proposal.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: "PAID" }) }),
      );
      expect(paypal.createOrder).not.toHaveBeenCalled();
    });

    it("keeps blocking a new order while the capture is still pending", async () => {
      openOrder("APPROVED", { paypalCaptureId: "CAP1" });
      paypal.getOrder.mockResolvedValue(paypalOrder("COMPLETED", "PENDING"));
      db.payment.findUniqueOrThrow.mockResolvedValue(payment("APPROVED", { paypalCaptureId: "CAP1" }));

      await expectApiError(await callOrders(), 409, "CONFLICT");

      expect(db.proposal.updateMany).not.toHaveBeenCalled();
      expect(paypal.createOrder).not.toHaveBeenCalled();
    });

    it("answers 502 and creates no new order when recording the captured payment fails", async () => {
      openOrder("CREATED");
      paypal.getOrder.mockResolvedValue(paypalOrder("COMPLETED", "COMPLETED"));
      db.$transaction.mockRejectedValue(dbDown());
      db.payment.findUnique.mockRejectedValue(dbDown());

      await expectApiError(await callOrders(), 502, "PAYMENT_PROVIDER_ERROR");

      expect(paypal.createOrder).not.toHaveBeenCalled();
    });
  });

  it("answers 502 when an expired open order cannot be retired, and creates no second order", async () => {
    db.payment.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(payment("CREATED"));
    paypal.getOrder.mockResolvedValue(paypalOrder("VOIDED"));
    db.payment.updateMany.mockRejectedValue(dbDown());

    await expectApiError(await callOrders(), 502, "PAYMENT_PROVIDER_ERROR");
    expect(paypal.createOrder).not.toHaveBeenCalled();
  });
});

describe("POST .../paypal/capture", () => {
  it("captures once, then a duplicate request returns the stored completion without calling PayPal", async () => {
    db.payment.findFirst.mockResolvedValueOnce(payment("CREATED"));
    paypal.getOrder.mockResolvedValueOnce(paypalOrder("APPROVED")).mockResolvedValueOnce(paypalOrder("COMPLETED", "COMPLETED"));
    paypal.captureOrder.mockResolvedValue(paypalOrder("COMPLETED", "COMPLETED"));
    db.payment.findUniqueOrThrow.mockResolvedValue(payment("COMPLETED", { paypalCaptureId: "CAP1", verifiedAt: now }));

    const first = await callCapture();
    expect(first.status).toBe(200);
    const firstData = (await first.json()).data;
    expect(firstData).toMatchObject({ paymentStatus: "completed", proposalStatus: "paid", captureId: "CAP1" });
    expect(paypal.captureOrder).toHaveBeenCalledTimes(1);

    vi.mocked(paypal.getOrder).mockClear();
    db.proposal.findUnique.mockResolvedValue(proposal("PAID"));
    db.payment.findFirst.mockResolvedValueOnce(payment("COMPLETED", { paypalCaptureId: "CAP1", verifiedAt: now }));

    const duplicate = await callCapture();
    expect(duplicate.status).toBe(200);
    const duplicateData = (await duplicate.json()).data;
    expect(duplicateData).toMatchObject({ paymentStatus: "completed", proposalStatus: "paid", captureId: "CAP1", orderId: ORDER_ID });
    expect(paypal.captureOrder).toHaveBeenCalledTimes(1);
    expect(paypal.getOrder).not.toHaveBeenCalled();
  });

  it("reconciles a REVIEW payment to completed only from a verified capture, without capturing again", async () => {
    db.payment.findFirst.mockResolvedValue(payment("REVIEW", { paypalCaptureId: "CAP1" }));
    paypal.getOrder.mockResolvedValue(paypalOrder("COMPLETED", "COMPLETED"));
    db.payment.findUniqueOrThrow.mockResolvedValue(payment("COMPLETED", { paypalCaptureId: "CAP1", verifiedAt: now }));

    const response = await callCapture();

    expect(response.status).toBe(200);
    expect((await response.json()).data.proposalStatus).toBe("paid");
    expect(paypal.captureOrder).not.toHaveBeenCalled();
  });

  it("answers 502 for a REVIEW payment on a proposal that is no longer payable", async () => {
    db.proposal.findUnique.mockResolvedValue(proposal("CANCELLED"));
    db.payment.findFirst.mockResolvedValue(payment("REVIEW"));

    await expectApiError(await callCapture(), 502, "PAYMENT_PROVIDER_ERROR");
    expect(paypal.captureOrder).not.toHaveBeenCalled();
  });

  it("answers 502, not success, when the completion transaction and the follow-up read both fail", async () => {
    db.payment.findFirst.mockResolvedValue(payment("APPROVED"));
    paypal.getOrder.mockResolvedValue(paypalOrder("COMPLETED", "COMPLETED"));
    db.$transaction.mockRejectedValue(dbDown());
    db.payment.findUnique.mockRejectedValue(dbDown());

    await expectApiError(await callCapture(), 502, "PAYMENT_PROVIDER_ERROR");
  });

  it("answers 502 when a completed payment's proposal repair and re-read fail", async () => {
    db.payment.findFirst.mockResolvedValue(payment("COMPLETED", { paypalCaptureId: "CAP1", verifiedAt: now }));
    db.proposal.updateMany.mockRejectedValue(dbDown());
    db.payment.findUnique.mockRejectedValue(dbDown());

    await expectApiError(await callCapture(), 502, "PAYMENT_PROVIDER_ERROR");
  });

  it("answers 502 when the REVIEW state itself cannot be saved", async () => {
    db.payment.findFirst.mockResolvedValue(payment("APPROVED"));
    const mismatched = paypalOrder("COMPLETED", "COMPLETED");
    mismatched.purchase_units[0].amount.value = "999.00";
    paypal.getOrder.mockResolvedValue(mismatched);
    db.payment.updateMany.mockRejectedValue(dbDown());

    await expectApiError(await callCapture(), 502, "PAYMENT_PROVIDER_ERROR");
  });

  it("answers 502, not a generic 500, when a pending capture cannot be saved", async () => {
    db.payment.findFirst.mockResolvedValue(payment("CREATED"));
    paypal.getOrder.mockResolvedValue(paypalOrder("COMPLETED", "PENDING"));
    db.payment.updateMany.mockRejectedValue(dbDown());

    await expectApiError(await callCapture(), 502, "PAYMENT_PROVIDER_ERROR");
  });

  it("answers 502, not a generic 500, when a saved pending capture cannot be read back", async () => {
    db.payment.findFirst.mockResolvedValue(payment("CREATED"));
    paypal.getOrder.mockResolvedValue(paypalOrder("COMPLETED", "PENDING"));
    db.payment.findUniqueOrThrow.mockRejectedValue(dbDown());

    await expectApiError(await callCapture(), 502, "PAYMENT_PROVIDER_ERROR");
  });
});

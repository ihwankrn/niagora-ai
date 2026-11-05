import { afterEach, describe, expect, it, vi } from "vitest";

import {
  approvePublicProposal,
  capturePublicProposalPaypalOrder,
  createPublicProposalPaypalOrder,
  decidePaymentConflict,
  PublicProposalPaymentError,
  readLatestProposalStatus,
} from "./payment-client";

const TOKEN = "a".repeat(43);
const proposal = {
  title: "Website project",
  summary: null,
  clientName: null,
  freelancerName: null,
  status: "approved",
  currency: "USD",
  items: [],
  totalHours: 0,
  subtotalCents: 0,
  totalCents: 0,
  approvedAt: "2026-11-05T00:00:00.000Z",
  paidAt: null,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("public proposal payment client", () => {
  it("uses the public approval endpoint and validates its response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: proposal }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(approvePublicProposal(TOKEN)).resolves.toMatchObject({ status: "approved" });
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/public/proposals/${TOKEN}/approve`,
      expect.objectContaining({ method: "POST", body: "{}" }),
    );
  });

  it("requests a server-priced PayPal order without sending an amount", async () => {
    const order = {
      orderId: "5O190127TN364715T",
      approveUrl: null,
      amountCents: 50000,
      currency: "USD",
    };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: order }), { status: 201 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(createPublicProposalPaypalOrder(TOKEN)).resolves.toEqual(order);
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/public/proposals/${TOKEN}/paypal/orders`,
      expect.objectContaining({ method: "POST", body: "{}" }),
    );
  });

  it("preserves the same orderId in repeated capture retries", async () => {
    const capture = {
      paymentStatus: "pending",
      proposalStatus: "approved",
      orderId: "5O190127TN364715T",
      captureId: null,
      amountCents: 50000,
      currency: "USD",
      paidAt: null,
    };
    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({ data: capture }), { status: 200 })),
    );
    vi.stubGlobal("fetch", fetchMock);

    await capturePublicProposalPaypalOrder(TOKEN, capture.orderId);
    await capturePublicProposalPaypalOrder(TOKEN, capture.orderId);

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      `/api/public/proposals/${TOKEN}/paypal/capture`,
      expect.objectContaining({ body: JSON.stringify({ orderId: capture.orderId }) }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      `/api/public/proposals/${TOKEN}/paypal/capture`,
      expect.objectContaining({ body: JSON.stringify({ orderId: capture.orderId }) }),
    );
  });

  it("surfaces API status and code for review conflicts and provider errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ error: { code: "CONFLICT", message: "Needs review" } }), {
            status: 409,
          }),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              error: { code: "PAYMENT_PROVIDER_ERROR", message: "Please retry" },
            }),
            { status: 502 },
          ),
        ),
    );

    await expect(createPublicProposalPaypalOrder(TOKEN)).rejects.toMatchObject<
      Partial<PublicProposalPaymentError>
    >({ status: 409, code: "CONFLICT" });
    await expect(
      capturePublicProposalPaypalOrder(TOKEN, "5O190127TN364715T"),
    ).rejects.toMatchObject<Partial<PublicProposalPaymentError>>({
      status: 502,
      code: "PAYMENT_PROVIDER_ERROR",
    });
  });
});

describe("decidePaymentConflict", () => {
  it.each(["paid", "cancelled", "rejected", "sent"] as const)(
    "shows the current status when the proposal is %s, whatever the source",
    (status) => {
      expect(decidePaymentConflict("create-order", status)).toEqual({ kind: "show-status", status });
      expect(decidePaymentConflict("capture", status)).toEqual({ kind: "show-status", status });
    },
  );

  it("blocks a new payment when an order request conflicts on a still-approved proposal", () => {
    expect(decidePaymentConflict("create-order", "approved")).toEqual({ kind: "blocked" });
  });

  it("lets the client start again when a captured order is no longer valid", () => {
    expect(decidePaymentConflict("capture", "approved")).toEqual({ kind: "restart-payment" });
  });

  it("never offers a new payment when the status cannot be read", () => {
    expect(decidePaymentConflict("create-order", null)).toEqual({ kind: "blocked" });
    expect(decidePaymentConflict("capture", null)).toEqual({ kind: "retry-capture" });
  });
});

describe("readLatestProposalStatus", () => {
  it("returns the status from the public endpoint", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { ...proposal, status: "paid" } }), { status: 200 })));
    await expect(readLatestProposalStatus(TOKEN)).resolves.toBe("paid");
  });

  it("returns null instead of throwing when the status cannot be read", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    await expect(readLatestProposalStatus(TOKEN)).resolves.toBeNull();
  });
});

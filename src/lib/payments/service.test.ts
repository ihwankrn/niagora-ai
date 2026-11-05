import { beforeEach, describe, expect, it, vi } from "vitest";

import { Prisma } from "@/generated/prisma/client";
import { PaypalApiError } from "@/lib/paypal/client";

const db = vi.hoisted(() => ({
  proposal: { findUnique: vi.fn(), findFirst: vi.fn(), findUniqueOrThrow: vi.fn(), updateMany: vi.fn() },
  payment: {
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    findUniqueOrThrow: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  $transaction: vi.fn(),
}));
const paypal = vi.hoisted(() => ({ createOrder: vi.fn(), captureOrder: vi.fn(), getOrder: vi.fn() }));

vi.mock("@/lib/db", () => ({ prisma: db }));
vi.mock("@/lib/paypal/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/paypal/client")>()),
  ...paypal,
}));

const { approveProposal, capturePaypalOrder, createPaypalOrder, getPublicProposal, sendProposal } = await import("./service");

const TOKEN = "a".repeat(43);
const PROPOSAL_ID = "33333333-3333-4333-8333-333333333333";
const PAYMENT_ID = "44444444-4444-4444-8444-444444444444";
const ORDER_ID = "5O190127TN364715T";
const now = new Date("2026-10-25T12:00:00.000Z");

function proposal(status: string, extra: Record<string, unknown> = {}) {
  return {
    id: PROPOSAL_ID,
    userId: "u1",
    briefId: null,
    title: "Company profile website",
    summary: null,
    clientName: "Client",
    clientEmail: "client@example.com",
    currency: "USD",
    hourlyRateCents: 5_000,
    subtotalCents: 65_000,
    totalCents: 65_000,
    status,
    shareToken: TOKEN,
    approvedAt: null,
    paidAt: null,
    createdAt: now,
    updatedAt: now,
    items: [{ position: 0, title: "Pages", description: null, estimatedHours: new Prisma.Decimal(13), hourlyRateCents: 5_000, amountCents: 65_000 }],
    user: { displayName: "Freelancer" },
    ...extra,
  };
}

function payment(status: string, extra: Record<string, unknown> = {}) {
  return {
    id: PAYMENT_ID,
    proposalId: PROPOSAL_ID,
    status,
    amountCents: 65_000,
    currency: "USD",
    paypalOrderId: ORDER_ID,
    paypalCaptureId: null,
    requestId: "req-1",
    payerId: null,
    payerEmail: null,
    providerPayload: null,
    reviewReason: null,
    verifiedAt: null,
    createdAt: now,
    updatedAt: now,
    ...extra,
  };
}

function paypalOrder(status = "COMPLETED", captureStatus: string | null = "COMPLETED", value = "650.00") {
  return {
    id: ORDER_ID,
    intent: "CAPTURE",
    status,
    purchase_units: [
      {
        reference_id: PROPOSAL_ID,
        custom_id: PAYMENT_ID,
        amount: { currency_code: "USD", value },
        payments: captureStatus ? { captures: [{ id: "CAP1", status: captureStatus, amount: { currency_code: "USD", value } }] } : undefined,
      },
    ],
    payer: { payer_id: "PAYER1", email_address: "payer@example.com" },
    links: [{ rel: "approve", href: "https://www.sandbox.paypal.com/checkoutnow?token=5O190127TN364715T" }],
  };
}

function createdOrder(input: { proposalId: string; paymentId: string; amount: { currency_code: string; value: string } }) {
  return {
    ...paypalOrder("CREATED", null),
    purchase_units: [
      {
        reference_id: input.proposalId,
        custom_id: input.paymentId,
        amount: input.amount,
        payments: undefined,
      },
    ],
  };
}

const paypalError = (issue: string) => new PaypalApiError(422, { name: "UNPROCESSABLE_ENTITY", details: [{ issue }] });

const uniqueViolation = () => new Prisma.PrismaClientKnownRequestError("Unique constraint failed", { code: "P2002", clientVersion: "7.10.1" });
const dbUnavailable = () =>
  new Prisma.PrismaClientKnownRequestError("Can't reach database server", { code: "P1001", clientVersion: "7.10.1" });

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("APP_BASE_URL", "http://localhost:3000/");
  db.$transaction.mockImplementation(async (arg: unknown) => {
    if (typeof arg === "function") return (arg as (tx: typeof db) => Promise<unknown>)(db);
    return Promise.all(arg as Promise<unknown>[]);
  });
  db.payment.updateMany.mockResolvedValue({ count: 1 });
  db.proposal.updateMany.mockResolvedValue({ count: 1 });
  db.payment.findUniqueOrThrow.mockResolvedValue(payment("COMPLETED", { paypalCaptureId: "CAP1", verifiedAt: now }));
  db.payment.findUnique.mockResolvedValue(null);
});

describe("sendProposal", () => {
  it("only lets the owner send, moves DRAFT to SENT and returns the client link", async () => {
    db.proposal.findFirst.mockResolvedValue({ status: "DRAFT" });
    db.proposal.findUnique.mockResolvedValue(proposal("SENT"));

    const result = await sendProposal({ id: "u1", email: "f@example.com" }, PROPOSAL_ID);

    expect(db.proposal.findFirst).toHaveBeenCalledWith({ where: { id: PROPOSAL_ID, userId: "u1" }, select: { status: true } });
    expect(db.proposal.updateMany).toHaveBeenCalledWith({ where: { id: PROPOSAL_ID, status: "DRAFT" }, data: { status: "SENT" } });
    expect(result.shareUrl).toBe(`http://localhost:3000/proposals/view/${TOKEN}`);
    expect(result.proposal.status).toBe("sent");
  });

  it("returns 404 for someone else's proposal", async () => {
    db.proposal.findFirst.mockResolvedValue(null);
    await expect(sendProposal({ id: "u2", email: "x@example.com" }, PROPOSAL_ID)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("does not report success when the DRAFT -> SENT update affected no row", async () => {
    db.proposal.findFirst.mockResolvedValue({ status: "DRAFT" });
    db.proposal.updateMany.mockResolvedValue({ count: 0 });
    db.proposal.findUnique.mockResolvedValue(proposal("DRAFT"));

    await expect(sendProposal({ id: "u1", email: "f@example.com" }, PROPOSAL_ID)).rejects.toMatchObject({ code: "CONFLICT" });
  });
});

describe("approveProposal", () => {
  it("moves SENT to APPROVED atomically", async () => {
    db.proposal.findUnique.mockResolvedValueOnce(proposal("SENT")).mockResolvedValueOnce(proposal("APPROVED", { approvedAt: now }));
    const result = await approveProposal(TOKEN);
    expect(db.proposal.updateMany).toHaveBeenCalledWith({
      where: { id: PROPOSAL_ID, status: "SENT" },
      data: { status: "APPROVED", approvedAt: expect.any(Date) },
    });
    expect(result).toMatchObject({ status: "approved", freelancerName: "Freelancer" });
    expect(result).not.toHaveProperty("clientEmail");
  });

  it("hides drafts and refuses cancelled proposals", async () => {
    db.proposal.findUnique.mockResolvedValue(proposal("DRAFT"));
    await expect(approveProposal(TOKEN)).rejects.toMatchObject({ code: "NOT_FOUND" });
    db.proposal.findUnique.mockResolvedValue(proposal("CANCELLED"));
    await expect(approveProposal(TOKEN)).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("does not report success when the SENT -> APPROVED update affected no row and the proposal became cancelled", async () => {
    db.proposal.updateMany.mockResolvedValue({ count: 0 });
    db.proposal.findUnique.mockResolvedValueOnce(proposal("SENT")).mockResolvedValueOnce(proposal("CANCELLED"));

    await expect(approveProposal(TOKEN)).rejects.toMatchObject({ code: "CONFLICT" });
  });
});

describe("createPaypalOrder", () => {
  it.each([
    ["SENT", "CONFLICT"],
    ["PAID", "CONFLICT"],
    ["DRAFT", "NOT_FOUND"],
  ])("refuses a %s proposal", async (status, code) => {
    db.proposal.findUnique.mockResolvedValue(proposal(status));
    await expect(createPaypalOrder(TOKEN)).rejects.toMatchObject({ code });
    expect(paypal.createOrder).not.toHaveBeenCalled();
  });

  it("creates the order from the stored total and records the payment", async () => {
    db.proposal.findUnique.mockResolvedValue(proposal("APPROVED"));
    db.payment.findFirst.mockResolvedValue(null);
    paypal.createOrder.mockImplementation(async (input) => createdOrder(input));

    const result = await createPaypalOrder(TOKEN);

    const orderInput = paypal.createOrder.mock.calls[0][0];
    expect(orderInput).toMatchObject({ proposalId: PROPOSAL_ID, amount: { currency_code: "USD", value: "650.00" } });
    expect(db.payment.create).toHaveBeenCalledWith({
      data: {
        id: orderInput.paymentId,
        proposalId: PROPOSAL_ID,
        status: "CREATED",
        amountCents: 65_000,
        currency: "USD",
        paypalOrderId: ORDER_ID,
        requestId: orderInput.requestId,
      },
    });
    expect(result).toEqual({ orderId: ORDER_ID, approveUrl: expect.stringContaining("sandbox.paypal.com"), amountCents: 65_000, currency: "USD" });
  });

  it("does not hand out an approve URL when the proposal was paid while the order was created", async () => {
    db.proposal.findUnique
      .mockResolvedValueOnce(proposal("APPROVED")) // findSharedProposal
      .mockResolvedValueOnce(proposal("PAID", { paidAt: now })); // re-check after PayPal
    db.payment.findFirst.mockResolvedValue(null);
    paypal.createOrder.mockImplementation(async (input) => createdOrder(input));

    await expect(createPaypalOrder(TOKEN)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(db.payment.create).not.toHaveBeenCalled();
  });

  it("does not record an order PayPal created with an unknown status", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    db.proposal.findUnique.mockResolvedValue(proposal("APPROVED"));
    db.payment.findFirst.mockResolvedValue(null);
    paypal.createOrder.mockImplementation(async (input) => ({ ...createdOrder(input), status: "SOMETHING_NEW" }));

    await expect(createPaypalOrder(TOKEN)).rejects.toMatchObject({ code: "PAYMENT_PROVIDER_ERROR" });
    expect(db.payment.create).not.toHaveBeenCalled();
  });

  it("reuses an open order that PayPal still accepts", async () => {
    db.proposal.findUnique.mockResolvedValue(proposal("APPROVED"));
    db.payment.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(payment("CREATED"));
    paypal.getOrder.mockResolvedValue(paypalOrder("APPROVED", null));

    expect((await createPaypalOrder(TOKEN)).orderId).toBe(ORDER_ID);
    expect(paypal.createOrder).not.toHaveBeenCalled();
  });

  it("voids an expired open order and creates a new one", async () => {
    db.proposal.findUnique.mockResolvedValue(proposal("APPROVED"));
    db.payment.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(payment("CREATED"));
    paypal.getOrder.mockRejectedValue(new PaypalApiError(404, { name: "RESOURCE_NOT_FOUND" }));
    paypal.createOrder.mockImplementation(async (input) => ({ ...createdOrder(input), id: "NEWORDER" }));

    expect((await createPaypalOrder(TOKEN)).orderId).toBe("NEWORDER");
    expect(db.payment.updateMany).toHaveBeenCalledWith({
      where: { id: PAYMENT_ID, status: { in: ["CREATED", "APPROVED"] } },
      data: { status: "VOIDED" },
    });
  });

  it("returns the validated winning order when a concurrent request opened one first", async () => {
    db.proposal.findUnique.mockResolvedValue(proposal("APPROVED"));
    db.payment.findFirst
      .mockResolvedValueOnce(null) // review check
      .mockResolvedValueOnce(null) // no open payment yet
      .mockResolvedValueOnce(payment("CREATED", { paypalOrderId: "WINNER" }));
    paypal.createOrder.mockImplementation(async (input) => ({ ...createdOrder(input), id: "LOSER" }));
    paypal.getOrder.mockResolvedValue({ ...paypalOrder("APPROVED", null), id: "WINNER" });
    db.payment.create.mockRejectedValue(uniqueViolation());

    expect((await createPaypalOrder(TOKEN)).orderId).toBe("WINNER");
  });

  it("marks a mismatched open order for review instead of creating a second live order", async () => {
    db.proposal.findUnique.mockResolvedValue(proposal("APPROVED"));
    db.payment.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(payment("CREATED", { amountCents: 1_000 }));
    paypal.getOrder.mockResolvedValue(paypalOrder("APPROVED", null, "10.00"));

    await expect(createPaypalOrder(TOKEN)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(db.payment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: PAYMENT_ID }),
        data: expect.objectContaining({ status: "REVIEW" }),
      }),
    );
  });

  it("keeps the open payment blocking a second order when REVIEW cannot be saved", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    db.proposal.findUnique.mockResolvedValue(proposal("APPROVED"));
    db.payment.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(payment("CREATED", { amountCents: 1_000 }));
    db.payment.updateMany.mockRejectedValue(dbUnavailable());
    paypal.getOrder.mockResolvedValue(paypalOrder("APPROVED", null, "10.00"));

    await expect(createPaypalOrder(TOKEN)).rejects.toMatchObject({
      code: "PAYMENT_PROVIDER_ERROR",
      message: expect.stringContaining("could not be saved for review"),
    });
    // The payment is still CREATED, so no second PayPal order is created.
    expect(paypal.getOrder).not.toHaveBeenCalled();
    expect(paypal.createOrder).not.toHaveBeenCalled();
  });

  it("refuses to replace a payment already in review", async () => {
    db.proposal.findUnique.mockResolvedValue(proposal("APPROVED"));
    db.payment.findFirst.mockResolvedValue({ id: PAYMENT_ID });

    await expect(createPaypalOrder(TOKEN)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(paypal.createOrder).not.toHaveBeenCalled();
  });
});

describe("capturePaypalOrder", () => {
  const approvedOrder = () => paypalOrder("APPROVED", null);
  const networkError = () => new TypeError("fetch failed", { cause: Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" }) });

  beforeEach(() => db.proposal.findUnique.mockResolvedValue(proposal("APPROVED")));

  it("reads the order, captures once, re-reads and verifies, then marks the payment and proposal paid together", async () => {
    db.payment.findFirst.mockResolvedValue(payment("CREATED"));
    paypal.getOrder.mockResolvedValueOnce(approvedOrder()).mockResolvedValueOnce(paypalOrder());
    paypal.captureOrder.mockResolvedValue({ id: ORDER_ID, status: "COMPLETED" });

    const result = await capturePaypalOrder(TOKEN, ORDER_ID);

    expect(db.payment.findFirst).toHaveBeenCalledWith({ where: { paypalOrderId: ORDER_ID, proposalId: PROPOSAL_ID } });
    expect(paypal.captureOrder).toHaveBeenCalledTimes(1);
    expect(paypal.captureOrder).toHaveBeenCalledWith(ORDER_ID, "req-1-capture");
    expect(paypal.getOrder).toHaveBeenCalledTimes(2);
    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(db.payment.updateMany).toHaveBeenCalledWith({
      where: { id: PAYMENT_ID, status: { in: ["CREATED", "APPROVED", "REVIEW"] } },
      data: expect.objectContaining({ status: "COMPLETED", paypalCaptureId: "CAP1", payerId: "PAYER1", verifiedAt: expect.any(Date) }),
    });
    expect(db.proposal.updateMany).toHaveBeenCalledWith({
      where: { id: PROPOSAL_ID, status: "APPROVED" },
      data: { status: "PAID", paidAt: expect.any(Date) },
    });
    expect(result).toMatchObject({ paymentStatus: "completed", proposalStatus: "paid", captureId: "CAP1", amountCents: 65_000 });
  });

  it("reconciles an order PayPal already captured without sending another capture", async () => {
    db.payment.findFirst.mockResolvedValue(payment("CREATED"));
    paypal.getOrder.mockResolvedValue(paypalOrder());

    const result = await capturePaypalOrder(TOKEN, ORDER_ID);

    expect(paypal.captureOrder).not.toHaveBeenCalled();
    expect(paypal.getOrder).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ paymentStatus: "completed", proposalStatus: "paid", captureId: "CAP1" });
  });

  it("re-reads instead of re-capturing when the capture response is lost, and records a capture that happened", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    db.payment.findFirst.mockResolvedValue(payment("CREATED"));
    paypal.getOrder.mockResolvedValueOnce(approvedOrder()).mockResolvedValueOnce(paypalOrder());
    paypal.captureOrder.mockRejectedValue(networkError());

    const result = await capturePaypalOrder(TOKEN, ORDER_ID);

    expect(paypal.captureOrder).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ paymentStatus: "completed", proposalStatus: "paid" });
  });

  it("reconciles after a transient PayPal 5xx instead of assuming the capture failed", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    db.payment.findFirst.mockResolvedValue(payment("CREATED"));
    paypal.getOrder.mockResolvedValueOnce(approvedOrder()).mockResolvedValueOnce(paypalOrder());
    paypal.captureOrder.mockRejectedValue(new PaypalApiError(500, { name: "INTERNAL_SERVER_ERROR" }));

    const result = await capturePaypalOrder(TOKEN, ORDER_ID);

    expect(paypal.captureOrder).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ paymentStatus: "completed", proposalStatus: "paid" });
  });

  it("records nothing when the capture response is lost and PayPal shows no capture", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    db.payment.findFirst.mockResolvedValue(payment("CREATED"));
    paypal.getOrder.mockResolvedValue(approvedOrder());
    paypal.captureOrder.mockRejectedValue(networkError());

    await expect(capturePaypalOrder(TOKEN, ORDER_ID)).rejects.toMatchObject({ code: "PAYMENT_PROVIDER_ERROR" });
    expect(paypal.captureOrder).toHaveBeenCalledTimes(1);
    expect(db.payment.updateMany).not.toHaveBeenCalled();
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("returns the stored result for a repeated capture without calling PayPal", async () => {
    db.proposal.findUnique.mockResolvedValue(proposal("PAID", { paidAt: now }));
    db.payment.findFirst.mockResolvedValue(payment("COMPLETED", { paypalCaptureId: "CAP1", verifiedAt: now }));

    const result = await capturePaypalOrder(TOKEN, ORDER_ID);

    expect(result).toMatchObject({ paymentStatus: "completed", proposalStatus: "paid", captureId: "CAP1" });
    expect(paypal.getOrder).not.toHaveBeenCalled();
    expect(paypal.captureOrder).not.toHaveBeenCalled();
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("returns 404 for an order that does not belong to this proposal", async () => {
    db.payment.findFirst.mockResolvedValue(null);
    await expect(capturePaypalOrder(TOKEN, "SOMEONEELSE")).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(paypal.getOrder).not.toHaveBeenCalled();
    expect(paypal.captureOrder).not.toHaveBeenCalled();
  });

  it("refuses voided or failed payments", async () => {
    for (const status of ["VOIDED", "FAILED"]) {
      db.payment.findFirst.mockResolvedValue(payment(status));
      await expect(capturePaypalOrder(TOKEN, ORDER_ID)).rejects.toMatchObject({ code: "CONFLICT" });
    }
    expect(paypal.captureOrder).not.toHaveBeenCalled();
  });

  it.each([
    ["ORDER_NOT_APPROVED", "PAYMENT_NOT_APPROVED"],
    ["PAYER_ACTION_REQUIRED", "PAYMENT_NOT_APPROVED"],
    ["INSTRUMENT_DECLINED", "PAYMENT_DECLINED"],
  ])("maps PayPal %s to %s without marking anything paid", async (issue, code) => {
    db.payment.findFirst.mockResolvedValue(payment("CREATED"));
    paypal.getOrder.mockResolvedValue(paypalOrder("CREATED", null));
    paypal.captureOrder.mockRejectedValue(paypalError(issue));

    await expect(capturePaypalOrder(TOKEN, ORDER_ID)).rejects.toMatchObject({ code });
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("continues to verification when PayPal says the order was already captured", async () => {
    db.payment.findFirst.mockResolvedValue(payment("CREATED"));
    paypal.getOrder.mockResolvedValueOnce(approvedOrder()).mockResolvedValueOnce(paypalOrder());
    paypal.captureOrder.mockRejectedValue(paypalError("ORDER_ALREADY_CAPTURED"));

    expect((await capturePaypalOrder(TOKEN, ORDER_ID)).paymentStatus).toBe("completed");
  });

  it("marks a successful capture that fails local verification for review, never FAILED", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    db.payment.findFirst.mockResolvedValue(payment("CREATED"));
    paypal.getOrder.mockResolvedValue(paypalOrder("COMPLETED", "COMPLETED", "1.00"));

    await expect(capturePaypalOrder(TOKEN, ORDER_ID)).rejects.toMatchObject({ code: "PAYMENT_PROVIDER_ERROR" });
    expect(db.payment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: PAYMENT_ID }),
        data: expect.objectContaining({ status: "REVIEW", reviewReason: expect.stringContaining("verification failed") }),
      }),
    );
    expect(db.$transaction).not.toHaveBeenCalled();
    expect(db.proposal.updateMany).not.toHaveBeenCalled();
  });

  it("rejects instead of reporting success when the REVIEW update fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    db.payment.findFirst.mockResolvedValue(payment("CREATED"));
    paypal.getOrder.mockResolvedValue(paypalOrder("COMPLETED", "COMPLETED", "1.00"));
    db.payment.updateMany.mockRejectedValue(dbUnavailable());

    await expect(capturePaypalOrder(TOKEN, ORDER_ID)).rejects.toMatchObject({
      code: "PAYMENT_PROVIDER_ERROR",
      message: expect.stringContaining("could not be saved for review"),
    });
    expect(db.$transaction).not.toHaveBeenCalled();
    expect(db.proposal.updateMany).not.toHaveBeenCalled();
  });

  it("rejects when the database fails while confirming a concurrent REVIEW write", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    db.payment.findFirst.mockResolvedValue(payment("CREATED"));
    paypal.getOrder.mockResolvedValue(paypalOrder("COMPLETED", "COMPLETED", "1.00"));
    db.payment.updateMany.mockResolvedValueOnce({ count: 0 });
    db.payment.findUnique.mockRejectedValue(dbUnavailable());

    await expect(capturePaypalOrder(TOKEN, ORDER_ID)).rejects.toMatchObject({
      code: "PAYMENT_PROVIDER_ERROR",
      message: expect.stringContaining("could not be saved for review"),
    });
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("rejects when a concurrent update leaves the payment outside REVIEW", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    db.payment.findFirst.mockResolvedValue(payment("CREATED"));
    paypal.getOrder.mockResolvedValue(paypalOrder("COMPLETED", "COMPLETED", "1.00"));
    db.payment.updateMany.mockResolvedValueOnce({ count: 0 });
    db.payment.findUnique.mockResolvedValue(payment("APPROVED"));

    await expect(capturePaypalOrder(TOKEN, ORDER_ID)).rejects.toMatchObject({
      code: "PAYMENT_PROVIDER_ERROR",
      message: expect.stringContaining("could not be saved for review"),
    });
    expect(db.$transaction).not.toHaveBeenCalled();
    expect(db.proposal.updateMany).not.toHaveBeenCalled();
  });

  it("keeps the review reason when the capture id belongs to another payment", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    db.payment.findFirst.mockResolvedValue(payment("CREATED"));
    paypal.getOrder.mockResolvedValue(paypalOrder("COMPLETED", "COMPLETED", "1.00"));
    db.payment.updateMany.mockRejectedValueOnce(uniqueViolation()).mockResolvedValueOnce({ count: 1 });

    await expect(capturePaypalOrder(TOKEN, ORDER_ID)).rejects.toMatchObject({
      code: "PAYMENT_PROVIDER_ERROR",
      message: expect.stringContaining("flagged for review"),
    });

    expect(db.payment.updateMany).toHaveBeenCalledTimes(2);
    // The second attempt keeps the audit data but never steals the capture id.
    expect(db.payment.updateMany.mock.calls[1][0].data).toMatchObject({
      status: "REVIEW",
      reviewReason: expect.stringContaining("verification failed"),
    });
    expect(db.payment.updateMany.mock.calls[1][0].data).not.toHaveProperty("paypalCaptureId");
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("rejects when the capture id conflict cannot be resolved", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    db.payment.findFirst.mockResolvedValue(payment("CREATED"));
    paypal.getOrder.mockResolvedValue(paypalOrder("COMPLETED", "COMPLETED", "1.00"));
    db.payment.updateMany.mockRejectedValueOnce(uniqueViolation()).mockRejectedValueOnce(dbUnavailable());

    await expect(capturePaypalOrder(TOKEN, ORDER_ID)).rejects.toMatchObject({
      code: "PAYMENT_PROVIDER_ERROR",
      message: expect.stringContaining("could not be saved for review"),
    });
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("rejects a payment currency mismatch and records review instead of paying", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    db.payment.findFirst.mockResolvedValue(payment("CREATED", { currency: "EUR" }));
    paypal.getOrder.mockResolvedValue(paypalOrder());

    await expect(capturePaypalOrder(TOKEN, ORDER_ID)).rejects.toMatchObject({ code: "PAYMENT_PROVIDER_ERROR" });
    expect(db.payment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "REVIEW", reviewReason: expect.stringContaining("does not match") }),
      }),
    );
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("flags review instead of FAILED when a capture may still settle at a different amount", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    db.payment.findFirst.mockResolvedValue(payment("CREATED"));
    paypal.getOrder.mockResolvedValue(paypalOrder("APPROVED", "PENDING", "1.00"));
    paypal.captureOrder.mockResolvedValue({ id: ORDER_ID, status: "COMPLETED" });

    await expect(capturePaypalOrder(TOKEN, ORDER_ID)).rejects.toMatchObject({ code: "PAYMENT_PROVIDER_ERROR" });
    expect(db.payment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "REVIEW" }) }),
    );
    expect(db.payment.updateMany).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "FAILED" }) }),
    );
    expect(db.proposal.updateMany).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "PAID" }) }),
    );
  });

  it("flags review, never FAILED, when a completed capture is not the first capture entry", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    db.payment.findFirst.mockResolvedValue(payment("CREATED"));
    const order = paypalOrder("COMPLETED", "COMPLETED");
    order.purchase_units[0].payments = {
      captures: [
        { id: "DECLINED1", status: "DECLINED", amount: { currency_code: "USD", value: "650.00" } },
        { id: "CAP1", status: "COMPLETED", amount: { currency_code: "USD", value: "650.00" } },
      ],
    };
    paypal.getOrder.mockResolvedValue(order);

    await expect(capturePaypalOrder(TOKEN, ORDER_ID)).rejects.toMatchObject({ code: "PAYMENT_PROVIDER_ERROR" });

    expect(db.payment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        // The money-moving capture is the one recorded for audit.
        data: expect.objectContaining({ status: "REVIEW", paypalCaptureId: "CAP1" }),
      }),
    );
    expect(db.payment.updateMany).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "FAILED" }) }),
    );
  });

  it("flags review instead of FAILED when a COMPLETED order reports a declined capture", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    db.payment.findFirst.mockResolvedValue(payment("CREATED"));
    paypal.getOrder.mockResolvedValue(paypalOrder("COMPLETED", "DECLINED"));

    await expect(capturePaypalOrder(TOKEN, ORDER_ID)).rejects.toMatchObject({ code: "PAYMENT_PROVIDER_ERROR" });

    expect(db.payment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "REVIEW" }) }),
    );
    expect(db.payment.updateMany).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "FAILED" }) }),
    );
  });

  it("retires a dead PayPal order without trying to capture it", async () => {
    db.payment.findFirst.mockResolvedValue(payment("CREATED"));
    paypal.getOrder.mockResolvedValue(paypalOrder("VOIDED", null));

    await expect(capturePaypalOrder(TOKEN, ORDER_ID)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(paypal.captureOrder).not.toHaveBeenCalled();
    expect(db.payment.updateMany).toHaveBeenCalledWith({
      where: { id: PAYMENT_ID, status: { in: ["CREATED", "APPROVED"] } },
      data: { status: "VOIDED" },
    });
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("keeps a pending capture open instead of marking it paid", async () => {
    db.payment.findFirst.mockResolvedValue(payment("CREATED"));
    paypal.getOrder.mockResolvedValueOnce(approvedOrder()).mockResolvedValueOnce(paypalOrder("APPROVED", "PENDING"));
    paypal.captureOrder.mockResolvedValue({ id: ORDER_ID, status: "COMPLETED" });
    db.payment.findUniqueOrThrow.mockResolvedValue(payment("APPROVED", { paypalCaptureId: "CAP1" }));

    const result = await capturePaypalOrder(TOKEN, ORDER_ID);

    expect(result).toMatchObject({ paymentStatus: "pending", proposalStatus: "approved", paidAt: null });
    expect(db.payment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "APPROVED", paypalCaptureId: "CAP1" }) }),
    );
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("keeps a REVIEW payment in REVIEW while its capture is only pending", async () => {
    db.payment.findFirst.mockResolvedValue(payment("REVIEW", { reviewReason: "previous mismatch" }));
    paypal.getOrder.mockResolvedValue(paypalOrder("APPROVED", "PENDING"));
    paypal.captureOrder.mockResolvedValue({ id: ORDER_ID, status: "COMPLETED" });
    db.payment.findUniqueOrThrow.mockResolvedValue(
      payment("REVIEW", { paypalCaptureId: "CAP1", reviewReason: "previous mismatch" }),
    );

    const result = await capturePaypalOrder(TOKEN, ORDER_ID);

    expect(result).toMatchObject({ paymentStatus: "pending", proposalStatus: "approved", paidAt: null });
    // No `status` field: a pending capture is not a reconciliation basis, so the
    // payment must not silently leave REVIEW for APPROVED.
    expect(db.payment.updateMany).toHaveBeenCalledTimes(1);
    expect(db.payment.updateMany).toHaveBeenCalledWith({
      where: { id: PAYMENT_ID, status: { in: ["CREATED", "APPROVED", "REVIEW"] } },
      data: { paypalCaptureId: "CAP1", providerPayload: expect.anything() },
    });
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("lets REVIEW become FAILED only on clear evidence that no money moved", async () => {
    db.payment.findFirst.mockResolvedValue(payment("REVIEW", { reviewReason: "previous mismatch" }));
    paypal.getOrder.mockResolvedValue(paypalOrder("APPROVED", "DECLINED"));
    paypal.captureOrder.mockResolvedValue({ id: ORDER_ID, status: "COMPLETED" });

    await expect(capturePaypalOrder(TOKEN, ORDER_ID)).rejects.toMatchObject({ code: "PAYMENT_DECLINED" });
    expect(db.payment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: PAYMENT_ID, status: { in: ["CREATED", "APPROVED", "REVIEW"] } },
        data: expect.objectContaining({ status: "FAILED", reviewReason: null }),
      }),
    );
  });

  it("marks a declined capture as FAILED", async () => {
    db.payment.findFirst.mockResolvedValue(payment("CREATED"));
    paypal.getOrder.mockResolvedValueOnce(approvedOrder()).mockResolvedValueOnce(paypalOrder("APPROVED", "DECLINED"));
    paypal.captureOrder.mockResolvedValue({ id: ORDER_ID, status: "COMPLETED" });

    await expect(capturePaypalOrder(TOKEN, ORDER_ID)).rejects.toMatchObject({ code: "PAYMENT_DECLINED" });
    expect(db.payment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "FAILED" }) }),
    );
  });

  it("reports a persistence error when a zero-row FAILED update leaves the payment ambiguous", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    db.payment.findFirst.mockResolvedValue(payment("CREATED"));
    paypal.getOrder.mockResolvedValue(paypalOrder("APPROVED", "DECLINED"));
    paypal.captureOrder.mockResolvedValue({ id: ORDER_ID, status: "COMPLETED" });
    db.payment.updateMany.mockResolvedValue({ count: 0 });
    db.payment.findUnique.mockResolvedValue(null);

    await expect(capturePaypalOrder(TOKEN, ORDER_ID)).rejects.toMatchObject({
      code: "PAYMENT_PROVIDER_ERROR",
      message: expect.stringContaining("payment state could not be saved"),
    });
    expect(db.proposal.updateMany).not.toHaveBeenCalled();
  });

  it("reports a decline when a zero-row FAILED update finds an already resolved payment", async () => {
    db.payment.findFirst.mockResolvedValue(payment("CREATED"));
    paypal.getOrder.mockResolvedValue(paypalOrder("APPROVED", "DECLINED"));
    paypal.captureOrder.mockResolvedValue({ id: ORDER_ID, status: "COMPLETED" });
    db.payment.updateMany.mockResolvedValue({ count: 0 });
    db.payment.findUnique.mockResolvedValue(payment("FAILED"));
    db.proposal.findUnique.mockResolvedValue(proposal("APPROVED"));

    await expect(capturePaypalOrder(TOKEN, ORDER_ID)).rejects.toMatchObject({ code: "PAYMENT_DECLINED" });
    expect(db.proposal.updateMany).not.toHaveBeenCalled();
  });

  it("flags review instead of a decline when a concurrent COMPLETED row lacks verification evidence", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    db.payment.findFirst.mockResolvedValue(payment("CREATED"));
    paypal.getOrder.mockResolvedValue(paypalOrder("APPROVED", "DECLINED"));
    paypal.captureOrder.mockResolvedValue({ id: ORDER_ID, status: "COMPLETED" });
    db.payment.updateMany
      .mockResolvedValueOnce({ count: 0 }) // FAILED update
      .mockResolvedValueOnce({ count: 0 }) // REVIEW update (COMPLETED is immutable)
      .mockResolvedValueOnce({ count: 1 }); // audit note
    db.payment.findUnique.mockResolvedValue(payment("COMPLETED", { paypalCaptureId: null, verifiedAt: null }));
    db.proposal.findUnique
      .mockResolvedValueOnce(proposal("APPROVED")) // findSharedProposal
      .mockResolvedValue({ status: "APPROVED", paidAt: null }); // storedCompletion + review

    await expect(capturePaypalOrder(TOKEN, ORDER_ID)).rejects.toMatchObject({
      code: "PAYMENT_PROVIDER_ERROR",
      message: expect.stringContaining("already completed"),
    });

    expect(db.payment.updateMany).toHaveBeenNthCalledWith(2, {
      where: { id: PAYMENT_ID, status: { not: "COMPLETED" } },
      data: expect.objectContaining({ status: "REVIEW" }),
    });
    expect(db.payment.updateMany).toHaveBeenNthCalledWith(3, {
      where: { id: PAYMENT_ID },
      data: { reviewReason: expect.stringContaining("could not be marked FAILED") },
    });
  });

  it("rejects when a FAILED update hits an unexpected unique violation", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    db.payment.findFirst.mockResolvedValue(payment("CREATED"));
    paypal.getOrder.mockResolvedValue(paypalOrder("APPROVED", "DECLINED"));
    paypal.captureOrder.mockResolvedValue({ id: ORDER_ID, status: "COMPLETED" });
    db.payment.updateMany.mockRejectedValue(uniqueViolation());
    db.payment.findUnique.mockResolvedValue(null);

    await expect(capturePaypalOrder(TOKEN, ORDER_ID)).rejects.toMatchObject({
      code: "PAYMENT_PROVIDER_ERROR",
      message: expect.stringContaining("payment state could not be saved"),
    });
    expect(db.proposal.updateMany).not.toHaveBeenCalled();
  });

  it("returns the stored completion when a FAILED update races a verified completion", async () => {
    db.payment.findFirst.mockResolvedValue(payment("CREATED"));
    paypal.getOrder.mockResolvedValue(paypalOrder("APPROVED", "DECLINED"));
    paypal.captureOrder.mockResolvedValue({ id: ORDER_ID, status: "COMPLETED" });
    db.payment.updateMany.mockRejectedValue(uniqueViolation());
    db.payment.findUnique.mockResolvedValue(payment("COMPLETED", { paypalCaptureId: "CAP1", verifiedAt: now }));
    db.proposal.findUnique
      .mockResolvedValueOnce(proposal("APPROVED")) // findSharedProposal
      .mockResolvedValue({ status: "PAID", paidAt: now }); // storedCompletion

    const result = await capturePaypalOrder(TOKEN, ORDER_ID);

    expect(result).toMatchObject({ paymentStatus: "completed", proposalStatus: "paid", captureId: "CAP1" });
    expect(db.proposal.updateMany).not.toHaveBeenCalled();
  });

  it("reconciles a concurrent capture that completed first through the stored result", async () => {
    db.payment.findFirst.mockResolvedValue(payment("CREATED"));
    paypal.getOrder.mockResolvedValue(paypalOrder());
    db.payment.updateMany.mockResolvedValueOnce({ count: 0 });
    db.payment.findUnique.mockResolvedValue(payment("COMPLETED", { paypalCaptureId: "CAP1", verifiedAt: now }));
    db.proposal.findUnique.mockResolvedValue({ status: "PAID", paidAt: now });

    expect(await capturePaypalOrder(TOKEN, ORDER_ID)).toMatchObject({ paymentStatus: "completed", proposalStatus: "paid" });
  });

  it("rolls back and flags review when the proposal cannot transition after a successful capture", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    db.payment.findFirst.mockResolvedValue(payment("CREATED"));
    paypal.getOrder.mockResolvedValue(paypalOrder());
    db.proposal.updateMany.mockResolvedValue({ count: 0 });
    db.payment.findUnique.mockResolvedValue(payment("CREATED"));
    db.proposal.findUnique
      .mockResolvedValueOnce(proposal("APPROVED"))
      .mockResolvedValue({ status: "CANCELLED", paidAt: null });

    await expect(capturePaypalOrder(TOKEN, ORDER_ID)).rejects.toMatchObject({ code: "PAYMENT_PROVIDER_ERROR" });
    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(db.payment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: PAYMENT_ID }),
        data: expect.objectContaining({ status: "REVIEW" }),
      }),
    );
    expect(db.proposal.updateMany).toHaveBeenCalledWith({
      where: { id: PROPOSAL_ID, status: "APPROVED" },
      data: { status: "PAID", paidAt: expect.any(Date) },
    });
  });

  it("does not add a review note when the payment already completed and the proposal is paid", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    db.payment.findFirst.mockResolvedValue(payment("CREATED"));
    paypal.getOrder.mockResolvedValue(paypalOrder("COMPLETED", "COMPLETED", "1.00"));
    // Simulate losing the race: the payment was completed by a concurrent call.
    db.payment.updateMany.mockResolvedValueOnce({ count: 0 });
    db.payment.findUnique.mockResolvedValue(payment("COMPLETED", { paypalCaptureId: "CAP1", verifiedAt: now }));
    db.proposal.findUnique
      .mockResolvedValueOnce(proposal("APPROVED")) // findSharedProposal
      .mockResolvedValue({ status: "PAID", paidAt: now }); // consistency check + stored completion

    const result = await capturePaypalOrder(TOKEN, ORDER_ID);

    expect(result).toMatchObject({ paymentStatus: "completed", proposalStatus: "paid" });
    // The only updateMany is the attempted REVIEW transition, which matched 0
    // rows. No follow-up note is written for an already-consistent payment.
    expect(db.payment.updateMany).toHaveBeenCalledTimes(1);
  });

  it("records an audit note but never reports success when a COMPLETED payment's proposal is not paid", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    db.payment.findFirst.mockResolvedValue(payment("COMPLETED", { paypalCaptureId: "CAP1", verifiedAt: now }));
    db.proposal.findUnique.mockResolvedValue(proposal("CANCELLED"));
    db.payment.updateMany.mockResolvedValueOnce({ count: 0 });
    db.payment.findUnique.mockResolvedValue(payment("COMPLETED", { paypalCaptureId: "CAP1", verifiedAt: now }));

    await expect(capturePaypalOrder(TOKEN, ORDER_ID)).rejects.toMatchObject({ code: "PAYMENT_PROVIDER_ERROR" });

    expect(db.payment.updateMany).toHaveBeenNthCalledWith(2, {
      where: { id: PAYMENT_ID },
      data: { reviewReason: expect.stringContaining("proposal is CANCELLED") },
    });
    expect(db.$transaction).not.toHaveBeenCalled();
    expect(db.proposal.updateMany).not.toHaveBeenCalled();
  });

  it("repairs an APPROVED proposal when a verified COMPLETED payment already exists", async () => {
    db.payment.findFirst.mockResolvedValue(payment("COMPLETED", { paypalCaptureId: "CAP1", verifiedAt: now }));
    db.proposal.findUnique.mockResolvedValue(proposal("APPROVED"));
    db.proposal.updateMany.mockResolvedValue({ count: 1 });

    const result = await capturePaypalOrder(TOKEN, ORDER_ID);

    expect(result).toMatchObject({ paymentStatus: "completed", proposalStatus: "paid", paidAt: now.toISOString() });
    expect(db.proposal.updateMany).toHaveBeenCalledWith({
      where: { id: PROPOSAL_ID, status: "APPROVED" },
      data: { status: "PAID", paidAt: now },
    });
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("does not report success when repairing a COMPLETED payment's proposal fails", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    db.payment.findFirst.mockResolvedValue(payment("COMPLETED", { paypalCaptureId: "CAP1", verifiedAt: now }));
    db.proposal.findUnique.mockResolvedValue(proposal("APPROVED"));
    db.proposal.updateMany.mockRejectedValue(dbUnavailable());

    await expect(capturePaypalOrder(TOKEN, ORDER_ID)).rejects.toMatchObject({ code: "PAYMENT_PROVIDER_ERROR" });

    expect(errorSpy).toHaveBeenCalledWith("Failed to repair proposal after verified capture", {
      proposalId: PROPOSAL_ID,
      paymentId: PAYMENT_ID,
      error: { name: "PrismaClientKnownRequestError", code: "P1001" },
    });
    // The fallback review update is still guarded against COMPLETED rows.
    expect(db.payment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: PAYMENT_ID, status: { not: "COMPLETED" } } }),
    );
    expect(db.payment.updateMany).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "FAILED" }) }),
    );
  });

  it("does not report success when a concurrent update wins the proposal repair", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    db.payment.findFirst.mockResolvedValue(payment("COMPLETED", { paypalCaptureId: "CAP1", verifiedAt: now }));
    db.proposal.findUnique.mockResolvedValue(proposal("APPROVED"));
    db.proposal.updateMany.mockResolvedValue({ count: 0 });

    await expect(capturePaypalOrder(TOKEN, ORDER_ID)).rejects.toMatchObject({ code: "PAYMENT_PROVIDER_ERROR" });

    expect(warnSpy).toHaveBeenCalledWith("Proposal repair was not applied", {
      proposalId: PROPOSAL_ID,
      paymentId: PAYMENT_ID,
      matched: 0,
    });
    expect(db.payment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: PAYMENT_ID, status: { not: "COMPLETED" } } }),
    );
  });

  it("treats a failed repair as success only when a reread proves the pair is consistent", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    db.payment.findFirst.mockResolvedValue(payment("COMPLETED", { paypalCaptureId: "CAP1", verifiedAt: now }));
    db.proposal.findUnique
      .mockResolvedValueOnce(proposal("APPROVED")) // findSharedProposal
      .mockResolvedValue({ status: "PAID", paidAt: now }); // repair reread
    db.proposal.updateMany.mockRejectedValue(dbUnavailable());
    db.payment.findUnique.mockResolvedValue(payment("COMPLETED", { paypalCaptureId: "CAP1", verifiedAt: now }));

    const result = await capturePaypalOrder(TOKEN, ORDER_ID);

    expect(result).toMatchObject({ paymentStatus: "completed", proposalStatus: "paid", paidAt: now.toISOString() });
    expect(errorSpy).toHaveBeenCalledWith("Failed to repair proposal after verified capture", {
      proposalId: PROPOSAL_ID,
      paymentId: PAYMENT_ID,
      error: { name: "PrismaClientKnownRequestError", code: "P1001" },
    });
    // The write was never retried: the reread alone established the result.
    expect(db.proposal.updateMany).toHaveBeenCalledTimes(1);
    expect(db.payment.updateMany).not.toHaveBeenCalled();
  });

  it("does not treat a repair reread as success while the proposal is still not paid", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    db.payment.findFirst.mockResolvedValue(payment("COMPLETED", { paypalCaptureId: "CAP1", verifiedAt: now }));
    db.proposal.findUnique.mockResolvedValue(proposal("APPROVED"));
    db.proposal.updateMany.mockResolvedValue({ count: 0 });
    db.payment.findUnique.mockResolvedValue(payment("COMPLETED", { paypalCaptureId: "CAP1", verifiedAt: now }));

    await expect(capturePaypalOrder(TOKEN, ORDER_ID)).rejects.toMatchObject({ code: "PAYMENT_PROVIDER_ERROR" });

    expect(db.payment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: PAYMENT_ID, status: { not: "COMPLETED" } } }),
    );
  });

  it("returns a persistence error when the repair reread fails", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    db.payment.findFirst.mockResolvedValue(payment("COMPLETED", { paypalCaptureId: "CAP1", verifiedAt: now }));
    db.proposal.updateMany.mockRejectedValue(dbUnavailable());
    db.payment.findUnique.mockRejectedValue(dbUnavailable());

    await expect(capturePaypalOrder(TOKEN, ORDER_ID)).rejects.toMatchObject({
      code: "PAYMENT_PROVIDER_ERROR",
      message: expect.stringContaining("payment state could not be saved"),
    });

    expect(errorSpy).toHaveBeenCalledWith("Failed to repair proposal after verified capture", {
      proposalId: PROPOSAL_ID,
      paymentId: PAYMENT_ID,
      error: { name: "PrismaClientKnownRequestError", code: "P1001" },
    });
    expect(db.payment.updateMany).not.toHaveBeenCalled();
  });

  it("returns a persistence error when the stored completion cannot be read after P2002", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    db.payment.findFirst.mockResolvedValue(payment("CREATED"));
    paypal.getOrder.mockResolvedValue(paypalOrder("APPROVED", "DECLINED"));
    paypal.captureOrder.mockResolvedValue({ id: ORDER_ID, status: "COMPLETED" });
    db.payment.updateMany.mockRejectedValue(uniqueViolation());
    db.payment.findUnique.mockRejectedValue(dbUnavailable());

    await expect(capturePaypalOrder(TOKEN, ORDER_ID)).rejects.toMatchObject({
      code: "PAYMENT_PROVIDER_ERROR",
      message: expect.stringContaining("payment state could not be saved"),
    });

    expect(errorSpy).toHaveBeenCalledWith("Failed to read stored payment completion", {
      paymentId: PAYMENT_ID,
      proposalId: PROPOSAL_ID,
      error: { name: "PrismaClientKnownRequestError", code: "P1001" },
    });
  });

  it("returns a persistence error when the post-transaction reread fails", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    db.payment.findFirst.mockResolvedValue(payment("CREATED"));
    paypal.getOrder.mockResolvedValue(paypalOrder());
    // Payment transition succeeds, proposal transition fails, so reconciliation
    // is attempted and then its own re-read fails.
    db.payment.updateMany.mockResolvedValue({ count: 1 });
    db.proposal.updateMany.mockResolvedValue({ count: 0 });
    db.payment.findUnique
      .mockResolvedValueOnce(payment("CREATED")) // storedCompletion
      .mockRejectedValue(dbUnavailable()); // reconcileCompletionFailure reread
    db.proposal.findUnique
      .mockResolvedValueOnce(proposal("APPROVED")) // findSharedProposal
      .mockResolvedValue({ status: "APPROVED", paidAt: null }); // storedCompletion + reread

    await expect(capturePaypalOrder(TOKEN, ORDER_ID)).rejects.toMatchObject({
      code: "PAYMENT_PROVIDER_ERROR",
      message: expect.stringContaining("payment state could not be saved"),
    });

    expect(errorSpy).toHaveBeenCalledWith("Failed to re-read payment after a completion failure", {
      paymentId: PAYMENT_ID,
      proposalId: PROPOSAL_ID,
      error: { name: "PrismaClientKnownRequestError", code: "P1001" },
    });
  });

  it("never reports success nor repairs a proposal when a COMPLETED payment lacks verification evidence", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    db.payment.findFirst.mockResolvedValue(payment("COMPLETED", { paypalCaptureId: "CAP1", verifiedAt: null }));
    db.proposal.findUnique.mockResolvedValue(proposal("APPROVED"));

    await expect(capturePaypalOrder(TOKEN, ORDER_ID)).rejects.toMatchObject({ code: "PAYMENT_PROVIDER_ERROR" });

    expect(db.proposal.updateMany).not.toHaveBeenCalled();
    expect(db.$transaction).not.toHaveBeenCalled();
    expect(paypal.getOrder).not.toHaveBeenCalled();
  });

  it("records the audit reason for a COMPLETED payment without verification evidence even when the proposal is paid", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    db.payment.findFirst.mockResolvedValue(payment("COMPLETED", { paypalCaptureId: "CAP1", verifiedAt: null }));
    db.proposal.findUnique.mockResolvedValue(proposal("PAID", { paidAt: now }));
    db.payment.updateMany.mockResolvedValueOnce({ count: 0 });
    db.payment.findUnique.mockResolvedValue(payment("COMPLETED", { paypalCaptureId: "CAP1", verifiedAt: null }));

    await expect(capturePaypalOrder(TOKEN, ORDER_ID)).rejects.toMatchObject({ code: "PAYMENT_PROVIDER_ERROR" });

    expect(db.payment.updateMany).toHaveBeenNthCalledWith(1, {
      where: { id: PAYMENT_ID, status: { not: "COMPLETED" } },
      data: expect.objectContaining({ status: "REVIEW" }),
    });
    expect(db.payment.updateMany).toHaveBeenNthCalledWith(2, {
      where: { id: PAYMENT_ID },
      data: { reviewReason: expect.stringContaining("without a verified capture") },
    });
    // The audit note never writes a status, so COMPLETED stays COMPLETED.
    expect(db.payment.updateMany.mock.calls[1][0].data).not.toHaveProperty("status");
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("rejects when the audit note for an inconsistent COMPLETED payment cannot be saved", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    db.payment.findFirst.mockResolvedValue(payment("COMPLETED", { paypalCaptureId: "CAP1", verifiedAt: now }));
    db.proposal.findUnique.mockResolvedValue(proposal("CANCELLED"));
    db.payment.updateMany.mockResolvedValueOnce({ count: 0 }).mockRejectedValueOnce(dbUnavailable());
    db.payment.findUnique.mockResolvedValue(payment("COMPLETED", { paypalCaptureId: "CAP1", verifiedAt: now }));

    await expect(capturePaypalOrder(TOKEN, ORDER_ID)).rejects.toMatchObject({
      code: "PAYMENT_PROVIDER_ERROR",
      message: expect.stringContaining("could not be saved for review"),
    });
    expect(db.$transaction).not.toHaveBeenCalled();
    expect(db.proposal.updateMany).not.toHaveBeenCalled();
  });

  it("does not report a decline as recorded when the FAILED update cannot be saved", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    db.payment.findFirst.mockResolvedValue(payment("CREATED"));
    paypal.getOrder.mockResolvedValue(paypalOrder("APPROVED", "DECLINED"));
    paypal.captureOrder.mockResolvedValue({ id: ORDER_ID, status: "COMPLETED" });
    db.payment.updateMany.mockRejectedValue(dbUnavailable());

    await expect(capturePaypalOrder(TOKEN, ORDER_ID)).rejects.toMatchObject({
      code: "PAYMENT_PROVIDER_ERROR",
      message: expect.stringContaining("payment state could not be saved"),
    });
    expect(db.$transaction).not.toHaveBeenCalled();
    expect(db.proposal.updateMany).not.toHaveBeenCalled();
  });

  it("allows a REVIEW payment to reconcile to COMPLETED when the proposal is still approved", async () => {
    db.payment.findFirst.mockResolvedValue(payment("REVIEW", { reviewReason: "previous reconciliation" }));
    paypal.getOrder.mockResolvedValue(paypalOrder());

    const result = await capturePaypalOrder(TOKEN, ORDER_ID);

    expect(result).toMatchObject({ paymentStatus: "completed", proposalStatus: "paid" });
    expect(db.payment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "COMPLETED", reviewReason: null }) }),
    );
  });
});

describe("getPublicProposal", () => {
  it("returns exactly the public fields and never internal or payment data", async () => {
    db.proposal.findUnique.mockResolvedValue(proposal("SENT"));

    const result = await getPublicProposal(TOKEN);

    expect(Object.keys(result).sort()).toEqual(
      ["approvedAt", "clientName", "currency", "freelancerName", "items", "paidAt", "status", "subtotalCents", "summary", "title", "totalCents", "totalHours"].sort(),
    );
    const serialized = JSON.stringify(result);
    for (const secret of [PROPOSAL_ID, "u1", "client@example.com", TOKEN, PAYMENT_ID, ORDER_ID]) {
      expect(serialized).not.toContain(secret);
    }
    expect(result).toMatchObject({ status: "sent", freelancerName: "Freelancer", totalCents: 65_000, currency: "USD" });
  });

  it("only reads: opening the link never changes the proposal", async () => {
    db.proposal.findUnique.mockResolvedValue(proposal("SENT"));
    await getPublicProposal(TOKEN);

    expect(db.proposal.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { shareToken: TOKEN } }));
    expect(db.proposal.updateMany).not.toHaveBeenCalled();
    expect(db.payment.updateMany).not.toHaveBeenCalled();
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("returns the same 404 for unknown tokens and drafts", async () => {
    db.proposal.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(proposal("DRAFT"));
    const unknown = await getPublicProposal(TOKEN).catch((e: unknown) => e);
    const draft = await getPublicProposal(TOKEN).catch((e: unknown) => e);
    expect(unknown).toMatchObject({ code: "NOT_FOUND", message: "Proposal not found" });
    expect(draft).toMatchObject({ code: "NOT_FOUND", message: "Proposal not found" });
  });

  it("still shows rejected and cancelled proposals with their status", async () => {
    for (const status of ["REJECTED", "CANCELLED"]) {
      db.proposal.findUnique.mockResolvedValue(proposal(status));
      expect((await getPublicProposal(TOKEN)).status).toBe(status.toLowerCase());
    }
  });
});

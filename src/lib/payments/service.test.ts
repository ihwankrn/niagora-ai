import { beforeEach, describe, expect, it, vi } from "vitest";

import { Prisma } from "@/generated/prisma/client";
import { PaypalApiError } from "@/lib/paypal/client";

const db = vi.hoisted(() => ({
  proposal: { findUnique: vi.fn(), findFirst: vi.fn(), findUniqueOrThrow: vi.fn(), updateMany: vi.fn() },
  payment: { findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  $transaction: vi.fn(),
}));
const paypal = vi.hoisted(() => ({ createOrder: vi.fn(), captureOrder: vi.fn(), getOrder: vi.fn() }));

vi.mock("@/lib/db", () => ({ prisma: db }));
vi.mock("@/lib/paypal/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/paypal/client")>()),
  ...paypal,
}));

const { approveProposal, capturePaypalOrder, createPaypalOrder, sendProposal } = await import("./service");

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

const paypalError = (issue: string) =>
  new PaypalApiError(422, { name: "UNPROCESSABLE_ENTITY", details: [{ issue }] });

const uniqueViolation = () => new Prisma.PrismaClientKnownRequestError("Unique constraint failed", { code: "P2002", clientVersion: "7.10.1" });

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("APP_BASE_URL", "http://localhost:3000/");
  db.$transaction.mockImplementation((operations: Promise<unknown>[]) => Promise.all(operations));
  db.payment.update.mockImplementation(async ({ data }) => ({ ...payment("CREATED"), ...data }));
  db.proposal.updateMany.mockResolvedValue({ count: 1 });
  db.payment.updateMany.mockResolvedValue({ count: 1 });
});

describe("sendProposal", () => {
  it("only lets the owner send, moves DRAFT to SENT and returns the client link", async () => {
    db.proposal.findFirst.mockResolvedValue({ status: "DRAFT" });
    db.proposal.findUniqueOrThrow.mockResolvedValue(proposal("SENT"));

    const result = await sendProposal({ id: "u1", email: "f@example.com" }, PROPOSAL_ID);

    expect(db.proposal.findFirst).toHaveBeenCalledWith({ where: { id: PROPOSAL_ID, userId: "u1" }, select: { status: true } });
    expect(db.proposal.updateMany).toHaveBeenCalledWith({ where: { id: PROPOSAL_ID, status: "DRAFT" }, data: { status: "SENT" } });
    expect(result.shareUrl).toBe(`http://localhost:3000/p/${TOKEN}`);
    expect(result.proposal.status).toBe("sent");
  });

  it("returns 404 for someone else's proposal", async () => {
    db.proposal.findFirst.mockResolvedValue(null);
    await expect(sendProposal({ id: "u2", email: "x@example.com" }, PROPOSAL_ID)).rejects.toMatchObject({ code: "NOT_FOUND" });
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
    paypal.createOrder.mockResolvedValue(paypalOrder("CREATED", null));

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

  it("reuses an open order that PayPal still accepts", async () => {
    db.proposal.findUnique.mockResolvedValue(proposal("APPROVED"));
    db.payment.findFirst.mockResolvedValue(payment("CREATED"));
    paypal.getOrder.mockResolvedValue(paypalOrder("APPROVED", null));

    expect((await createPaypalOrder(TOKEN)).orderId).toBe(ORDER_ID);
    expect(paypal.createOrder).not.toHaveBeenCalled();
  });

  it("voids an expired open order and creates a new one", async () => {
    db.proposal.findUnique.mockResolvedValue(proposal("APPROVED"));
    db.payment.findFirst.mockResolvedValue(payment("CREATED"));
    paypal.getOrder.mockRejectedValue(new PaypalApiError(404, { name: "RESOURCE_NOT_FOUND" }));
    paypal.createOrder.mockResolvedValue({ ...paypalOrder("CREATED", null), id: "NEWORDER" });

    expect((await createPaypalOrder(TOKEN)).orderId).toBe("NEWORDER");
    expect(db.payment.updateMany).toHaveBeenCalledWith({
      where: { id: PAYMENT_ID, status: { in: ["CREATED", "APPROVED"] } },
      data: { status: "VOIDED" },
    });
  });

  it("returns the winning order when a concurrent request opened one first", async () => {
    db.proposal.findUnique.mockResolvedValue(proposal("APPROVED"));
    db.payment.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(payment("CREATED", { paypalOrderId: "WINNER" }));
    paypal.createOrder.mockResolvedValue({ ...paypalOrder("CREATED", null), id: "LOSER" });
    db.payment.create.mockRejectedValue(uniqueViolation());

    expect((await createPaypalOrder(TOKEN)).orderId).toBe("WINNER");
  });
});

describe("capturePaypalOrder", () => {
  beforeEach(() => db.proposal.findUnique.mockResolvedValue(proposal("APPROVED")));

  it("captures, re-reads and verifies the order, then marks the payment and proposal paid together", async () => {
    db.payment.findFirst.mockResolvedValue(payment("CREATED"));
    paypal.captureOrder.mockResolvedValue({ id: ORDER_ID, status: "COMPLETED" });
    paypal.getOrder.mockResolvedValue(paypalOrder());

    const result = await capturePaypalOrder(TOKEN, ORDER_ID);

    expect(db.payment.findFirst).toHaveBeenCalledWith({ where: { paypalOrderId: ORDER_ID, proposalId: PROPOSAL_ID } });
    expect(paypal.captureOrder).toHaveBeenCalledWith(ORDER_ID, "req-1-capture");
    expect(paypal.getOrder).toHaveBeenCalledWith(ORDER_ID);
    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(db.payment.update).toHaveBeenCalledWith({
      where: { id: PAYMENT_ID },
      data: expect.objectContaining({ status: "COMPLETED", paypalCaptureId: "CAP1", payerId: "PAYER1", verifiedAt: expect.any(Date) }),
    });
    expect(db.proposal.updateMany).toHaveBeenCalledWith({
      where: { id: PROPOSAL_ID, status: "APPROVED" },
      data: { status: "PAID", paidAt: expect.any(Date) },
    });
    expect(result).toMatchObject({ paymentStatus: "completed", proposalStatus: "paid", captureId: "CAP1", amountCents: 65_000 });
  });

  it("returns the stored result for a repeated capture without calling PayPal", async () => {
    db.proposal.findUnique.mockResolvedValue(proposal("PAID", { paidAt: now }));
    db.payment.findFirst.mockResolvedValue(payment("COMPLETED", { paypalCaptureId: "CAP1" }));

    const result = await capturePaypalOrder(TOKEN, ORDER_ID);

    expect(result).toMatchObject({ paymentStatus: "completed", proposalStatus: "paid", captureId: "CAP1" });
    expect(paypal.captureOrder).not.toHaveBeenCalled();
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("returns 404 for an order that does not belong to this proposal", async () => {
    db.payment.findFirst.mockResolvedValue(null);
    await expect(capturePaypalOrder(TOKEN, "SOMEONEELSE")).rejects.toMatchObject({ code: "NOT_FOUND" });
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
    paypal.captureOrder.mockRejectedValue(paypalError(issue));

    await expect(capturePaypalOrder(TOKEN, ORDER_ID)).rejects.toMatchObject({ code });
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("continues to verification when PayPal says the order was already captured", async () => {
    db.payment.findFirst.mockResolvedValue(payment("CREATED"));
    paypal.captureOrder.mockRejectedValue(paypalError("ORDER_ALREADY_CAPTURED"));
    paypal.getOrder.mockResolvedValue(paypalOrder());

    expect((await capturePaypalOrder(TOKEN, ORDER_ID)).paymentStatus).toBe("completed");
  });

  it("flags an amount mismatch as FAILED and never marks the proposal paid", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    db.payment.findFirst.mockResolvedValue(payment("CREATED"));
    paypal.captureOrder.mockResolvedValue({ id: ORDER_ID, status: "COMPLETED" });
    paypal.getOrder.mockResolvedValue(paypalOrder("COMPLETED", "COMPLETED", "1.00"));

    await expect(capturePaypalOrder(TOKEN, ORDER_ID)).rejects.toMatchObject({ code: "PAYMENT_PROVIDER_ERROR" });
    expect(db.payment.update).toHaveBeenCalledWith({ where: { id: PAYMENT_ID }, data: expect.objectContaining({ status: "FAILED" }) });
    expect(db.$transaction).not.toHaveBeenCalled();
    expect(db.proposal.updateMany).not.toHaveBeenCalled();
  });

  it("keeps a pending capture open instead of marking it paid", async () => {
    db.payment.findFirst.mockResolvedValue(payment("CREATED"));
    paypal.captureOrder.mockResolvedValue({ id: ORDER_ID, status: "COMPLETED" });
    paypal.getOrder.mockResolvedValue(paypalOrder("COMPLETED", "PENDING"));

    const result = await capturePaypalOrder(TOKEN, ORDER_ID);

    expect(result).toMatchObject({ paymentStatus: "pending", proposalStatus: "approved", paidAt: null });
    expect(db.payment.update).toHaveBeenCalledWith({ where: { id: PAYMENT_ID }, data: expect.objectContaining({ status: "APPROVED" }) });
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("marks a declined capture as FAILED", async () => {
    db.payment.findFirst.mockResolvedValue(payment("CREATED"));
    paypal.captureOrder.mockResolvedValue({ id: ORDER_ID, status: "COMPLETED" });
    paypal.getOrder.mockResolvedValue(paypalOrder("COMPLETED", "DECLINED"));

    await expect(capturePaypalOrder(TOKEN, ORDER_ID)).rejects.toMatchObject({ code: "PAYMENT_DECLINED" });
    expect(db.payment.update).toHaveBeenCalledWith({ where: { id: PAYMENT_ID }, data: expect.objectContaining({ status: "FAILED" }) });
  });

  it("returns the result of a concurrent capture that completed first", async () => {
    db.payment.findFirst.mockResolvedValue(payment("CREATED"));
    paypal.captureOrder.mockResolvedValue({ id: ORDER_ID, status: "COMPLETED" });
    paypal.getOrder.mockResolvedValue(paypalOrder());
    db.$transaction.mockRejectedValue(uniqueViolation());
    db.payment.findUnique.mockResolvedValue(payment("COMPLETED", { paypalCaptureId: "CAP1" }));
    db.proposal.findUnique.mockResolvedValueOnce(proposal("APPROVED")).mockResolvedValueOnce({ status: "PAID", paidAt: now });

    expect(await capturePaypalOrder(TOKEN, ORDER_ID)).toMatchObject({ paymentStatus: "completed", proposalStatus: "paid" });
  });
});

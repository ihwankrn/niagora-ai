import "server-only";

import { randomUUID } from "node:crypto";

import { ApiError } from "@/lib/api/http";
import type { AuthUser } from "@/lib/auth/session";
import type {
  CapturePaypalOrderResponse,
  CreatePaypalOrderResponse,
  PublicProposal,
  SendProposalResponse,
} from "@/lib/contracts/payments";
import { prisma } from "@/lib/db";
import * as paypal from "@/lib/paypal/client";
import { formatAmount, PaypalApiError, type PaypalOrder } from "@/lib/paypal/client";
import { proposalWithItems, STATUS_FROM_DB, toCurrency, toProposal } from "@/lib/proposals/service";
import { Prisma } from "@/generated/prisma/client";

import { verifyPaypalOrder } from "./verify";

const OPEN_PAYMENT_STATUSES = ["CREATED", "APPROVED"] as const;
// PayPal order states in which the payer can still approve or we can still capture.
const REUSABLE_ORDER_STATUSES = ["CREATED", "SAVED", "APPROVED", "PAYER_ACTION_REQUIRED"];

function appBaseUrl() {
  const value = process.env.APP_BASE_URL;
  if (!value) throw new Error("APP_BASE_URL must be set");
  return new URL(value).origin;
}

function isUniqueViolation(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function providerError(error: unknown): never {
  if (error instanceof PaypalApiError) {
    console.error("PayPal API error", error.status, error.issue, error.debugId);
  } else {
    console.error("PayPal request failed", error);
  }
  throw new ApiError("PAYMENT_PROVIDER_ERROR", "The payment provider is unavailable. Please try again.");
}

async function findSharedProposal(token: string) {
  const proposal = await prisma.proposal.findUnique({
    where: { shareToken: token },
    include: { ...proposalWithItems.include, user: { select: { displayName: true } } },
  });
  // Drafts have not been shared yet.
  if (!proposal || proposal.status === "DRAFT") {
    throw new ApiError("NOT_FOUND", "Proposal not found");
  }
  return proposal;
}

function toPublicProposal(record: Awaited<ReturnType<typeof findSharedProposal>>): PublicProposal {
  const proposal = toProposal(record);
  return {
    title: proposal.title,
    summary: proposal.summary,
    clientName: proposal.clientName,
    freelancerName: record.user.displayName,
    status: proposal.status,
    currency: proposal.currency,
    items: proposal.items,
    totalHours: proposal.totalHours,
    subtotalCents: proposal.subtotalCents,
    totalCents: proposal.totalCents,
    approvedAt: proposal.approvedAt,
    paidAt: proposal.paidAt,
  };
}

// Freelancer: DRAFT -> SENT, returns the link for the client. Idempotent.
export async function sendProposal(user: AuthUser, proposalId: string): Promise<SendProposalResponse> {
  const existing = await prisma.proposal.findFirst({ where: { id: proposalId, userId: user.id }, select: { status: true } });
  if (!existing) throw new ApiError("NOT_FOUND", "Proposal not found");

  if (existing.status === "DRAFT") {
    await prisma.proposal.updateMany({ where: { id: proposalId, status: "DRAFT" }, data: { status: "SENT" } });
  }

  const record = await prisma.proposal.findUniqueOrThrow({ where: { id: proposalId }, ...proposalWithItems });
  if (record.status === "CANCELLED" || record.status === "REJECTED") {
    throw new ApiError("CONFLICT", `A ${STATUS_FROM_DB[record.status]} proposal cannot be sent`);
  }
  return { proposal: toProposal(record), shareUrl: `${appBaseUrl()}/p/${record.shareToken}` };
}

export async function getPublicProposal(token: string): Promise<PublicProposal> {
  return toPublicProposal(await findSharedProposal(token));
}

// Client: SENT -> APPROVED. Idempotent for proposals that are already approved or paid.
export async function approveProposal(token: string): Promise<PublicProposal> {
  const proposal = await findSharedProposal(token);

  if (proposal.status === "SENT") {
    await prisma.proposal.updateMany({
      where: { id: proposal.id, status: "SENT" },
      data: { status: "APPROVED", approvedAt: new Date() },
    });
    return toPublicProposal(await findSharedProposal(token));
  }
  if (proposal.status === "APPROVED" || proposal.status === "PAID") {
    return toPublicProposal(proposal);
  }
  throw new ApiError("CONFLICT", `A ${STATUS_FROM_DB[proposal.status]} proposal cannot be approved`);
}

function approveUrl(order: PaypalOrder) {
  return order.links?.find((link) => link.rel === "approve" || link.rel === "payer-action")?.href ?? null;
}

// Client: creates (or reuses) the PayPal order for an approved proposal.
// The amount always comes from the stored proposal total.
export async function createPaypalOrder(token: string): Promise<CreatePaypalOrderResponse> {
  const proposal = await findSharedProposal(token);
  if (proposal.status === "PAID") throw new ApiError("CONFLICT", "This proposal is already paid");
  if (proposal.status !== "APPROVED") throw new ApiError("CONFLICT", "The proposal must be approved before payment");
  if (proposal.totalCents <= 0) throw new ApiError("CONFLICT", "This proposal has nothing to pay");

  const currency = toCurrency(proposal.currency);
  const amountCents = proposal.totalCents;

  const open = await prisma.payment.findFirst({
    where: { proposalId: proposal.id, status: { in: [...OPEN_PAYMENT_STATUSES] } },
  });
  if (open) {
    if (open.amountCents === amountCents && open.currency.trim() === currency) {
      let order: PaypalOrder | null = null;
      try {
        order = await paypal.getOrder(open.paypalOrderId);
      } catch (error) {
        if (!(error instanceof PaypalApiError && error.status === 404)) providerError(error);
      }
      if (order && REUSABLE_ORDER_STATUSES.includes(order.status)) {
        return { orderId: order.id, approveUrl: approveUrl(order), amountCents, currency };
      }
      if (order?.status === "COMPLETED") {
        throw new ApiError("CONFLICT", "A payment for this proposal is being finalized. Please refresh.");
      }
    }
    // Expired, voided or for a different amount: retire it before creating a new order.
    await prisma.payment.updateMany({ where: { id: open.id, status: { in: [...OPEN_PAYMENT_STATUSES] } }, data: { status: "VOIDED" } });
  }

  const paymentId = randomUUID();
  const requestId = randomUUID();
  let order: PaypalOrder;
  try {
    order = await paypal.createOrder({
      requestId,
      proposalId: proposal.id,
      paymentId,
      description: proposal.title,
      amount: { currency_code: currency, value: formatAmount(amountCents) },
    });
  } catch (error) {
    providerError(error);
  }

  try {
    await prisma.payment.create({
      data: { id: paymentId, proposalId: proposal.id, status: "CREATED", amountCents, currency, paypalOrderId: order.id, requestId },
    });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    // A concurrent request opened an order first; use that one (ours is never approved and expires).
    const winner = await prisma.payment.findFirst({
      where: { proposalId: proposal.id, status: { in: [...OPEN_PAYMENT_STATUSES] } },
    });
    if (!winner) throw error;
    return { orderId: winner.paypalOrderId, approveUrl: null, amountCents, currency };
  }

  return { orderId: order.id, approveUrl: approveUrl(order), amountCents, currency };
}

function captureResponse(payment: {
  paypalOrderId: string;
  paypalCaptureId: string | null;
  amountCents: number;
  currency: string;
}, status: "completed" | "pending", proposalStatus: CapturePaypalOrderResponse["proposalStatus"], paidAt: Date | null): CapturePaypalOrderResponse {
  return {
    paymentStatus: status,
    proposalStatus,
    orderId: payment.paypalOrderId,
    captureId: payment.paypalCaptureId,
    amountCents: payment.amountCents,
    currency: toCurrency(payment.currency),
    paidAt: paidAt?.toISOString() ?? null,
  };
}

// Client (after PayPal approval): captures on the server, re-reads the order
// from PayPal, verifies it against the stored payment and only then marks the
// proposal paid. A redirect or a browser message is never proof of payment.
export async function capturePaypalOrder(token: string, orderId: string): Promise<CapturePaypalOrderResponse> {
  const proposal = await findSharedProposal(token);
  const payment = await prisma.payment.findFirst({ where: { paypalOrderId: orderId, proposalId: proposal.id } });
  if (!payment) throw new ApiError("NOT_FOUND", "Payment not found");

  // Repeated capture requests return the stored result without calling PayPal again.
  if (payment.status === "COMPLETED") {
    return captureResponse(payment, "completed", STATUS_FROM_DB[proposal.status], proposal.paidAt);
  }
  if (payment.status === "VOIDED" || payment.status === "FAILED") {
    throw new ApiError("CONFLICT", "This payment is no longer valid. Please start the payment again.");
  }
  if (proposal.status !== "APPROVED") {
    throw new ApiError("CONFLICT", `A ${STATUS_FROM_DB[proposal.status]} proposal cannot be paid`);
  }

  try {
    // Stable request id: PayPal returns the earlier result instead of capturing twice.
    await paypal.captureOrder(orderId, `${payment.requestId}-capture`);
  } catch (error) {
    const issue = error instanceof PaypalApiError ? error.issue : undefined;
    if (issue === "ORDER_NOT_APPROVED" || issue === "PAYER_ACTION_REQUIRED") {
      throw new ApiError("PAYMENT_NOT_APPROVED", "The payment has not been approved in PayPal yet.");
    }
    if (issue === "INSTRUMENT_DECLINED") {
      throw new ApiError("PAYMENT_DECLINED", "The payment method was declined. Please choose another one.");
    }
    if (issue !== "ORDER_ALREADY_CAPTURED") providerError(error);
  }

  let order: PaypalOrder;
  try {
    order = await paypal.getOrder(orderId);
  } catch (error) {
    providerError(error);
  }

  const result = verifyPaypalOrder(order, {
    orderId,
    proposalId: proposal.id,
    paymentId: payment.id,
    amountCents: proposal.totalCents,
    currency: toCurrency(proposal.currency),
  });
  const payload = order as unknown as Prisma.InputJsonValue;

  if (result.kind === "mismatch" || payment.amountCents !== proposal.totalCents) {
    console.error("PayPal order failed verification", { orderId, paymentId: payment.id, reason: result.kind === "mismatch" ? result.reason : "stored amount" });
    await prisma.payment.update({ where: { id: payment.id }, data: { status: "FAILED", providerPayload: payload } });
    throw new ApiError("PAYMENT_PROVIDER_ERROR", "The payment could not be verified. It has been flagged for review.");
  }
  if (result.kind === "declined") {
    await prisma.payment.update({ where: { id: payment.id }, data: { status: "FAILED", providerPayload: payload } });
    throw new ApiError("PAYMENT_DECLINED", "The payment was declined. Please choose another payment method.");
  }
  if (result.kind === "pending") {
    const updated = await prisma.payment.update({
      where: { id: payment.id },
      data: { status: "APPROVED", paypalCaptureId: result.capture?.id ?? null, providerPayload: payload },
    });
    return captureResponse(updated, "pending", "approved", null);
  }

  const paidAt = new Date();
  try {
    const [updated] = await prisma.$transaction([
      prisma.payment.update({
        where: { id: payment.id },
        data: {
          status: "COMPLETED",
          paypalCaptureId: result.capture.id,
          payerId: result.payerId,
          payerEmail: result.payerEmail,
          providerPayload: payload,
          verifiedAt: paidAt,
        },
      }),
      prisma.proposal.updateMany({ where: { id: proposal.id, status: "APPROVED" }, data: { status: "PAID", paidAt } }),
    ]);
    return captureResponse(updated, "completed", "paid", paidAt);
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    // A concurrent request for the same payment finished first.
    const current = await prisma.payment.findUnique({ where: { id: payment.id } });
    if (current?.status === "COMPLETED") {
      const refreshed = await prisma.proposal.findUnique({ where: { id: proposal.id }, select: { status: true, paidAt: true } });
      return captureResponse(current, "completed", STATUS_FROM_DB[refreshed?.status ?? "PAID"], refreshed?.paidAt ?? null);
    }
    console.error("Captured PayPal order conflicts with another completed payment", { orderId, paymentId: payment.id });
    throw new ApiError("PAYMENT_PROVIDER_ERROR", "The payment could not be recorded. It has been flagged for review.");
  }
}

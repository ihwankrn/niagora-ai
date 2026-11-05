import "server-only";

import { randomUUID } from "node:crypto";

import { ApiError } from "@/lib/api/http";
import type { AuthUser } from "@/lib/auth/session";
import type { Currency } from "@/lib/contracts/common";
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
import { proposalShareUrl } from "@/lib/proposals/share-link";
import { Prisma } from "@/generated/prisma/client";

import { verifyPaypalOrder, type VerificationResult } from "./verify";

const OPEN_PAYMENT_STATUSES = ["CREATED", "APPROVED"] as const;
// States from which a verified PayPal capture may be applied.
const RECONCILABLE_PAYMENT_STATUSES = ["CREATED", "APPROVED", "REVIEW"] as const;
// PayPal order states in which the payer can still approve or we can still capture.
const REUSABLE_ORDER_STATUSES = ["CREATED", "SAVED", "APPROVED", "PAYER_ACTION_REQUIRED"];
// PayPal has told us the order can no longer be paid; a new order is safe.
const DEAD_ORDER_STATUSES = ["VOIDED", "EXPIRED"];

type PaymentForPaymentFlow = {
  id: string;
  status: string;
  amountCents: number;
  currency: string;
  paypalOrderId: string;
  paypalCaptureId: string | null;
  requestId: string;
  verifiedAt: Date | null;
};

type ProposalForPaymentFlow = {
  id: string;
  status: string;
  totalCents: number;
  currency: string;
  paidAt: Date | null;
};

class PaymentTransitionError extends Error {}
class ProposalTransitionError extends Error {}

function appBaseUrl() {
  const value = process.env.APP_BASE_URL;
  if (!value) throw new Error("APP_BASE_URL must be set");
  return new URL(value).origin;
}

function isUniqueViolation(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function isSafePositiveCents(value: number) {
  return Number.isSafeInteger(value) && value > 0;
}

function paymentMatchesProposal(payment: PaymentForPaymentFlow, proposal: ProposalForPaymentFlow, currency: string) {
  return (
    isSafePositiveCents(proposal.totalCents) &&
    payment.amountCents === proposal.totalCents &&
    payment.currency.trim().toUpperCase() === currency
  );
}

function logProviderFailure(error: unknown) {
  if (error instanceof PaypalApiError) {
    // Never log headers, credentials or the raw provider body.
    console.error("PayPal API error", { status: error.status, issue: error.issue, debugId: error.debugId });
  } else if (error instanceof Error) {
    console.error("PayPal request failed", { name: error.name, message: error.message.slice(0, 300) });
  } else {
    console.error("PayPal request failed");
  }
}

function providerError(error: unknown): never {
  logProviderFailure(error);
  throw new ApiError("PAYMENT_PROVIDER_ERROR", "The payment provider is unavailable. Please try again.");
}

function reviewError(
  message = "PayPal captured the payment, but it could not be safely recorded. It has been flagged for review.",
) {
  return new ApiError("PAYMENT_PROVIDER_ERROR", message);
}

function reviewConflictError() {
  return new ApiError("CONFLICT", "A payment for this proposal needs review and cannot be replaced automatically.");
}

// A failed REVIEW write is not a reason to claim the payment is safe. The
// message deliberately does not say "flagged for review": that state was not
// persisted. Repeating the capture request is still safe because the order is
// read before any capture, but starting a new payment is not.
function reviewPersistenceError() {
  return new ApiError(
    "PAYMENT_PROVIDER_ERROR",
    "The payment could not be saved for review. Do not start a new payment; please retry this request or contact support.",
  );
}

// Non-REVIEW payment state writes (FAILED/VOIDED) must also fail loudly: a
// swallowed write would leave the client with a response that does not match
// the stored state.
function paymentStatePersistenceError() {
  return new ApiError(
    "PAYMENT_PROVIDER_ERROR",
    "The payment state could not be saved. Please retry this request or contact support.",
  );
}

function errorInfo(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError
    ? { name: error.name, code: error.code }
    : error instanceof Error
      ? { name: error.name }
      : { name: "unknown" };
}

function logReviewPersistenceFailure(paymentId: string, reason: string, order: PaypalOrder | undefined, error: unknown) {
  // Keep the reconciliation context even when the row could not be updated: the
  // order id and capture id let support re-read the payment from PayPal.
  console.error("Failed to record payment review", {
    paymentId,
    orderId: order?.id,
    orderStatus: order?.status,
    captureId: reviewCapture(order)?.id,
    reason: reason.slice(0, 200),
    error: errorInfo(error),
  });
}

function logRepairFailure(proposalId: string, paymentId: string, error: unknown) {
  console.error("Failed to repair proposal after verified capture", {
    proposalId,
    paymentId,
    error: errorInfo(error),
  });
}

function capturesOf(order: PaypalOrder | undefined) {
  return order?.purchase_units?.flatMap((unit) => unit.payments?.captures ?? []) ?? [];
}

// True when PayPal shows any capture that might still settle or already moved
// money. Such an order must never be marked FAILED, because that would unblock
// a new order and risk charging the client twice. All captures are inspected:
// a DECLINED first entry must not hide a COMPLETED one later in the array.
function hasUnsettledCapture(order: PaypalOrder) {
  return capturesOf(order).some((capture) => !["DECLINED", "FAILED"].includes(capture.status));
}

// Prefer the capture that actually moved money, so a REVIEW row stores the
// meaningful capture id even when the order exposes several capture entries.
function reviewCapture(order: PaypalOrder | undefined) {
  const captures = capturesOf(order);
  return captures.find((capture) => capture.status === "COMPLETED") ?? captures[0] ?? null;
}

function providerPayload(order: PaypalOrder) {
  return order as unknown as Prisma.InputJsonValue;
}

async function markPaymentForReview(
  paymentId: string,
  reason: string,
  order?: PaypalOrder,
  noteCompleted = false,
) {
  const capture = reviewCapture(order);
  const reviewReason = reason.slice(0, 500);
  const baseData: Prisma.PaymentUpdateManyMutationInput = {
    status: "REVIEW",
    reviewReason,
    ...(order ? { providerPayload: providerPayload(order) } : {}),
  };

  const record = async (data: Prisma.PaymentUpdateManyMutationInput) => {
    const updated = await prisma.payment.updateMany({
      // COMPLETED is immutable: a review must never downgrade a completed
      // payment, even when another field (amount, proposal status) looks wrong.
      where: { id: paymentId, status: { not: "COMPLETED" } },
      data,
    });
    return updated.count;
  };

  let recorded: number;
  try {
    recorded = await record(capture?.id ? { ...baseData, paypalCaptureId: capture.id } : baseData);
  } catch (error) {
    if (!isUniqueViolation(error)) {
      logReviewPersistenceFailure(paymentId, reason, order, error);
      throw reviewPersistenceError();
    }
    // The capture id is already attached to another payment. Keep the review
    // reason and PayPal payload, but never steal the id from that payment.
    console.error("Payment review capture id conflict", { paymentId, captureId: capture?.id });
    try {
      recorded = await record(baseData);
    } catch (retryError) {
      logReviewPersistenceFailure(paymentId, reason, order, retryError);
      throw reviewPersistenceError();
    }
  }

  if (recorded > 0) return;

  // The conditional update matched nothing: the row is COMPLETED (never
  // overwrite it) or it disappeared. Read it before deciding, and never claim
  // that REVIEW was recorded without evidence.
  let current: { status: string; proposalId: string } | null;
  try {
    current = await prisma.payment.findUnique({
      where: { id: paymentId },
      select: { status: true, proposalId: true },
    });
  } catch (error) {
    logReviewPersistenceFailure(paymentId, reason, order, error);
    throw reviewPersistenceError();
  }
  if (!current) {
    console.error("Payment disappeared while recording review", { paymentId });
    throw reviewPersistenceError();
  }
  if (current.status !== "COMPLETED") {
    // The row changed between the update and this read. The review state is not
    // confirmed, so the caller must not continue as if it were recorded.
    console.error("Payment review was not applied", { paymentId, status: current.status });
    throw reviewPersistenceError();
  }

  // COMPLETED is immutable. Only attach the audit reason when the pair is
  // inconsistent, or when the caller explicitly needs the note (for example a
  // COMPLETED payment that lacks verified capture evidence).
  let proposal: { status: string } | null;
  try {
    proposal = await prisma.proposal.findUnique({
      where: { id: current.proposalId },
      select: { status: true },
    });
  } catch (error) {
    logReviewPersistenceFailure(paymentId, reason, order, error);
    throw reviewPersistenceError();
  }
  if (!noteCompleted && proposal?.status === "PAID") return;

  try {
    const note = await prisma.payment.updateMany({ where: { id: paymentId }, data: { reviewReason } });
    if (note.count === 0) {
      console.error("Payment review note was not applied", { paymentId });
      throw reviewPersistenceError();
    }
  } catch (error) {
    if (error instanceof ApiError) throw error;
    logReviewPersistenceFailure(paymentId, reason, order, error);
    throw reviewPersistenceError();
  }
}

async function reviewOrStored(
  paymentId: string,
  proposalId: string,
  reason: string,
  order?: PaypalOrder,
): Promise<CapturePaypalOrderResponse | null> {
  await markPaymentForReview(paymentId, reason, order);
  return storedCompletion(paymentId, proposalId);
}

async function markPaymentFailed(paymentId: string, proposalId: string, payload: Prisma.InputJsonValue) {
  try {
    const updated = await prisma.payment.updateMany({
      where: { id: paymentId, status: { in: [...RECONCILABLE_PAYMENT_STATUSES] } },
      // FAILED is an explicit resolution: the review flag no longer applies.
      data: { status: "FAILED", providerPayload: payload, reviewReason: null },
    });
    if (updated.count === 0) {
      const stored = await storedCompletion(paymentId, proposalId);
      if (stored) return stored;
      // A COMPLETED row must never be reported as a decline. This can happen
      // when the payment completed concurrently but lacks verification evidence
      // (legacy or partial write), so storedCompletion correctly refuses it.
      let current: { status: string } | null;
      try {
        current = await prisma.payment.findUnique({ where: { id: paymentId }, select: { status: true } });
      } catch (error) {
        console.error("Failed to inspect payment after a zero-row FAILED update", {
          paymentId,
          error: errorInfo(error),
        });
        throw paymentStatePersistenceError();
      }
      if (current?.status === "COMPLETED") {
        await markPaymentForReview(paymentId, "payment is COMPLETED but could not be marked FAILED", undefined, true);
        throw reviewError("The payment is already completed. It has been flagged for review.");
      }
      // FAILED/VOIDED already represent a resolved, non-payable state, so a
      // decline is accurate. A missing row or any other status is ambiguous:
      // never tell the client to retry a payment we cannot account for.
      if (!current || (current.status !== "FAILED" && current.status !== "VOIDED")) {
        console.error("Payment was not in a resolved state after a zero-row FAILED update", {
          paymentId,
          status: current?.status ?? "missing",
        });
        throw paymentStatePersistenceError();
      }
      return null;
    }
    return null;
  } catch (error) {
    // A review/decline decision taken after the update must not be rewritten as
    // a generic persistence failure.
    if (error instanceof ApiError) throw error;
    if (isUniqueViolation(error)) {
      // A FAILED update does not change any unique column, so P2002 here is
      // unexpected. Only report success if the same payment is already a
      // verified completion; otherwise the FAILED write did not happen.
      const stored = await storedCompletion(paymentId, proposalId);
      if (stored) return stored;
      console.error("Unexpected unique violation while recording failed payment", { paymentId });
      throw paymentStatePersistenceError();
    }
    console.error("Failed to record failed payment", { paymentId, error: errorInfo(error) });
    throw paymentStatePersistenceError();
  }
}

async function retireOpenPayment(paymentId: string) {
  try {
    await prisma.payment.updateMany({
      where: { id: paymentId, status: { in: [...OPEN_PAYMENT_STATUSES] } },
      data: { status: "VOIDED" },
    });
  } catch {
    console.error("Failed to retire open payment", { paymentId });
    throw paymentStatePersistenceError();
  }
}

// A payment may only be reported as a successful payment when PayPal's capture
// was verified locally. A COMPLETED row without verifiedAt/captureId is an
// incomplete record (legacy or partial write), not proof of payment.
function isVerifiedCompletion(payment: {
  status: string;
  verifiedAt: Date | null;
  paypalCaptureId: string | null;
}) {
  return payment.status === "COMPLETED" && payment.verifiedAt !== null && payment.paypalCaptureId !== null;
}

async function storedCompletion(paymentId: string, proposalId: string): Promise<CapturePaypalOrderResponse | null> {
  let payment: {
    status: string;
    verifiedAt: Date | null;
    paypalCaptureId: string | null;
    paypalOrderId: string;
    amountCents: number;
    currency: string;
  } | null;
  let proposal: { status: string; paidAt: Date | null } | null;
  try {
    [payment, proposal] = await Promise.all([
      prisma.payment.findUnique({
        where: { id: paymentId },
        select: {
          status: true,
          verifiedAt: true,
          paypalCaptureId: true,
          paypalOrderId: true,
          amountCents: true,
          currency: true,
        },
      }),
      prisma.proposal.findUnique({ where: { id: proposalId }, select: { status: true, paidAt: true } }),
    ]);
  } catch (error) {
    // A failed read is not evidence of payment, and it is not a generic server
    // error either: the caller must retry or contact support, never re-pay.
    console.error("Failed to read stored payment completion", { paymentId, proposalId, error: errorInfo(error) });
    throw paymentStatePersistenceError();
  }
  if (payment && isVerifiedCompletion(payment) && proposal?.status === "PAID") {
    return captureResponse(payment, "completed", "paid", proposal.paidAt);
  }
  return null;
}

async function repairProposalPaid(proposalId: string, verifiedAt: Date | null, paymentId: string) {
  const paidAt = verifiedAt ?? new Date();
  let applied = false;
  try {
    const updated = await prisma.proposal.updateMany({
      // Only an APPROVED proposal may be repaired. A concurrent request may
      // have already paid or cancelled it; that is reported, not overwritten.
      where: { id: proposalId, status: "APPROVED" },
      data: { status: "PAID", paidAt },
    });
    applied = updated.count === 1;
    if (!applied) {
      console.warn("Proposal repair was not applied", { proposalId, paymentId, matched: updated.count });
    }
  } catch (error) {
    // The write may have committed even though the client saw an error, so a
    // failure is not final until the rows are re-read below.
    logRepairFailure(proposalId, paymentId, error);
  }

  if (applied) return { status: "PAID" as const, paidAt };

  // Ambiguous outcome: re-read both rows. Success is only valid when the same
  // payment is a verified COMPLETED capture AND the proposal is PAID. A
  // COMPLETED payment is never downgraded, and no other proposal transition is
  // attempted here.
  let currentPayment: {
    status: string;
    verifiedAt: Date | null;
    paypalCaptureId: string | null;
  } | null;
  let currentProposal: { status: string; paidAt: Date | null } | null;
  try {
    [currentPayment, currentProposal] = await Promise.all([
      prisma.payment.findUnique({
        where: { id: paymentId },
        select: { status: true, verifiedAt: true, paypalCaptureId: true },
      }),
      prisma.proposal.findUnique({ where: { id: proposalId }, select: { status: true, paidAt: true } }),
    ]);
  } catch (error) {
    // Without a trustworthy re-read the outcome is unknown. Surface a
    // persistence error instead of a false success or a generic 500.
    logRepairFailure(proposalId, paymentId, error);
    throw paymentStatePersistenceError();
  }

  if (currentPayment && isVerifiedCompletion(currentPayment) && currentProposal?.status === "PAID") {
    return { status: "PAID" as const, paidAt: currentProposal.paidAt };
  }
  return null;
}

async function completedPaymentResponse(
  payment: PaymentForPaymentFlow,
  proposal: ProposalForPaymentFlow,
): Promise<CapturePaypalOrderResponse> {
  if (!isVerifiedCompletion(payment)) {
    await markPaymentForReview(payment.id, "payment is COMPLETED without a verified capture", undefined, true);
    throw reviewError("The payment record is incomplete. It has been flagged for review.");
  }
  if (proposal.status === "PAID") {
    return captureResponse(payment, "completed", "paid", proposal.paidAt);
  }
  if (proposal.status === "APPROVED") {
    const repaired = await repairProposalPaid(proposal.id, payment.verifiedAt, payment.id);
    if (repaired) {
      return captureResponse(payment, "completed", "paid", repaired.paidAt);
    }
  }

  await markPaymentForReview(payment.id, `payment is COMPLETED but proposal is ${proposal.status}`);
  throw reviewError("The payment is recorded but the proposal could not be confirmed as paid. It has been flagged for review.");
}

// A browser that closed after capturing has lost its orderId and cannot call the
// capture endpoint again, so an order request records that capture instead. The
// capture flow reads the order first and sends no capture for a COMPLETED order.
async function recordExistingCapture(token: string, orderId: string): Promise<never> {
  const result = await capturePaypalOrder(token, orderId);
  throw new ApiError(
    "CONFLICT",
    result.proposalStatus === "paid"
      ? "This proposal is already paid"
      : "A payment for this proposal is being processed. Please refresh.",
  );
}

async function reuseOpenPayment(
  token: string,
  payment: PaymentForPaymentFlow,
  proposal: ProposalForPaymentFlow,
  amountCents: number,
  currency: Currency,
): Promise<CreatePaypalOrderResponse | null> {
  if (payment.paypalCaptureId) {
    // A capture has already been attempted and may still be settling. Creating
    // another order here could charge the client twice.
    return recordExistingCapture(token, payment.paypalOrderId);
  }

  if (!paymentMatchesProposal(payment, proposal, currency)) {
    await markPaymentForReview(payment.id, "stored open payment does not match the proposal amount or currency");
    throw reviewConflictError();
  }

  let order: PaypalOrder;
  try {
    order = await paypal.getOrder(payment.paypalOrderId);
  } catch (error) {
    if (error instanceof PaypalApiError && error.status === 404) {
      await retireOpenPayment(payment.id);
      return null;
    }
    providerError(error);
  }

  if (order.status === "COMPLETED") {
    return recordExistingCapture(token, payment.paypalOrderId);
  }
  if (DEAD_ORDER_STATUSES.includes(order.status)) {
    await retireOpenPayment(payment.id);
    return null;
  }
  if (!REUSABLE_ORDER_STATUSES.includes(order.status)) {
    await markPaymentForReview(payment.id, `PayPal order status ${order.status} cannot be reused`, order);
    throw reviewConflictError();
  }

  const verification = verifyPaypalOrder(order, {
    orderId: payment.paypalOrderId,
    proposalId: proposal.id,
    paymentId: payment.id,
    amountCents,
    currency,
  });
  if (verification.kind === "mismatch") {
    await markPaymentForReview(payment.id, `PayPal open order failed verification: ${verification.reason}`, order);
    throw reviewConflictError();
  }
  if (verification.kind !== "pending" || verification.capture) {
    await markPaymentForReview(payment.id, "PayPal open order is not reusable", order);
    throw reviewConflictError();
  }

  return { orderId: order.id, approveUrl: approveUrl(order), amountCents, currency };
}

function approveUrl(order: PaypalOrder) {
  return order.links?.find((link) => link.rel === "approve" || link.rel === "payer-action")?.href ?? null;
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

  const record = await prisma.proposal.findUnique({ where: { id: proposalId }, ...proposalWithItems });
  if (!record) throw new ApiError("NOT_FOUND", "Proposal not found");
  if (record.status === "CANCELLED" || record.status === "REJECTED") {
    throw new ApiError("CONFLICT", `A ${STATUS_FROM_DB[record.status]} proposal cannot be sent`);
  }
  if (record.status === "DRAFT") {
    // The conditional update affected no row (for example a concurrent writer)
    // and the proposal is still a draft, so do not report success.
    throw new ApiError("CONFLICT", "The proposal could not be sent. Please try again.");
  }
  return { proposal: toProposal(record), shareUrl: proposalShareUrl(appBaseUrl(), record.shareToken) };
}

export async function getPublicProposal(token: string): Promise<PublicProposal> {
  return toPublicProposal(await findSharedProposal(token));
}

// Client: SENT -> APPROVED. Idempotent for proposals that are already approved or paid.
export async function approveProposal(token: string): Promise<PublicProposal> {
  const proposal = await findSharedProposal(token);

  if (proposal.status === "SENT") {
    const updated = await prisma.proposal.updateMany({
      where: { id: proposal.id, status: "SENT" },
      data: { status: "APPROVED", approvedAt: new Date() },
    });
    if (updated.count === 0) {
      const current = await findSharedProposal(token);
      if (current.status === "APPROVED" || current.status === "PAID") {
        return toPublicProposal(current);
      }
      if (current.status === "SENT") {
        throw new ApiError("CONFLICT", "The proposal could not be approved. Please try again.");
      }
      throw new ApiError("CONFLICT", `A ${STATUS_FROM_DB[current.status]} proposal cannot be approved`);
    }
    return toPublicProposal(await findSharedProposal(token));
  }
  if (proposal.status === "APPROVED" || proposal.status === "PAID") {
    return toPublicProposal(proposal);
  }
  throw new ApiError("CONFLICT", `A ${STATUS_FROM_DB[proposal.status]} proposal cannot be approved`);
}

// Client: creates (or reuses) the PayPal order for an approved proposal.
// The amount always comes from the stored proposal total.
export async function createPaypalOrder(token: string): Promise<CreatePaypalOrderResponse> {
  const proposal = await findSharedProposal(token);
  if (proposal.status === "PAID") throw new ApiError("CONFLICT", "This proposal is already paid");
  if (proposal.status !== "APPROVED") throw new ApiError("CONFLICT", "The proposal must be approved before payment");

  const amountCents = proposal.totalCents;
  if (!isSafePositiveCents(amountCents)) throw new ApiError("CONFLICT", "This proposal has nothing to pay");
  const currency = toCurrency(proposal.currency);

  // A captured-but-unreconciled payment must never be replaced by a new order.
  const review = await prisma.payment.findFirst({
    where: { proposalId: proposal.id, status: "REVIEW" },
    select: { id: true },
  });
  if (review) throw reviewConflictError();

  for (let attempt = 0; attempt < 2; attempt++) {
    const open = await prisma.payment.findFirst({
      where: { proposalId: proposal.id, status: { in: [...OPEN_PAYMENT_STATUSES] } },
    });
    if (open) {
      const reused = await reuseOpenPayment(token, open, proposal, amountCents, currency);
      if (reused) return reused;
      // The open order was confirmed dead and retired; a new order is safe.
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

    if (typeof order.id !== "string" || order.id.trim() === "") {
      providerError(new Error("PayPal returned an order without an id"));
    }
    const created = verifyPaypalOrder(order, {
      orderId: order.id,
      proposalId: proposal.id,
      paymentId,
      amountCents,
      currency,
    });
    if (created.kind !== "pending" || created.capture) {
      // A brand-new order must be unpaid and carry no capture. Anything else is
      // a provider anomaly, so the order is never exposed to the client.
      const reason =
        created.kind === "mismatch" || created.kind === "unexpected" ? created.reason : `unexpected ${created.kind} order on creation`;
      providerError(new Error(`PayPal created an unusable order: ${reason}`));
    }

    // The proposal may have been paid or cancelled while the order was being
    // created. Never hand out an approve URL for a proposal that is no longer
    // payable; the unused PayPal order cannot capture by itself.
    const latest = await prisma.proposal.findUnique({ where: { id: proposal.id }, select: { status: true } });
    if (latest?.status !== "APPROVED") {
      throw new ApiError("CONFLICT", "The proposal is no longer payable. Please refresh.");
    }

    try {
      await prisma.payment.create({
        data: { id: paymentId, proposalId: proposal.id, status: "CREATED", amountCents, currency, paypalOrderId: order.id, requestId },
      });
      return { orderId: order.id, approveUrl: approveUrl(order), amountCents, currency };
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      // A concurrent request won a unique constraint. Only reuse a winner that
      // still matches the proposal and is usable at PayPal.
      const winner = await prisma.payment.findFirst({
        where: { proposalId: proposal.id, status: { in: [...OPEN_PAYMENT_STATUSES, "REVIEW"] } },
      });
      if (!winner) throw error;
      if (winner.status === "REVIEW") throw reviewConflictError();
      const reused = await reuseOpenPayment(token, winner, proposal, amountCents, currency);
      if (reused) return reused;
      // Winner was confirmed dead and retired; retry once.
    }
  }

  throw new ApiError("CONFLICT", "Could not create a payment order. Please try again.");
}

function captureResponse(
  payment: {
    paypalOrderId: string;
    paypalCaptureId: string | null;
    amountCents: number;
    currency: string;
  },
  status: "completed" | "pending",
  proposalStatus: CapturePaypalOrderResponse["proposalStatus"],
  paidAt: Date | null,
): CapturePaypalOrderResponse {
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

async function reconcileCompletionFailure(
  payment: PaymentForPaymentFlow,
  proposal: ProposalForPaymentFlow,
  order: PaypalOrder,
  error: unknown,
): Promise<CapturePaypalOrderResponse> {
  const stored = await storedCompletion(payment.id, proposal.id);
  if (stored) return stored;

  let currentPayment: {
    status: string;
    verifiedAt: Date | null;
    paypalCaptureId: string | null;
    paypalOrderId: string;
    amountCents: number;
    currency: string;
  } | null;
  let currentProposal: { status: string; paidAt: Date | null } | null;
  try {
    [currentPayment, currentProposal] = await Promise.all([
      prisma.payment.findUnique({ where: { id: payment.id } }),
      prisma.proposal.findUnique({ where: { id: proposal.id }, select: { status: true, paidAt: true } }),
    ]);
  } catch (error) {
    // The transaction already failed; if the follow-up read also fails we
    // cannot decide between repair and review. Report a persistence error.
    console.error("Failed to re-read payment after a completion failure", {
      paymentId: payment.id,
      proposalId: proposal.id,
      error: errorInfo(error),
    });
    throw paymentStatePersistenceError();
  }

  // Legacy/inconsistent rows may have a completed payment but an approved
  // proposal. Repair that specific pair before falling back to review.
  if (currentPayment && isVerifiedCompletion(currentPayment) && currentProposal?.status === "APPROVED") {
    const repaired = await repairProposalPaid(proposal.id, currentPayment.verifiedAt, payment.id);
    if (repaired) {
      return captureResponse(currentPayment, "completed", "paid", repaired.paidAt);
    }
  }

  if (currentProposal?.status === "PAID") {
    await markPaymentForReview(payment.id, "another payment completed for this proposal", order);
    throw reviewError(
      "PayPal captured this payment, but another payment is already recorded for the proposal. It has been flagged for review.",
    );
  }

  const reason =
    error instanceof ProposalTransitionError
      ? `proposal transition failed (current status ${currentProposal?.status ?? "missing"})`
      : error instanceof PaymentTransitionError
        ? "payment transition failed"
        : "database transaction failed";
  await markPaymentForReview(payment.id, reason, order);
  throw reviewError();
}

async function completePayment(
  payment: PaymentForPaymentFlow,
  proposal: ProposalForPaymentFlow,
  order: PaypalOrder,
  result: Extract<VerificationResult, { kind: "completed" }>,
): Promise<CapturePaypalOrderResponse> {
  const paidAt = new Date();
  const payload = providerPayload(order);

  try {
    const updated = await prisma.$transaction(async (tx) => {
      const paymentUpdate = await tx.payment.updateMany({
        where: { id: payment.id, status: { in: [...RECONCILABLE_PAYMENT_STATUSES] } },
        data: {
          status: "COMPLETED",
          paypalCaptureId: result.capture.id,
          payerId: result.payerId,
          payerEmail: result.payerEmail,
          providerPayload: payload,
          reviewReason: null,
          verifiedAt: paidAt,
        },
      });
      if (paymentUpdate.count !== 1) throw new PaymentTransitionError("payment");

      const proposalUpdate = await tx.proposal.updateMany({
        where: { id: proposal.id, status: "APPROVED" },
        data: { status: "PAID", paidAt },
      });
      if (proposalUpdate.count !== 1) throw new ProposalTransitionError("proposal");

      return tx.payment.findUniqueOrThrow({ where: { id: payment.id } });
    });

    return captureResponse(updated, "completed", "paid", paidAt);
  } catch (error) {
    return reconcileCompletionFailure(payment, proposal, order, error);
  }
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
    return completedPaymentResponse(payment, proposal);
  }
  if (payment.status === "VOIDED" || payment.status === "FAILED") {
    throw new ApiError("CONFLICT", "This payment is no longer valid. Please start the payment again.");
  }
  if (payment.status !== "CREATED" && payment.status !== "APPROVED" && payment.status !== "REVIEW") {
    throw new ApiError("CONFLICT", "This payment is no longer valid. Please start the payment again.");
  }

  const readOrder = async () => {
    try {
      return await paypal.getOrder(orderId);
    } catch (error) {
      providerError(error);
    }
  };

  // If the proposal is no longer payable, never capture. A previous attempt may
  // still have captured, so inspect PayPal's record before returning an error.
  if (proposal.status !== "APPROVED") {
    if (payment.status === "REVIEW") {
      throw reviewError(`The payment is under review because the proposal is ${STATUS_FROM_DB[proposal.status]}.`);
    }
    const order = await readOrder();
    if (hasUnsettledCapture(order)) {
      const stored = await reviewOrStored(payment.id, proposal.id, `proposal is ${proposal.status} but PayPal has a capture`, order);
      if (stored) return stored;
      throw reviewError("The payment was captured but the proposal is no longer payable. It has been flagged for review.");
    }
    throw new ApiError("CONFLICT", `A ${STATUS_FROM_DB[proposal.status]} proposal cannot be paid`);
  }

  const proposalAmount = proposal.totalCents;
  const proposalCurrency = toCurrency(proposal.currency);
  if (!paymentMatchesProposal(payment, proposal, proposalCurrency)) {
    // Read PayPal first: if it already captured, this is a review case, not a
    // failed payment. Do not let a bad local amount hide money movement.
    const order = await readOrder();
    if (hasUnsettledCapture(order)) {
      const stored = await reviewOrStored(payment.id, proposal.id, "stored payment does not match the proposal", order);
      if (stored) return stored;
      throw reviewError();
    }
    await markPaymentForReview(payment.id, "stored payment does not match the proposal");
    throw reviewError(
      "The payment could not be verified because its stored amount or currency does not match the proposal. It has been flagged for review.",
    );
  }

  // Read first. If PayPal already captured this order (for example an earlier
  // attempt lost its response), reconcile from PayPal's record instead of
  // sending another capture.
  let order = await readOrder();
  if (DEAD_ORDER_STATUSES.includes(order.status)) {
    // PayPal can no longer capture this order, so no money can move.
    if (payment.status === "REVIEW") throw reviewConflictError();
    await retireOpenPayment(payment.id);
    throw new ApiError("CONFLICT", "This payment is no longer valid. Please start the payment again.");
  }
  if (order.status !== "COMPLETED") {
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
      // Network error, timeout, 5xx/429 or another provider response: the
      // capture may or may not have happened. The re-read below decides; the
      // capture is never sent again.
      if (error instanceof PaypalApiError) {
        console.error("PayPal capture did not return a definite result, re-reading order", {
          orderId,
          status: error.status,
          issue: error.issue,
          debugId: error.debugId,
        });
      } else {
        console.error("PayPal capture response lost, re-reading order", { orderId });
      }
    }
    order = await readOrder();
  }

  const result = verifyPaypalOrder(order, {
    orderId,
    proposalId: proposal.id,
    paymentId: payment.id,
    amountCents: proposalAmount,
    currency: proposalCurrency,
  });
  const payload = providerPayload(order);

  if (result.kind === "mismatch") {
    console.error("PayPal order failed verification", { orderId, paymentId: payment.id, reason: result.reason });
    if (hasUnsettledCapture(order)) {
      const stored = await reviewOrStored(payment.id, proposal.id, `verification failed after capture: ${result.reason}`, order);
      if (stored) return stored;
      throw reviewError();
    }
    const stored = await markPaymentFailed(payment.id, proposal.id, payload);
    if (stored) return stored;
    throw new ApiError("PAYMENT_PROVIDER_ERROR", "The payment could not be verified.");
  }
  if (result.kind === "unexpected") {
    console.error("PayPal order needs reconciliation", { orderId, paymentId: payment.id, reason: result.reason });
    const stored = await reviewOrStored(payment.id, proposal.id, result.reason, order);
    if (stored) return stored;
    throw reviewError();
  }
  if (result.kind === "declined") {
    const stored = await markPaymentFailed(payment.id, proposal.id, payload);
    if (stored) return stored;
    throw new ApiError("PAYMENT_DECLINED", "The payment was declined. Please choose another payment method.");
  }
  if (result.kind === "pending") {
    const capture = result.capture;
    if (!capture) {
      // Not captured (yet): nothing to record. Calling capture again is safe.
      throw new ApiError("PAYMENT_PROVIDER_ERROR", "The payment could not be completed. Please try again.");
    }
    // A pending capture is not proof of payment, and it is not a reconciliation
    // either: a payment in REVIEW stays in REVIEW until a verified COMPLETED
    // capture (or a PayPal-declined/failed capture) gives a clear basis.
    const keepReview = payment.status === "REVIEW";
    try {
      const updated = await prisma.payment.updateMany({
        where: { id: payment.id, status: { in: [...RECONCILABLE_PAYMENT_STATUSES] } },
        data: {
          ...(keepReview ? {} : { status: "APPROVED" as const }),
          paypalCaptureId: capture.id,
          providerPayload: payload,
        },
      });
      if (updated.count === 0) {
        const stored = await storedCompletion(payment.id, proposal.id);
        if (stored) return stored;
        const reviewed = await reviewOrStored(payment.id, proposal.id, "pending capture changed concurrently", order);
        if (reviewed) return reviewed;
        throw reviewError();
      }
      const current = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
      return captureResponse(current, "pending", "approved", null);
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (isUniqueViolation(error)) {
        const stored = await storedCompletion(payment.id, proposal.id);
        if (stored) return stored;
        const reviewed = await reviewOrStored(payment.id, proposal.id, "pending capture conflicted with another payment", order);
        if (reviewed) return reviewed;
        throw reviewError();
      }
      // PayPal holds a capture the database could not confirm. A generic 500
      // could lead the client to pay again, so report it as a payment state error.
      console.error("Failed to record pending capture", { paymentId: payment.id, orderId, error: errorInfo(error) });
      throw paymentStatePersistenceError();
    }
  }

  return completePayment(payment, proposal, order, result);
}

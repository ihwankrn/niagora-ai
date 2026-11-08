import "server-only";

import { z } from "zod";

import { ApiError } from "@/lib/api/http";
import type { AuthUser } from "@/lib/auth/session";
import type { InvoiceStatus, InvoiceSummary } from "@/lib/contracts/agent";
import { prisma } from "@/lib/db";
import * as paypal from "@/lib/paypal/client";
import { formatAmount } from "@/lib/paypal/client";
import { InvoicingError, runInvoiceTool } from "@/lib/paypal/invoicing";
import { STATUS_FROM_DB, toCurrency } from "@/lib/proposals/service";
import type { PaypalInvoice, InvoiceStatus as DbInvoiceStatus } from "@/generated/prisma/client";

// Billing by PayPal invoice, used by the billing agent.
//
// Safety rules:
// - Only an APPROVED proposal can be invoiced. Sending flips it to INVOICED in
//   one conditional update, which closes the PayPal checkout on the client page
//   (create and capture both require APPROVED), so the client cannot pay twice.
// - Every amount on the invoice is copied from the stored proposal items. The
//   invoice is read back from PayPal and must match the proposal total before
//   it is sent.
// - A paid invoice only counts when PayPal reports PAID with the full amount.

const LIVE_STATUSES: DbInvoiceStatus[] = ["SENDING", "SENT", "PAID"];
// A local SENDING row older than this, with no PayPal invoice id, is a crashed send.
const STALE_SENDING_MS = 2 * 60_000;
const DEFAULT_NOTE = "Thank you for approving the proposal. You can pay this invoice securely with PayPal.";

const STATUS_TO_API: Record<DbInvoiceStatus, InvoiceStatus> = {
  SENDING: "sending",
  SENT: "sent",
  PAID: "paid",
  CANCELLED: "cancelled",
  FAILED: "failed",
};

export function toInvoiceSummary(invoice: PaypalInvoice): InvoiceSummary {
  return {
    proposalId: invoice.proposalId,
    status: STATUS_TO_API[invoice.status],
    invoiceNumber: invoice.invoiceNumber,
    amountCents: invoice.amountCents,
    currency: toCurrency(invoice.currency),
    payerViewUrl: invoice.payerViewUrl,
    paidAt: invoice.paidAt?.toISOString() ?? null,
  };
}

// --- PayPal response parsing ---------------------------------------------

const moneySchema = z.looseObject({ currency_code: z.string(), value: z.string() });
const paypalInvoiceSchema = z.looseObject({
  id: z.string().min(1),
  status: z.string(),
  detail: z
    .looseObject({
      reference: z.string().optional(),
      currency_code: z.string().optional(),
      invoice_number: z.string().optional(),
      metadata: z.looseObject({ recipient_view_url: z.string().optional() }).optional(),
    })
    .optional(),
  amount: moneySchema.optional(),
  due_amount: moneySchema.optional(),
  payments: z
    .looseObject({
      paid_amount: moneySchema.optional(),
      transactions: z.array(z.looseObject({ payment_id: z.string().optional() })).optional(),
    })
    .optional(),
});
type PaypalInvoiceRecord = z.infer<typeof paypalInvoiceSchema>;

function parseInvoice(value: unknown): PaypalInvoiceRecord {
  const parsed = paypalInvoiceSchema.safeParse(value);
  if (!parsed.success) throw new InvoicingError("get_invoice");
  return parsed.data;
}

// create_invoice answers with the invoice or with a link to it.
function createdInvoiceId(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const record = value as Record<string, unknown>;
  if (typeof record.id === "string" && record.id) return record.id;
  if (typeof record.href === "string") {
    const match = /\/v2\/invoicing\/invoices\/([A-Za-z0-9-]+)\/?$/.exec(record.href);
    if (match) return match[1];
  }
  return undefined;
}

function proposalReference(proposalId: string) {
  return `niagora:${proposalId}`;
}

function isHttpsUrl(value: string | undefined) {
  if (!value) return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function matchesProposal(invoice: PaypalInvoiceRecord, proposalId: string, amountCents: number, currency: string) {
  return (
    invoice.detail?.reference === proposalReference(proposalId) &&
    invoice.amount?.currency_code === currency &&
    invoice.amount.value === formatAmount(amountCents)
  );
}

function isFullyPaid(invoice: PaypalInvoiceRecord, amountCents: number, currency: string) {
  const paid = invoice.payments?.paid_amount;
  return invoice.status === "PAID" && paid?.currency_code === currency && paid.value === formatAmount(amountCents);
}

function logInvoicingFailure(error: unknown, step: string) {
  if (error instanceof InvoicingError) {
    console.error("PayPal invoicing failed", { step, tool: error.tool, status: error.status, code: error.code });
  } else {
    console.error("PayPal invoicing failed", { step, type: error instanceof Error ? error.name : typeof error });
  }
}

function providerUnavailable(error: unknown, step: string): never {
  logInvoicingFailure(error, step);
  throw new ApiError("PAYMENT_PROVIDER_ERROR", "PayPal invoicing is unavailable right now. Please try again.");
}

async function readInvoice(paypalInvoiceId: string) {
  return parseInvoice(await runInvoiceTool("get_invoice", { invoice_id: paypalInvoiceId }));
}

// --- Lookups ---------------------------------------------------------------

async function findOwnedProposal(user: AuthUser, proposalId: string) {
  const proposal = await prisma.proposal.findFirst({
    where: { id: proposalId, userId: user.id },
    include: { items: { orderBy: { position: "asc" } } },
  });
  if (!proposal) throw new ApiError("NOT_FOUND", "Proposal not found");
  return proposal;
}

async function findLiveInvoice(proposalId: string) {
  return prisma.paypalInvoice.findFirst({
    where: { proposalId, status: { in: LIVE_STATUSES } },
    orderBy: { createdAt: "desc" },
  });
}

async function findLatestInvoice(proposalId: string) {
  return prisma.paypalInvoice.findFirst({ where: { proposalId }, orderBy: { createdAt: "desc" } });
}

export type AgentProposalRow = {
  id: string;
  title: string;
  clientName: string | null;
  hasClientEmail: boolean;
  status: string;
  total: string;
  invoice: { status: InvoiceStatus; invoiceNumber: string | null } | null;
};

/** The signed-in freelancer's recent proposals, in a compact form for the agent. */
export async function listProposalsForAgent(user: AuthUser): Promise<AgentProposalRow[]> {
  const records = await prisma.proposal.findMany({
    where: { userId: user.id },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 25,
    select: {
      id: true,
      title: true,
      clientName: true,
      clientEmail: true,
      status: true,
      currency: true,
      totalCents: true,
      invoices: { orderBy: { createdAt: "desc" }, take: 1, select: { status: true, invoiceNumber: true } },
    },
  });
  return records.map((record) => ({
    id: record.id,
    title: record.title,
    clientName: record.clientName,
    hasClientEmail: Boolean(record.clientEmail),
    status: STATUS_FROM_DB[record.status],
    total: `${formatAmount(record.totalCents)} ${record.currency}`,
    invoice: record.invoices[0]
      ? { status: STATUS_TO_API[record.invoices[0].status], invoiceNumber: record.invoices[0].invoiceNumber }
      : null,
  }));
}

// --- Send ------------------------------------------------------------------

const emailSchema = z.email().max(254);

export type SendInvoiceInput = { clientEmail?: string; note?: string };
export type SendInvoiceResult = { invoice: InvoiceSummary; alreadySent: boolean };

// Rolls a reserved invoice back so the client can pay by checkout again.
async function releaseReservation(invoiceId: string, proposalId: string) {
  await prisma.$transaction([
    prisma.paypalInvoice.update({ where: { id: invoiceId }, data: { status: "FAILED" } }),
    prisma.proposal.updateMany({ where: { id: proposalId, status: "INVOICED" }, data: { status: "APPROVED" } }),
  ]);
}

// A checkout order the client may already have approved at PayPal would be
// captured on top of the invoice, so it blocks invoicing.
async function assertNoCheckoutInFlight(proposalId: string) {
  const payments = await prisma.payment.findMany({
    where: { proposalId, status: { in: ["CREATED", "APPROVED", "REVIEW", "COMPLETED"] } },
    select: { status: true, paypalOrderId: true },
  });
  for (const payment of payments) {
    if (payment.status !== "CREATED") {
      throw new ApiError("CONFLICT", "The client has already started paying this proposal by PayPal checkout.");
    }
    let order: paypal.PaypalOrder;
    try {
      order = await paypal.getOrder(payment.paypalOrderId);
    } catch (error) {
      providerUnavailable(error, "check-checkout");
    }
    if (order.status !== "CREATED" && order.status !== "VOIDED") {
      throw new ApiError("CONFLICT", "The client has already started paying this proposal by PayPal checkout.");
    }
  }
}

export async function sendInvoiceForProposal(
  user: AuthUser,
  proposalId: string,
  input: SendInvoiceInput,
): Promise<SendInvoiceResult> {
  const proposal = await findOwnedProposal(user, proposalId);

  if (proposal.status === "INVOICED") {
    const live = await findLiveInvoice(proposal.id);
    if (live) return { invoice: toInvoiceSummary(live), alreadySent: true };
  }
  if (proposal.status === "PAID") throw new ApiError("CONFLICT", "This proposal is already paid.");
  if (proposal.status === "DRAFT" || proposal.status === "SENT") {
    throw new ApiError("CONFLICT", "The client has to approve the proposal before it can be invoiced.");
  }
  if (proposal.status !== "APPROVED") {
    throw new ApiError("CONFLICT", `A ${STATUS_FROM_DB[proposal.status]} proposal cannot be invoiced.`);
  }

  let recipient = proposal.clientEmail;
  if (!recipient) {
    const email = emailSchema.safeParse(input.clientEmail?.trim());
    if (!email.success) {
      throw new ApiError("VALIDATION_ERROR", "This proposal has no client email. Ask the user for the client's email address.");
    }
    recipient = email.data;
  }
  const note = input.note?.trim().slice(0, 500) || DEFAULT_NOTE;
  const currency = toCurrency(proposal.currency);
  const amountCents = proposal.totalCents;
  const itemsTotal = proposal.items.reduce((sum, item) => sum + item.amountCents, 0);
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0 || itemsTotal !== amountCents || proposal.items.length === 0) {
    throw new ApiError("CONFLICT", "This proposal has no payable amount.");
  }

  await assertNoCheckoutInFlight(proposal.id);

  // Reserve: APPROVED -> INVOICED and a local SENDING row, atomically. The
  // partial unique index allows only one live invoice per proposal.
  let reservationId: string;
  try {
    reservationId = await prisma.$transaction(async (tx) => {
      const flipped = await tx.proposal.updateMany({
        where: { id: proposal.id, userId: user.id, status: "APPROVED" },
        data: { status: "INVOICED", ...(proposal.clientEmail ? {} : { clientEmail: recipient }) },
      });
      if (flipped.count !== 1) throw new ApiError("CONFLICT", "The proposal changed. Please check its status and try again.");
      const row = await tx.paypalInvoice.create({ data: { proposalId: proposal.id, amountCents, currency } });
      return row.id;
    });
  } catch (error) {
    if (error instanceof ApiError) throw error;
    const live = await findLiveInvoice(proposal.id);
    if (live) return { invoice: toInvoiceSummary(live), alreadySent: true };
    throw error;
  }

  // 1. Draft invoice, every line copied from the stored proposal items.
  let paypalInvoiceId: string | undefined;
  try {
    const created = await runInvoiceTool("create_invoice", {
      currency_code: currency,
      reference: proposalReference(proposal.id),
      invoice_date: new Date().toISOString().slice(0, 10),
      note,
      primary_recipients: [
        {
          billing_info: {
            email_address: recipient,
            ...(proposal.clientName ? { business_name: proposal.clientName.slice(0, 300) } : {}),
          },
        },
      ],
      items: proposal.items.map((item) => ({
        name: item.title.slice(0, 200),
        description: `${item.estimatedHours.toString()} h at ${formatAmount(item.hourlyRateCents)} ${currency}/h${
          item.description ? ` - ${item.description}` : ""
        }`.slice(0, 1_000),
        quantity: "1",
        unit_amount: { currency_code: currency, value: formatAmount(item.amountCents) },
        unit_of_measure: "AMOUNT",
      })),
    });
    paypalInvoiceId = createdInvoiceId(created);
    if (!paypalInvoiceId) throw new InvoicingError("create_invoice");
  } catch (error) {
    await releaseReservation(reservationId, proposal.id);
    providerUnavailable(error, "create");
  }

  // 2. Read it back: it must be an unsent draft that matches the proposal.
  let draft: PaypalInvoiceRecord;
  try {
    draft = await readInvoice(paypalInvoiceId);
  } catch (error) {
    await releaseReservation(reservationId, proposal.id);
    providerUnavailable(error, "verify");
  }
  if (draft.status !== "DRAFT" || !matchesProposal(draft, proposal.id, amountCents, currency)) {
    await runInvoiceTool("delete_invoice", { invoice_id: paypalInvoiceId }).catch(() => undefined);
    await releaseReservation(reservationId, proposal.id);
    console.error("PayPal invoicing failed", { step: "verify", reason: "draft does not match the proposal" });
    throw new ApiError("PAYMENT_PROVIDER_ERROR", "PayPal created an invoice that did not match the proposal, so it was not sent.");
  }
  await prisma.paypalInvoice.update({
    where: { id: reservationId },
    data: { paypalInvoiceId, invoiceNumber: draft.detail?.invoice_number ?? null },
  });

  // 3. Send it to the client.
  try {
    await runInvoiceTool("send_invoice", { invoice_id: paypalInvoiceId, send_to_recipient: true, send_to_invoicer: false });
  } catch (error) {
    // The send may have gone through before the error. Settle from PayPal's record.
    logInvoicingFailure(error, "send");
  }
  const settled = await settleSending(reservationId);
  if (settled.status !== "SENT" && settled.status !== "PAID") {
    throw new ApiError("PAYMENT_PROVIDER_ERROR", "PayPal could not send the invoice. Nothing was sent to the client.");
  }
  return { invoice: toInvoiceSummary(settled), alreadySent: false };
}

// Resolves a SENDING row from PayPal's record: sent, or rolled back.
async function settleSending(invoiceRowId: string): Promise<PaypalInvoice> {
  const row = await prisma.paypalInvoice.findUniqueOrThrow({ where: { id: invoiceRowId } });
  if (row.status !== "SENDING") return row;

  if (!row.paypalInvoiceId) {
    if (Date.now() - row.createdAt.getTime() > STALE_SENDING_MS) {
      await releaseReservation(row.id, row.proposalId);
      return prisma.paypalInvoice.findUniqueOrThrow({ where: { id: row.id } });
    }
    return row;
  }

  let remote: PaypalInvoiceRecord;
  try {
    remote = await readInvoice(row.paypalInvoiceId);
  } catch (error) {
    logInvoicingFailure(error, "settle");
    return row;
  }
  if (remote.status === "DRAFT") {
    await runInvoiceTool("delete_invoice", { invoice_id: row.paypalInvoiceId }).catch(() => undefined);
    await releaseReservation(row.id, row.proposalId);
    return prisma.paypalInvoice.findUniqueOrThrow({ where: { id: row.id } });
  }
  const viewUrl = remote.detail?.metadata?.recipient_view_url;
  const updated = await prisma.paypalInvoice.update({
    where: { id: row.id },
    data: { status: "SENT", payerViewUrl: isHttpsUrl(viewUrl) ? viewUrl : null },
  });
  return applyRemoteState(updated, remote);
}

// --- Status, reminders, cancellation ----------------------------------------

// Applies PayPal's view of a sent invoice: paid or cancelled.
async function applyRemoteState(row: PaypalInvoice, remote: PaypalInvoiceRecord): Promise<PaypalInvoice> {
  if (row.status !== "SENT" || !row.paypalInvoiceId) return row;

  if (remote.status === "CANCELLED") {
    const [updated] = await prisma.$transaction([
      prisma.paypalInvoice.update({ where: { id: row.id }, data: { status: "CANCELLED" } }),
      prisma.proposal.updateMany({ where: { id: row.proposalId, status: "INVOICED" }, data: { status: "APPROVED" } }),
    ]);
    return updated;
  }

  if (remote.status !== "PAID") return row;
  if (!isFullyPaid(remote, row.amountCents, row.currency)) {
    console.error("PayPal invoicing failed", { step: "reconcile", reason: "paid amount does not match the invoice" });
    return row;
  }

  const paidAt = new Date();
  const transactionId = remote.payments?.transactions?.find((t) => t.payment_id)?.payment_id ?? null;
  const updated = await prisma.$transaction(async (tx) => {
    const flipped = await tx.proposal.updateMany({
      where: { id: row.proposalId, status: "INVOICED" },
      data: { status: "PAID", paidAt },
    });
    if (flipped.count !== 1) {
      // Paid twice or changed by hand: keep the invoice as sent for a human to look at.
      console.error("PayPal invoicing failed", { step: "reconcile", reason: "invoice paid but proposal is not invoiced" });
      return row;
    }
    await tx.payment.create({
      data: {
        proposalId: row.proposalId,
        status: "COMPLETED",
        amountCents: row.amountCents,
        currency: row.currency,
        // Invoice payments have no checkout order; the invoice id takes its place.
        paypalOrderId: row.paypalInvoiceId!,
        paypalCaptureId: transactionId,
        requestId: `invoice:${row.paypalInvoiceId}`,
        providerPayload: {
          source: "invoice",
          invoiceId: remote.id,
          status: remote.status,
          paidAmount: { currency_code: row.currency, value: formatAmount(row.amountCents) },
        },
        verifiedAt: paidAt,
      },
    });
    return tx.paypalInvoice.update({ where: { id: row.id }, data: { status: "PAID", paidAt } });
  });
  return updated;
}

async function refreshRow(row: PaypalInvoice): Promise<PaypalInvoice> {
  if (row.status === "SENDING") return settleSending(row.id);
  if (row.status !== "SENT" || !row.paypalInvoiceId) return row;
  let remote: PaypalInvoiceRecord;
  try {
    remote = await readInvoice(row.paypalInvoiceId);
  } catch (error) {
    providerUnavailable(error, "refresh");
  }
  return applyRemoteState(row, remote);
}

/** Latest invoice for a proposal, refreshed from PayPal. */
export async function checkInvoice(user: AuthUser, proposalId: string): Promise<InvoiceSummary | null> {
  const proposal = await findOwnedProposal(user, proposalId);
  const row = (await findLiveInvoice(proposal.id)) ?? (await findLatestInvoice(proposal.id));
  if (!row) return null;
  return toInvoiceSummary(await refreshRow(row));
}

async function requireSentInvoice(user: AuthUser, proposalId: string) {
  const proposal = await findOwnedProposal(user, proposalId);
  const live = await findLiveInvoice(proposal.id);
  if (!live) throw new ApiError("CONFLICT", "This proposal has no open PayPal invoice.");
  const current = await refreshRow(live);
  if (current.status === "PAID") throw new ApiError("CONFLICT", "This invoice is already paid.");
  if (current.status !== "SENT" || !current.paypalInvoiceId) {
    throw new ApiError("CONFLICT", "This invoice is not open. Check its status first.");
  }
  return current as PaypalInvoice & { paypalInvoiceId: string };
}

export async function remindInvoice(user: AuthUser, proposalId: string, note?: string): Promise<InvoiceSummary> {
  const invoice = await requireSentInvoice(user, proposalId);
  try {
    await runInvoiceTool("send_invoice_reminder", {
      invoice_id: invoice.paypalInvoiceId,
      ...(note?.trim() ? { note: note.trim().slice(0, 500) } : {}),
    });
  } catch (error) {
    providerUnavailable(error, "remind");
  }
  return toInvoiceSummary(invoice);
}

export async function cancelInvoice(user: AuthUser, proposalId: string, reason?: string): Promise<InvoiceSummary> {
  const invoice = await requireSentInvoice(user, proposalId);
  try {
    await runInvoiceTool("cancel_sent_invoice", {
      invoice_id: invoice.paypalInvoiceId,
      send_to_recipient: true,
      ...(reason?.trim() ? { note: reason.trim().slice(0, 500) } : {}),
    });
  } catch (error) {
    // It may have been paid meanwhile; report PayPal's current state instead.
    logInvoicingFailure(error, "cancel");
    const current = await refreshRow(invoice);
    if (current.status === "PAID") throw new ApiError("CONFLICT", "This invoice was paid, so it cannot be cancelled.");
    throw new ApiError("PAYMENT_PROVIDER_ERROR", "PayPal could not cancel the invoice. Please try again.");
  }
  let remote: PaypalInvoiceRecord;
  try {
    remote = await readInvoice(invoice.paypalInvoiceId);
  } catch (error) {
    providerUnavailable(error, "cancel-verify");
  }
  return toInvoiceSummary(await applyRemoteState(invoice, remote));
}

/** Webhook entry point: settle a local invoice from PayPal's record. */
export async function reconcileInvoiceByPaypalId(paypalInvoiceId: string) {
  const row = await prisma.paypalInvoice.findUnique({ where: { paypalInvoiceId } });
  // Not ours (another app on the same PayPal account) or already final.
  if (!row) return;
  await refreshRow(row);
}

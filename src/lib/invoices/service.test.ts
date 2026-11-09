import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api/http";
import { InvoicingError } from "@/lib/paypal/invoicing";

const db = vi.hoisted(() => ({
  proposal: { findFirst: vi.fn(), findMany: vi.fn(), updateMany: vi.fn() },
  payment: { findMany: vi.fn(), create: vi.fn() },
  paypalInvoice: {
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    findUniqueOrThrow: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  $transaction: vi.fn(),
}));
const invoicing = vi.hoisted(() => ({ runInvoiceTool: vi.fn() }));
const paypal = vi.hoisted(() => ({ getOrder: vi.fn() }));

vi.mock("@/lib/db", () => ({ prisma: db }));
vi.mock("@/lib/paypal/invoicing", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/paypal/invoicing")>()),
  runInvoiceTool: invoicing.runInvoiceTool,
}));
vi.mock("@/lib/paypal/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/paypal/client")>()),
  getOrder: paypal.getOrder,
}));

const { cancelInvoice, checkInvoice, reconcileInvoiceByPaypalId, sendInvoiceForProposal } = await import("./service");

const USER = { id: "11111111-1111-4111-8111-111111111111", email: "freelancer@example.com" };
const PROPOSAL_ID = "33333333-3333-4333-8333-333333333333";
const ROW_ID = "55555555-5555-4555-8555-555555555555";
const INVOICE_ID = "INV2-AAAA-BBBB-CCCC-DDDD";
const now = new Date("2026-11-08T12:00:00.000Z");

function proposal(status: string, extra: Record<string, unknown> = {}) {
  return {
    id: PROPOSAL_ID,
    userId: USER.id,
    title: "Catering website",
    clientName: "Rasa Catering",
    clientEmail: "client@example.com",
    currency: "USD",
    totalCents: 132_500,
    status,
    items: [
      { title: "Pages", description: null, estimatedHours: { toString: () => "20" }, hourlyRateCents: 5_000, amountCents: 100_000 },
      { title: "Contact form", description: "With email", estimatedHours: { toString: () => "6.5" }, hourlyRateCents: 5_000, amountCents: 32_500 },
    ],
    ...extra,
  };
}

function row(status: string, extra: Record<string, unknown> = {}) {
  return {
    id: ROW_ID,
    proposalId: PROPOSAL_ID,
    status,
    amountCents: 132_500,
    currency: "USD",
    paypalInvoiceId: INVOICE_ID,
    invoiceNumber: "0007",
    payerViewUrl: "https://www.sandbox.paypal.com/invoice/p/#INV2AAAA",
    paidAt: null,
    createdAt: now,
    updatedAt: now,
    ...extra,
  };
}

function remoteInvoice(status: string, extra: Record<string, unknown> = {}) {
  return {
    id: INVOICE_ID,
    status,
    detail: {
      reference: `niagora:${PROPOSAL_ID}`,
      currency_code: "USD",
      invoice_number: "0007",
      metadata: { recipient_view_url: "https://www.sandbox.paypal.com/invoice/p/#INV2AAAA" },
    },
    amount: { currency_code: "USD", value: "1325.00" },
    ...extra,
  };
}

// Answers PayPal tool calls in order, recording each call.
function paypalAnswers(answers: Partial<Record<string, unknown[]>>) {
  invoicing.runInvoiceTool.mockImplementation(async (tool: string) => {
    const queue = answers[tool];
    if (!queue || queue.length === 0) throw new Error(`unexpected PayPal call ${tool}`);
    const next = queue.shift();
    if (next instanceof Error) throw next;
    return next;
  });
}

const calls = (tool: string) => invoicing.runInvoiceTool.mock.calls.filter(([name]) => name === tool);

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  db.$transaction.mockImplementation(async (arg: unknown) =>
    typeof arg === "function" ? (arg as (tx: typeof db) => unknown)(db) : Promise.all(arg as Promise<unknown>[]),
  );
  db.payment.findMany.mockResolvedValue([]);
  db.proposal.updateMany.mockResolvedValue({ count: 1 });
  db.paypalInvoice.create.mockResolvedValue(row("SENDING", { paypalInvoiceId: null, invoiceNumber: null, payerViewUrl: null }));
  db.paypalInvoice.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => row("SENT", data));
});

describe("sendInvoiceForProposal", () => {
  beforeEach(() => {
    db.proposal.findFirst.mockResolvedValue(proposal("APPROVED"));
    db.paypalInvoice.findUniqueOrThrow.mockResolvedValue(row("SENDING", { payerViewUrl: null }));
  });

  it("bills exactly the stored proposal lines and sends the verified draft", async () => {
    paypalAnswers({
      create_invoice: [{ href: `https://api-m.sandbox.paypal.com/v2/invoicing/invoices/${INVOICE_ID}`, rel: "self" }],
      get_invoice: [remoteInvoice("DRAFT"), remoteInvoice("UNPAID")],
      send_invoice: [{ href: "https://www.sandbox.paypal.com/invoice/p/#INV2AAAA" }],
    });

    const result = await sendInvoiceForProposal(USER, PROPOSAL_ID, { note: "Thanks!" });

    const [, args] = calls("create_invoice")[0];
    expect(args).toMatchObject({
      currency_code: "USD",
      reference: `niagora:${PROPOSAL_ID}`,
      note: "Thanks!",
      primary_recipients: [{ billing_info: { email_address: "client@example.com", business_name: "Rasa Catering" } }],
      items: [
        { name: "Pages", quantity: "1", unit_amount: { currency_code: "USD", value: "1000.00" } },
        { name: "Contact form", quantity: "1", unit_amount: { currency_code: "USD", value: "325.00" } },
      ],
    });
    expect(calls("send_invoice")[0][1]).toEqual({ invoice_id: INVOICE_ID, send_to_recipient: true, send_to_invoicer: false });
    // APPROVED -> INVOICED closes the client's checkout.
    expect(db.proposal.updateMany).toHaveBeenCalledWith({
      where: { id: PROPOSAL_ID, userId: USER.id, status: "APPROVED" },
      data: { status: "INVOICED" },
    });
    expect(result).toMatchObject({ alreadySent: false, invoice: { status: "sent", amountCents: 132_500, currency: "USD" } });
  });

  it.each(["DRAFT", "SENT", "PAID", "CANCELLED"])("refuses a %s proposal without calling PayPal", async (status) => {
    db.proposal.findFirst.mockResolvedValue(proposal(status));
    await expect(sendInvoiceForProposal(USER, PROPOSAL_ID, {})).rejects.toBeInstanceOf(ApiError);
    expect(invoicing.runInvoiceTool).not.toHaveBeenCalled();
  });

  it("returns the existing invoice instead of billing twice", async () => {
    db.proposal.findFirst.mockResolvedValue(proposal("INVOICED"));
    db.paypalInvoice.findFirst.mockResolvedValue(row("SENT"));

    const result = await sendInvoiceForProposal(USER, PROPOSAL_ID, {});

    expect(result.alreadySent).toBe(true);
    expect(invoicing.runInvoiceTool).not.toHaveBeenCalled();
  });

  it("asks for an email when the proposal has none, and stores the one given", async () => {
    db.proposal.findFirst.mockResolvedValue(proposal("APPROVED", { clientEmail: null }));
    await expect(sendInvoiceForProposal(USER, PROPOSAL_ID, {})).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(sendInvoiceForProposal(USER, PROPOSAL_ID, { clientEmail: "not an email" })).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });

    paypalAnswers({
      create_invoice: [{ id: INVOICE_ID }],
      get_invoice: [remoteInvoice("DRAFT"), remoteInvoice("UNPAID")],
      send_invoice: [{}],
    });
    await sendInvoiceForProposal(USER, PROPOSAL_ID, { clientEmail: "new@client.test" });

    expect(db.proposal.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "INVOICED", clientEmail: "new@client.test" } }),
    );
    expect(calls("create_invoice")[0][1]).toMatchObject({
      primary_recipients: [{ billing_info: { email_address: "new@client.test" } }],
    });
  });

  it("refuses while the client is paying by checkout", async () => {
    db.payment.findMany.mockResolvedValue([{ status: "APPROVED", paypalOrderId: "ORDER1" }]);
    await expect(sendInvoiceForProposal(USER, PROPOSAL_ID, {})).rejects.toMatchObject({ code: "CONFLICT" });

    db.payment.findMany.mockResolvedValue([{ status: "CREATED", paypalOrderId: "ORDER1" }]);
    paypal.getOrder.mockResolvedValue({ id: "ORDER1", status: "APPROVED" });
    await expect(sendInvoiceForProposal(USER, PROPOSAL_ID, {})).rejects.toMatchObject({ code: "CONFLICT" });

    expect(invoicing.runInvoiceTool).not.toHaveBeenCalled();
  });

  it("deletes a draft that does not match the proposal and reopens checkout", async () => {
    paypalAnswers({
      create_invoice: [{ id: INVOICE_ID }],
      get_invoice: [remoteInvoice("DRAFT", { amount: { currency_code: "USD", value: "1.00" } })],
      delete_invoice: [null],
    });

    await expect(sendInvoiceForProposal(USER, PROPOSAL_ID, {})).rejects.toMatchObject({ code: "PAYMENT_PROVIDER_ERROR" });

    expect(calls("delete_invoice")).toHaveLength(1);
    expect(calls("send_invoice")).toHaveLength(0);
    expect(db.paypalInvoice.update).toHaveBeenCalledWith({ where: { id: ROW_ID }, data: { status: "FAILED" } });
    expect(db.proposal.updateMany).toHaveBeenLastCalledWith({
      where: { id: PROPOSAL_ID, status: "INVOICED" },
      data: { status: "APPROVED" },
    });
  });

  it("rolls back when PayPal cannot create the invoice", async () => {
    paypalAnswers({ create_invoice: [new InvoicingError("create_invoice", 500)] });

    await expect(sendInvoiceForProposal(USER, PROPOSAL_ID, {})).rejects.toMatchObject({ code: "PAYMENT_PROVIDER_ERROR" });

    expect(db.paypalInvoice.update).toHaveBeenCalledWith({ where: { id: ROW_ID }, data: { status: "FAILED" } });
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toMatch(/client@example.com/);
  });
});

describe("checkInvoice", () => {
  beforeEach(() => {
    db.proposal.findFirst.mockResolvedValue(proposal("INVOICED"));
    db.paypalInvoice.findFirst.mockResolvedValue(row("SENT"));
  });

  it("records a fully paid invoice as a verified payment and marks the proposal paid", async () => {
    paypalAnswers({
      get_invoice: [
        remoteInvoice("PAID", {
          payments: { paid_amount: { currency_code: "USD", value: "1325.00" }, transactions: [{ payment_id: "TXN123" }] },
        }),
      ],
    });
    db.paypalInvoice.update.mockResolvedValue(row("PAID", { paidAt: now }));

    const invoice = await checkInvoice(USER, PROPOSAL_ID);

    expect(db.proposal.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: PROPOSAL_ID, status: "INVOICED" }, data: expect.objectContaining({ status: "PAID" }) }),
    );
    expect(db.payment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        proposalId: PROPOSAL_ID,
        status: "COMPLETED",
        amountCents: 132_500,
        currency: "USD",
        paypalOrderId: INVOICE_ID,
        paypalCaptureId: "TXN123",
        verifiedAt: expect.any(Date),
      }),
    });
    expect(invoice?.status).toBe("paid");
  });

  it("does not count a partial or mismatched payment", async () => {
    paypalAnswers({
      get_invoice: [remoteInvoice("PAID", { payments: { paid_amount: { currency_code: "USD", value: "100.00" } } })],
    });

    const invoice = await checkInvoice(USER, PROPOSAL_ID);

    expect(db.payment.create).not.toHaveBeenCalled();
    expect(invoice?.status).toBe("sent");
  });

  it("keeps an invoice open while PayPal says it is unpaid", async () => {
    paypalAnswers({ get_invoice: [remoteInvoice("UNPAID")] });
    expect((await checkInvoice(USER, PROPOSAL_ID))?.status).toBe("sent");
    expect(db.proposal.updateMany).not.toHaveBeenCalled();
  });

  it("returns null when the proposal was never invoiced", async () => {
    db.paypalInvoice.findFirst.mockResolvedValue(null);
    expect(await checkInvoice(USER, PROPOSAL_ID)).toBeNull();
  });

  it("only looks at the signed-in freelancer's proposals", async () => {
    db.proposal.findFirst.mockResolvedValue(null);
    await expect(checkInvoice(USER, PROPOSAL_ID)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(db.proposal.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: PROPOSAL_ID, userId: USER.id } }));
  });
});

describe("cancelInvoice", () => {
  it("cancels at PayPal and reopens checkout", async () => {
    db.proposal.findFirst.mockResolvedValue(proposal("INVOICED"));
    db.paypalInvoice.findFirst.mockResolvedValue(row("SENT"));
    paypalAnswers({
      get_invoice: [remoteInvoice("UNPAID"), remoteInvoice("CANCELLED")],
      cancel_sent_invoice: [{ success: true }],
    });
    db.paypalInvoice.update.mockResolvedValue(row("CANCELLED"));

    const invoice = await cancelInvoice(USER, PROPOSAL_ID, "Paying by card instead");

    expect(calls("cancel_sent_invoice")[0][1]).toMatchObject({ invoice_id: INVOICE_ID, note: "Paying by card instead" });
    expect(db.proposal.updateMany).toHaveBeenCalledWith({ where: { id: PROPOSAL_ID, status: "INVOICED" }, data: { status: "APPROVED" } });
    expect(invoice.status).toBe("cancelled");
  });
});

describe("reconcileInvoiceByPaypalId", () => {
  it("ignores invoices this app did not create", async () => {
    db.paypalInvoice.findUnique.mockResolvedValue(null);
    await reconcileInvoiceByPaypalId("INV2-OTHER");
    expect(invoicing.runInvoiceTool).not.toHaveBeenCalled();
  });
});

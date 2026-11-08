import { z } from "zod";

import { centsSchema, currencySchema, isoDateTimeSchema, uuidSchema } from "./common";

// A PayPal invoice sent by the billing agent, as shown to the freelancer.
export const INVOICE_STATUSES = ["sending", "sent", "paid", "cancelled", "failed"] as const;
export const invoiceStatusSchema = z.enum(INVOICE_STATUSES);
export type InvoiceStatus = z.infer<typeof invoiceStatusSchema>;

export const invoiceSummarySchema = z.object({
  proposalId: uuidSchema,
  status: invoiceStatusSchema,
  invoiceNumber: z.string().nullable(),
  amountCents: centsSchema,
  currency: currencySchema,
  // PayPal's page where the client views and pays the invoice (Sandbox).
  payerViewUrl: z.url().nullable(),
  paidAt: isoDateTimeSchema.nullable(),
});
export type InvoiceSummary = z.infer<typeof invoiceSummarySchema>;

export const MAX_AGENT_MESSAGES = 12;
export const MAX_AGENT_MESSAGE_LENGTH = 2_000;

// POST /api/agent/billing
// The browser keeps the conversation and sends it each turn; the last message
// must be the user's. The server holds no chat state.
export const agentMessageSchema = z.strictObject({
  role: z.enum(["user", "assistant"]),
  content: z.string().trim().min(1).max(MAX_AGENT_MESSAGE_LENGTH),
});
export type AgentMessage = z.infer<typeof agentMessageSchema>;

export const billingAgentRequestSchema = z.strictObject({
  messages: z
    .array(agentMessageSchema)
    .min(1)
    .max(MAX_AGENT_MESSAGES)
    .refine((messages) => messages.at(-1)?.role === "user", { message: "The last message must be from the user" }),
});
export type BillingAgentRequest = z.infer<typeof billingAgentRequestSchema>;

export const AGENT_TOOL_NAMES = ["list_proposals", "send_invoice", "check_invoice", "remind_invoice", "cancel_invoice"] as const;

// What the agent did this turn, so the UI can show it next to the reply.
export const agentActionSchema = z.object({
  tool: z.enum(AGENT_TOOL_NAMES),
  proposalId: uuidSchema.nullable(),
  ok: z.boolean(),
  // Short human-readable outcome, e.g. "Invoice INV-0012 sent".
  summary: z.string(),
  invoice: invoiceSummarySchema.nullable(),
});
export type AgentAction = z.infer<typeof agentActionSchema>;

export const billingAgentResponseSchema = z.object({
  reply: z.string(),
  actions: z.array(agentActionSchema),
  model: z.string(),
});
export type BillingAgentResponse = z.infer<typeof billingAgentResponseSchema>;

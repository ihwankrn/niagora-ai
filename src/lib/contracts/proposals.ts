import { z } from "zod";

import { centsSchema, currencySchema, isoDateTimeSchema, optionalTextSchema, titleSchema, uuidSchema } from "./common";
import { quoteInputFields, quoteSchema } from "./quotes";

export const PROPOSAL_STATUSES = ["draft", "sent", "approved", "rejected", "paid", "cancelled"] as const;
export const proposalStatusSchema = z.enum(PROPOSAL_STATUSES);
export type ProposalStatus = z.infer<typeof proposalStatusSchema>;

// POST /api/proposals
// Same pricing inputs as /api/quotes/calculate; the server recalculates the
// quote and stores its result, ignoring any amounts from the browser.
export const createProposalRequestSchema = z.strictObject({
  briefId: uuidSchema.optional(),
  title: titleSchema,
  summary: optionalTextSchema(5_000),
  clientName: optionalTextSchema(200),
  clientEmail: z.email().max(320).optional(),
  ...quoteInputFields,
});
export type CreateProposalRequest = z.infer<typeof createProposalRequestSchema>;

export const proposalSchema = quoteSchema.extend({
  id: uuidSchema,
  briefId: uuidSchema.nullable(),
  title: z.string(),
  summary: z.string().nullable(),
  clientName: z.string().nullable(),
  clientEmail: z.string().nullable(),
  status: proposalStatusSchema,
  approvedAt: isoDateTimeSchema.nullable(),
  paidAt: isoDateTimeSchema.nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type Proposal = z.infer<typeof proposalSchema>;

// GET /api/proposals?limit=20
// Lists only the signed-in user's proposals, newest first.
export const DEFAULT_PROPOSAL_LIST_LIMIT = 20;
export const MAX_PROPOSAL_LIST_LIMIT = 100;

export const listProposalsQuerySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(MAX_PROPOSAL_LIST_LIMIT).default(DEFAULT_PROPOSAL_LIST_LIMIT),
});
export type ListProposalsQuery = z.infer<typeof listProposalsQuerySchema>;

export const proposalSummarySchema = z.object({
  id: uuidSchema,
  title: z.string(),
  clientName: z.string().nullable(),
  status: proposalStatusSchema,
  currency: currencySchema,
  totalCents: centsSchema,
  createdAt: isoDateTimeSchema,
});
export type ProposalSummary = z.infer<typeof proposalSummarySchema>;

export const currencyAmountSchema = z.object({
  currency: currencySchema,
  amountCents: centsSchema,
});
export type CurrencyAmount = z.infer<typeof currencyAmountSchema>;

// Dashboard statistics over all of the user's proposals (not just the
// returned page).
export const dashboardStatsSchema = z.object({
  totalProjects: z.int().nonnegative(), // all proposals
  pendingProposals: z.int().nonnegative(), // status "sent": awaiting client response
  paidProjects: z.int().nonnegative(), // proposals with a verified, completed payment
  // Sum of verified, completed PayPal captures, one entry per currency
  // (amounts in different currencies are never added together).
  revenueReceived: z.array(currencyAmountSchema),
});
export type DashboardStats = z.infer<typeof dashboardStatsSchema>;

export const listProposalsResponseSchema = z.object({
  items: z.array(proposalSummarySchema),
  stats: dashboardStatsSchema,
});
export type ListProposalsResponse = z.infer<typeof listProposalsResponseSchema>;

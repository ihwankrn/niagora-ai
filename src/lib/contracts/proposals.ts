import { z } from "zod";

import { isoDateTimeSchema, optionalTextSchema, titleSchema, uuidSchema } from "./common";
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

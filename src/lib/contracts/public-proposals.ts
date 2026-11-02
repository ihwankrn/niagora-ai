import { z } from "zod";

import { centsSchema, currencySchema, isoDateTimeSchema } from "./common";
import { proposalStatusSchema } from "./proposals";
import { quoteLineSchema } from "./quotes";

export const publicProposalTokenParamSchema = z.strictObject({
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
});
export type PublicProposalTokenParam = z.infer<typeof publicProposalTokenParamSchema>;

// GET /api/public/proposals/[token] returns only fields intended for a client.
export const publicProposalApiResponseSchema = z
  .object({
    title: z.string(),
    summary: z.string().nullable(),
    clientName: z.string().nullable(),
    freelancerName: z.string().nullable(),
    status: proposalStatusSchema,
    currency: currencySchema,
    items: z.array(quoteLineSchema),
    totalHours: z.number().nonnegative(),
    subtotalCents: centsSchema,
    totalCents: centsSchema,
    approvedAt: isoDateTimeSchema.nullable(),
    paidAt: isoDateTimeSchema.nullable(),
  })
  .strip();
export type PublicProposalApiResponse = z.infer<typeof publicProposalApiResponseSchema>;

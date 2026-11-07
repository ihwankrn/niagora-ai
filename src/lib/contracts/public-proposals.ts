import { z } from "zod";

import { publicProposalSchema, type PublicProposal, shareTokenSchema } from "./payments";

export const publicProposalTokenParamSchema = z.strictObject({ token: shareTokenSchema });
export type PublicProposalTokenParam = z.infer<typeof publicProposalTokenParamSchema>;

// GET /api/public/proposals/[token] returns only fields intended for a client.
export const publicProposalApiResponseSchema = publicProposalSchema;
export type PublicProposalApiResponse = PublicProposal;

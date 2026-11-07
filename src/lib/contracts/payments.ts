import { z } from "zod";

import { centsSchema, currencySchema, isoDateTimeSchema } from "./common";
import { proposalSchema, proposalStatusSchema } from "./proposals";
import { quoteLineSchema } from "./quotes";

// Client-facing endpoints are addressed by the proposal's share token
// (32 random bytes, base64url) instead of a session.
export const shareTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

// POST /api/proposals/:id/send (freelancer, session required)
export const sendProposalResponseSchema = z.object({
  proposal: proposalSchema,
  // Link to give the client: APP_BASE_URL/proposals/view/<shareToken>
  shareUrl: z.url(),
});
export type SendProposalResponse = z.infer<typeof sendProposalResponseSchema>;

// GET /api/public/proposals/:token (client, no session)
// Never includes internal ids, the client email or the freelancer's account.
export const publicProposalSchema = z.object({
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
});
export type PublicProposal = z.infer<typeof publicProposalSchema>;

// POST /api/public/proposals/:token/paypal/orders (no body)
// The amount always comes from the stored proposal, never from the browser.
export const createPaypalOrderResponseSchema = z.object({
  orderId: z.string(),
  // For the PayPal JS SDK createOrder callback: return orderId.
  // approveUrl is the PayPal page for a redirect-based fallback.
  approveUrl: z.url().nullable(),
  amountCents: centsSchema,
  currency: currencySchema,
});
export type CreatePaypalOrderResponse = z.infer<typeof createPaypalOrderResponseSchema>;

// POST /api/public/proposals/:token/paypal/capture
export const capturePaypalOrderRequestSchema = z.strictObject({
  orderId: z.string().regex(/^[A-Z0-9]{1,36}$/),
});
export type CapturePaypalOrderRequest = z.infer<typeof capturePaypalOrderRequestSchema>;

export const PAYMENT_RESULT_STATUSES = ["completed", "pending"] as const;

export const capturePaypalOrderResponseSchema = z.object({
  // "completed": captured and verified against the PayPal API; proposal is paid.
  // "pending": PayPal accepted the capture but has not completed it yet.
  paymentStatus: z.enum(PAYMENT_RESULT_STATUSES),
  proposalStatus: proposalStatusSchema,
  orderId: z.string(),
  captureId: z.string().nullable(),
  amountCents: centsSchema,
  currency: currencySchema,
  paidAt: isoDateTimeSchema.nullable(),
});
export type CapturePaypalOrderResponse = z.infer<typeof capturePaypalOrderResponseSchema>;

import { z } from "zod";

import {
  centsSchema,
  currencySchema,
  hourlyRateCentsSchema,
  hoursSchema,
  optionalTextSchema,
  titleSchema,
} from "./common";

export const MAX_QUOTE_ITEMS = 50;

// A line item as sent by the browser: no amounts, only hours and an optional
// per-item rate override. Unknown keys (e.g. "amountCents", "totalCents") are
// rejected so a client-side total can never be mistaken for a trusted value.
export const quoteItemInputSchema = z.strictObject({
  title: titleSchema,
  description: optionalTextSchema(2_000),
  estimatedHours: hoursSchema,
  hourlyRateCents: hourlyRateCentsSchema.optional(),
});
export type QuoteItemInput = z.infer<typeof quoteItemInputSchema>;

export const quoteInputFields = {
  currency: currencySchema,
  // Default rate for items without their own hourlyRateCents.
  hourlyRateCents: hourlyRateCentsSchema,
  items: z.array(quoteItemInputSchema).min(1).max(MAX_QUOTE_ITEMS),
};

// POST /api/quotes/calculate
export const calculateQuoteRequestSchema = z.strictObject(quoteInputFields);
export type CalculateQuoteRequest = z.infer<typeof calculateQuoteRequestSchema>;

export const quoteLineSchema = z.object({
  position: z.int().nonnegative(),
  title: z.string(),
  description: z.string().nullable(),
  estimatedHours: z.number(),
  hourlyRateCents: centsSchema,
  // round_half_up(estimatedHours * hourlyRateCents), computed on the server.
  amountCents: centsSchema,
});
export type QuoteLine = z.infer<typeof quoteLineSchema>;

export const quoteSchema = z.object({
  currency: currencySchema,
  hourlyRateCents: centsSchema,
  items: z.array(quoteLineSchema),
  totalHours: z.number().nonnegative(),
  subtotalCents: centsSchema,
  // Equal to subtotalCents in the MVP (no tax or discount yet).
  totalCents: centsSchema,
});
export type Quote = z.infer<typeof quoteSchema>;

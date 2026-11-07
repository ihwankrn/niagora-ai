import { z } from "zod";

// Shared building blocks for the API contracts. These files are safe to import
// from client components (types and schemas only, no server code).

// Currencies supported for PayPal checkout in the MVP. All use 2 decimals,
// so every amount is expressed in integer minor units (cents).
export const CURRENCIES = ["USD", "EUR", "GBP", "AUD", "CAD", "SGD"] as const;
export const currencySchema = z.enum(CURRENCIES);
export type Currency = z.infer<typeof currencySchema>;

// Values match the service options in the dashboard form.
export const SERVICE_TYPES = ["web_development", "graphic_design", "content_writing"] as const;
export const serviceTypeSchema = z.enum(SERVICE_TYPES);
export type ServiceType = z.infer<typeof serviceTypeSchema>;

export const MAX_HOURLY_RATE_CENTS = 100_000_00; // 100,000.00 per hour
export const MAX_ITEM_HOURS = 1_000;
// Upper bound for any computed amount (1,000,000.00). Keeps values well inside
// the INTEGER money columns and within a single checkout.
export const MAX_QUOTE_TOTAL_CENTS = 100_000_000;

// Integer cents, e.g. 5000 = 50.00.
export const centsSchema = z.int().nonnegative();

export const hourlyRateCentsSchema = z
  .int()
  .positive()
  .max(MAX_HOURLY_RATE_CENTS);

// Hours with at most 2 decimals (stored as DECIMAL(7,2)), e.g. 1.5 or 12.25.
export const hoursSchema = z
  .number()
  .positive()
  .max(MAX_ITEM_HOURS)
  .refine((value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-9, {
    message: "Must have at most 2 decimal places",
  });

export const isoDateTimeSchema = z.iso.datetime();

export const uuidSchema = z.uuid();

const trimmedText = (min: number, max: number) => z.string().trim().min(min).max(max);
export const titleSchema = trimmedText(1, 200);
export const optionalTextSchema = (max: number) => trimmedText(1, max).optional();

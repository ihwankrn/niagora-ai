import { z } from "zod";

// Every non-2xx response from /api/* has this shape:
// { "error": { "code": "VALIDATION_ERROR", "message": "...", "details": [...] } }
export const API_ERROR_CODES = [
  "INVALID_JSON", // 400: body is not valid JSON
  "VALIDATION_ERROR", // 400: body or params failed schema validation
  "UNAUTHORIZED", // 401: no valid Supabase session
  "FORBIDDEN", // 403: authenticated but not the owner
  "NOT_FOUND", // 404
  "CONFLICT", // 409: state does not allow the action (e.g. already paid)
  "PAYLOAD_TOO_LARGE", // 413
  "RATE_LIMITED", // 429
  "AI_UNAVAILABLE", // 502: the LLM failed or returned invalid output
  "PAYMENT_PROVIDER_ERROR", // 502: PayPal API failed
  "INTERNAL_ERROR", // 500
] as const;

export const apiErrorCodeSchema = z.enum(API_ERROR_CODES);
export type ApiErrorCode = z.infer<typeof apiErrorCodeSchema>;

export const validationIssueSchema = z.object({
  // Dot path into the request body, e.g. "items.0.estimatedHours". "" = root.
  path: z.string(),
  message: z.string(),
});
export type ValidationIssue = z.infer<typeof validationIssueSchema>;

export const apiErrorBodySchema = z.object({
  error: z.object({
    code: apiErrorCodeSchema,
    message: z.string(),
    details: z.array(validationIssueSchema).optional(),
  }),
});
export type ApiErrorBody = z.infer<typeof apiErrorBodySchema>;

// Successful responses wrap the payload: { "data": ... }
export type ApiSuccessBody<T> = { data: T };

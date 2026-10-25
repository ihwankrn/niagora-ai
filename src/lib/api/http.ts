import "server-only";

import { z } from "zod";

import type { ApiErrorBody, ApiErrorCode, ApiSuccessBody, ValidationIssue } from "@/lib/contracts/errors";

const STATUS_BY_CODE: Record<ApiErrorCode, number> = {
  INVALID_JSON: 400,
  VALIDATION_ERROR: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  PAYLOAD_TOO_LARGE: 413,
  RATE_LIMITED: 429,
  AI_UNAVAILABLE: 502,
  PAYMENT_NOT_APPROVED: 409,
  PAYMENT_DECLINED: 422,
  PAYMENT_PROVIDER_ERROR: 502,
  INTERNAL_ERROR: 500,
};

export const MAX_JSON_BODY_BYTES = 64 * 1024;

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly details?: ValidationIssue[];

  constructor(code: ApiErrorCode, message: string, details?: ValidationIssue[]) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.details = details;
  }

  get status() {
    return STATUS_BY_CODE[this.code];
  }
}

export function toValidationIssues(error: z.ZodError): ValidationIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path.map(String).join("."),
    message: issue.message,
  }));
}

export function ok<T>(data: T, init?: ResponseInit) {
  return Response.json({ data } satisfies ApiSuccessBody<T>, init);
}

export function errorResponse(error: ApiError) {
  const body: ApiErrorBody = {
    error: {
      code: error.code,
      message: error.message,
      ...(error.details ? { details: error.details } : {}),
    },
  };
  return Response.json(body, { status: error.status });
}

// Reads the request body as JSON (with a size limit) and validates it.
export async function parseJsonBody<S extends z.ZodType>(request: Request, schema: S): Promise<z.output<S>> {
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_JSON_BODY_BYTES) {
    throw new ApiError("PAYLOAD_TOO_LARGE", "Request body is too large");
  }

  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_JSON_BODY_BYTES) {
    throw new ApiError("PAYLOAD_TOO_LARGE", "Request body is too large");
  }

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new ApiError("INVALID_JSON", "Request body must be valid JSON");
  }

  const result = schema.safeParse(json);
  if (!result.success) {
    throw new ApiError("VALIDATION_ERROR", "Request body is invalid", toValidationIssues(result.error));
  }
  return result.data;
}

// Wraps a route handler so every failure becomes the standard error body.
// Unexpected errors are logged on the server and never leak details.
export function withApiErrors<Args extends unknown[]>(handler: (...args: Args) => Promise<Response>) {
  return async (...args: Args): Promise<Response> => {
    try {
      return await handler(...args);
    } catch (error) {
      if (error instanceof ApiError) {
        return errorResponse(error);
      }
      console.error("Unhandled API error", error);
      return errorResponse(new ApiError("INTERNAL_ERROR", "Something went wrong"));
    }
  };
}

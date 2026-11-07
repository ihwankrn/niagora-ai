import { z } from "zod";

import { apiErrorBodySchema } from "@/lib/contracts/errors";
import {
  capturePaypalOrderResponseSchema,
  capturePaypalOrderRequestSchema,
  createPaypalOrderResponseSchema,
  publicProposalSchema,
} from "@/lib/contracts/payments";
import type { ProposalStatus } from "@/lib/contracts/proposals";
import { fetchPublicProposal } from "@/lib/proposals/public-client";

export class PublicProposalPaymentError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = "PublicProposalPaymentError";
  }
}

async function postPaymentRequest<T>(
  path: string,
  body: unknown,
  schema: z.ZodType<T>,
): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    cache: "no-store",
    credentials: "omit",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const responseBody: unknown = await response.json();

  if (!response.ok) {
    const parsedError = apiErrorBodySchema.safeParse(responseBody);
    if (parsedError.success) {
      throw new PublicProposalPaymentError(
        parsedError.data.error.message,
        response.status,
        parsedError.data.error.code,
      );
    }

    throw new PublicProposalPaymentError(
      `Payment request failed with status ${response.status}`,
      response.status,
    );
  }

  const data =
    responseBody && typeof responseBody === "object" && "data" in responseBody
      ? responseBody.data
      : undefined;
  const result = schema.safeParse(data);

  if (!result.success) {
    throw new Error("Payment response was invalid");
  }

  return result.data;
}

export function approvePublicProposal(token: string) {
  return postPaymentRequest(
    `/api/public/proposals/${encodeURIComponent(token)}/approve`,
    {},
    publicProposalSchema,
  );
}

export function createPublicProposalPaypalOrder(token: string) {
  return postPaymentRequest(
    `/api/public/proposals/${encodeURIComponent(token)}/paypal/orders`,
    {},
    createPaypalOrderResponseSchema,
  );
}

export function capturePublicProposalPaypalOrder(token: string, orderId: string) {
  const request = capturePaypalOrderRequestSchema.parse({ orderId });
  return postPaymentRequest(
    `/api/public/proposals/${encodeURIComponent(token)}/paypal/capture`,
    request,
    capturePaypalOrderResponseSchema,
  );
}

export type PaymentConflictSource = "create-order" | "capture";

export type PaymentConflictOutcome =
  | { kind: "show-status"; status: ProposalStatus }
  | { kind: "restart-payment" }
  | { kind: "blocked" }
  | { kind: "retry-capture" };

// 409 CONFLICT covers several situations with one code, so the UI decides from
// the proposal's current status rather than from the error message text.
// latestStatus is null when the status could not be read.
export function decidePaymentConflict(
  source: PaymentConflictSource,
  latestStatus: ProposalStatus | null,
): PaymentConflictOutcome {
  if (latestStatus !== null && latestStatus !== "approved") {
    return { kind: "show-status", status: latestStatus };
  }
  if (source === "create-order") {
    // No new order can start: a payment is still processing or needs review.
    return { kind: "blocked" };
  }
  // The order is no longer valid. A new order request is safe: the server refuses
  // it if a payment is in review, and records any capture it finds.
  return latestStatus === "approved" ? { kind: "restart-payment" } : { kind: "retry-capture" };
}

export async function readLatestProposalStatus(token: string): Promise<ProposalStatus | null> {
  try {
    return (await fetchPublicProposal(token)).status;
  } catch {
    return null;
  }
}

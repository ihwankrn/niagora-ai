import { z } from "zod";

import { apiErrorBodySchema } from "@/lib/contracts/errors";
import {
  capturePaypalOrderResponseSchema,
  capturePaypalOrderRequestSchema,
  createPaypalOrderResponseSchema,
  publicProposalSchema,
} from "@/lib/contracts/payments";

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

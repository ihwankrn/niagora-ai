import { z } from "zod";

import { ApiError, ok, readBodyWithLimit, withApiErrors } from "@/lib/api/http";
import { assertAuthenticPaypalWebhook, reconcileCapturedOrder } from "@/lib/payments/service";

const webhookEventSchema = z.looseObject({
  event_type: z.string(),
  resource: z
    .looseObject({
      supplementary_data: z
        .looseObject({ related_ids: z.looseObject({ order_id: z.string().optional() }).optional() })
        .optional(),
    })
    .optional(),
});

// POST /api/paypal/webhook — see docs/api.md
// A non-2xx answer makes PayPal deliver the event again.
export const POST = withApiErrors(async (request: Request) => {
  const rawEvent = await readBodyWithLimit(request);

  let json: unknown;
  try {
    json = JSON.parse(rawEvent);
  } catch {
    throw new ApiError("INVALID_JSON", "Request body must be valid JSON");
  }
  const event = webhookEventSchema.safeParse(json);
  if (!event.success) throw new ApiError("VALIDATION_ERROR", "Unrecognized webhook event");

  await assertAuthenticPaypalWebhook(request.headers, rawEvent);

  const orderId = event.data.resource?.supplementary_data?.related_ids?.order_id;
  if (event.data.event_type === "PAYMENT.CAPTURE.COMPLETED" && orderId) {
    await reconcileCapturedOrder(orderId);
  }
  return ok({ received: true });
});

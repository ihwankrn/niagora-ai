import { ok, parseJsonBody, withApiErrors } from "@/lib/api/http";
import { capturePaypalOrderRequestSchema } from "@/lib/contracts/payments";
import { capturePaypalOrder } from "@/lib/payments/service";

import { PRIVATE, readShareToken, type TokenContext } from "../../token";

// POST /api/public/proposals/:token/paypal/capture — see docs/api.md
export const POST = withApiErrors(async (request: Request, context: TokenContext) => {
  const token = await readShareToken(context);
  const { orderId } = await parseJsonBody(request, capturePaypalOrderRequestSchema);
  return ok(await capturePaypalOrder(token, orderId), PRIVATE);
});

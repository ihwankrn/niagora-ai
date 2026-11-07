import { ok, withApiErrors } from "@/lib/api/http";
import { createPaypalOrder } from "@/lib/payments/service";

import { PRIVATE, readShareToken, type TokenContext } from "../../token";

// POST /api/public/proposals/:token/paypal/orders — see docs/api.md
// No request body: the amount is always the stored proposal total.
export const POST = withApiErrors(async (_request: Request, context: TokenContext) => {
  return ok(await createPaypalOrder(await readShareToken(context)), { ...PRIVATE, status: 201 });
});

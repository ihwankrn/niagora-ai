import { ok, withApiErrors } from "@/lib/api/http";
import { approveProposal } from "@/lib/payments/service";

import { PRIVATE, readShareToken, type TokenContext } from "../token";

// POST /api/public/proposals/:token/approve — see docs/api.md
export const POST = withApiErrors(async (_request: Request, context: TokenContext) => {
  return ok(await approveProposal(await readShareToken(context)), PRIVATE);
});

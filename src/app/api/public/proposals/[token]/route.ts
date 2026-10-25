import { ok, withApiErrors } from "@/lib/api/http";
import { getPublicProposal } from "@/lib/payments/service";

import { PRIVATE, readShareToken, type TokenContext } from "./token";

// GET /api/public/proposals/:token — client view, no session. See docs/api.md
export const GET = withApiErrors(async (_request: Request, context: TokenContext) => {
  return ok(await getPublicProposal(await readShareToken(context)), PRIVATE);
});

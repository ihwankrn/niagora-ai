import { ok, parseJsonBody, withApiErrors } from "@/lib/api/http";
import { requireUser } from "@/lib/auth/session";
import { calculateQuoteRequestSchema } from "@/lib/contracts/quotes";
import { calculateQuoteOrThrow } from "@/lib/quotes/service";

// POST /api/quotes/calculate — see docs/api.md
// Stateless preview: nothing is stored. Totals are always computed here.
export const POST = withApiErrors(async (request: Request) => {
  await requireUser();
  const input = await parseJsonBody(request, calculateQuoteRequestSchema);
  return ok(calculateQuoteOrThrow(input));
});

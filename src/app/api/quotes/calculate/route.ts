import { ApiError, ok, parseJsonBody, withApiErrors } from "@/lib/api/http";
import { requireUser } from "@/lib/auth/session";
import { MAX_QUOTE_TOTAL_CENTS } from "@/lib/contracts/common";
import { calculateQuoteRequestSchema } from "@/lib/contracts/quotes";
import { calculateQuote, QuoteLimitError } from "@/lib/quotes/engine";

// POST /api/quotes/calculate — see docs/api.md
// Stateless preview: nothing is stored. Totals are always computed here.
export const POST = withApiErrors(async (request: Request) => {
  await requireUser();
  const input = await parseJsonBody(request, calculateQuoteRequestSchema);

  try {
    return ok(calculateQuote(input));
  } catch (error) {
    if (error instanceof QuoteLimitError) {
      throw new ApiError("VALIDATION_ERROR", "Quote total is too large", [
        { path: "items", message: `Total must not exceed ${MAX_QUOTE_TOTAL_CENTS} cents` },
      ]);
    }
    throw error;
  }
});

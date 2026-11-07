import "server-only";

import { ApiError } from "@/lib/api/http";
import { MAX_QUOTE_TOTAL_CENTS } from "@/lib/contracts/common";
import type { CalculateQuoteRequest, Quote } from "@/lib/contracts/quotes";

import { calculateQuote, QuoteLimitError } from "./engine";

// calculateQuote with its limit error mapped to the API error format.
export function calculateQuoteOrThrow(input: CalculateQuoteRequest): Quote {
  try {
    return calculateQuote(input);
  } catch (error) {
    if (error instanceof QuoteLimitError) {
      throw new ApiError("VALIDATION_ERROR", "Quote total is too large", [
        { path: "items", message: `Total must not exceed ${MAX_QUOTE_TOTAL_CENTS} cents` },
      ]);
    }
    throw error;
  }
}

import { MAX_QUOTE_TOTAL_CENTS } from "@/lib/contracts/common";
import type { CalculateQuoteRequest, Quote, QuoteLine } from "@/lib/contracts/quotes";

// Deterministic pricing. All arithmetic is done on integers:
// hours are converted to hundredths of an hour (inputs have at most 2
// decimals), so amountCents = round_half_up(hundredths * rateCents / 100).

export class QuoteLimitError extends Error {
  constructor() {
    super(`Quote total must not exceed ${MAX_QUOTE_TOTAL_CENTS} cents`);
    this.name = "QuoteLimitError";
  }
}

function toHundredths(hours: number) {
  return Math.round(hours * 100);
}

// Round half up for non-negative integers: n / 100 rounded to the nearest cent.
function divideBy100RoundHalfUp(value: number) {
  return Math.floor((value + 50) / 100);
}

export function lineAmountCents(estimatedHours: number, hourlyRateCents: number) {
  return divideBy100RoundHalfUp(toHundredths(estimatedHours) * hourlyRateCents);
}

export function calculateQuote(input: CalculateQuoteRequest): Quote {
  let subtotalCents = 0;
  let totalHundredths = 0;

  const items: QuoteLine[] = input.items.map((item, position) => {
    const hourlyRateCents = item.hourlyRateCents ?? input.hourlyRateCents;
    const amountCents = lineAmountCents(item.estimatedHours, hourlyRateCents);

    subtotalCents += amountCents;
    totalHundredths += toHundredths(item.estimatedHours);

    return {
      position,
      title: item.title,
      description: item.description ?? null,
      estimatedHours: toHundredths(item.estimatedHours) / 100,
      hourlyRateCents,
      amountCents,
    };
  });

  if (subtotalCents > MAX_QUOTE_TOTAL_CENTS) {
    throw new QuoteLimitError();
  }

  return {
    currency: input.currency,
    hourlyRateCents: input.hourlyRateCents,
    items,
    totalHours: totalHundredths / 100,
    subtotalCents,
    // No tax or discount in the MVP.
    totalCents: subtotalCents,
  };
}

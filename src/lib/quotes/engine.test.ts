import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { MAX_HOURLY_RATE_CENTS, MAX_ITEM_HOURS, MAX_QUOTE_TOTAL_CENTS } from "@/lib/contracts/common";
import { type CalculateQuoteRequest, calculateQuoteRequestSchema, quoteSchema } from "@/lib/contracts/quotes";

import { calculateQuote, lineAmountCents, QuoteLimitError } from "./engine";

function quote(items: CalculateQuoteRequest["items"], hourlyRateCents = 5_000): ReturnType<typeof calculateQuote> {
  return calculateQuote({ currency: "USD", hourlyRateCents, items });
}

describe("lineAmountCents", () => {
  it.each([
    [10, 5_000, 50_000],
    [2.5, 6_000, 15_000],
    [1.33, 3_333, 4_433], // 4432.89 -> 4433
    [0.5, 1, 1], // 0.5 -> 1 (half up)
    [0.25, 2, 1], // 0.5 -> 1 (half up)
    [0.01, 49, 0], // 0.49 -> 0
    [0.01, 50, 1], // 0.50 -> 1
    [0.01, 150, 2], // 1.50 -> 2
  ])("%s h x %s cents = %s cents", (hours, rate, expected) => {
    expect(lineAmountCents(hours, rate)).toBe(expected);
  });

  it("is exact where floating point multiplication is not", () => {
    // 1.15 * 100 = 114.99999999999999 in IEEE 754; the engine must still use 115 hundredths.
    expect(1.15 * 100).not.toBe(115);
    expect(lineAmountCents(1.15, 100)).toBe(115);
    expect(lineAmountCents(0.29, 10_000)).toBe(2_900);
  });
});

describe("calculateQuote", () => {
  it("applies the default rate, per-item overrides, positions and totals", () => {
    const result = quote([
      { title: "Pages", estimatedHours: 10 },
      { title: "Form", description: "Email notification", estimatedHours: 2.5, hourlyRateCents: 6_000 },
    ]);

    expect(result).toEqual({
      currency: "USD",
      hourlyRateCents: 5_000,
      items: [
        { position: 0, title: "Pages", description: null, estimatedHours: 10, hourlyRateCents: 5_000, amountCents: 50_000 },
        { position: 1, title: "Form", description: "Email notification", estimatedHours: 2.5, hourlyRateCents: 6_000, amountCents: 15_000 },
      ],
      totalHours: 12.5,
      subtotalCents: 65_000,
      totalCents: 65_000,
    });
    expect(quoteSchema.safeParse(result).success).toBe(true);
  });

  it("sums hours without floating point drift", () => {
    const result = quote([0.1, 0.2, 0.3].map((estimatedHours) => ({ title: "x", estimatedHours })));
    expect(result.totalHours).toBe(0.6);
  });

  it("rounds per line, then sums (never re-rounds the total)", () => {
    // Three lines of 0.5 cent each round up to 1 cent each: total 3, not round(1.5) = 2.
    const result = quote(
      [1, 2, 3].map(() => ({ title: "x", estimatedHours: 0.5 })),
      1,
    );
    expect(result.items.map((item) => item.amountCents)).toEqual([1, 1, 1]);
    expect(result.totalCents).toBe(3);
  });

  it("is deterministic for the same input", () => {
    const input: CalculateQuoteRequest = { currency: "EUR", hourlyRateCents: 7_777, items: [{ title: "a", estimatedHours: 3.33 }] };
    expect(calculateQuote(input)).toEqual(calculateQuote(input));
  });

  it("rejects totals above the cap and accepts exactly the cap", () => {
    expect(() => quote([{ title: "x", estimatedHours: MAX_ITEM_HOURS }], MAX_HOURLY_RATE_CENTS)).toThrow(QuoteLimitError);
    expect(quote([{ title: "x", estimatedHours: 100 }], MAX_QUOTE_TOTAL_CENTS / 100).totalCents).toBe(MAX_QUOTE_TOTAL_CENTS);
  });

  it("matches the worked example in docs/api.md", () => {
    const blocks = [...readFileSync("docs/api.md", "utf8").matchAll(/```json\n([\s\S]*?)```/g)].map((m) => m[1]);
    const section = (title: string) => {
      const md = readFileSync("docs/api.md", "utf8");
      const start = md.indexOf(`## \`${title}\``);
      return md.slice(start, md.indexOf("\n## ", start + 1));
    };
    const quoteSection = section("POST /api/quotes/calculate");
    const [requestJson, responseJson] = blocks.filter((block) => quoteSection.includes(block));

    const request = calculateQuoteRequestSchema.parse(JSON.parse(requestJson));
    expect(calculateQuote(request)).toEqual(JSON.parse(responseJson).data);
  });
});

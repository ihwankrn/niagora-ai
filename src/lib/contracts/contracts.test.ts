import { describe, expect, it } from "vitest";

import { analyzeBriefRequestSchema, briefAnalysisSchema } from "./briefs";
import { hoursSchema } from "./common";
import { createProposalRequestSchema, dashboardStatsSchema, listProposalsQuerySchema } from "./proposals";
import { calculateQuoteRequestSchema } from "./quotes";

const validQuote = {
  currency: "USD",
  hourlyRateCents: 5_000,
  items: [
    { title: "Landing page design", estimatedHours: 6 },
    { title: "Contact form", description: "With email notification", estimatedHours: 2.5, hourlyRateCents: 6_000 },
  ],
};

describe("analyzeBriefRequestSchema", () => {
  it("accepts a valid brief and trims it", () => {
    const result = analyzeBriefRequestSchema.parse({
      brief: "   I need a company profile website with 5 pages.   ",
      serviceType: "web_development",
    });
    expect(result.brief).toBe("I need a company profile website with 5 pages.");
  });

  it("rejects briefs shorter than 20 characters after trimming", () => {
    const result = analyzeBriefRequestSchema.safeParse({ brief: "  too short   ", serviceType: "web_development" });
    expect(result.success).toBe(false);
  });

  it("rejects unknown service types and extra keys", () => {
    expect(
      analyzeBriefRequestSchema.safeParse({ brief: "x".repeat(30), serviceType: "video_editing" }).success,
    ).toBe(false);
    expect(
      analyzeBriefRequestSchema.safeParse({ brief: "x".repeat(30), serviceType: "graphic_design", price: 100 }).success,
    ).toBe(false);
  });
});

describe("briefAnalysisSchema", () => {
  const deliverable = {
    id: "3f0e5b8a-6c1d-4e2f-9a7b-1c2d3e4f5a6b",
    title: "Home page",
    description: "Hero and services",
    estimatedHours: 4,
  };

  it("strips price-like fields the model might add", () => {
    const result = briefAnalysisSchema.parse({
      summary: "Company profile site",
      deliverables: [{ ...deliverable, priceCents: 99_999 }],
      clarificationQuestions: [],
      assumptions: [],
    });
    expect(result.deliverables[0]).not.toHaveProperty("priceCents");
  });

  it("requires a server id and an hour estimate on every deliverable", () => {
    const withoutId = { title: deliverable.title, description: deliverable.description, estimatedHours: 4 };
    const withoutHours = { id: deliverable.id, title: deliverable.title, description: deliverable.description };
    for (const item of [withoutId, withoutHours, { ...deliverable, id: "1" }]) {
      const result = briefAnalysisSchema.safeParse({
        summary: "Site",
        deliverables: [item],
        clarificationQuestions: [],
        assumptions: [],
      });
      expect(result.success).toBe(false);
    }
  });

  it("allows no deliverables when the brief needs clarification first", () => {
    const result = briefAnalysisSchema.safeParse({
      summary: "Scope is unclear",
      deliverables: [],
      clarificationQuestions: ["How many pages does the site need?"],
      assumptions: [],
    });
    expect(result.success).toBe(true);
  });

  it("rejects an analysis with neither deliverables nor questions", () => {
    const result = briefAnalysisSchema.safeParse({
      summary: "Empty",
      deliverables: [],
      clarificationQuestions: [],
      assumptions: [],
    });
    expect(result.success).toBe(false);
  });
});

describe("hoursSchema", () => {
  it.each([0.25, 1, 1.5, 12.75, 999.99])("accepts %s", (hours) => {
    expect(hoursSchema.safeParse(hours).success).toBe(true);
  });

  it.each([0, -1, 1.234, 1_000.5, Number.NaN])("rejects %s", (hours) => {
    expect(hoursSchema.safeParse(hours).success).toBe(false);
  });
});

describe("calculateQuoteRequestSchema", () => {
  it("accepts a valid quote request", () => {
    expect(calculateQuoteRequestSchema.safeParse(validQuote).success).toBe(true);
  });

  it("rejects client-supplied totals and amounts", () => {
    expect(calculateQuoteRequestSchema.safeParse({ ...validQuote, totalCents: 1 }).success).toBe(false);
    expect(
      calculateQuoteRequestSchema.safeParse({
        ...validQuote,
        items: [{ title: "Hack", estimatedHours: 1, amountCents: 1 }],
      }).success,
    ).toBe(false);
  });

  it("rejects non-integer rates, unsupported currencies and empty item lists", () => {
    expect(calculateQuoteRequestSchema.safeParse({ ...validQuote, hourlyRateCents: 50.5 }).success).toBe(false);
    expect(calculateQuoteRequestSchema.safeParse({ ...validQuote, currency: "IDR" }).success).toBe(false);
    expect(calculateQuoteRequestSchema.safeParse({ ...validQuote, items: [] }).success).toBe(false);
  });
});

describe("createProposalRequestSchema", () => {
  it("accepts a proposal with optional client details", () => {
    const result = createProposalRequestSchema.safeParse({
      ...validQuote,
      briefId: "3f0e5b8a-6c1d-4e2f-9a7b-1c2d3e4f5a6b",
      title: "Company profile website",
      clientName: "PT Contoh",
      clientEmail: "client@example.com",
    });
    expect(result.success).toBe(true);
  });

  it("rejects an invalid email, invalid briefId and client-supplied status", () => {
    const base = { ...validQuote, title: "Website" };
    expect(createProposalRequestSchema.safeParse({ ...base, clientEmail: "nope" }).success).toBe(false);
    expect(createProposalRequestSchema.safeParse({ ...base, briefId: "123" }).success).toBe(false);
    expect(createProposalRequestSchema.safeParse({ ...base, status: "paid" }).success).toBe(false);
  });
});

describe("listProposalsQuerySchema", () => {
  it("defaults and coerces the limit from the query string", () => {
    expect(listProposalsQuerySchema.parse({})).toEqual({ limit: 20 });
    expect(listProposalsQuerySchema.parse({ limit: "5" })).toEqual({ limit: 5 });
  });

  it.each(["0", "101", "abc", "2.5"])("rejects limit=%s", (limit) => {
    expect(listProposalsQuerySchema.safeParse({ limit }).success).toBe(false);
  });

  it("rejects unknown query parameters such as userId", () => {
    expect(listProposalsQuerySchema.safeParse({ userId: "someone-else" }).success).toBe(false);
  });
});

describe("dashboardStatsSchema", () => {
  it("keeps revenue separated per currency", () => {
    const stats = dashboardStatsSchema.parse({
      totalProjects: 3,
      pendingProposals: 1,
      paidProjects: 2,
      revenueReceived: [
        { currency: "USD", amountCents: 65_000 },
        { currency: "EUR", amountCents: 12_000 },
      ],
    });
    expect(stats.revenueReceived).toHaveLength(2);
  });

  it("rejects a single unlabeled revenue number", () => {
    expect(
      dashboardStatsSchema.safeParse({ totalProjects: 1, pendingProposals: 0, paidProjects: 1, revenueReceived: 65_000 })
        .success,
    ).toBe(false);
  });
});

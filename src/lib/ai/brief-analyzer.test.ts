import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api/http";

import { analyzeBrief, BRIEF_ANALYSIS_MODEL, sumHours, toBriefAnalysis } from "./brief-analyzer";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const modelOutput = {
  summary: "Company profile website for a catering business.",
  deliverables: [
    { title: "  Page layouts ", description: "Home, About, Menu, Gallery, Contact", estimatedHours: 10 },
    { title: "Contact form", description: "Validation and email notification", estimatedHours: 2.333 },
  ],
  clarificationQuestions: ["Will the client provide photos?"],
  assumptions: ["Hosting is provided by the client."],
};

function fakeClient(response: unknown) {
  const parse = vi.fn().mockResolvedValue(response);
  return { client: { beta: { messages: { parse } } } as unknown as Pick<Anthropic, "beta">, parse };
}

function failingClient(error: unknown) {
  const parse = vi.fn().mockRejectedValue(error);
  return { beta: { messages: { parse } } } as unknown as Pick<Anthropic, "beta">;
}

const input = { brief: "I need a 5 page company profile website for my catering business.", serviceType: "web_development" as const };

async function expectAiUnavailable(promise: Promise<unknown>) {
  const error = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(ApiError);
  expect((error as ApiError).code).toBe("AI_UNAVAILABLE");
}

describe("toBriefAnalysis", () => {
  it("assigns server UUIDs, trims text and rounds hours to 2 decimals", () => {
    const analysis = toBriefAnalysis(modelOutput);
    expect(analysis.deliverables.map((item) => item.id)).toEqual([expect.stringMatching(UUID), expect.stringMatching(UUID)]);
    expect(analysis.deliverables[0].title).toBe("Page layouts");
    expect(analysis.deliverables[1].estimatedHours).toBe(2.33);
  });

  it("drops deliverables without a usable estimate instead of keeping fake numbers", () => {
    const analysis = toBriefAnalysis({
      ...modelOutput,
      deliverables: [
        { title: "Booking system", description: "Unclear", estimatedHours: 0 },
        { title: "Huge", description: "Out of range", estimatedHours: 5_000 },
        { title: "Contact form", description: "Form", estimatedHours: 3 },
      ],
    });
    expect(analysis.deliverables.map((item) => item.title)).toEqual(["Contact form"]);
  });

  it("accepts an analysis that only asks clarification questions", () => {
    const analysis = toBriefAnalysis({ ...modelOutput, deliverables: [] });
    expect(analysis.deliverables).toEqual([]);
    expect(analysis.clarificationQuestions).toHaveLength(1);
  });

  it("fails when there is nothing usable", () => {
    expect(() => toBriefAnalysis({ ...modelOutput, deliverables: [], clarificationQuestions: [] })).toThrow(ApiError);
  });

  it("caps list lengths to the contract limits", () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ title: `Item ${i}`, description: "", estimatedHours: 1 }));
    const analysis = toBriefAnalysis({
      ...modelOutput,
      deliverables: many,
      assumptions: Array.from({ length: 20 }, (_, i) => `Assumption ${i}`),
    });
    expect(analysis.deliverables).toHaveLength(30);
    expect(analysis.assumptions).toHaveLength(15);
  });
});

describe("sumHours", () => {
  it("sums without floating point drift", () => {
    const analysis = toBriefAnalysis({
      ...modelOutput,
      deliverables: [0.1, 0.2, 0.3].map((h) => ({ title: "x", description: "", estimatedHours: h })),
    });
    expect(sumHours(analysis)).toBe(0.6);
  });
});

describe("analyzeBrief", () => {
  it("sends a structured-output request with fallbacks and the brief wrapped as data", async () => {
    const { client, parse } = fakeClient({ stop_reason: "end_turn", parsed_output: modelOutput, model: BRIEF_ANALYSIS_MODEL });
    const result = await analyzeBrief(input, client);

    const params = parse.mock.calls[0][0];
    expect(params.model).toBe("claude-opus-5-5");
    expect(params.fallbacks).toBe("default");
    expect(params.betas).toEqual(["server-side-fallback-2026-07-01"]);
    expect(params.output_config.format).toBeDefined();
    expect(params.messages[0].content).toContain(`<client_brief>\n${input.brief}\n</client_brief>`);
    expect(params.system).toMatch(/Never include prices/);

    expect(result.totalEstimatedHours).toBe(12.33);
    expect(result.model).toBe(BRIEF_ANALYSIS_MODEL);
  });

  it("does not request any price field from the model", async () => {
    const { client, parse } = fakeClient({ stop_reason: "end_turn", parsed_output: modelOutput, model: BRIEF_ANALYSIS_MODEL });
    await analyzeBrief(input, client);
    const schemaText = JSON.stringify(parse.mock.calls[0][0].output_config.format);
    expect(schemaText).not.toMatch(/price|rate|amount|total|cents|currency/i);
  });

  it("maps a refusal to AI_UNAVAILABLE", async () => {
    const { client } = fakeClient({ stop_reason: "refusal", parsed_output: null, model: BRIEF_ANALYSIS_MODEL });
    await expectAiUnavailable(analyzeBrief(input, client));
  });

  it("maps truncated or unparsed output to AI_UNAVAILABLE", async () => {
    for (const response of [
      { stop_reason: "max_tokens", parsed_output: modelOutput, model: BRIEF_ANALYSIS_MODEL },
      { stop_reason: "end_turn", parsed_output: null, model: BRIEF_ANALYSIS_MODEL },
    ]) {
      await expectAiUnavailable(analyzeBrief(input, fakeClient(response).client));
    }
  });

  it("maps SDK errors to AI_UNAVAILABLE without leaking details", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expectAiUnavailable(analyzeBrief(input, failingClient(new Anthropic.APIConnectionError({ message: "socket hang up" }))));
    await expectAiUnavailable(analyzeBrief(input, failingClient(new Error("boom"))));
    spy.mockRestore();
  });
});

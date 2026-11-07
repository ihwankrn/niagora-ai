import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

const completion = (content: string | null, finishReason = "stop") =>
  json(200, { model: BRIEF_ANALYSIS_MODEL, choices: [{ finish_reason: finishReason, message: { content } }] });

function fakeFetch(...responses: Array<Response | Error>) {
  const fn = vi.fn<typeof fetch>();
  for (const response of responses) {
    if (response instanceof Error) fn.mockRejectedValueOnce(response);
    else fn.mockResolvedValueOnce(response);
  }
  return fn;
}

const requestBody = (fn: ReturnType<typeof fakeFetch>) => JSON.parse(String(fn.mock.calls[0][1]?.body));

const input = { brief: "I need a 5 page company profile website for my catering business.", serviceType: "web_development" as const };

async function expectAiUnavailable(promise: Promise<unknown>) {
  const error = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(ApiError);
  expect((error as ApiError).code).toBe("AI_UNAVAILABLE");
}

beforeEach(() => vi.stubEnv("GROQ_API_KEY", "gsk_test_key"));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

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
  it("sends a strict structured-output request to Groq with the brief wrapped as data", async () => {
    const fetchImpl = fakeFetch(completion(JSON.stringify(modelOutput)));

    const result = await analyzeBrief(input, fetchImpl);

    const [url, init] = fetchImpl.mock.calls[0];
    expect(String(url)).toBe("https://api.groq.com/openai/v1/chat/completions");
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer gsk_test_key");
    const body = requestBody(fetchImpl);
    expect(body.model).toBe("openai/gpt-oss-120b");
    expect(body.response_format.type).toBe("json_schema");
    expect(body.response_format.json_schema.strict).toBe(true);
    expect(body.messages[0]).toMatchObject({ role: "system", content: expect.stringMatching(/Never include prices/) });
    expect(body.messages[1].content).toContain(`<client_brief>\n${input.brief}\n</client_brief>`);

    expect(result.totalEstimatedHours).toBe(12.33);
    expect(result.model).toBe(BRIEF_ANALYSIS_MODEL);
  });

  it("requests a schema that meets Groq's strict-mode rules and has no price field", async () => {
    const fetchImpl = fakeFetch(completion(JSON.stringify(modelOutput)));
    await analyzeBrief(input, fetchImpl);

    const { schema } = requestBody(fetchImpl).response_format.json_schema;
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toEqual(["summary", "deliverables", "clarificationQuestions", "assumptions"]);
    expect(schema.properties.deliverables.items.additionalProperties).toBe(false);
    expect(schema.properties.deliverables.items.required).toEqual(["title", "description", "estimatedHours"]);
    expect(JSON.stringify(schema)).not.toMatch(/price|rate|amount|total|cents|currency/i);
  });

  it("maps truncated, empty, malformed or wrongly shaped output to AI_UNAVAILABLE", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    for (const response of [
      completion(JSON.stringify(modelOutput), "length"),
      completion(null),
      completion("{not json"),
      completion(JSON.stringify({ summary: "No lists" })),
      json(200, { choices: [] }),
    ]) {
      await expectAiUnavailable(analyzeBrief(input, fakeFetch(response)));
    }
  });

  it("retries a temporary failure, then succeeds", async () => {
    const fetchImpl = fakeFetch(json(503, {}, { "retry-after": "0" }), completion(JSON.stringify(modelOutput)));

    await expect(analyzeBrief(input, fetchImpl)).resolves.toMatchObject({ totalEstimatedHours: 12.33 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("does not retry a rate limit with a long wait or a rejected key", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    const limited = fakeFetch(json(429, { error: { type: "rate_limit", message: "secret detail" } }, { "retry-after": "60" }));
    await expectAiUnavailable(analyzeBrief(input, limited));
    expect(limited).toHaveBeenCalledOnce();
    expect(log).toHaveBeenLastCalledWith("Brief analysis provider request failed", {
      provider: "groq",
      category: "rate_limited",
      status: 429,
      apiErrorType: "rate_limit",
    });

    const rejected = fakeFetch(json(401, { error: { type: "invalid_api_key" } }));
    await expectAiUnavailable(analyzeBrief(input, rejected));
    expect(rejected).toHaveBeenCalledOnce();
    expect(log).toHaveBeenLastCalledWith("Brief analysis provider request failed", {
      provider: "groq",
      category: "authentication_failed",
      status: 401,
      apiErrorType: "invalid_api_key",
    });
  });

  it("gives up after repeated connection failures without leaking details", async () => {
    vi.useFakeTimers();
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchImpl = fakeFetch(new Error("socket hang up"), new Error("socket hang up"), new Error("socket hang up"));

    const pending = expectAiUnavailable(analyzeBrief(input, fetchImpl));
    await vi.runAllTimersAsync();
    await pending;
    vi.useRealTimers();

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/socket hang up|gsk_test_key|catering/);
  });

  it("never logs the key or the brief when a request fails", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await expectAiUnavailable(analyzeBrief(input, fakeFetch(json(400, { error: { type: "invalid_request_error", message: input.brief } }))));
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/gsk_test_key|catering/);
  });

  it("sends nothing when the API key is missing", async () => {
    vi.stubEnv("GROQ_API_KEY", "");
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchImpl = fakeFetch();

    await expectAiUnavailable(analyzeBrief(input, fetchImpl));

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith("Brief analysis provider request failed", {
      provider: "groq",
      category: "missing_configuration",
    });
  });
});

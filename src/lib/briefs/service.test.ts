import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api/http";

const db = vi.hoisted(() => ({
  brief: { count: vi.fn(), create: vi.fn(), update: vi.fn() },
}));
const ai = vi.hoisted(() => ({ analyzeBrief: vi.fn() }));

vi.mock("@/lib/db", () => ({ prisma: db }));
vi.mock("@/lib/ai/brief-analyzer", () => ai);

const { analyzeAndStoreBrief, MAX_ANALYSES_PER_HOUR } = await import("./service");

const user = { id: "11111111-1111-4111-8111-111111111111", email: "freelancer@example.com" };
const input = { brief: "I need a 5 page company profile website.", serviceType: "web_development" as const };
const createdAt = new Date("2026-10-25T11:30:00.000Z");
const analysis = {
  summary: "Website",
  deliverables: [{ id: "22222222-2222-4222-8222-222222222222", title: "Pages", description: "", estimatedHours: 10 }],
  clarificationQuestions: [],
  assumptions: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  db.brief.count.mockResolvedValue(0);
  db.brief.create.mockResolvedValue({ id: "33333333-3333-4333-8333-333333333333", createdAt });
  db.brief.update.mockResolvedValue({});
});

describe("analyzeAndStoreBrief", () => {
  it("stores the brief for the signed-in user and returns the contract shape", async () => {
    ai.analyzeBrief.mockResolvedValue({ analysis, totalEstimatedHours: 10, model: "claude-opus-5-5" });

    const result = await analyzeAndStoreBrief(user, input);

    expect(db.brief.create).toHaveBeenCalledWith({
      data: { userId: user.id, serviceType: "WEB_DEVELOPMENT", rawText: input.brief },
    });
    expect(db.brief.update).toHaveBeenCalledWith({
      where: { id: "33333333-3333-4333-8333-333333333333" },
      data: { status: "ANALYZED", analysis, aiModel: "claude-opus-5-5" },
    });
    expect(result).toEqual({
      briefId: "33333333-3333-4333-8333-333333333333",
      serviceType: "web_development",
      analysis,
      totalEstimatedHours: 10,
      createdAt: "2026-10-25T11:30:00.000Z",
    });
  });

  it("marks the brief FAILED and rethrows when analysis fails", async () => {
    ai.analyzeBrief.mockRejectedValue(new ApiError("AI_UNAVAILABLE", "x"));

    await expect(analyzeAndStoreBrief(user, input)).rejects.toMatchObject({ code: "AI_UNAVAILABLE" });
    expect(db.brief.update).toHaveBeenCalledWith({
      where: { id: "33333333-3333-4333-8333-333333333333" },
      data: { status: "FAILED" },
    });
  });

  it("rate limits before calling the model", async () => {
    db.brief.count.mockResolvedValue(MAX_ANALYSES_PER_HOUR);

    await expect(analyzeAndStoreBrief(user, input)).rejects.toMatchObject({ code: "RATE_LIMITED" });
    expect(db.brief.count).toHaveBeenCalledWith({
      where: { userId: user.id, createdAt: { gte: expect.any(Date) } },
    });
    expect(ai.analyzeBrief).not.toHaveBeenCalled();
    expect(db.brief.create).not.toHaveBeenCalled();
  });
});

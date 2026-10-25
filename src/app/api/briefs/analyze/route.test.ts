import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api/http";

const auth = vi.hoisted(() => ({ requireUser: vi.fn(), ensureUserRecord: vi.fn() }));
const service = vi.hoisted(() => ({ analyzeAndStoreBrief: vi.fn() }));

vi.mock("@/lib/auth/session", () => auth);
vi.mock("@/lib/briefs/service", () => service);

const { POST } = await import("./route");

const user = { id: "11111111-1111-4111-8111-111111111111", email: "freelancer@example.com" };
const validBody = { brief: "I need a 5 page company profile website.", serviceType: "web_development" };

function post(body: unknown) {
  return new Request("http://localhost/api/briefs/analyze", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  auth.requireUser.mockResolvedValue(user);
});

describe("POST /api/briefs/analyze", () => {
  it("returns 401 without a session, before reading the body", async () => {
    auth.requireUser.mockRejectedValue(new ApiError("UNAUTHORIZED", "Sign in to continue"));

    const response = await POST(post("{not json"));

    expect(response.status).toBe(401);
    expect((await response.json()).error.code).toBe("UNAUTHORIZED");
    expect(service.analyzeAndStoreBrief).not.toHaveBeenCalled();
  });

  it("validates the body against the contract", async () => {
    const response = await POST(post({ ...validBody, serviceType: "video", userId: "someone-else" }));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.details.map((issue: { path: string }) => issue.path)).toEqual(
      expect.arrayContaining(["serviceType", ""]),
    );
    expect(service.analyzeAndStoreBrief).not.toHaveBeenCalled();
  });

  it("uses the verified session user, not anything from the body", async () => {
    service.analyzeAndStoreBrief.mockResolvedValue({ briefId: "b" });

    const response = await POST(post(validBody));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: { briefId: "b" } });
    expect(auth.ensureUserRecord).toHaveBeenCalledWith(user);
    expect(service.analyzeAndStoreBrief).toHaveBeenCalledWith(user, {
      brief: validBody.brief,
      serviceType: "web_development",
    });
  });

  it("passes AI failures through as 502 AI_UNAVAILABLE", async () => {
    service.analyzeAndStoreBrief.mockRejectedValue(new ApiError("AI_UNAVAILABLE", "Please try again."));

    const response = await POST(post(validBody));

    expect(response.status).toBe(502);
    expect((await response.json()).error).toEqual({ code: "AI_UNAVAILABLE", message: "Please try again." });
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api/http";

const auth = vi.hoisted(() => ({ requireUser: vi.fn(), ensureUserRecord: vi.fn() }));
const service = vi.hoisted(() => ({ createProposal: vi.fn(), listProposals: vi.fn() }));
vi.mock("@/lib/auth/session", () => auth);
vi.mock("@/lib/proposals/service", () => service);

const { GET, POST } = await import("./route");

const user = { id: "11111111-1111-4111-8111-111111111111", email: "freelancer@example.com" };
const validBody = {
  title: "Company profile website",
  currency: "USD",
  hourlyRateCents: 5_000,
  items: [{ title: "Pages", estimatedHours: 10 }],
};

const get = (query = "") => new Request(`http://localhost/api/proposals${query}`);
const post = (body: unknown) =>
  new Request("http://localhost/api/proposals", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  vi.clearAllMocks();
  auth.requireUser.mockResolvedValue(user);
});

describe("GET /api/proposals", () => {
  it("returns 401 without a session", async () => {
    auth.requireUser.mockRejectedValue(new ApiError("UNAUTHORIZED", "Sign in to continue"));
    expect((await GET(get())).status).toBe(401);
    expect(service.listProposals).not.toHaveBeenCalled();
  });

  it("uses the default limit and marks the response private", async () => {
    service.listProposals.mockResolvedValue({ items: [], stats: {} });
    const response = await GET(get());

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(service.listProposals).toHaveBeenCalledWith(user, { limit: 20 });
  });

  it("rejects invalid limits and attempts to pick another user", async () => {
    for (const query of ["?limit=0", "?limit=500", "?userId=someone-else"]) {
      const response = await GET(get(query));
      expect(response.status).toBe(400);
      expect((await response.json()).error.code).toBe("VALIDATION_ERROR");
    }
    expect(service.listProposals).not.toHaveBeenCalled();
  });
});

describe("POST /api/proposals", () => {
  it("returns 401 without a session", async () => {
    auth.requireUser.mockRejectedValue(new ApiError("UNAUTHORIZED", "Sign in to continue"));
    expect((await POST(post(validBody))).status).toBe(401);
  });

  it("creates a proposal for the session user with 201", async () => {
    service.createProposal.mockResolvedValue({ id: "p1" });
    const response = await POST(post(validBody));

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ data: { id: "p1" } });
    expect(auth.ensureUserRecord).toHaveBeenCalledWith(user);
    expect(service.createProposal).toHaveBeenCalledWith(user, validBody);
  });

  it("rejects browser-sent totals, status and user ids", async () => {
    for (const extra of [{ totalCents: 1 }, { status: "paid" }, { userId: "someone-else" }, { shareToken: "x" }]) {
      const response = await POST(post({ ...validBody, ...extra }));
      expect(response.status).toBe(400);
    }
    expect(service.createProposal).not.toHaveBeenCalled();
  });
});

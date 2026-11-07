import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api/http";

const auth = vi.hoisted(() => ({ requireUser: vi.fn() }));
const service = vi.hoisted(() => ({ getProposalForUser: vi.fn() }));
vi.mock("@/lib/auth/session", () => auth);
vi.mock("@/lib/proposals/service", () => service);

const { GET } = await import("./route");

const owner = { id: "11111111-1111-4111-8111-111111111111", email: "owner@example.com" };
const PROPOSAL_ID = "33333333-3333-4333-8333-333333333333";
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const get = (id: string) => GET(new Request(`http://localhost/api/proposals/${id}`), ctx(id));

beforeEach(() => {
  vi.clearAllMocks();
  auth.requireUser.mockResolvedValue(owner);
});

describe("GET /api/proposals/:id", () => {
  it("returns 401 without a session and never loads the proposal", async () => {
    auth.requireUser.mockRejectedValue(new ApiError("UNAUTHORIZED", "Sign in to continue"));

    const response = await get(PROPOSAL_ID);

    expect(response.status).toBe(401);
    expect((await response.json()).error.code).toBe("UNAUTHORIZED");
    expect(service.getProposalForUser).not.toHaveBeenCalled();
  });

  it("returns the owner's proposal with a private, no-store response", async () => {
    service.getProposalForUser.mockResolvedValue({ id: PROPOSAL_ID, status: "draft" });

    const response = await get(PROPOSAL_ID);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ data: { id: PROPOSAL_ID, status: "draft" } });
    expect(service.getProposalForUser).toHaveBeenCalledWith(owner, PROPOSAL_ID);
  });

  it("returns the same 404 for someone else's proposal and a missing one", async () => {
    service.getProposalForUser.mockRejectedValue(new ApiError("NOT_FOUND", "Proposal not found"));

    const foreign = await get(PROPOSAL_ID);
    const missing = await get("44444444-4444-4444-8444-444444444444");

    expect(foreign.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(await foreign.json()).toEqual(await missing.json());
  });

  it.each(["not-a-uuid", "1", "' OR 1=1 --"])("returns 404 for a malformed id %s without querying", async (id) => {
    const response = await get(encodeURIComponent(id));
    expect(response.status).toBe(404);
    expect((await response.json()).error).toEqual({ code: "NOT_FOUND", message: "Proposal not found" });
    expect(service.getProposalForUser).not.toHaveBeenCalled();
  });

  it("hides unexpected errors behind INTERNAL_ERROR", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    service.getProposalForUser.mockRejectedValue(new Error("connection string with secret"));

    const response = await get(PROPOSAL_ID);

    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("secret");
    spy.mockRestore();
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ user: { upsert: vi.fn() } }));
const supabase = vi.hoisted(() => ({ getClaims: vi.fn() }));

vi.mock("@/lib/db", () => ({ prisma: db }));
vi.mock("next/headers", () => ({ cookies: async () => ({ getAll: () => [], set: () => {} }) }));
vi.mock("@supabase/ssr", () => ({ createServerClient: () => ({ auth: { getClaims: supabase.getClaims } }) }));

const { ensureUserRecord, requireUser } = await import("./session");

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
});

describe("requireUser", () => {
  it("takes identity and display name from the verified claims", async () => {
    supabase.getClaims.mockResolvedValue({
      data: { claims: { sub: "u1", email: "freelancer@example.com", user_metadata: { full_name: "Ahmad Rasidi" } } },
      error: null,
    });
    expect(await requireUser()).toEqual({ id: "u1", email: "freelancer@example.com", displayName: "Ahmad Rasidi" });
  });

  it("rejects missing, anonymous or email-less sessions", async () => {
    for (const claims of [null, { sub: "u1", email: "a@b.c", is_anonymous: true }, { sub: "u1" }]) {
      supabase.getClaims.mockResolvedValue({ data: claims ? { claims } : null, error: null });
      await expect(requireUser()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    }
  });
});

describe("ensureUserRecord", () => {
  it("stores the display name on create and update", async () => {
    await ensureUserRecord({ id: "u1", email: "f@example.com", displayName: "Rasidi" });
    expect(db.user.upsert).toHaveBeenCalledWith({
      where: { id: "u1" },
      create: { id: "u1", email: "f@example.com", displayName: "Rasidi" },
      update: { email: "f@example.com", displayName: "Rasidi" },
    });
  });

  it("does not erase a stored name when the session has none", async () => {
    await ensureUserRecord({ id: "u1", email: "f@example.com" });
    expect(db.user.upsert).toHaveBeenCalledWith({
      where: { id: "u1" },
      create: { id: "u1", email: "f@example.com", displayName: null },
      update: { email: "f@example.com" },
    });
  });
});

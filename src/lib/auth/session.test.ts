import { beforeEach, describe, expect, it, vi } from "vitest";

import { Prisma } from "@/generated/prisma/client";

const db = vi.hoisted(() => ({ user: { upsert: vi.fn(), updateMany: vi.fn() }, $transaction: vi.fn() }));
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

  const uniqueViolation = () => new Prisma.PrismaClientKnownRequestError("duplicate", { code: "P2002", clientVersion: "test" });

  it("releases the email from a stale row and keeps that row's id when the email conflicts", async () => {
    db.user.upsert.mockRejectedValueOnce(uniqueViolation()).mockResolvedValueOnce({});
    db.$transaction.mockImplementation(async (callback: (tx: typeof db) => unknown) => callback(db));

    await ensureUserRecord({ id: "u2", email: "f@example.com" });

    expect(db.user.updateMany).toHaveBeenCalledWith({
      where: { email: "f@example.com", id: { not: "u2" } },
      data: { email: expect.stringMatching(/^released-[0-9a-f-]+@users\.invalid$/) },
    });
    expect(db.user.upsert).toHaveBeenCalledTimes(2);
  });

  it("rethrows other database errors", async () => {
    db.user.upsert.mockRejectedValueOnce(new Error("database down"));
    await expect(ensureUserRecord({ id: "u1", email: "f@example.com" })).rejects.toThrow("database down");
    expect(db.$transaction).not.toHaveBeenCalled();
  });
});

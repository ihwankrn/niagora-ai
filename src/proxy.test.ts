import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const supabase = vi.hoisted(() => ({ createServerClient: vi.fn(), getClaims: vi.fn() }));
vi.mock("@supabase/ssr", () => ({ createServerClient: supabase.createServerClient }));

const { proxy } = await import("./proxy");

const request = () => new NextRequest("https://example.test/", { headers: { cookie: "sb-x-auth-token=old" } });

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
  supabase.getClaims.mockResolvedValue({ data: null, error: null });
  supabase.createServerClient.mockReturnValue({ auth: { getClaims: supabase.getClaims } });
});

describe("proxy", () => {
  it("writes a refreshed session to the response, with its cache headers", async () => {
    supabase.getClaims.mockImplementation(async () => {
      const { cookies } = supabase.createServerClient.mock.calls[0][2];
      cookies.setAll([{ name: "sb-x-auth-token", value: "new", options: { path: "/" } }], { "cache-control": "private, no-store" });
      return { data: null, error: null };
    });

    const response = await proxy(request());

    expect(response.cookies.get("sb-x-auth-token")?.value).toBe("new");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("passes the request through untouched when no refresh is needed", async () => {
    const response = await proxy(request());
    expect(response.cookies.getAll()).toEqual([]);
    expect(supabase.getClaims).toHaveBeenCalledOnce();
  });

  it("does nothing when Supabase is not configured", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    await proxy(request());
    expect(supabase.createServerClient).not.toHaveBeenCalled();
  });
});

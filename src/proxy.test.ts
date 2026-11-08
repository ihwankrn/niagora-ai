import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const supabase = vi.hoisted(() => ({ createServerClient: vi.fn(), getClaims: vi.fn() }));
vi.mock("@supabase/ssr", () => ({ createServerClient: supabase.createServerClient }));

const { proxy } = await import("./proxy");

const request = (path = "/") =>
  new NextRequest(`https://example.test${path}`, { headers: { cookie: "sb-x-auth-token=old" } });

const signedIn = { data: { claims: { sub: "user-1" } }, error: null };
const signedOut = { data: null, error: null };

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
  supabase.getClaims.mockResolvedValue(signedIn);
  supabase.createServerClient.mockReturnValue({ auth: { getClaims: supabase.getClaims } });
});

describe("proxy", () => {
  it("writes a refreshed session to the response, with its cache headers", async () => {
    supabase.getClaims.mockImplementation(async () => {
      const { cookies } = supabase.createServerClient.mock.calls[0][2];
      cookies.setAll([{ name: "sb-x-auth-token", value: "new", options: { path: "/" } }], { "cache-control": "private, no-store" });
      return signedIn;
    });

    const response = await proxy(request());

    expect(response.headers.get("location")).toBeNull();
    expect(response.cookies.get("sb-x-auth-token")?.value).toBe("new");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("passes the request through untouched when no refresh is needed", async () => {
    const response = await proxy(request());
    expect(response.headers.get("location")).toBeNull();
    expect(response.cookies.getAll()).toEqual([]);
    expect(supabase.getClaims).toHaveBeenCalledOnce();
  });

  it.each(["/", "/new-proposal"])("sends a signed-out visit to %s to /login", async (path) => {
    supabase.getClaims.mockResolvedValue(signedOut);

    const response = await proxy(request(`${path}?tab=x`));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://example.test/login");
  });

  it("keeps cookie changes when redirecting a signed-out visit", async () => {
    supabase.getClaims.mockImplementation(async () => {
      const { cookies } = supabase.createServerClient.mock.calls[0][2];
      cookies.setAll([{ name: "sb-x-auth-token", value: "", options: { path: "/", maxAge: 0 } }], { "cache-control": "private, no-store" });
      return signedOut;
    });

    const response = await proxy(request());

    expect(response.headers.get("location")).toBe("https://example.test/login");
    expect(response.cookies.get("sb-x-auth-token")?.value).toBe("");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it.each(["/login", "/auth/callback", "/api/proposals"])("lets a signed-out visitor reach %s", async (path) => {
    supabase.getClaims.mockResolvedValue(signedOut);

    const response = await proxy(request(path));

    expect(response.headers.get("location")).toBeNull();
  });

  it("sends an email link that lands on the dashboard to the callback, keeping its code", async () => {
    const response = await proxy(new NextRequest("https://example.test/?code=abc"));

    expect(response.headers.get("location")).toBe("https://example.test/auth/callback?code=abc");
    expect(supabase.createServerClient).not.toHaveBeenCalled();
  });

  it("does nothing when Supabase is not configured", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    const response = await proxy(request());
    expect(supabase.createServerClient).not.toHaveBeenCalled();
    expect(response.headers.get("location")).toBeNull();
  });
});

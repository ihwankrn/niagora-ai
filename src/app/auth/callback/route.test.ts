import { beforeEach, describe, expect, it, vi } from "vitest";

const exchangeCodeForSession = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth/session", () => ({
  createSupabaseServerClient: async () => ({ auth: { exchangeCodeForSession } }),
}));

const { GET } = await import("./route");

const call = (query: string) => GET(new Request(`https://app.example.test/auth/callback${query}`));

beforeEach(() => vi.clearAllMocks());

describe("GET /auth/callback", () => {
  it("exchanges the code and goes to the dashboard", async () => {
    exchangeCodeForSession.mockResolvedValue({ error: null });

    const response = await call("?code=abc");

    expect(exchangeCodeForSession).toHaveBeenCalledWith("abc");
    expect(response.headers.get("location")).toBe("https://app.example.test/");
  });

  it("sends a rejected or thrown exchange to the login page", async () => {
    exchangeCodeForSession.mockResolvedValueOnce({ error: new Error("bad code") });
    expect((await call("?code=abc")).headers.get("location")).toBe("https://app.example.test/login?link=failed");

    exchangeCodeForSession.mockRejectedValueOnce(new Error("verifier missing"));
    expect((await call("?code=abc")).headers.get("location")).toBe("https://app.example.test/login?link=failed");
  });

  it("does not call Supabase without a code, and ignores any redirect target", async () => {
    const response = await call("?next=https://evil.example.test");

    expect(exchangeCodeForSession).not.toHaveBeenCalled();
    expect(response.headers.get("location")).toBe("https://app.example.test/login?link=failed");
  });
});

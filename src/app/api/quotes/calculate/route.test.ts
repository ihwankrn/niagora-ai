import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api/http";
import { MAX_HOURLY_RATE_CENTS } from "@/lib/contracts/common";

const auth = vi.hoisted(() => ({ requireUser: vi.fn() }));
vi.mock("@/lib/auth/session", () => auth);

const { POST } = await import("./route");

const validBody = {
  currency: "USD",
  hourlyRateCents: 5_000,
  items: [
    { title: "Pages", estimatedHours: 10 },
    { title: "Form", estimatedHours: 2.5, hourlyRateCents: 6_000 },
  ],
};

function post(body: unknown) {
  return new Request("http://localhost/api/quotes/calculate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  auth.requireUser.mockResolvedValue({ id: "11111111-1111-4111-8111-111111111111", email: "f@example.com" });
});

describe("POST /api/quotes/calculate", () => {
  it("returns 401 without a session", async () => {
    auth.requireUser.mockRejectedValue(new ApiError("UNAUTHORIZED", "Sign in to continue"));
    const response = await POST(post(validBody));
    expect(response.status).toBe(401);
  });

  it("returns the server-computed quote", async () => {
    const response = await POST(post(validBody));
    expect(response.status).toBe(200);
    const { data } = await response.json();
    expect(data.items.map((item: { amountCents: number }) => item.amountCents)).toEqual([50_000, 15_000]);
    expect(data.totalCents).toBe(65_000);
  });

  it("rejects totals and amounts sent by the browser", async () => {
    for (const body of [
      { ...validBody, totalCents: 1 },
      { ...validBody, subtotalCents: 1 },
      { ...validBody, items: [{ title: "Pages", estimatedHours: 10, amountCents: 1 }] },
    ]) {
      const response = await POST(post(body));
      expect(response.status).toBe(400);
      expect((await response.json()).error.code).toBe("VALIDATION_ERROR");
    }
  });

  it("rejects unsupported currencies and invalid hours", async () => {
    for (const body of [
      { ...validBody, currency: "IDR" },
      { ...validBody, items: [{ title: "Pages", estimatedHours: 1.234 }] },
      { ...validBody, hourlyRateCents: 49.5 },
    ]) {
      expect((await POST(post(body))).status).toBe(400);
    }
  });

  it("maps quotes above the cap to VALIDATION_ERROR on items", async () => {
    const response = await POST(
      post({ ...validBody, hourlyRateCents: MAX_HOURLY_RATE_CENTS, items: [{ title: "x", estimatedHours: 1_000 }] }),
    );
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.details[0].path).toBe("items");
  });
});

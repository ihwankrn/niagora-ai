import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api/http";

const auth = vi.hoisted(() => ({ requireUser: vi.fn() }));
const payments = vi.hoisted(() => ({
  sendProposal: vi.fn(),
  getPublicProposal: vi.fn(),
  approveProposal: vi.fn(),
  createPaypalOrder: vi.fn(),
  capturePaypalOrder: vi.fn(),
}));
vi.mock("@/lib/auth/session", () => auth);
vi.mock("@/lib/payments/service", () => payments);

const view = await import("./route");
const approve = await import("./approve/route");
const orders = await import("./paypal/orders/route");
const capture = await import("./paypal/capture/route");
const send = await import("../../../proposals/[id]/send/route");

const TOKEN = "a".repeat(43);
const ctx = (token: string) => ({ params: Promise.resolve({ token }) });
const req = (body?: unknown) =>
  new Request("http://localhost/api/x", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

beforeEach(() => vi.clearAllMocks());

describe("public proposal routes", () => {
  it.each(["short", "a".repeat(44), "../../etc/passwd", `${"a".repeat(42)}!`])("return 404 for malformed token %s", async (token) => {
    for (const handler of [view.GET, approve.POST, orders.POST]) {
      const response = await handler(req(), ctx(token));
      expect(response.status).toBe(404);
    }
    expect(payments.getPublicProposal).not.toHaveBeenCalled();
    expect(payments.createPaypalOrder).not.toHaveBeenCalled();
  });

  it("serve the client view privately without a session", async () => {
    payments.getPublicProposal.mockResolvedValue({ title: "Site" });
    const response = await view.GET(new Request("http://localhost/x"), ctx(TOKEN));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(auth.requireUser).not.toHaveBeenCalled();
  });

  it("create an order with 201 and ignore any body", async () => {
    payments.createPaypalOrder.mockResolvedValue({ orderId: "ORDER1" });
    const response = await orders.POST(req({ amountCents: 1, currency: "USD" }), ctx(TOKEN));
    expect(response.status).toBe(201);
    expect(payments.createPaypalOrder).toHaveBeenCalledWith(TOKEN);
  });

  it("validate the capture body", async () => {
    for (const body of [{}, { orderId: "lowercase" }, { orderId: "ORDER1", amountCents: 1 }]) {
      expect((await capture.POST(req(body), ctx(TOKEN))).status).toBe(400);
    }
    payments.capturePaypalOrder.mockResolvedValue({ paymentStatus: "completed" });
    expect((await capture.POST(req({ orderId: "5O190127TN364715T" }), ctx(TOKEN))).status).toBe(200);
    expect(payments.capturePaypalOrder).toHaveBeenCalledWith(TOKEN, "5O190127TN364715T");
  });

  it("pass payment errors through with their status", async () => {
    payments.capturePaypalOrder.mockRejectedValue(new ApiError("PAYMENT_DECLINED", "Declined"));
    const response = await capture.POST(req({ orderId: "ORDER1" }), ctx(TOKEN));
    expect(response.status).toBe(422);
    expect((await response.json()).error.code).toBe("PAYMENT_DECLINED");
  });
});

describe("POST /api/proposals/:id/send", () => {
  const idCtx = (id: string) => ({ params: Promise.resolve({ id }) });

  it("requires a session", async () => {
    auth.requireUser.mockRejectedValue(new ApiError("UNAUTHORIZED", "Sign in to continue"));
    expect((await send.POST(req(), idCtx("33333333-3333-4333-8333-333333333333"))).status).toBe(401);
  });

  it("returns 404 for a malformed id", async () => {
    auth.requireUser.mockResolvedValue({ id: "u1", email: "f@example.com" });
    expect((await send.POST(req(), idCtx("not-a-uuid"))).status).toBe(404);
    expect(payments.sendProposal).not.toHaveBeenCalled();
  });
});

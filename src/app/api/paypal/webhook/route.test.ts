import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api/http";

const service = vi.hoisted(() => ({ assertAuthenticPaypalWebhook: vi.fn(), reconcileCapturedOrder: vi.fn() }));
vi.mock("@/lib/payments/service", () => service);

const { POST } = await import("./route");

const capture = {
  event_type: "PAYMENT.CAPTURE.COMPLETED",
  resource: { id: "CAP1", supplementary_data: { related_ids: { order_id: "ORDER1" } } },
};
const post = (body: string) =>
  POST(new Request("https://example.test/api/paypal/webhook", { method: "POST", body }));

beforeEach(() => {
  vi.clearAllMocks();
  service.assertAuthenticPaypalWebhook.mockResolvedValue(undefined);
  service.reconcileCapturedOrder.mockResolvedValue(undefined);
});

describe("POST /api/paypal/webhook", () => {
  it("verifies the exact raw body, then reconciles the order", async () => {
    const raw = JSON.stringify(capture, null, 2);

    const response = await post(raw);

    expect(response.status).toBe(200);
    expect(service.assertAuthenticPaypalWebhook).toHaveBeenCalledWith(expect.any(Headers), raw);
    expect(service.reconcileCapturedOrder).toHaveBeenCalledWith("ORDER1");
  });

  it("never reconciles an event that fails verification", async () => {
    service.assertAuthenticPaypalWebhook.mockRejectedValue(new ApiError("UNAUTHORIZED", "Invalid webhook signature"));

    const response = await post(JSON.stringify(capture));

    expect(response.status).toBe(401);
    expect(service.reconcileCapturedOrder).not.toHaveBeenCalled();
  });

  it("does not forward a body that is not a JSON object for verification", async () => {
    for (const body of ["{not json", "1", '{"a":1}']) {
      const response = await post(body);
      expect(response.status).toBe(400);
    }
    expect(service.assertAuthenticPaypalWebhook).not.toHaveBeenCalled();
  });

  it("acknowledges other verified events without reconciling", async () => {
    const response = await post(JSON.stringify({ event_type: "PAYMENT.CAPTURE.REFUNDED", resource: {} }));

    expect(response.status).toBe(200);
    expect(service.reconcileCapturedOrder).not.toHaveBeenCalled();
  });

  it("answers non-2xx so PayPal retries when reconciliation fails", async () => {
    service.reconcileCapturedOrder.mockRejectedValue(new ApiError("PAYMENT_PROVIDER_ERROR", "The order is not completed yet."));

    expect((await post(JSON.stringify(capture))).status).toBe(502);
  });
});

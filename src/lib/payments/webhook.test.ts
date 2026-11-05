import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  proposal: { findUnique: vi.fn() },
  payment: { findFirst: vi.fn() },
}));
const paypal = vi.hoisted(() => ({ captureOrder: vi.fn(), getOrder: vi.fn(), verifyWebhookSignature: vi.fn() }));

vi.mock("@/lib/db", () => ({ prisma: db }));
vi.mock("@/lib/paypal/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/paypal/client")>()),
  ...paypal,
}));

const { assertAuthenticPaypalWebhook, reconcileCapturedOrder } = await import("./service");

const signedHeaders = () =>
  new Headers({
    "PAYPAL-AUTH-ALGO": "SHA256withRSA",
    "PAYPAL-CERT-URL": "https://api.sandbox.paypal.com/cert",
    "PAYPAL-TRANSMISSION-ID": "tx-1",
    "PAYPAL-TRANSMISSION-SIG": "sig",
    "PAYPAL-TRANSMISSION-TIME": "2026-11-05T12:00:00Z",
  });

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("PAYPAL_WEBHOOK_ID", "WH-1");
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("assertAuthenticPaypalWebhook", () => {
  it("accepts an event PayPal confirms, using the configured webhook id", async () => {
    paypal.verifyWebhookSignature.mockResolvedValue(true);

    await expect(assertAuthenticPaypalWebhook(signedHeaders(), "{}")).resolves.toBeUndefined();

    expect(paypal.verifyWebhookSignature).toHaveBeenCalledWith(expect.objectContaining({ webhookId: "WH-1", transmissionId: "tx-1" }), "{}");
  });

  it("rejects a failed signature and missing signature headers", async () => {
    paypal.verifyWebhookSignature.mockResolvedValue(false);
    await expect(assertAuthenticPaypalWebhook(signedHeaders(), "{}")).rejects.toMatchObject({ code: "UNAUTHORIZED" });

    paypal.verifyWebhookSignature.mockClear();
    await expect(assertAuthenticPaypalWebhook(new Headers(), "{}")).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(paypal.verifyWebhookSignature).not.toHaveBeenCalled();
  });

  it("trusts nothing when no webhook id is configured", async () => {
    vi.stubEnv("PAYPAL_WEBHOOK_ID", "");
    await expect(assertAuthenticPaypalWebhook(signedHeaders(), "{}")).rejects.toMatchObject({ code: "PAYMENT_PROVIDER_ERROR" });
    expect(paypal.verifyWebhookSignature).not.toHaveBeenCalled();
  });
});

describe("reconcileCapturedOrder", () => {
  it("ignores an order this app does not know", async () => {
    db.payment.findFirst.mockResolvedValue(null);
    await expect(reconcileCapturedOrder("OTHER")).resolves.toBeUndefined();
    expect(paypal.getOrder).not.toHaveBeenCalled();
  });

  it("never captures an order PayPal does not show as completed, and asks for a retry", async () => {
    db.payment.findFirst.mockResolvedValue({ proposal: { shareToken: "t".repeat(43) } });
    paypal.getOrder.mockResolvedValue({ id: "ORDER1", status: "APPROVED" });

    await expect(reconcileCapturedOrder("ORDER1")).rejects.toMatchObject({ code: "PAYMENT_PROVIDER_ERROR" });
    expect(paypal.captureOrder).not.toHaveBeenCalled();
  });
});

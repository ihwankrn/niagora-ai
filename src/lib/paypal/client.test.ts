import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { captureOrder, createOrder, formatAmount, getOrder, getPaypalConfig, PaypalApiError, resetPaypalTokenCache } from "./client";

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function fakeFetch(...responses: Response[]) {
  const fn = vi.fn<typeof fetch>();
  for (const response of responses) fn.mockResolvedValueOnce(response);
  return fn;
}

const token = () => json(200, { access_token: "A21AAtest", token_type: "Bearer", expires_in: 32_400 });

beforeEach(() => {
  resetPaypalTokenCache();
  vi.stubEnv("PAYPAL_ENVIRONMENT", "sandbox");
  vi.stubEnv("PAYPAL_CLIENT_ID", "client-id");
  vi.stubEnv("PAYPAL_CLIENT_SECRET", "client-secret");
});
afterEach(() => vi.unstubAllEnvs());

describe("formatAmount", () => {
  it.each([
    [65_000, "650.00"],
    [5, "0.05"],
    [50, "0.50"],
    [100_000_000, "1000000.00"],
  ])("%s cents -> %s", (cents, value) => expect(formatAmount(cents)).toBe(value));
});

describe("getPaypalConfig", () => {
  it("defaults to sandbox and rejects unknown environments or missing credentials", () => {
    vi.stubEnv("PAYPAL_ENVIRONMENT", "");
    expect(() => getPaypalConfig()).toThrow();
    vi.unstubAllEnvs();
    vi.stubEnv("PAYPAL_CLIENT_ID", "id");
    vi.stubEnv("PAYPAL_CLIENT_SECRET", "secret");
    expect(getPaypalConfig().baseUrl).toBe("https://api-m.sandbox.paypal.com");
    vi.stubEnv("PAYPAL_ENVIRONMENT", "production");
    expect(() => getPaypalConfig()).toThrow(/sandbox/);
    vi.stubEnv("PAYPAL_ENVIRONMENT", "sandbox");
    vi.stubEnv("PAYPAL_CLIENT_SECRET", "");
    expect(() => getPaypalConfig()).toThrow(/CLIENT_SECRET/);
  });
});

describe("PayPal requests", () => {
  it("authenticates with client credentials and creates a CAPTURE order with idempotency", async () => {
    const fetchImpl = fakeFetch(token(), json(201, { id: "ORDER1", status: "CREATED" }));

    await createOrder(
      { requestId: "req-1", proposalId: "prop-1", paymentId: "pay-1", description: "x".repeat(200), amount: { currency_code: "USD", value: "650.00" } },
      fetchImpl,
    );

    const [tokenUrl, tokenInit] = fetchImpl.mock.calls[0];
    expect(tokenUrl).toBe("https://api-m.sandbox.paypal.com/v1/oauth2/token");
    expect((tokenInit!.headers as Record<string, string>).authorization).toBe(`Basic ${Buffer.from("client-id:client-secret").toString("base64")}`);
    expect(tokenInit!.body).toBe("grant_type=client_credentials");

    const [orderUrl, orderInit] = fetchImpl.mock.calls[1];
    const headers = orderInit!.headers as Record<string, string>;
    expect(orderUrl).toBe("https://api-m.sandbox.paypal.com/v2/checkout/orders");
    expect(headers.authorization).toBe("Bearer A21AAtest");
    expect(headers["paypal-request-id"]).toBe("req-1");
    expect(headers.prefer).toBe("return=representation");
    const body = JSON.parse(orderInit!.body as string);
    expect(body.intent).toBe("CAPTURE");
    expect(body.purchase_units[0]).toMatchObject({
      reference_id: "prop-1",
      custom_id: "pay-1",
      invoice_id: "pay-1",
      amount: { currency_code: "USD", value: "650.00" },
    });
    expect(body.purchase_units[0].description).toHaveLength(127);
  });

  it("reuses the access token until it expires", async () => {
    const fetchImpl = fakeFetch(token(), json(200, { id: "A", status: "APPROVED" }), json(200, { id: "A", status: "APPROVED" }));
    await getOrder("A", fetchImpl);
    await getOrder("A", fetchImpl);
    expect(fetchImpl.mock.calls.filter(([url]) => String(url).endsWith("/v1/oauth2/token"))).toHaveLength(1);
  });

  it("sends the capture request id and surfaces PayPal issue codes", async () => {
    const fetchImpl = fakeFetch(
      token(),
      json(422, { name: "UNPROCESSABLE_ENTITY", debug_id: "dbg1", details: [{ issue: "ORDER_NOT_APPROVED" }] }),
    );

    const error = await captureOrder("ORDER1", "req-1-capture", fetchImpl).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(PaypalApiError);
    expect(error).toMatchObject({ status: 422, issue: "ORDER_NOT_APPROVED", debugId: "dbg1" });
    const [url, init] = fetchImpl.mock.calls[1];
    expect(url).toBe("https://api-m.sandbox.paypal.com/v2/checkout/orders/ORDER1/capture");
    expect((init!.headers as Record<string, string>)["paypal-request-id"]).toBe("req-1-capture");
  });

  it("fails clearly when the credentials are rejected", async () => {
    const fetchImpl = fakeFetch(json(401, { error: "invalid_client" }));
    await expect(getOrder("A", fetchImpl)).rejects.toMatchObject({ status: 401 });
  });
});

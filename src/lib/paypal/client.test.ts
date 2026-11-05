import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  captureOrder,
  createOrder,
  formatAmount,
  getOrder,
  getPaypalConfig,
  PaypalApiError,
  resetPaypalTokenCache,
  verifyWebhookSignature,
} from "./client";

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

  it.each([-1, -150, 1.5, 650.01, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid cents %s",
    (cents) => {
      expect(() => formatAmount(cents)).toThrow(RangeError);
    },
  );
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

  it.each(["toString", "constructor", "__proto__", "hasOwnProperty"])(
    "rejects the inherited prototype key %s as an environment",
    (environment) => {
      vi.stubEnv("PAYPAL_ENVIRONMENT", environment);
      expect(() => getPaypalConfig()).toThrow(/sandbox/);
    },
  );

  it.each(["live", "LIVE", "production", " sandbox", "Sandbox"])("refuses PAYPAL_ENVIRONMENT=%j", (environment) => {
    vi.stubEnv("PAYPAL_ENVIRONMENT", environment);
    expect(() => getPaypalConfig()).toThrow(/PayPal Live is disabled/);
  });

  it("sends nothing to PayPal when the environment is live", async () => {
    vi.stubEnv("PAYPAL_ENVIRONMENT", "live");
    const fetchImpl = vi.fn<typeof fetch>();

    await expect(getOrder("ORDER1", fetchImpl)).rejects.toThrow(/PayPal Live is disabled/);
    await expect(captureOrder("ORDER1", "req-1-capture", fetchImpl)).rejects.toThrow(/PayPal Live is disabled/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("never targets the Live API host", () => {
    expect(getPaypalConfig().baseUrl).toBe("https://api-m.sandbox.paypal.com");
    expect(readFileSync(fileURLToPath(new URL("./client.ts", import.meta.url)), "utf8")).not.toContain("api-m.paypal.com");
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

describe("token handling", () => {
  const tokenCalls = (fetchImpl: ReturnType<typeof vi.fn<typeof fetch>>) =>
    fetchImpl.mock.calls.filter(([url]) => String(url).endsWith("/v1/oauth2/token")).length;

  it.each([
    ["a null body", null],
    ["a missing access token", { expires_in: 3600 }],
    ["a blank access token", { access_token: "   ", expires_in: 3600 }],
    ["a non-string access token", { access_token: 123, expires_in: 3600 }],
    ["a missing lifetime", { access_token: "A" }],
    ["a zero lifetime", { access_token: "A", expires_in: 0 }],
    ["a negative lifetime", { access_token: "A", expires_in: -60 }],
    ["an infinite lifetime", { access_token: "A", expires_in: "Infinity" }],
  ])("rejects %s", async (_label, body) => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () => json(200, body));

    const error = await getOrder("A", fetchImpl).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(PaypalApiError);
    expect(error).toMatchObject({ status: 502, issue: "INVALID_TOKEN_RESPONSE", retryable: false });
    // A provider contract violation is not retried.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("shares one in-flight token request between concurrent callers", async () => {
    let releaseToken!: (response: Response) => void;
    const pendingToken = new Promise<Response>((resolve) => {
      releaseToken = resolve;
    });
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(() => pendingToken)
      .mockResolvedValueOnce(json(200, { id: "A", status: "APPROVED" }))
      .mockResolvedValueOnce(json(200, { id: "B", status: "APPROVED" }));

    const first = getOrder("A", fetchImpl);
    const second = getOrder("B", fetchImpl);
    // Let both callers reach getAccessToken before the token resolves.
    await Promise.resolve();

    releaseToken(token());

    expect(await Promise.all([first, second])).toHaveLength(2);
    expect(tokenCalls(fetchImpl)).toBe(1);
  });

  it("does not cache a token for longer than its (short) lifetime", async () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    try {
      const fetchImpl = fakeFetch(
        json(200, { access_token: "SHORT", expires_in: 1 }),
        json(200, { id: "A", status: "APPROVED" }),
        json(200, { access_token: "LATER", expires_in: 3600 }),
        json(200, { id: "A", status: "APPROVED" }),
      );

      await getOrder("A", fetchImpl);
      // A 1s lifetime refreshes 0.5s early, so the token is already stale here.
      nowSpy.mockReturnValue(1_000_501);
      await getOrder("A", fetchImpl);

      expect(tokenCalls(fetchImpl)).toBe(2);
      expect((fetchImpl.mock.calls[3][1]!.headers as Record<string, string>).authorization).toBe("Bearer LATER");
    } finally {
      nowSpy.mockRestore();
    }
  });

  it("caps an absurdly long token lifetime at 24 hours", async () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    try {
      const fetchImpl = fakeFetch(
        json(200, { access_token: "FOREVER", expires_in: 2_000_000_000 }),
        json(200, { id: "A", status: "APPROVED" }),
        json(200, { access_token: "NEW", expires_in: 3600 }),
        json(200, { id: "A", status: "APPROVED" }),
      );

      await getOrder("A", fetchImpl);
      nowSpy.mockReturnValue(1_000_000 + 24 * 60 * 60 * 1000 + 1);
      await getOrder("A", fetchImpl);

      expect(tokenCalls(fetchImpl)).toBe(2);
    } finally {
      nowSpy.mockRestore();
    }
  });
});

describe("rejected access tokens", () => {
  const order = { id: "O1", status: "COMPLETED" };
  const rejected = () => json(401, { name: "AUTHENTICATION_FAILURE" });

  it("requests a fresh token once after a 401 and keeps using it", async () => {
    const fetchImpl = fakeFetch(token(), json(200, order), rejected(), token(), json(200, order), json(200, order));

    await getOrder("O1", fetchImpl);
    await expect(getOrder("O1", fetchImpl)).resolves.toEqual(order);
    await getOrder("O1", fetchImpl);

    expect(fetchImpl).toHaveBeenCalledTimes(6);
  });

  it("sends a capture again with the same request id after a 401, which PayPal rejects unprocessed", async () => {
    const fetchImpl = fakeFetch(token(), rejected(), token(), json(201, order));

    await expect(captureOrder("O1", "req-capture", fetchImpl)).resolves.toEqual(order);

    const headers = [1, 3].map((call) => new Headers(fetchImpl.mock.calls[call][1]?.headers).get("PayPal-Request-Id"));
    expect(headers).toEqual(["req-capture", "req-capture"]);
  });

  it("does not loop when the fresh token is rejected too", async () => {
    const fetchImpl = fakeFetch(token(), rejected(), token(), rejected());

    await expect(getOrder("O1", fetchImpl)).rejects.toMatchObject({ status: 401 });
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it("does not reuse a cached token after the client secret changes", async () => {
    const fetchImpl = fakeFetch(token(), json(200, order), token(), json(200, order));

    await getOrder("O1", fetchImpl);
    vi.stubEnv("PAYPAL_CLIENT_SECRET", "rotated-secret");
    await getOrder("O1", fetchImpl);

    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });
});

describe("verifyWebhookSignature", () => {
  const signature = {
    authAlgo: "SHA256withRSA",
    certUrl: "https://api.sandbox.paypal.com/cert",
    transmissionId: "tx-1",
    transmissionSig: "sig",
    transmissionTime: "2026-11-05T12:00:00Z",
    webhookId: "WH-1",
  };

  it("posts the event back byte for byte and accepts only SUCCESS", async () => {
    const rawEvent = '{"id":"WH-EVENT",  "amount":1.10,"event_type":"X"}';
    const fetchImpl = fakeFetch(token(), json(200, { verification_status: "SUCCESS" }));

    await expect(verifyWebhookSignature(signature, rawEvent, fetchImpl)).resolves.toBe(true);

    const [url, init] = fetchImpl.mock.calls[1];
    expect(String(url)).toBe("https://api-m.sandbox.paypal.com/v1/notifications/verify-webhook-signature");
    const body = String(init?.body);
    expect(body).toContain(`"webhook_event":${rawEvent}}`);
    expect(JSON.parse(body)).toMatchObject({ auth_algo: "SHA256withRSA", webhook_id: "WH-1", transmission_id: "tx-1" });
  });

  it("rejects FAILURE", async () => {
    const fetchImpl = fakeFetch(token(), json(200, { verification_status: "FAILURE" }));
    await expect(verifyWebhookSignature(signature, "{}", fetchImpl)).resolves.toBe(false);
  });
});

describe("retries for transient errors", () => {
  const networkError = () => new TypeError("fetch failed");

  beforeEach(() => vi.useFakeTimers({ toFake: ["setTimeout"] }));
  afterEach(() => vi.useRealTimers());

  async function settle<T>(promise: Promise<T>) {
    const result = promise.then((value) => ({ value }), (error: unknown) => ({ error }));
    await vi.runAllTimersAsync();
    return result;
  }

  it("retries a GET after a network error and a 503", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(token())
      .mockRejectedValueOnce(networkError())
      .mockResolvedValueOnce(json(503, { name: "SERVICE_UNAVAILABLE" }))
      .mockResolvedValueOnce(json(200, { id: "A", status: "COMPLETED" }));

    const result = await settle(getOrder("A", fetchImpl));

    expect(result).toEqual({ value: { id: "A", status: "COMPLETED" } });
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it("gives up after the last retry", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(token()).mockRejectedValue(networkError());
    const result = await settle(getOrder("A", fetchImpl));
    expect(result).toEqual({ error: expect.any(TypeError) });
    expect(fetchImpl).toHaveBeenCalledTimes(4); // token + 3 attempts
  });

  it("retries order creation with the same PayPal-Request-Id", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(token())
      .mockRejectedValueOnce(networkError())
      .mockResolvedValueOnce(json(201, { id: "ORDER1", status: "CREATED" }));

    await settle(
      createOrder({ requestId: "req-1", proposalId: "p", paymentId: "pay", description: "d", amount: { currency_code: "USD", value: "1.00" } }, fetchImpl),
    );

    const ids = fetchImpl.mock.calls.slice(1).map(([, init]) => (init!.headers as Record<string, string>)["paypal-request-id"]);
    expect(ids).toEqual(["req-1", "req-1"]);
  });

  it("retries a GET after a request timeout", async () => {
    const timeoutError = () => new DOMException("The operation was aborted due to timeout", "TimeoutError");
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(token())
      .mockRejectedValueOnce(timeoutError())
      .mockResolvedValueOnce(json(200, { id: "A", status: "COMPLETED" }));

    expect(await settle(getOrder("A", fetchImpl))).toEqual({ value: { id: "A", status: "COMPLETED" } });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("never retries a capture after a request timeout", async () => {
    const timeoutError = () => new DOMException("The operation was aborted due to timeout", "TimeoutError");
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(token()).mockRejectedValueOnce(timeoutError());

    const result = await settle(captureOrder("ORDER1", "req-1-capture", fetchImpl));

    expect(result).toEqual({ error: expect.objectContaining({ name: "TimeoutError" }) });
    expect(fetchImpl.mock.calls.filter(([url]) => String(url).endsWith("/capture"))).toHaveLength(1);
  });

  it("rejects a non-object provider response instead of returning it as an order", async () => {
    const fetchImpl = fakeFetch(token(), json(200, null));
    await expect(captureOrder("ORDER1", "req-1-capture", fetchImpl)).rejects.toMatchObject({
      status: 502,
      issue: "INVALID_RESPONSE",
    });
  });

  it("never retries a capture, even after a network error", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(token()).mockRejectedValueOnce(networkError());
    const result = await settle(captureOrder("ORDER1", "req-1-capture", fetchImpl));
    expect(result).toEqual({ error: expect.any(TypeError) });
    expect(fetchImpl.mock.calls.filter(([url]) => String(url).endsWith("/capture"))).toHaveLength(1);
  });

  it("does not retry 4xx errors", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(token()).mockResolvedValueOnce(json(404, { name: "RESOURCE_NOT_FOUND" }));
    const result = await settle(getOrder("MISSING", fetchImpl));
    expect(result).toEqual({ error: expect.objectContaining({ status: 404 }) });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("retries the token request after a network error", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockRejectedValueOnce(networkError())
      .mockResolvedValueOnce(token())
      .mockResolvedValueOnce(json(200, { id: "A", status: "APPROVED" }));
    expect(await settle(getOrder("A", fetchImpl))).toEqual({ value: { id: "A", status: "APPROVED" } });
  });
});

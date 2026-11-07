import "server-only";

// Minimal PayPal REST client for Orders v2 (developer.paypal.com/docs/api/orders/v2/).
// Credentials stay on the server; the browser only ever sees order ids.

// Sandbox only. The Live API host is deliberately absent, so no configuration
// value can send a real payment through this client.
const SANDBOX_BASE_URL = "https://api-m.sandbox.paypal.com";

export type PaypalAmount = { currency_code: string; value: string };

export type PaypalCapture = {
  id: string;
  status: string; // COMPLETED, PENDING, DECLINED, ...
  amount?: PaypalAmount;
  final_capture?: boolean;
};

export type PaypalOrder = {
  id: string;
  intent?: string;
  status: string; // CREATED, APPROVED, COMPLETED, VOIDED, PAYER_ACTION_REQUIRED, ...
  purchase_units?: Array<{
    reference_id?: string;
    custom_id?: string;
    invoice_id?: string;
    amount?: PaypalAmount;
    payments?: { captures?: PaypalCapture[] };
  }>;
  payer?: { payer_id?: string };
  links?: Array<{ href: string; rel: string; method?: string }>;
};

const REQUEST_TIMEOUT_MS = 20_000;
const MAX_TOKEN_LIFETIME_SECONDS = 24 * 60 * 60;
export const RETRY_DELAYS_MS = [300, 1_000];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export class PaypalApiError extends Error {
  readonly status: number;
  readonly issue: string | undefined; // e.g. ORDER_NOT_APPROVED, ORDER_ALREADY_CAPTURED
  readonly debugId: string | undefined;
  // Locally detected contract violations (invalid body) are not worth retrying.
  readonly retryable: boolean;

  constructor(status: number, body: unknown, options: { retryable?: boolean } = {}) {
    const record = isRecord(body) ? body : {};
    const name = typeof record.name === "string" ? record.name : undefined;
    const message = typeof record.message === "string" ? record.message : undefined;
    const debugId = typeof record.debug_id === "string" ? record.debug_id : undefined;
    const details = Array.isArray(record.details) ? record.details.filter(isRecord) : [];
    const firstIssue = details[0]?.issue;
    const issue = typeof firstIssue === "string" ? firstIssue : name;

    // Keep messages short and never include request headers or credentials.
    super(`PayPal API ${status}: ${name ?? "error"}${message ? ` - ${message.slice(0, 300)}` : ""}`);
    this.name = "PaypalApiError";
    this.status = status;
    this.issue = issue;
    this.debugId = debugId;
    this.retryable = options.retryable ?? (status === 429 || status >= 500);
  }
}

export function getPaypalConfig() {
  const environment = process.env.PAYPAL_ENVIRONMENT ?? "sandbox";
  const clientId = process.env.PAYPAL_CLIENT_ID?.trim();
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET?.trim();

  if (environment !== "sandbox") {
    throw new Error('PAYPAL_ENVIRONMENT must be "sandbox": PayPal Live is disabled');
  }
  if (!clientId || !clientSecret) {
    throw new Error("PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET must be set");
  }
  return { environment, baseUrl: SANDBOX_BASE_URL, clientId, clientSecret };
}

type CachedToken = { value: string; expiresAt: number; key: string };
type OAuthToken = { access_token: string; expires_in: number };

let cachedToken: CachedToken | undefined;
let pendingToken: { key: string; promise: Promise<{ token: string; baseUrl: string }> } | undefined;

function parseTokenResponse(json: unknown): OAuthToken {
  if (!isRecord(json)) {
    throw new PaypalApiError(
      502,
      { name: "INVALID_TOKEN_RESPONSE", message: "PayPal returned an invalid OAuth response" },
      { retryable: false },
    );
  }

  const accessToken = json.access_token;
  const expiresIn = Number(json.expires_in);
  if (typeof accessToken !== "string" || accessToken.trim() === "" || !Number.isFinite(expiresIn) || expiresIn <= 0) {
    throw new PaypalApiError(
      502,
      { name: "INVALID_TOKEN_RESPONSE", message: "PayPal returned an invalid OAuth response" },
      { retryable: false },
    );
  }

  return { access_token: accessToken, expires_in: expiresIn };
}

async function getAccessToken(fetchImpl: typeof fetch) {
  const config = getPaypalConfig();
  // The secret is part of the key so rotated credentials never reuse an old token.
  const key = `${config.environment}:${config.clientId}:${config.clientSecret}`;

  if (cachedToken && cachedToken.key === key && cachedToken.expiresAt > Date.now()) {
    return { token: cachedToken.value, baseUrl: config.baseUrl };
  }
  // Share one in-flight request between concurrent callers. Requesting a token
  // has no side effects, so retrying a failed request is safe.
  if (pendingToken?.key === key) {
    return pendingToken.promise;
  }

  const request = (async () => {
    const body = await withRetry(true, async () => {
      const response = await fetchImpl(`${config.baseUrl}/v1/oauth2/token`, {
        method: "POST",
        headers: {
          authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64")}`,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: "grant_type=client_credentials",
        cache: "no-store",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      const json: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        throw new PaypalApiError(response.status, json);
      }
      return parseTokenResponse(json);
    });

    // Refresh a minute early, but never let a very short lifetime produce a
    // negative/zero cache window. An absurdly long lifetime is capped so a bad
    // provider response cannot pin a token forever.
    const lifetimeMs = Math.min(body.expires_in, MAX_TOKEN_LIFETIME_SECONDS) * 1000;
    const skewMs = Math.min(60_000, Math.floor(lifetimeMs / 2));
    cachedToken = { value: body.access_token, expiresAt: Date.now() + lifetimeMs - skewMs, key };
    return { token: body.access_token, baseUrl: config.baseUrl };
  })();

  pendingToken = { key, promise: request };
  try {
    return await request;
  } finally {
    if (pendingToken?.promise === request) {
      pendingToken = undefined;
    }
  }
}

export function resetPaypalTokenCache() {
  cachedToken = undefined;
  pendingToken = undefined;
}

// Network failures, timeouts, 429 and 5xx may succeed on a later attempt
// (developer.paypal.com/api/rest/reference/idempotency/). 4xx errors will not.
export function isTransientPaypalError(error: unknown) {
  if (error instanceof PaypalApiError) return error.retryable;
  if (error instanceof TypeError) return true;
  if (typeof DOMException !== "undefined" && error instanceof DOMException) {
    return ["TimeoutError", "AbortError"].includes(error.name);
  }
  return error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name);
}

async function withRetry<T>(retry: boolean, attempt: () => Promise<T>): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await attempt();
    } catch (error) {
      if (!retry || i >= RETRY_DELAYS_MS.length || !isTransientPaypalError(error)) throw error;
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[i]));
    }
  }
}

async function request<T>(
  method: "GET" | "POST",
  path: string,
  options: { body?: unknown; rawBody?: string; requestId?: string; retry: boolean },
  fetchImpl: typeof fetch = fetch,
): Promise<T> {
  const { token, baseUrl } = await getAccessToken(fetchImpl);
  try {
    return await send<T>(method, path, options, token, baseUrl, fetchImpl);
  } catch (error) {
    if (!(error instanceof PaypalApiError && error.status === 401)) throw error;
    // PayPal rejected the token before processing the request, so one attempt
    // with a fresh token is safe, including for a capture.
    if (cachedToken?.value === token) cachedToken = undefined;
    const fresh = await getAccessToken(fetchImpl);
    return send<T>(method, path, options, fresh.token, fresh.baseUrl, fetchImpl);
  }
}

function send<T>(
  method: "GET" | "POST",
  path: string,
  options: { body?: unknown; rawBody?: string; requestId?: string; retry: boolean },
  token: string,
  baseUrl: string,
  fetchImpl: typeof fetch,
): Promise<T> {
  return withRetry(options.retry, async () => {
    const response = await fetchImpl(`${baseUrl}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        prefer: "return=representation",
        ...(options.requestId ? { "paypal-request-id": options.requestId } : {}),
      },
      body: options.rawBody ?? (options.body === undefined ? undefined : JSON.stringify(options.body)),
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      throw new PaypalApiError(response.status, body);
    }
    if (!isRecord(body)) {
      throw new PaypalApiError(
        502,
        { name: "INVALID_RESPONSE", message: "PayPal returned an invalid response" },
        { retryable: false },
      );
    }
    return body as T;
  });
}

export type CreateOrderInput = {
  requestId: string; // PayPal-Request-Id: retries with the same id return the same order
  proposalId: string;
  paymentId: string;
  description: string;
  amount: PaypalAmount;
};

export function createOrder(input: CreateOrderInput, fetchImpl?: typeof fetch) {
  return request<PaypalOrder>(
    "POST",
    "/v2/checkout/orders",
    {
      requestId: input.requestId,
      // Same PayPal-Request-Id on every attempt: a retry returns the same order.
      retry: true,
      body: {
        intent: "CAPTURE",
        purchase_units: [
          {
            reference_id: input.proposalId,
            custom_id: input.paymentId,
            // Unique per merchant account: PayPal rejects a second payment for the same invoice.
            invoice_id: input.paymentId,
            description: input.description.slice(0, 127),
            amount: input.amount,
          },
        ],
      },
    },
    fetchImpl,
  );
}

// Never retried automatically: after a lost response the caller re-reads the
// order instead of sending the capture again.
export function captureOrder(orderId: string, requestId: string, fetchImpl?: typeof fetch) {
  return request<PaypalOrder>(
    "POST",
    `/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`,
    { requestId, body: {}, retry: false },
    fetchImpl,
  );
}

export function getOrder(orderId: string, fetchImpl?: typeof fetch) {
  return request<PaypalOrder>("GET", `/v2/checkout/orders/${encodeURIComponent(orderId)}`, { retry: true }, fetchImpl);
}

// PayPal amounts are strings with exactly 2 decimals for the supported currencies.
export function formatAmount(cents: number) {
  if (!Number.isSafeInteger(cents) || cents < 0) {
    throw new RangeError("PayPal amount must be a non-negative safe integer in cents");
  }
  return `${Math.trunc(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

export type WebhookSignature = {
  authAlgo: string;
  certUrl: string;
  transmissionId: string;
  transmissionSig: string;
  transmissionTime: string;
  webhookId: string;
};

// PayPal requires webhook_event to be posted back exactly as received, so the
// raw text is embedded rather than parsed and re-serialized.
export async function verifyWebhookSignature(signature: WebhookSignature, rawEvent: string, fetchImpl?: typeof fetch) {
  const fields = JSON.stringify({
    auth_algo: signature.authAlgo,
    cert_url: signature.certUrl,
    transmission_id: signature.transmissionId,
    transmission_sig: signature.transmissionSig,
    transmission_time: signature.transmissionTime,
    webhook_id: signature.webhookId,
  });
  const result = await request<{ verification_status?: string }>(
    "POST",
    "/v1/notifications/verify-webhook-signature",
    { rawBody: `${fields.slice(0, -1)},"webhook_event":${rawEvent}}`, retry: true },
    fetchImpl,
  );
  return result.verification_status === "SUCCESS";
}

import "server-only";

// Minimal PayPal REST client for Orders v2 (developer.paypal.com/docs/api/orders/v2/).
// Credentials stay on the server; the browser only ever sees order ids.

const BASE_URLS = {
  sandbox: "https://api-m.sandbox.paypal.com",
  live: "https://api-m.paypal.com",
} as const;

export type PaypalEnvironment = keyof typeof BASE_URLS;

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
  payer?: { payer_id?: string; email_address?: string };
  links?: Array<{ href: string; rel: string; method?: string }>;
};

export class PaypalApiError extends Error {
  readonly status: number;
  readonly issue: string | undefined; // e.g. ORDER_NOT_APPROVED, ORDER_ALREADY_CAPTURED
  readonly debugId: string | undefined;

  constructor(status: number, body: { name?: string; message?: string; debug_id?: string; details?: { issue?: string }[] }) {
    super(`PayPal API ${status}: ${body.name ?? "error"}${body.message ? ` - ${body.message}` : ""}`);
    this.name = "PaypalApiError";
    this.status = status;
    this.issue = body.details?.[0]?.issue ?? body.name;
    this.debugId = body.debug_id;
  }
}

export function getPaypalConfig() {
  const environment = (process.env.PAYPAL_ENVIRONMENT ?? "sandbox") as PaypalEnvironment;
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;

  if (!(environment in BASE_URLS)) {
    throw new Error('PAYPAL_ENVIRONMENT must be "sandbox" or "live"');
  }
  if (!clientId || !clientSecret) {
    throw new Error("PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET must be set");
  }
  return { environment, baseUrl: BASE_URLS[environment], clientId, clientSecret };
}

let cachedToken: { value: string; expiresAt: number; key: string } | undefined;

async function getAccessToken(fetchImpl: typeof fetch) {
  const config = getPaypalConfig();
  const key = `${config.environment}:${config.clientId}`;
  if (cachedToken && cachedToken.key === key && cachedToken.expiresAt > Date.now()) {
    return { token: cachedToken.value, baseUrl: config.baseUrl };
  }

  const response = await fetchImpl(`${config.baseUrl}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64")}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
    cache: "no-store",
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || typeof body.access_token !== "string") {
    throw new PaypalApiError(response.status, body);
  }

  // Refresh a minute early.
  cachedToken = { value: body.access_token, expiresAt: Date.now() + (Number(body.expires_in) - 60) * 1000, key };
  return { token: body.access_token as string, baseUrl: config.baseUrl };
}

export function resetPaypalTokenCache() {
  cachedToken = undefined;
}

async function request<T>(
  method: "GET" | "POST",
  path: string,
  options: { body?: unknown; requestId?: string } = {},
  fetchImpl: typeof fetch = fetch,
): Promise<T> {
  const { token, baseUrl } = await getAccessToken(fetchImpl);
  const response = await fetchImpl(`${baseUrl}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      prefer: "return=representation",
      ...(options.requestId ? { "paypal-request-id": options.requestId } : {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    cache: "no-store",
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new PaypalApiError(response.status, body);
  }
  return body as T;
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

export function captureOrder(orderId: string, requestId: string, fetchImpl?: typeof fetch) {
  return request<PaypalOrder>("POST", `/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, { requestId, body: {} }, fetchImpl);
}

export function getOrder(orderId: string, fetchImpl?: typeof fetch) {
  return request<PaypalOrder>("GET", `/v2/checkout/orders/${encodeURIComponent(orderId)}`, {}, fetchImpl);
}

// PayPal amounts are strings with exactly 2 decimals for the supported currencies.
export function formatAmount(cents: number) {
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

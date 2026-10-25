import type { PaypalAmount, PaypalCapture, PaypalOrder } from "@/lib/paypal/client";

// Decides whether a PayPal order (as returned by GET /v2/checkout/orders/:id)
// really pays for the expected proposal. Pure so it can be tested exhaustively.

export type ExpectedPayment = {
  orderId: string;
  proposalId: string;
  paymentId: string;
  amountCents: number;
  currency: string;
};

export type VerificationResult =
  | { kind: "completed"; capture: PaypalCapture; payerId: string | null; payerEmail: string | null }
  | { kind: "pending"; capture: PaypalCapture | null }
  | { kind: "declined"; capture: PaypalCapture }
  | { kind: "mismatch"; reason: string };

// "123.45" -> 12345. Returns null for anything that is not a plain 0-2 decimal amount.
export function parseAmountCents(value: string | undefined): number | null {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value ?? "");
  if (!match) return null;
  return Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
}

function sameAmount(amount: PaypalAmount | undefined, expected: ExpectedPayment) {
  return amount?.currency_code === expected.currency && parseAmountCents(amount.value) === expected.amountCents;
}

export function verifyPaypalOrder(order: PaypalOrder, expected: ExpectedPayment): VerificationResult {
  if (order.id !== expected.orderId) return { kind: "mismatch", reason: "order id" };
  if (order.intent !== "CAPTURE") return { kind: "mismatch", reason: "intent" };

  const units = order.purchase_units ?? [];
  if (units.length !== 1) return { kind: "mismatch", reason: "purchase unit count" };
  const [unit] = units;
  if (unit.reference_id !== expected.proposalId) return { kind: "mismatch", reason: "reference_id" };
  if (unit.custom_id !== expected.paymentId) return { kind: "mismatch", reason: "custom_id" };
  if (!sameAmount(unit.amount, expected)) return { kind: "mismatch", reason: "order amount" };

  const captures = unit.payments?.captures ?? [];
  if (captures.length > 1) return { kind: "mismatch", reason: "multiple captures" };
  const capture = captures[0] ?? null;

  if (capture && !sameAmount(capture.amount, expected)) return { kind: "mismatch", reason: "capture amount" };

  if (order.status === "COMPLETED" && capture?.status === "COMPLETED") {
    return {
      kind: "completed",
      capture,
      payerId: order.payer?.payer_id ?? null,
      payerEmail: order.payer?.email_address ?? null,
    };
  }
  if (capture && ["DECLINED", "FAILED"].includes(capture.status)) {
    return { kind: "declined", capture };
  }
  // Captured but not settled yet (e.g. PENDING), or not captured at all.
  return { kind: "pending", capture };
}

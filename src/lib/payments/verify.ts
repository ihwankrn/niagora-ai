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
  | { kind: "unexpected"; capture: PaypalCapture | null; reason: string }
  | { kind: "mismatch"; reason: string };

// PayPal statuses we know how to classify. Anything else must never be treated
// as a completed payment; it is surfaced for explicit reconciliation instead.
const KNOWN_CAPTURE_STATUSES = new Set(["COMPLETED", "PENDING", "DECLINED", "FAILED", "REFUNDED", "PARTIALLY_REFUNDED"]);

// Order statuses documented by Orders v2. An unrecognised order status is a
// provider contract surprise, never "pending": it must be reconciled by a human.
const KNOWN_ORDER_STATUSES = new Set(["CREATED", "SAVED", "APPROVED", "PAYER_ACTION_REQUIRED", "COMPLETED", "VOIDED", "EXPIRED"]);
// PayPal will never capture these orders, so they need explicit handling.
const UNPAYABLE_ORDER_STATUSES = new Set(["VOIDED", "EXPIRED"]);

// "123.45" -> 12345. Returns null for anything that is not a plain 0-2 decimal,
// safe-integer amount.
export function parseAmountCents(value: string | undefined): number | null {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value ?? "");
  if (!match) return null;

  const major = Number(match[1]);
  if (!Number.isSafeInteger(major)) return null;

  const minor = Number((match[2] ?? "").padEnd(2, "0"));
  const cents = major * 100 + minor;
  return Number.isSafeInteger(cents) ? cents : null;
}

function sameAmount(amount: PaypalAmount | undefined, expected: ExpectedPayment) {
  return amount?.currency_code === expected.currency && parseAmountCents(amount.value) === expected.amountCents;
}

export function verifyPaypalOrder(order: PaypalOrder, expected: ExpectedPayment): VerificationResult {
  if (!Number.isSafeInteger(expected.amountCents) || expected.amountCents <= 0) {
    return { kind: "mismatch", reason: "expected amount" };
  }
  if (order.id !== expected.orderId) return { kind: "mismatch", reason: "order id" };
  if (order.intent !== "CAPTURE") return { kind: "mismatch", reason: "intent" };

  // Validate the order status before comparing amounts: an unrecognised or
  // unpayable order must reach review even if some other field also looks wrong.
  const orderCapture = order.purchase_units?.[0]?.payments?.captures?.[0] ?? null;
  if (!KNOWN_ORDER_STATUSES.has(order.status)) {
    // PayPal added/changed a status we do not understand. Never guess that it
    // means "still pending": the payment might already be captured.
    return { kind: "unexpected", capture: orderCapture, reason: `unknown order status ${order.status}` };
  }
  if (UNPAYABLE_ORDER_STATUSES.has(order.status)) {
    // The order can no longer be paid. If a capture is nevertheless present it
    // must be inspected, never silently discarded.
    return { kind: "unexpected", capture: orderCapture, reason: `order status ${order.status}` };
  }

  const units = order.purchase_units ?? [];
  if (units.length !== 1) return { kind: "mismatch", reason: "purchase unit count" };
  const [unit] = units;
  if (unit.reference_id !== expected.proposalId) return { kind: "mismatch", reason: "reference_id" };
  if (unit.custom_id !== expected.paymentId) return { kind: "mismatch", reason: "custom_id" };
  if (!sameAmount(unit.amount, expected)) return { kind: "mismatch", reason: "order amount" };

  const captures = unit.payments?.captures ?? [];
  if (captures.length > 1) return { kind: "mismatch", reason: "multiple captures" };
  const capture = captures[0] ?? null;

  if (order.status === "COMPLETED" && !capture) {
    // PayPal says the order is complete but gives us nothing to reconcile
    // against. Never guess that this was a successful capture.
    return { kind: "unexpected", capture: null, reason: "completed order without capture" };
  }

  if (capture) {
    // Classify the capture status before the amount: money that already moved
    // (refunded) or a status we do not understand must never be downgraded to a
    // "failed" payment just because an amount looks wrong.
    if (["REFUNDED", "PARTIALLY_REFUNDED"].includes(capture.status)) {
      // The money moved and was (partly) returned. This needs a human decision,
      // not a "pending" response that could be retried forever.
      return { kind: "unexpected", capture, reason: `capture status ${capture.status}` };
    }
    if (!KNOWN_CAPTURE_STATUSES.has(capture.status)) {
      return { kind: "unexpected", capture, reason: `unknown capture status ${capture.status}` };
    }
    if (["DECLINED", "FAILED"].includes(capture.status)) {
      if (order.status === "COMPLETED") {
        // PayPal says the order is complete, so a declined/FAILED capture view
        // is contradictory. It is not proof that no money moved; reconcile it.
        return { kind: "unexpected", capture, reason: `completed order with ${capture.status} capture` };
      }
      // No money moved, so a mismatched amount does not need reconciliation.
      return { kind: "declined", capture };
    }

    if (!sameAmount(capture.amount, expected)) return { kind: "mismatch", reason: "capture amount" };
    if (capture.status === "PENDING") return { kind: "pending", capture };
    if (order.status !== "COMPLETED") {
      // The capture exists but the order view has not caught up yet. Treat it as
      // pending so a later GET can reconcile it, never as paid.
      return { kind: "pending", capture };
    }
    if (typeof capture.id !== "string" || capture.id.trim() === "") {
      return { kind: "mismatch", reason: "capture id" };
    }
    return {
      kind: "completed",
      capture,
      payerId: order.payer?.payer_id ?? null,
      payerEmail: order.payer?.email_address ?? null,
    };
  }

  // Captured but not settled yet, or not captured at all.
  return { kind: "pending", capture: null };
}

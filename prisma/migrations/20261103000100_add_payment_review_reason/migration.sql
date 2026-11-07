-- Human-readable reason for a payment in REVIEW. The verified PayPal order is
-- stored separately in provider_payload for forensic reconciliation.
ALTER TABLE "payments" ADD COLUMN "review_reason" TEXT;

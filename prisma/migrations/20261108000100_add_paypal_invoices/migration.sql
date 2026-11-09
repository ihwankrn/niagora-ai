-- PayPal invoices sent by the billing agent.
CREATE TYPE "InvoiceStatus" AS ENUM ('SENDING', 'SENT', 'PAID', 'CANCELLED', 'FAILED');

CREATE TABLE "paypal_invoices" (
    "id" UUID NOT NULL,
    "proposal_id" UUID NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'SENDING',
    "amount_cents" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "paypal_invoice_id" TEXT,
    "invoice_number" TEXT,
    "payer_view_url" TEXT,
    "paid_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "paypal_invoices_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "paypal_invoices_paypal_invoice_id_key" ON "paypal_invoices"("paypal_invoice_id");
CREATE INDEX "paypal_invoices_proposal_id_idx" ON "paypal_invoices"("proposal_id");

ALTER TABLE "paypal_invoices" ADD CONSTRAINT "paypal_invoices_proposal_id_fkey"
  FOREIGN KEY ("proposal_id") REFERENCES "proposals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- At most one live invoice per proposal, so a client can never be billed twice.
CREATE UNIQUE INDEX "paypal_invoices_one_live_per_proposal"
  ON "paypal_invoices"("proposal_id")
  WHERE "status" IN ('SENDING', 'SENT', 'PAID');

-- Same row-level security posture as the other tables: no direct client access.
ALTER TABLE "paypal_invoices" ENABLE ROW LEVEL SECURITY;

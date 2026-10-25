-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "ServiceType" AS ENUM ('WEB_DEVELOPMENT', 'GRAPHIC_DESIGN', 'CONTENT_WRITING');

-- CreateEnum
CREATE TYPE "BriefStatus" AS ENUM ('DRAFT', 'ANALYZED', 'FAILED');

-- CreateEnum
CREATE TYPE "ProposalStatus" AS ENUM ('DRAFT', 'SENT', 'APPROVED', 'REJECTED', 'PAID', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PaymentProvider" AS ENUM ('PAYPAL');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('CREATED', 'APPROVED', 'COMPLETED', 'FAILED', 'VOIDED');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "display_name" TEXT,
    "default_hourly_rate_cents" INTEGER,
    "default_currency" CHAR(3) NOT NULL DEFAULT 'USD',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "briefs" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "service_type" "ServiceType" NOT NULL,
    "raw_text" TEXT NOT NULL,
    "status" "BriefStatus" NOT NULL DEFAULT 'DRAFT',
    "analysis" JSONB,
    "ai_model" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "briefs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "proposals" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "brief_id" UUID,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "client_name" TEXT,
    "client_email" TEXT,
    "currency" CHAR(3) NOT NULL DEFAULT 'USD',
    "hourly_rate_cents" INTEGER NOT NULL,
    "subtotal_cents" INTEGER NOT NULL,
    "total_cents" INTEGER NOT NULL,
    "status" "ProposalStatus" NOT NULL DEFAULT 'DRAFT',
    "share_token" TEXT NOT NULL,
    "approved_at" TIMESTAMPTZ(3),
    "paid_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "proposals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "proposal_items" (
    "id" UUID NOT NULL,
    "proposal_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "estimated_hours" DECIMAL(7,2) NOT NULL,
    "hourly_rate_cents" INTEGER NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "proposal_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "proposal_id" UUID NOT NULL,
    "provider" "PaymentProvider" NOT NULL DEFAULT 'PAYPAL',
    "status" "PaymentStatus" NOT NULL DEFAULT 'CREATED',
    "amount_cents" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "paypal_order_id" TEXT NOT NULL,
    "paypal_capture_id" TEXT,
    "request_id" TEXT NOT NULL,
    "payer_id" TEXT,
    "payer_email" TEXT,
    "provider_payload" JSONB,
    "verified_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "briefs_user_id_created_at_idx" ON "briefs"("user_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "proposals_share_token_key" ON "proposals"("share_token");

-- CreateIndex
CREATE INDEX "proposals_user_id_created_at_idx" ON "proposals"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "proposals_brief_id_idx" ON "proposals"("brief_id");

-- CreateIndex
CREATE UNIQUE INDEX "proposal_items_proposal_id_position_key" ON "proposal_items"("proposal_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "payments_paypal_order_id_key" ON "payments"("paypal_order_id");

-- CreateIndex
CREATE UNIQUE INDEX "payments_paypal_capture_id_key" ON "payments"("paypal_capture_id");

-- CreateIndex
CREATE UNIQUE INDEX "payments_request_id_key" ON "payments"("request_id");

-- CreateIndex
CREATE INDEX "payments_proposal_id_idx" ON "payments"("proposal_id");

-- AddForeignKey
ALTER TABLE "briefs" ADD CONSTRAINT "briefs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_brief_id_fkey" FOREIGN KEY ("brief_id") REFERENCES "briefs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proposal_items" ADD CONSTRAINT "proposal_items_proposal_id_fkey" FOREIGN KEY ("proposal_id") REFERENCES "proposals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_proposal_id_fkey" FOREIGN KEY ("proposal_id") REFERENCES "proposals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Hand-written additions (not expressible in schema.prisma)
-- ---------------------------------------------------------------------------

-- Money and hours must never be negative.
ALTER TABLE "users" ADD CONSTRAINT "users_default_hourly_rate_cents_check" CHECK ("default_hourly_rate_cents" IS NULL OR "default_hourly_rate_cents" >= 0);
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_money_check" CHECK ("hourly_rate_cents" >= 0 AND "subtotal_cents" >= 0 AND "total_cents" >= 0);
ALTER TABLE "proposal_items" ADD CONSTRAINT "proposal_items_values_check" CHECK ("estimated_hours" >= 0 AND "hourly_rate_cents" >= 0 AND "amount_cents" >= 0);
ALTER TABLE "payments" ADD CONSTRAINT "payments_amount_cents_check" CHECK ("amount_cents" > 0);

-- At most one completed payment per proposal (guards against double capture).
CREATE UNIQUE INDEX "payments_one_completed_per_proposal" ON "payments"("proposal_id") WHERE "status" = 'COMPLETED';

-- Supabase exposes the public schema through the Data API (PostgREST) to the
-- anon/authenticated roles. All access goes through the Next.js server via
-- Prisma, so enable RLS with no policies: Data API access is denied, while
-- the table owner used by Prisma is unaffected.
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "briefs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "proposals" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "proposal_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payments" ENABLE ROW LEVEL SECURITY;

-- Prisma's own bookkeeping table also lives in public; hide it from the Data API.
DO $$
BEGIN
  IF to_regclass('public._prisma_migrations') IS NOT NULL THEN
    ALTER TABLE "public"."_prisma_migrations" ENABLE ROW LEVEL SECURITY;
  END IF;
END $$;

-- Explicit reconciliation state for captures that PayPal completed but the
-- application could not safely apply to the local proposal.
--
-- Kept in its own migration: PostgreSQL enum values must be committed before a
-- later migration can reference them (for example in an index predicate).
ALTER TYPE "PaymentStatus" ADD VALUE IF NOT EXISTS 'REVIEW';

-- A payment awaiting reconciliation must also block a second order for the same
-- proposal, otherwise a captured-but-unrecorded payment could be charged twice.
--
-- This migration runs only after the REVIEW enum value has been committed by
-- 20261103000000_add_payment_review_status.
--
-- Operational note: apply the migrations before deploying application code that
-- can write REVIEW. This predicate is the database backstop that prevents a
-- REVIEW payment from being joined by a second open order. If duplicate open
-- rows somehow exist, CREATE UNIQUE INDEX fails and must be reconciled manually
-- before retrying; the previous index already guaranteed uniqueness for
-- CREATED/APPROVED.
DROP INDEX IF EXISTS "payments_one_open_per_proposal";

CREATE UNIQUE INDEX "payments_one_open_per_proposal"
  ON "payments"("proposal_id")
  WHERE "status" IN ('CREATED', 'APPROVED', 'REVIEW');

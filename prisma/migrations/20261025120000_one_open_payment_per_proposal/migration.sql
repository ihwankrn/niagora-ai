-- At most one open PayPal order (created or approved, not yet captured) per
-- proposal. Concurrent checkout attempts reuse that order instead of creating
-- a second one that could also be paid.
CREATE UNIQUE INDEX "payments_one_open_per_proposal" ON "payments"("proposal_id") WHERE "status" IN ('CREATED', 'APPROVED');

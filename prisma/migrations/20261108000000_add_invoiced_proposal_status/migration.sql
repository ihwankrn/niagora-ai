-- Proposals billed by a sent PayPal invoice. Kept in its own migration so the
-- enum value is committed before anything references it.
ALTER TYPE "ProposalStatus" ADD VALUE IF NOT EXISTS 'INVOICED';

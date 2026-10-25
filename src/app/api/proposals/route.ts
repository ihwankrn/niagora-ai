import { ApiError, ok, parseJsonBody, toValidationIssues, withApiErrors } from "@/lib/api/http";
import { ensureUserRecord, requireUser } from "@/lib/auth/session";
import { createProposalRequestSchema, listProposalsQuerySchema } from "@/lib/contracts/proposals";
import { createProposal, listProposals } from "@/lib/proposals/service";

// GET /api/proposals?limit=20 — see docs/api.md
export const GET = withApiErrors(async (request: Request) => {
  const user = await requireUser();

  const query = listProposalsQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!query.success) {
    throw new ApiError("VALIDATION_ERROR", "Query parameters are invalid", toValidationIssues(query.error));
  }

  // Per-user data: never cache in shared caches.
  return ok(await listProposals(user, query.data), { headers: { "cache-control": "private, no-store" } });
});

// POST /api/proposals — see docs/api.md
export const POST = withApiErrors(async (request: Request) => {
  const user = await requireUser();
  const input = await parseJsonBody(request, createProposalRequestSchema);

  await ensureUserRecord(user);
  return ok(await createProposal(user, input), { status: 201 });
});

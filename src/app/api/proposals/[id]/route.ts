import { ApiError, ok, withApiErrors } from "@/lib/api/http";
import { requireUser } from "@/lib/auth/session";
import { uuidSchema } from "@/lib/contracts/common";
import { getProposalForUser } from "@/lib/proposals/service";

type Context = { params: Promise<{ id: string }> };

// GET /api/proposals/:id — see docs/api.md
export const GET = withApiErrors(async (_request: Request, context: Context) => {
  const user = await requireUser();
  const id = uuidSchema.safeParse((await context.params).id);
  if (!id.success) throw new ApiError("NOT_FOUND", "Proposal not found");

  // Per-user data: never cache in shared caches.
  return ok(await getProposalForUser(user, id.data), { headers: { "cache-control": "private, no-store" } });
});

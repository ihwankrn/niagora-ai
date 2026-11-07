import { ApiError, ok, withApiErrors } from "@/lib/api/http";
import { requireUser } from "@/lib/auth/session";
import { uuidSchema } from "@/lib/contracts/common";
import { sendProposal } from "@/lib/payments/service";

type Context = { params: Promise<{ id: string }> };

// POST /api/proposals/:id/send — see docs/api.md
export const POST = withApiErrors(async (_request: Request, context: Context) => {
  const user = await requireUser();
  const id = uuidSchema.safeParse((await context.params).id);
  if (!id.success) throw new ApiError("NOT_FOUND", "Proposal not found");

  return ok(await sendProposal(user, id.data));
});

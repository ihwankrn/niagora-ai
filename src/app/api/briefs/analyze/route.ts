import { ok, parseJsonBody, withApiErrors } from "@/lib/api/http";
import { ensureUserRecord, requireUser } from "@/lib/auth/session";
import { analyzeAndStoreBrief } from "@/lib/briefs/service";
import { analyzeBriefRequestSchema } from "@/lib/contracts/briefs";

// POST /api/briefs/analyze — see docs/api.md
export const POST = withApiErrors(async (request: Request) => {
  const user = await requireUser();
  const input = await parseJsonBody(request, analyzeBriefRequestSchema);

  await ensureUserRecord(user);
  return ok(await analyzeAndStoreBrief(user, input));
});

import { ok, parseJsonBody, withApiErrors } from "@/lib/api/http";
import { runBillingAgent } from "@/lib/ai/billing-agent";
import { requireUser } from "@/lib/auth/session";
import { billingAgentRequestSchema } from "@/lib/contracts/agent";

// The agent may make several model and PayPal calls in one turn.
export const maxDuration = 60;

// POST /api/agent/billing — see docs/api.md
export const POST = withApiErrors(async (request: Request) => {
  const user = await requireUser();
  const { messages } = await parseJsonBody(request, billingAgentRequestSchema);
  return ok(await runBillingAgent(user, messages));
});

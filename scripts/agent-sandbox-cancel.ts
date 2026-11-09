// Asks the billing agent to cancel the demo invoice (live PayPal Sandbox).
// Usage: npx tsx --conditions=react-server scripts/agent-sandbox-cancel.ts
import "dotenv/config";

import { runBillingAgent } from "@/lib/ai/billing-agent";
import { prisma } from "@/lib/db";

async function main() {
  const demo = await prisma.proposal.findFirst({
    where: { title: "Bakery website (agent demo)", status: "INVOICED" },
    orderBy: { createdAt: "desc" },
    select: { id: true, userId: true },
  });
  if (!demo) throw new Error("No invoiced demo proposal");
  const user = { id: demo.userId, email: "unused@example.invalid" };

  const result = await runBillingAgent(user, [
    { role: "user", content: "Cancel the PayPal invoice for the Bakery website (agent demo) proposal. Reason: test run." },
  ]);
  console.log(result.reply);
  for (const action of result.actions) console.log(`  [${action.tool}] ok=${action.ok} ${action.summary}`);
  const status = await prisma.proposal.findUnique({ where: { id: demo.id }, select: { status: true } });
  console.log("proposal status now:", status?.status);
  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error("cancel failed:", error instanceof Error ? `${error.name}: ${error.message}` : error);
  await prisma.$disconnect();
  process.exit(1);
});

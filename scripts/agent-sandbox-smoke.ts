// Live smoke test of the billing agent against PayPal Sandbox and Groq.
// Creates one approved demo proposal for the most recent user, then talks to
// the agent. Prints only the agent replies and action summaries.
// Usage: npx tsx --conditions=react-server scripts/agent-sandbox-smoke.ts
import "dotenv/config";

import { runBillingAgent } from "@/lib/ai/billing-agent";
import type { AgentMessage } from "@/lib/contracts/agent";
import { prisma } from "@/lib/db";
import { approveProposal, sendProposal } from "@/lib/payments/service";
import { createProposal } from "@/lib/proposals/service";

async function main() {
  const latest = await prisma.proposal.findFirst({ orderBy: { createdAt: "desc" }, select: { userId: true } });
  if (!latest) throw new Error("No proposals yet");
  const user = { id: latest.userId, email: "unused@example.invalid" };

  const proposal = await createProposal(user, {
    title: "Bakery website (agent demo)",
    clientName: "Demo Bakery",
    clientEmail: "client@example.com",
    currency: "USD",
    hourlyRateCents: 4_000,
    items: [
      { title: "Landing page", description: "Hero, menu highlights, opening hours", estimatedHours: 6 },
      { title: "Online order form", description: "Form with email notification", estimatedHours: 4.5 },
    ],
  });
  const sent = await sendProposal(user, proposal.id);
  const token = new URL(sent.shareUrl).pathname.split("/").at(-1)!;
  await approveProposal(token);
  console.log("demo proposal approved, total", proposal.totalCents, proposal.currency);

  const conversation: AgentMessage[] = [];
  for (const ask of [
    "Send a PayPal invoice for the Bakery website (agent demo) proposal.",
    "Has the bakery invoice been paid yet?",
    "Send them a friendly payment reminder.",
  ]) {
    conversation.push({ role: "user", content: ask });
    const result = await runBillingAgent(user, conversation);
    console.log(`\n> ${ask}\n${result.reply}`);
    for (const action of result.actions) console.log(`  [${action.tool}] ok=${action.ok} ${action.summary}`);
    conversation.push({ role: "assistant", content: result.reply });
  }

  const status = await prisma.proposal.findUnique({ where: { id: proposal.id }, select: { status: true } });
  console.log("\nproposal status now:", status?.status);
  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error("smoke test failed:", error instanceof Error ? `${error.name}: ${error.message}` : error);
  await prisma.$disconnect();
  process.exit(1);
});

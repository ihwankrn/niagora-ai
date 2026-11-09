import { uuidSchema } from "@/lib/contracts/common";
import { prisma } from "@/lib/db";

// Smoke scripts act on one explicit account. They never guess, so test data
// cannot land in someone else's workspace.
export async function requireSmokeUser() {
  const id = uuidSchema.safeParse(process.env.SMOKE_USER_ID?.trim());
  if (!id.success) throw new Error("Set SMOKE_USER_ID to your users.id (a UUID).");
  const user = await prisma.user.findUnique({ where: { id: id.data }, select: { id: true } });
  if (!user) throw new Error("SMOKE_USER_ID does not match any user.");
  return { id: user.id, email: "unused@example.invalid" };
}

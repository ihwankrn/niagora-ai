import { ApiError } from "@/lib/api/http";
import { shareTokenSchema } from "@/lib/contracts/payments";

export type TokenContext = { params: Promise<{ token: string }> };

// Malformed tokens get the same 404 as unknown ones.
export async function readShareToken(context: TokenContext) {
  const token = shareTokenSchema.safeParse((await context.params).token);
  if (!token.success) throw new ApiError("NOT_FOUND", "Proposal not found");
  return token.data;
}

// Responses for one client link must never be stored by shared caches.
export const PRIVATE = { headers: { "cache-control": "private, no-store" } };

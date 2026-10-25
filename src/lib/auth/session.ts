import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { ApiError } from "@/lib/api/http";
import { prisma } from "@/lib/db";

export type AuthUser = {
  id: string; // Supabase Auth user id (JWT "sub"), equals users.id
  email: string;
};

export async function createSupabaseServerClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !publishableKey) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY must be set");
  }

  const cookieStore = await cookies();
  return createServerClient(url, publishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Components cannot write cookies; the session is refreshed elsewhere.
        }
      },
    },
  });
}

// Resolves the signed-in user from the verified Supabase session.
// Identity always comes from the JWT (getClaims verifies it), never from the
// request body. getSession() must not be used here: it does not verify.
export async function requireUser(): Promise<AuthUser> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getClaims();
  const claims = data?.claims;

  if (error || !claims?.sub || claims.is_anonymous || !claims.email) {
    throw new ApiError("UNAUTHORIZED", "Sign in to continue");
  }
  return { id: claims.sub, email: claims.email };
}

// Keeps a users row for every authenticated Supabase user.
export async function ensureUserRecord(user: AuthUser) {
  await prisma.user.upsert({
    where: { id: user.id },
    create: { id: user.id, email: user.email },
    update: { email: user.email },
  });
}

import { NextResponse } from "next/server";

import { createSupabaseServerClient } from "@/lib/auth/session";

// GET /auth/callback?code=... — target of Supabase email links. Exchanging the
// code needs the verifier cookie set by the browser that signed up. The email is
// already confirmed by this point, so a failure only means signing in by hand.
export async function GET(request: Request) {
  const code = new URL(request.url).searchParams.get("code");
  if (code) {
    try {
      const supabase = await createSupabaseServerClient();
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (!error) return NextResponse.redirect(new URL("/", request.url));
    } catch {
      // Handled below: the user can still sign in with email and password.
    }
  }
  return NextResponse.redirect(new URL("/login?link=failed", request.url));
}

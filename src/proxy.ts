import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

// Refreshes the Supabase session before a page or route reads it, because Server
// Components cannot write cookies. getClaims verifies the token and refreshes it
// when needed. Access control stays in requireUser.
export async function proxy(request: NextRequest) {
  // Supabase email links return to the Site URL with ?code=... by default.
  if (request.nextUrl.pathname === "/" && request.nextUrl.searchParams.has("code")) {
    const callback = request.nextUrl.clone();
    callback.pathname = "/auth/callback";
    return NextResponse.redirect(callback);
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  let response = NextResponse.next({ request });
  if (!url || !publishableKey) return response;

  const supabase = createServerClient(url, publishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
        for (const [name, value] of Object.entries(headers ?? {})) response.headers.set(name, value);
      },
    },
  });
  await supabase.auth.getClaims();
  return response;
}

// Public client links and the PayPal webhook have no freelancer session to refresh.
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/public|api/paypal|proposals/view|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};

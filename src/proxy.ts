import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

// Pages a signed-out visitor may open. Everything else (the dashboard, New
// Proposal) sends them to /login instead of rendering an empty, failing page.
// API routes are left alone: they answer 401 themselves.
function isPublicPath(pathname: string) {
  return pathname === "/login" || pathname.startsWith("/auth/") || pathname.startsWith("/api/");
}

// Refreshes the Supabase session before a page or route reads it, because Server
// Components cannot write cookies. getClaims verifies the token and refreshes it
// when needed. Access control for data stays in requireUser; the redirect below
// is only a convenience for page visits.
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
  const { data } = await supabase.auth.getClaims();

  if (!data?.claims && !isPublicPath(request.nextUrl.pathname)) {
    const login = request.nextUrl.clone();
    login.pathname = "/login";
    login.search = "";
    const redirect = NextResponse.redirect(login);
    // Keep any cookie changes, e.g. Supabase clearing an expired session.
    for (const cookie of response.cookies.getAll()) redirect.cookies.set(cookie);
    const cacheControl = response.headers.get("cache-control");
    if (cacheControl) redirect.headers.set("cache-control", cacheControl);
    return redirect;
  }

  return response;
}

// Public client links and the PayPal webhook have no freelancer session to refresh.
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/public|api/paypal|proposals/view|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};

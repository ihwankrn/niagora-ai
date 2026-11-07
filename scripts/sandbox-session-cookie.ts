// Prints a Cookie header for a Supabase test user, for the curl/Postman steps in
// docs/paypal-sandbox-e2e.md. The output is a live session: never share or commit it.
// Usage: TEST_USER_EMAIL=... TEST_USER_PASSWORD=... npm run -s sandbox:cookie
import "dotenv/config";

import { createServerClient } from "@supabase/ssr";

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const email = process.env.TEST_USER_EMAIL;
  const password = process.env.TEST_USER_PASSWORD;

  if (!url || !publishableKey || !email || !password) {
    throw new Error("Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, TEST_USER_EMAIL and TEST_USER_PASSWORD.");
  }

  const cookies = new Map<string, string>();
  const supabase = createServerClient(url, publishableKey, {
    cookies: {
      getAll: () => [...cookies].map(([name, value]) => ({ name, value })),
      setAll: (items) => {
        for (const { name, value } of items) cookies.set(name, value);
      },
    },
  });

  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    throw new Error(`Sign-in failed: ${error.message}`);
  }

  // The session cookie is written just after sign-in resolves.
  for (let attempt = 0; attempt < 20 && cookies.size === 0; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  if (cookies.size === 0) {
    throw new Error("Sign-in succeeded but no session cookie was produced.");
  }

  console.log([...cookies].map(([name, value]) => `${name}=${value}`).join("; "));
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });

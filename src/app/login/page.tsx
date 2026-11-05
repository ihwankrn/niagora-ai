"use client";

import { createBrowserClient } from "@supabase/ssr";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";

type Mode = "sign-in" | "sign-up";

function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !publishableKey) throw new Error("Sign-in is not configured.");
  return createBrowserClient(url, publishableKey);
}

const fieldClass =
  "mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("sign-in");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const auth = createClient().auth;
      const result =
        mode === "sign-in"
          ? await auth.signInWithPassword({ email, password })
          : await auth.signUp({ email, password, options: { data: { full_name: fullName.trim() } } });
      if (result.error) {
        setError(result.error.message);
      } else if (result.data.session) {
        router.push("/");
        router.refresh();
      } else {
        setNotice("Check your email to confirm your account, then sign in.");
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not reach the sign-in service.");
    } finally {
      setBusy(false);
    }
  }

  const signingUp = mode === "sign-up";
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
      <form onSubmit={handleSubmit} className="w-full max-w-sm space-y-4 rounded-2xl border border-slate-200 bg-white p-6">
        <h1 className="text-lg font-bold text-slate-900">{signingUp ? "Create your account" : "Sign in to Niagora AI"}</h1>

        {signingUp && (
          <label className="block text-xs font-medium text-slate-600">
            Name shown to clients
            <input
              required
              value={fullName}
              onChange={(event) => setFullName(event.target.value)}
              autoComplete="name"
              maxLength={200}
              className={fieldClass}
            />
          </label>
        )}
        <label className="block text-xs font-medium text-slate-600">
          Email
          <input
            required
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="email"
            className={fieldClass}
          />
        </label>
        <label className="block text-xs font-medium text-slate-600">
          Password
          <input
            required
            type="password"
            minLength={signingUp ? 8 : undefined}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete={signingUp ? "new-password" : "current-password"}
            className={fieldClass}
          />
        </label>

        {error && (
          <p role="alert" className="text-xs text-rose-700">
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="text-xs text-emerald-700">
            {notice}
          </p>
        )}

        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
        >
          {busy ? "Please wait…" : signingUp ? "Create account" : "Sign in"}
        </button>
        <button
          type="button"
          onClick={() => {
            setMode(signingUp ? "sign-in" : "sign-up");
            setError(null);
            setNotice(null);
          }}
          className="w-full text-xs font-medium text-indigo-700 hover:underline"
        >
          {signingUp ? "Already have an account? Sign in" : "New here? Create an account"}
        </button>
      </form>
    </main>
  );
}

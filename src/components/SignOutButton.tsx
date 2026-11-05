"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { createSupabaseBrowserClient } from "@/lib/auth/browser-client";

export default function SignOutButton() {
  const router = useRouter();
  const [signedIn, setSignedIn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    // Only decides whether to show the button; the server still verifies access.
    createSupabaseBrowserClient()
      .auth.getSession()
      .then(({ data }) => setSignedIn(Boolean(data.session)))
      .catch(() => setSignedIn(false));
  }, []);

  if (!signedIn) return null;

  async function handleSignOut() {
    setBusy(true);
    setFailed(false);
    try {
      // Ends this browser's session only, not the user's other devices.
      const { error } = await createSupabaseBrowserClient().auth.signOut({ scope: "local" });
      if (error) throw error;
      router.push("/login");
      router.refresh();
    } catch {
      setFailed(true);
      setBusy(false);
    }
  }

  return (
    <div className="space-y-1">
      <button
        type="button"
        onClick={handleSignOut}
        disabled={busy}
        className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-100 disabled:opacity-60"
      >
        {busy ? "Signing out…" : "Sign out"}
      </button>
      {failed && (
        <p role="alert" className="text-[11px] text-rose-700">
          Could not sign out. Please try again.
        </p>
      )}
    </div>
  );
}

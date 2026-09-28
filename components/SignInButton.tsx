"use client";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export function SignInButton({ next = "/dashboard", label = "Sign in with X" }: { next?: string; label?: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      className="btn btn-primary"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await createClient().auth.signInWithOAuth({
          provider: "x",
          options: { redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}` },
        });
      }}
    >
      <XLogo /> {busy ? "Opening X…" : label}
    </button>
  );
}

export function XLogo() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden fill="currentColor">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

export function SignOutButton() {
  return (
    <button
      className="btn btn-ghost"
      onClick={async () => {
        await createClient().auth.signOut();
        window.location.href = "/";
      }}
    >
      Sign out
    </button>
  );
}

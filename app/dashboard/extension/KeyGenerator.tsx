"use client";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export function KeyGenerator({ hasKey }: { hasKey: boolean }) {
  const [key, setKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function generate() {
    if (hasKey && !key && !confirm("This replaces your current key — the extension will need the new one. Continue?")) return;
    setBusy(true);
    setErr(null);
    const { data, error } = await createClient().rpc("rotate_ingest_token");
    setBusy(false);
    if (error) return setErr(error.message);
    setKey(data as string);
    setCopied(false);
  }

  return (
    <div className="space-y-3">
      {key ? (
        <>
          <div className="flex gap-2">
            <input readOnly value={key} className="input font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
            <button
              className="btn btn-primary"
              onClick={async () => {
                await navigator.clipboard.writeText(key);
                setCopied(true);
              }}
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <p className="text-xs" style={{ color: "var(--accent)" }}>
            Copy it now — we only show it once. Paste it into the extension popup.
          </p>
        </>
      ) : (
        <button className="btn btn-primary" onClick={generate} disabled={busy}>
          {busy ? "Generating…" : hasKey ? "Generate a new key" : "Generate my key"}
        </button>
      )}
      {hasKey && !key && <p className="text-xs muted">You already have a key set up. Lost it? Generate a new one.</p>}
      {err && <p className="text-sm" style={{ color: "var(--hot)" }}>{err}</p>}
    </div>
  );
}

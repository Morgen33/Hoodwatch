"use client";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

const RX = {
  ethereum: /^0x[0-9a-fA-F]{40}$/,
  solana: /^[1-9A-HJ-NP-Za-km-z]{32,44}$/,
};

export function ClaimForm({
  slug, handle, reactions, chain, existing, existingChain,
}: { slug: string; handle: string; reactions: number; chain: "solana" | "ethereum" | "any"; existing: string | null; existingChain: string | null }) {
  const [wallet, setWallet] = useState(existing ?? "");
  const [pick, setPick] = useState<"solana" | "ethereum">(
    chain !== "any" ? chain : (existingChain as "solana" | "ethereum") ?? "solana",
  );
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(existing);
  const [err, setErr] = useState<string | null>(null);

  const guess = RX.ethereum.test(wallet.trim()) ? "ethereum" : RX.solana.test(wallet.trim()) ? "solana" : null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const w = wallet.trim();
    const c = chain === "any" ? (guess ?? pick) : chain;
    if (!RX[c].test(w)) return setErr(`That's not a valid ${c === "ethereum" ? "Ethereum" : "Solana"} address.`);
    setBusy(true);
    setErr(null);
    const { error } = await createClient().rpc("submit_claim", { p_slug: slug, p_wallet: w, p_chain: c });
    setBusy(false);
    if (error) return setErr(error.message);
    setSaved(w);
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="rounded-xl p-3 text-sm" style={{ background: "var(--panel-2)" }}>
        ✅ <b>@{handle}</b> — {reactions} reactions logged. You&apos;re eligible.
      </div>

      {chain === "any" && (
        <div className="flex gap-2">
          {(["solana", "ethereum"] as const).map((c) => (
            <button type="button" key={c} onClick={() => setPick(c)}
              className={`btn flex-1 justify-center ${(guess ?? pick) === c ? "btn-primary" : "btn-ghost"}`}>
              {c === "solana" ? "Solana" : "Ethereum"}
            </button>
          ))}
        </div>
      )}

      <label className="space-y-1 block">
        <span className="label">Your wallet address</span>
        <input className="input font-mono text-sm" value={wallet} onChange={(e) => { setWallet(e.target.value); setSaved(null); }}
          placeholder={(chain === "any" ? (guess ?? pick) : chain) === "ethereum" ? "0x…" : "Solana address"} spellCheck={false} autoComplete="off" />
      </label>
      <p className="text-xs muted">Public address only. Never share a seed phrase or private key — nobody legit will ever ask for it.</p>

      <button className="btn btn-primary w-full justify-center" disabled={busy || !wallet.trim()}>
        {busy ? "Saving…" : existing ? "Update wallet" : "Submit wallet"}
      </button>
      {saved && !err && <p className="text-sm" style={{ color: "var(--accent)" }}>You&apos;re on the list with {saved.slice(0, 6)}…{saved.slice(-4)} 🎉</p>}
      {err && <p className="text-sm" style={{ color: "var(--hot)" }}>{err}</p>}
    </form>
  );
}

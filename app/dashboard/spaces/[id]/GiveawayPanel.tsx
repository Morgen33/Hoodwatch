"use client";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Giveaway } from "@/lib/types";
import { fmtTime } from "@/lib/format";

export function GiveawayPanel({ spaceId, emojis, initial }: { spaceId: string; emojis: string[]; initial: Giveaway[] }) {
  const [emoji, setEmoji] = useState("");
  const [min, setMin] = useState(1);
  const [exclude, setExclude] = useState(true);
  const [busy, setBusy] = useState(false);
  const [rolling, setRolling] = useState<string | null>(null);
  const [draws, setDraws] = useState<Giveaway[]>(initial);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  async function draw() {
    setBusy(true);
    setErr(null);
    const { data, error } = await createClient().rpc("draw_giveaway", {
      p_space: spaceId, p_emoji: emoji || null, p_min: min, p_exclude_winners: exclude,
    });
    if (error) {
      setBusy(false);
      return setErr(error.message.includes("no eligible") ? "Nobody qualifies with those settings yet." : error.message);
    }
    const g = data as Giveaway;
    // a short shuffle through real entrants for the room — the winner was already fixed server-side
    const pool = g.entrants;
    for (let i = 0; i < 18; i++) {
      setRolling(pool[Math.floor(Math.random() * pool.length)]);
      await new Promise((r) => setTimeout(r, 40 + i * 9));
    }
    setRolling(null);
    setDraws((d) => [g, ...d]);
    setOpen(g.id);
    setBusy(false);
  }

  const latest = draws[0];

  return (
    <div className="card space-y-4 h-fit">
      <div className="font-bold">Giveaway</div>

      <div className="grid grid-cols-2 gap-3">
        <label className="space-y-1">
          <span className="label">Emoji to enter</span>
          <select className="input" value={emoji} onChange={(e) => setEmoji(e.target.value)}>
            <option value="">Any reaction</option>
            {emojis.map((e) => <option key={e} value={e}>{e}</option>)}
          </select>
        </label>
        <label className="space-y-1">
          <span className="label">Min reactions</span>
          <input className="input" type="number" min={1} value={min} onChange={(e) => setMin(Math.max(1, +e.target.value || 1))} />
        </label>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={exclude} onChange={(e) => setExclude(e.target.checked)} />
        Skip people who already won in this Space
      </label>

      <button className="btn btn-primary w-full justify-center" onClick={draw} disabled={busy}>
        {busy ? "Drawing…" : "🎲 Draw a winner"}
      </button>
      {err && <p className="text-sm" style={{ color: "var(--hot)" }}>{err}</p>}

      {(rolling || latest) && (
        <div className="rounded-xl p-4 text-center" style={{ background: "var(--panel-2)" }}>
          <div className="label">{rolling ? "Rolling…" : "Winner"}</div>
          <div className="text-2xl font-black mt-1" style={{ color: rolling ? "var(--muted)" : "var(--accent)" }}>
            @{rolling ?? latest!.winner_username}
          </div>
          {!rolling && (
            <a className="text-xs link" href={`https://x.com/${latest!.winner_username}`} target="_blank" rel="noreferrer">view profile</a>
          )}
        </div>
      )}

      {draws.length > 0 && (
        <div className="space-y-2">
          <div className="label">Draw history</div>
          {draws.map((g) => (
            <div key={g.id} className="text-sm rounded-lg p-2" style={{ background: "var(--panel-2)" }}>
              <button className="w-full flex justify-between text-left" onClick={() => setOpen(open === g.id ? null : g.id)}>
                <span><b>@{g.winner_username}</b> <span className="muted">· {g.emoji_filter ?? "any"} · {g.entrants.length} entrants</span></span>
                <span className="muted">{fmtTime(g.drawn_at)}</span>
              </button>
              {open === g.id && (
                <div className="mt-2 text-xs muted space-y-1 break-all">
                  <div><b>Seed:</b> <code>{g.seed}</code></div>
                  <div>
                    <b>Verify:</b> sha256(<code>seed + &quot;:&quot; + entrants joined by &quot;,&quot;</code>), take the first 12 hex chars as a
                    number, mod {g.entrants.length} → index into the sorted entrant list.
                  </div>
                  <details>
                    <summary className="cursor-pointer">Entrants ({g.entrants.length})</summary>
                    <div className="mt-1">{g.entrants.join(", ")}</div>
                  </details>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

"use client";
import { useMemo, useState } from "react";

type Row = { username: string; display_name: string | null; total: number; emojis: Record<string, number> };

const nf = new Intl.NumberFormat("en-US");

export function PublicLeaderboard({ rows }: { rows: Row[] }) {
  const [q, setQ] = useState("");
  const [showAll, setShowAll] = useState(false);

  // rank is fixed by the full list, so searching doesn't renumber people
  const ranked = useMemo(() => rows.map((r, i) => ({ ...r, rank: i + 1 })), [rows]);
  const filtered = q.trim()
    ? ranked.filter((r) => (r.username + " " + (r.display_name ?? "")).toLowerCase().includes(q.trim().toLowerCase().replace(/^@/, "")))
    : ranked;
  const visible = showAll || q ? filtered : filtered.slice(0, 50);

  return (
    <section className="card p-0">
      <div className="flex flex-wrap items-center gap-3 px-4 pt-4 pb-3">
        <div className="font-bold">Leaderboard</div>
        <input
          className="input ml-auto max-w-[220px]"
          placeholder="Find your @handle"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Search leaderboard"
        />
      </div>
      {!rows.length && <p className="px-4 pb-4 text-sm muted">No reactions yet.</p>}
      <ol>
        {visible.map((u) => (
          <li key={u.username} className="flex flex-wrap items-baseline gap-x-2 gap-y-1 px-4 py-2.5 border-t" style={{ borderColor: "var(--line)" }}>
            <span className="muted tabular-nums w-8 shrink-0">#{u.rank}</span>
            <a className="min-w-0 truncate hover:underline" href={`https://x.com/${u.username}`} target="_blank" rel="noreferrer">
              <span className="font-semibold">{u.display_name || u.username}</span>{" "}
              <span className="muted text-sm">@{u.username}</span>
            </a>
            <span className="ml-auto flex flex-wrap items-baseline justify-end gap-x-2.5 gap-y-1">
              <span className="font-extrabold tabular-nums">{nf.format(u.total)}</span>
              {Object.entries(u.emojis).sort((a, b) => b[1] - a[1]).map(([e, n]) => (
                <span key={e} className="whitespace-nowrap">
                  {e}<span className="text-xs muted ml-0.5 tabular-nums">{nf.format(n)}</span>
                </span>
              ))}
            </span>
          </li>
        ))}
      </ol>
      {!q && !showAll && filtered.length > 50 && (
        <button className="btn btn-ghost w-full justify-center rounded-t-none border-x-0 border-b-0" onClick={() => setShowAll(true)}>
          Show all {nf.format(filtered.length)}
        </button>
      )}
      {q && !filtered.length && <p className="px-4 py-3 text-sm muted border-t" style={{ borderColor: "var(--line)" }}>No one matching “{q}”.</p>}
    </section>
  );
}

import { fmtNum } from "@/lib/format";

type Person = { handle: string; name?: string | null; avatar?: string | null };
export type Analytics = {
  started_at: string;
  ended_at: string | null;
  duration_min: number;
  reactions_per_min: number;
  engagement_rate: number | null;
  avg_per_reactor: number | null;
  peak_minute: { at: string; n: number } | null;
  returning_reactors: number;
  new_reactors: number;
  top10_share: number | null;
  cohosts: Person[];
  speakers: Person[];
  total_live_listeners: number | null;
  total_replay_watched: number | null;
  replay_available: boolean | null;
  host: { handle: string | null; name: string | null; avatar: string | null };
};

const dur = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`);
const time = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

function Avatar({ p, size = 28 }: { p: Person; size?: number }) {
  return p.avatar ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={p.avatar} alt="" width={size} height={size} className="rounded-full shrink-0" />
  ) : (
    <span className="rounded-full shrink-0 inline-flex items-center justify-center text-xs font-bold"
      style={{ width: size, height: size, background: "var(--panel-2)", color: "var(--muted)" }}>
      {p.handle.slice(0, 1).toUpperCase()}
    </span>
  );
}

function PersonChip({ p, role }: { p: Person; role?: string }) {
  return (
    <a href={`https://x.com/${p.handle}`} target="_blank" rel="noreferrer"
      className="flex items-center gap-2 rounded-full pl-1 pr-3 py-1 hover:opacity-90" style={{ background: "var(--panel-2)" }}>
      <Avatar p={p} size={24} />
      <span className="text-sm font-semibold truncate max-w-[140px]">{p.name || p.handle}</span>
      <span className="text-xs muted">@{p.handle}</span>
      {role && <span className="text-[10px] uppercase tracking-wide muted">{role}</span>}
    </a>
  );
}

/** Who was on stage for the Space. */
export function OnStage({ a }: { a: Analytics }) {
  const host = a.host.handle ? ({ handle: a.host.handle, name: a.host.name, avatar: a.host.avatar } as Person) : null;
  const cohostSet = new Set(a.cohosts.map((c) => c.handle.toLowerCase()));
  const speakers = a.speakers.filter((s) => s.handle.toLowerCase() !== host?.handle.toLowerCase() && !cohostSet.has(s.handle.toLowerCase()));
  if (!host && !a.cohosts.length && !speakers.length) return null;
  return (
    <section className="card space-y-3">
      <div className="font-bold">On stage</div>
      <div className="flex flex-wrap gap-2">
        {host && <PersonChip p={host} role="host" />}
        {a.cohosts.map((c) => <PersonChip key={c.handle} p={c} role="co-host" />)}
      </div>
      {speakers.length > 0 && (
        <>
          <div className="label">Speakers</div>
          <div className="flex flex-wrap gap-2">{speakers.map((s) => <PersonChip key={s.handle} p={s} />)}</div>
        </>
      )}
    </section>
  );
}

/** The numbers: duration, engagement, peaks, new vs returning, X's own counts. */
export function InsightGrid({ a, total, unique }: { a: Analytics; total: number; unique: number }) {
  const tiles: [string, string, string?][] = [
    ["Duration", dur(a.duration_min), `${time(a.started_at)}${a.ended_at ? ` – ${time(a.ended_at)}` : " – now"}`],
    ["Engagement rate", a.engagement_rate != null ? `${a.engagement_rate}%` : "—", "of peak listeners reacted"],
    ["Reactions / min", String(a.reactions_per_min), `${fmtNum(total)} total`],
    ["Per reactor", a.avg_per_reactor != null ? String(a.avg_per_reactor) : "—", `avg across ${fmtNum(unique)} people`],
    ["Peak moment", a.peak_minute ? `${a.peak_minute.n}/min` : "—", a.peak_minute ? `at ${time(a.peak_minute.at)}` : undefined],
    ["New vs returning", `${fmtNum(a.new_reactors)} / ${fmtNum(a.returning_reactors)}`, "first time here / been before"],
    ["Top 10 share", a.top10_share != null ? `${a.top10_share}%` : "—", "of reactions came from the top 10"],
  ];
  if (a.total_live_listeners != null) tiles.push(["Total listeners (X)", fmtNum(a.total_live_listeners), "everyone who tuned in live"]);
  if (a.total_replay_watched != null) tiles.push(["Replay plays (X)", fmtNum(a.total_replay_watched), a.replay_available ? "replay is up" : undefined]);

  return (
    <section className="grid gap-3 grid-cols-2 lg:grid-cols-4">
      {tiles.map(([label, value, sub]) => (
        <div key={label} className="card">
          <div className="label">{label}</div>
          <div className="text-2xl font-extrabold tabular-nums mt-0.5">{value}</div>
          {sub && <div className="text-xs muted mt-0.5">{sub}</div>}
        </div>
      ))}
    </section>
  );
}

export function HostLine({ a }: { a: Analytics }) {
  if (!a.host.handle) return null;
  const co = a.cohosts.slice(0, 3);
  return (
    <span>
      Hosted by <a className="font-semibold hover:underline" href={`https://x.com/${a.host.handle}`} target="_blank" rel="noreferrer">@{a.host.handle}</a>
      {co.length > 0 && (
        <>
          {" "}with{" "}
          {co.map((c, i) => (
            <span key={c.handle}>
              {i > 0 && (i === co.length - 1 ? " & " : ", ")}
              <a className="hover:underline" href={`https://x.com/${c.handle}`} target="_blank" rel="noreferrer">@{c.handle}</a>
            </span>
          ))}
          {a.cohosts.length > 3 && ` +${a.cohosts.length - 3}`}
        </>
      )}
    </span>
  );
}

import Link from "next/link";
import { notFound } from "next/navigation";
import { getPublicSpace } from "@/lib/public-space";
import { fmtNum } from "@/lib/format";
import { AutoRefresh } from "@/components/AutoRefresh";
import { PublicLeaderboard } from "./PublicLeaderboard";

export async function generateMetadata({ params }: PageProps<"/s/[slug]">) {
  const { slug } = await params;
  const s = await getPublicSpace(slug);
  if (!s) return { title: "Tapped In" };
  const title = `${s.title || "Space"} — ${s.live ? "live" : "final"} leaderboard`;
  const top = s.leaderboard.slice(0, 3).map((u) => "@" + u.username).join(", ");
  return {
    title: `${title} · Tapped In`,
    description: `${fmtNum(s.total)} reactions from ${fmtNum(s.unique)} people${top ? `. Top: ${top}` : ""}. Hosted by @${s.host.handle}.`,
    twitter: { card: "summary_large_image" },
  };
}

export default async function PublicSpacePage({ params }: PageProps<"/s/[slug]">) {
  const { slug } = await params;
  const s = await getPublicSpace(slug);
  if (!s) notFound();

  const date = new Date(s.started_at).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
  const maxE = s.emojis[0]?.n ?? 1;

  return (
    <main className="flex-1">
      {s.live && <AutoRefresh seconds={15} />}
      <div className="mx-auto max-w-3xl px-4 sm:px-5 py-10 space-y-6">
        <header className="space-y-3">
          <Link href="/" className="text-sm font-black">tapped<span style={{ color: "var(--accent)" }}>in</span></Link>
          <div className="flex items-center gap-2">
            {s.live
              ? <span className="pill pill-live">● live now</span>
              : <span className="pill">final results</span>}
            <span className="text-sm muted">{date}</span>
          </div>
          <h1 className="text-3xl sm:text-4xl font-black tracking-tight leading-tight">{s.title || "X Space"}</h1>
          <div className="flex items-center gap-2 text-sm">
            {s.host.avatar && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={s.host.avatar} alt="" width={24} height={24} className="rounded-full" />
            )}
            <span className="muted">Hosted by</span>
            <a className="font-semibold hover:underline" href={`https://x.com/${s.host.handle}`} target="_blank" rel="noreferrer">@{s.host.handle}</a>
            <span className="muted">·</span>
            <a className="muted hover:underline" href={`https://x.com/i/spaces/${s.space_id}`} target="_blank" rel="noreferrer">{s.live ? "join on X" : "view on X"}</a>
          </div>
        </header>

        <div className="grid grid-cols-3 gap-3">
          <div className="card"><div className="label">Reactions</div><div className="stat">{fmtNum(s.total)}</div></div>
          <div className="card"><div className="label">Reactors</div><div className="stat">{fmtNum(s.unique)}</div></div>
          <div className="card"><div className="label">Peak listeners</div><div className="stat">{fmtNum(s.peak_listeners)}</div></div>
        </div>

        {s.emojis.length > 0 && (
          <section className="card space-y-2">
            <div className="font-bold">Emojis</div>
            {s.emojis.map((e) => (
              <div key={e.emoji} className="flex items-center gap-3 text-sm">
                <span className="text-xl w-7 text-center">{e.emoji}</span>
                <div className="flex-1 h-2.5 rounded-full overflow-hidden" style={{ background: "var(--panel-2)" }}>
                  <div className="h-full rounded-full" style={{ width: `${Math.max(3, (e.n / maxE) * 100)}%`, background: "var(--accent)" }} />
                </div>
                <span className="font-bold tabular-nums w-14 text-right">{fmtNum(e.n)}</span>
                <span className="muted text-xs w-16 text-right">{fmtNum(e.people)} {e.people === 1 ? "person" : "people"}</span>
              </div>
            ))}
          </section>
        )}

        <PublicLeaderboard rows={s.leaderboard} />

        <footer className="pt-4 text-center text-sm muted">
          Leaderboard by <Link className="link" href="/">Tapped In</Link> — see who&apos;s really in your Space.
        </footer>
      </div>
    </main>
  );
}

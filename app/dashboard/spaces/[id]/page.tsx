import Link from "next/link";
import { notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getUser } from "@/lib/supabase/server";
import { fmtDate, fmtNum } from "@/lib/format";
import type { Giveaway, Summary } from "@/lib/types";
import { Timeline } from "./Timeline";
import { GiveawayPanel } from "./GiveawayPanel";
import { AutoRefresh } from "./AutoRefresh";

export default async function SpacePage({ params }: PageProps<"/dashboard/spaces/[id]">) {
  const { id } = await params;
  const { supabase } = await getUser();

  const { data: space } = await supabase
    .from("spaces")
    .select("id, space_id, title, started_at, ended_at, peak_listeners, total_reactions")
    .eq("id", id)
    .maybeSingle();
  if (!space) notFound();

  const [{ data: summary }, { data: giveaways }] = await Promise.all([
    supabase.rpc("space_summary", { p_space: id }),
    supabase.from("giveaways").select("*").eq("space_uuid", id).order("drawn_at", { ascending: false }),
  ]);
  const s = summary as Summary;
  const live = !space.ended_at;

  async function rename(formData: FormData) {
    "use server";
    const title = String(formData.get("title") ?? "").trim().slice(0, 200);
    const { supabase } = await getUser();
    await supabase.from("spaces").update({ title: title || null }).eq("id", id);
    revalidatePath(`/dashboard/spaces/${id}`);
  }

  return (
    <div className="space-y-6">
      {live && <AutoRefresh seconds={10} />}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <Link href="/dashboard" className="text-sm muted hover:underline">← Spaces</Link>
          <form action={rename} className="mt-1 flex items-center gap-2">
            <input
              name="title"
              defaultValue={space.title ?? ""}
              placeholder={`Space ${space.space_id}`}
              className="bg-transparent text-3xl font-black tracking-tight outline-none w-full min-w-0 border-b border-transparent focus:border-[color:var(--line)]"
              aria-label="Space title"
            />
          </form>
          <div className="mt-1 flex items-center gap-2 text-sm muted">
            {fmtDate(space.started_at)} ·{" "}
            <a className="hover:underline" href={`https://x.com/i/spaces/${space.space_id}`} target="_blank" rel="noreferrer">open on X</a>
            {live ? <span className="pill pill-live">● live</span> : <span className="pill">ended</span>}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <a className="btn" href={`/api/export/space/${id}`}>Export CSV</a>
          <a className="btn" href={`/api/recap/${id}`} target="_blank" rel="noreferrer">Recap card</a>
          <Link className="btn btn-primary" href={`/dashboard/campaigns?space=${id}`}>Make allowlist</Link>
        </div>
      </div>

      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <div className="card"><div className="label">Reactions</div><div className="stat">{fmtNum(s.total)}</div></div>
        <div className="card"><div className="label">Unique reactors</div><div className="stat">{fmtNum(s.unique)}</div></div>
        <div className="card"><div className="label">Peak listeners</div><div className="stat">{fmtNum(space.peak_listeners)}</div></div>
        <div className="card">
          <div className="label">Top emojis</div>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-lg">
            {s.emojis.slice(0, 5).map((e) => (
              <span key={e.emoji}>{e.emoji}<span className="text-sm muted ml-1">{fmtNum(e.n)}</span></span>
            ))}
            {!s.emojis.length && <span className="muted text-sm">—</span>}
          </div>
        </div>
      </div>

      <Timeline timeline={s.timeline} occupancy={s.occupancy} bucketSecs={s.bucket_secs} />

      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <div className="card p-0 overflow-x-auto">
          <div className="px-4 pt-4 pb-2 font-bold">Leaderboard</div>
          {!s.leaderboard.length ? (
            <p className="px-4 pb-4 muted text-sm">No reactions yet.</p>
          ) : (
            <table className="tbl">
              <thead><tr><th>#</th><th>Account</th><th>Reactions</th><th>Emojis</th></tr></thead>
              <tbody>
                {s.leaderboard.map((u, i) => (
                  <tr key={u.username}>
                    <td className="muted">{i + 1}</td>
                    <td>
                      <a className="hover:underline" href={`https://x.com/${u.username}`} target="_blank" rel="noreferrer">
                        <span className="font-semibold">{u.display_name || u.username}</span> <span className="muted">@{u.username}</span>
                      </a>
                    </td>
                    <td className="font-bold">{fmtNum(u.total)}</td>
                    <td>
                      <div className="flex flex-wrap gap-x-2.5 gap-y-1">
                        {Object.entries(u.emojis).sort((a, b) => b[1] - a[1]).map(([e, n]) => (
                          <span key={e} className="whitespace-nowrap">{e}<span className="text-xs muted ml-0.5">{fmtNum(n)}</span></span>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <GiveawayPanel spaceId={id} emojis={s.emojis.map((e) => e.emoji)} initial={(giveaways ?? []) as Giveaway[]} />
      </div>
    </div>
  );
}

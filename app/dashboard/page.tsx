import Link from "next/link";
import { getUser } from "@/lib/supabase/server";
import { fmtDate, fmtNum } from "@/lib/format";
import { isLive } from "@/lib/live";

export default async function Dashboard() {
  const { supabase, user } = await getUser();
  const [{ data: spaces }, { data: profile }, { count: regularsCount }] = await Promise.all([
    supabase
      .from("spaces")
      .select("id, space_id, title, started_at, ended_at, last_activity_at, peak_listeners, total_reactions")
      .order("started_at", { ascending: false })
      .limit(50),
    supabase.from("profiles").select("ingest_token_hash").eq("id", user!.id).single(),
    supabase.from("regulars").select("*", { count: "exact", head: true }),
  ]);

  const totalReactions = (spaces ?? []).reduce((a, s) => a + s.total_reactions, 0);
  const hasKey = !!profile?.ingest_token_hash;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black tracking-tight">Your Spaces</h1>
          <p className="muted mt-1">Every Space you&apos;ve tracked with the extension.</p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="card"><div className="label">Spaces tracked</div><div className="stat">{fmtNum(spaces?.length ?? 0)}</div></div>
        <div className="card"><div className="label">Reactions logged</div><div className="stat">{fmtNum(totalReactions)}</div></div>
        <div className="card"><div className="label">Unique reactors</div><div className="stat">{fmtNum(regularsCount ?? 0)}</div></div>
      </div>

      {!spaces?.length ? (
        <div className="card">
          <h2 className="font-bold text-lg">No Spaces yet — let&apos;s get you set up</h2>
          <ol className="mt-3 space-y-2 text-sm">
            <li>{hasKey ? "✅" : "1."} <Link className="link" href="/dashboard/extension">Get your extension key</Link></li>
            <li>2. Install the Tapped In extension and paste the key in</li>
            <li>3. Open any Space on x.com and hit Start listening — it shows up here live</li>
          </ol>
        </div>
      ) : (
        <div className="card p-0 overflow-x-auto">
          <table className="tbl">
            <thead>
              <tr><th>Space</th><th>Date</th><th>Reactions</th><th>Peak listeners</th><th></th></tr>
            </thead>
            <tbody>
              {spaces.map((s) => (
                <tr key={s.id}>
                  <td>
                    <Link className="font-semibold hover:underline" href={`/dashboard/spaces/${s.id}`}>
                      {s.title || `Space ${s.space_id}`}
                    </Link>
                  </td>
                  <td className="muted">{fmtDate(s.started_at)}</td>
                  <td>{fmtNum(s.total_reactions)}</td>
                  <td>{fmtNum(s.peak_listeners)}</td>
                  <td>{isLive(s.ended_at, s.last_activity_at) ? <span className="pill pill-live">● live</span> : <span className="pill">ended</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

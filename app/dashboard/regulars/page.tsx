import { getUser } from "@/lib/supabase/server";
import { fmtDate, fmtNum } from "@/lib/format";

export default async function Regulars({ searchParams }: PageProps<"/dashboard/regulars">) {
  const { supabase } = await getUser();
  const { sort } = await searchParams;
  const orderCol = sort === "reactions" ? "total_reactions" : sort === "recent" ? "last_seen" : "spaces_attended";

  const [{ data: rows }, { count: spaceCount }] = await Promise.all([
    supabase
      .from("regulars")
      .select("x_username, x_display_name, spaces_attended, total_reactions, first_seen, last_seen")
      .order(orderCol, { ascending: false })
      .order("total_reactions", { ascending: false })
      .limit(300),
    supabase.from("spaces").select("*", { count: "exact", head: true }),
  ]);

  const tabs: [string, string][] = [["", "Most Spaces"], ["reactions", "Most reactions"], ["recent", "Recently seen"]];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black tracking-tight">Regulars</h1>
          <p className="muted mt-1">Everyone who&apos;s reacted across your {fmtNum(spaceCount ?? 0)} Spaces.</p>
        </div>
        <a className="btn" href="/api/export/regulars">Export CSV</a>
      </div>

      <div className="flex gap-2">
        {tabs.map(([key, label]) => (
          <a key={key} href={key ? `?sort=${key}` : "?"} className={`btn ${((sort ?? "") === key) ? "btn-primary" : "btn-ghost"}`}>
            {label}
          </a>
        ))}
      </div>

      {!rows?.length ? (
        <div className="card muted">No reactions yet. Track a Space and your regulars show up here.</div>
      ) : (
        <div className="card p-0 overflow-x-auto">
          <table className="tbl">
            <thead>
              <tr><th>#</th><th>Account</th><th>Spaces</th><th>Reactions</th><th>First seen</th><th>Last seen</th></tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.x_username}>
                  <td className="muted">{i + 1}</td>
                  <td>
                    <a className="hover:underline" href={`https://x.com/${r.x_username}`} target="_blank" rel="noreferrer">
                      <span className="font-semibold">{r.x_display_name || r.x_username}</span>{" "}
                      <span className="muted">@{r.x_username}</span>
                    </a>
                    {spaceCount && spaceCount >= 3 && r.spaces_attended >= Math.max(3, Math.ceil(spaceCount * 0.5)) && (
                      <span className="pill pill-live ml-2">OG</span>
                    )}
                  </td>
                  <td>{r.spaces_attended}</td>
                  <td>{fmtNum(r.total_reactions)}</td>
                  <td className="muted">{fmtDate(r.first_seen)}</td>
                  <td className="muted">{fmtDate(r.last_seen)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

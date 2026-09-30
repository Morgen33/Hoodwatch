import { ImageResponse } from "next/og";
import { getUser } from "@/lib/supabase/server";
import type { Summary } from "@/lib/types";

// Shareable recap card: top reactors of a Space. Only the host can generate it.
export async function GET(_req: Request, ctx: RouteContext<"/api/recap/[id]">) {
  const { id } = await ctx.params;
  const { supabase, user } = await getUser();
  if (!user) return new Response("Sign in first", { status: 401 });

  const [{ data: space }, { data: profile }, { data: summary }] = await Promise.all([
    supabase.from("spaces").select("title, space_id, started_at, peak_listeners").eq("id", id).maybeSingle(),
    supabase.from("profiles").select("x_handle").eq("id", user.id).single(),
    supabase.rpc("space_summary", { p_space: id }),
  ]);
  if (!space) return new Response("Not found", { status: 404 });
  const s = summary as Summary;
  const top = s.leaderboard.slice(0, 8);
  const date = new Date(space.started_at).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: "#0b0b0d", color: "#ededf0", padding: 56, fontFamily: "sans-serif" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", fontSize: 30, fontWeight: 900 }}>
            tapped<span style={{ color: "#c6ff3d" }}>in</span>
          </div>
          <div style={{ display: "flex", fontSize: 22, color: "#8b8b96" }}>{date}</div>
        </div>
        <div style={{ display: "flex", marginTop: 28, fontSize: 52, fontWeight: 900, lineHeight: 1.05, maxWidth: 1000 }}>
          {space.title || "Space recap"}
        </div>
        <div style={{ display: "flex", marginTop: 12, fontSize: 24, color: "#8b8b96", gap: 28 }}>
          <span>{s.total.toLocaleString()} reactions</span>
          <span>{s.unique.toLocaleString()} reactors</span>
          {space.peak_listeners > 0 && <span>{space.peak_listeners.toLocaleString()} peak listeners</span>}
        </div>

        <div style={{ display: "flex", marginTop: 30, fontSize: 22, color: "#c6ff3d", fontWeight: 700 }}>TOP REACTORS — thank you 🙏</div>
        <div style={{ display: "flex", flexWrap: "wrap", marginTop: 14, gap: 12 }}>
          {top.map((u, i) => (
            <div key={u.username} style={{ display: "flex", alignItems: "center", width: 530, background: "#141418", border: "1px solid #26262e", borderRadius: 14, padding: "12px 18px", fontSize: 26 }}>
              <span style={{ color: "#8b8b96", width: 44 }}>#{i + 1}</span>
              <span style={{ fontWeight: 800 }}>@{u.username}</span>
              <span style={{ marginLeft: "auto", fontWeight: 800 }}>{u.total}</span>
            </div>
          ))}
          {!top.length && <div style={{ display: "flex", fontSize: 26, color: "#8b8b96" }}>No reactions yet</div>}
        </div>

        <div style={{ display: "flex", marginTop: "auto", fontSize: 22, color: "#8b8b96" }}>
          Hosted by @{profile?.x_handle ?? "host"}
        </div>
      </div>
    ),
    { width: 1200, height: 900 },
  );
}

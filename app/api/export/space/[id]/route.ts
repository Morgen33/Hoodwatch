import { getUser } from "@/lib/supabase/server";
import { toCSV } from "@/lib/format";

// Full reaction log for one Space, paged past the 1000-row API limit.
export async function GET(_req: Request, ctx: RouteContext<"/api/export/space/[id]">) {
  const { id } = await ctx.params;
  const { supabase, user } = await getUser();
  if (!user) return new Response("Sign in first", { status: 401 });

  const { data: space } = await supabase.from("spaces").select("space_id, title").eq("id", id).maybeSingle();
  if (!space) return new Response("Not found", { status: 404 });

  const rows: unknown[][] = [["time_iso", "username", "display_name", "x_user_id", "emoji"]];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("reactions")
      .select("reacted_at, x_username, x_display_name, x_user_id, emoji")
      .eq("space_uuid", id)
      .order("reacted_at")
      .order("id")
      .range(from, from + 999);
    if (error) return new Response(error.message, { status: 500 });
    for (const r of data) rows.push([r.reacted_at, r.x_username, r.x_display_name, r.x_user_id, r.emoji]);
    if (data.length < 1000 || from > 500_000) break;
  }

  return new Response(toCSV(rows), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="hoodwatch-${space.space_id}.csv"`,
    },
  });
}

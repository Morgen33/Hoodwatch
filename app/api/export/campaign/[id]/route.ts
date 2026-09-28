import { getUser } from "@/lib/supabase/server";
import { toCSV } from "@/lib/format";

export async function GET(_req: Request, ctx: RouteContext<"/api/export/campaign/[id]">) {
  const { id } = await ctx.params;
  const { supabase, user } = await getUser();
  if (!user) return new Response("Sign in first", { status: 401 });

  const { data: c } = await supabase.from("claim_campaigns").select("slug").eq("id", id).maybeSingle();
  if (!c) return new Response("Not found", { status: 404 });

  const rows: unknown[][] = [["wallet", "chain", "x_username", "x_user_id", "claimed_at"]];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("claims")
      .select("wallet, chain, x_username, x_user_id, created_at")
      .eq("campaign_id", id)
      .order("created_at")
      .order("id")
      .range(from, from + 999);
    if (error) return new Response(error.message, { status: 500 });
    for (const r of data) rows.push([r.wallet, r.chain, r.x_username, r.x_user_id, r.created_at]);
    if (data.length < 1000) break;
  }
  return new Response(toCSV(rows), {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="allowlist-${c.slug}.csv"` },
  });
}

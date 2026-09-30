import { getUser } from "@/lib/supabase/server";
import { toCSV } from "@/lib/format";

export async function GET() {
  const { supabase, user } = await getUser();
  if (!user) return new Response("Sign in first", { status: 401 });

  const rows: unknown[][] = [["username", "display_name", "x_user_id", "spaces_attended", "total_reactions", "first_seen", "last_seen"]];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("regulars")
      .select("x_username, x_display_name, x_user_id, spaces_attended, total_reactions, first_seen, last_seen")
      .order("spaces_attended", { ascending: false })
      .order("x_username")
      .range(from, from + 999);
    if (error) return new Response(error.message, { status: 500 });
    for (const r of data) rows.push([r.x_username, r.x_display_name, r.x_user_id, r.spaces_attended, r.total_reactions, r.first_seen, r.last_seen]);
    if (data.length < 1000) break;
  }
  return new Response(toCSV(rows), {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="tappedin-regulars.csv"' },
  });
}

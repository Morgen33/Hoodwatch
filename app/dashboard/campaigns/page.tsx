import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getUser } from "@/lib/supabase/server";
import { fmtDate, fmtNum } from "@/lib/format";

function slugify(s: string) {
  const base = s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "wl";
  return `${base}-${Math.random().toString(36).slice(2, 7)}`;
}

export default async function Campaigns({ searchParams }: PageProps<"/dashboard/campaigns">) {
  const { supabase } = await getUser();
  const { space: preselect, error } = await searchParams;

  const [{ data: campaigns }, { data: spaces }] = await Promise.all([
    supabase.from("claim_campaigns").select("id, slug, title, chain, min_reactions, is_open, created_at, space_uuid, claims(count)").order("created_at", { ascending: false }),
    supabase.from("spaces").select("id, title, space_id, started_at").order("started_at", { ascending: false }).limit(100),
  ]);

  async function create(formData: FormData) {
    "use server";
    const { supabase, user } = await getUser();
    if (!user) redirect("/");
    const title = String(formData.get("title") ?? "").trim().slice(0, 120);
    if (!title) redirect("/dashboard/campaigns?error=title");
    const space = String(formData.get("space") ?? "");
    const chain = String(formData.get("chain") ?? "any");
    const min = Math.max(1, Math.min(10000, parseInt(String(formData.get("min") ?? "1"), 10) || 1));
    const { data, error } = await supabase
      .from("claim_campaigns")
      .insert({ host_id: user.id, title, slug: slugify(title), space_uuid: space || null, chain: ["solana", "ethereum", "any"].includes(chain) ? chain : "any", min_reactions: min })
      .select("id")
      .single();
    if (error) redirect("/dashboard/campaigns?error=save");
    revalidatePath("/dashboard/campaigns");
    redirect(`/dashboard/campaigns/${data.id}`);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-black tracking-tight">Allowlists</h1>
        <p className="muted mt-1">
          Turn reactions into a wallet list. Listeners sign in with X on your claim page — if they reacted enough, they drop a wallet.
        </p>
      </div>

      <form action={create} className="card grid gap-4 sm:grid-cols-2 lg:grid-cols-4 items-end">
        <label className="space-y-1 sm:col-span-2">
          <span className="label">Name</span>
          <input name="title" required maxLength={120} className="input" placeholder="Hoodstreet OG allowlist" />
        </label>
        <label className="space-y-1">
          <span className="label">Who qualifies</span>
          <select name="space" className="input" defaultValue={preselect ?? ""}>
            <option value="">Reacted in any of my Spaces</option>
            {spaces?.map((s) => (
              <option key={s.id} value={s.id}>{s.title || `Space ${s.space_id}`} · {fmtDate(s.started_at)}</option>
            ))}
          </select>
        </label>
        <label className="space-y-1">
          <span className="label">Min reactions</span>
          <input name="min" type="number" min={1} defaultValue={1} className="input" />
        </label>
        <label className="space-y-1">
          <span className="label">Chain</span>
          <select name="chain" className="input" defaultValue="any">
            <option value="any">Solana or Ethereum</option>
            <option value="solana">Solana only</option>
            <option value="ethereum">Ethereum only</option>
          </select>
        </label>
        <div className="sm:col-span-2 lg:col-span-3 flex justify-end">
          <button className="btn btn-primary">Create claim page</button>
        </div>
        {error && <p className="text-sm sm:col-span-4" style={{ color: "var(--hot)" }}>{error === "title" ? "Give it a name." : "Couldn't save — try again."}</p>}
      </form>

      {!!campaigns?.length && (
        <div className="card p-0 overflow-x-auto">
          <table className="tbl">
            <thead><tr><th>Allowlist</th><th>Chain</th><th>Min reactions</th><th>Wallets</th><th>Status</th><th>Created</th></tr></thead>
            <tbody>
              {campaigns.map((c) => (
                <tr key={c.id}>
                  <td><Link className="font-semibold hover:underline" href={`/dashboard/campaigns/${c.id}`}>{c.title}</Link></td>
                  <td className="muted capitalize">{c.chain}</td>
                  <td>{c.min_reactions}</td>
                  <td className="font-bold">{fmtNum((c.claims as unknown as { count: number }[])?.[0]?.count ?? 0)}</td>
                  <td>{c.is_open ? <span className="pill pill-live">● open</span> : <span className="pill">closed</span>}</td>
                  <td className="muted">{fmtDate(c.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

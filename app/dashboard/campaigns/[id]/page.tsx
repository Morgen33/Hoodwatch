import Link from "next/link";
import { notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { getUser } from "@/lib/supabase/server";
import { fmtDate, fmtNum } from "@/lib/format";
import { CopyButton } from "@/components/CopyButton";

export default async function CampaignPage({ params }: PageProps<"/dashboard/campaigns/[id]">) {
  const { id } = await params;
  const { supabase } = await getUser();
  const { data: c } = await supabase.from("claim_campaigns").select("*, spaces(title, space_id)").eq("id", id).maybeSingle();
  if (!c) notFound();
  const { data: claims } = await supabase
    .from("claims")
    .select("x_username, wallet, chain, created_at")
    .eq("campaign_id", id)
    .order("created_at", { ascending: false })
    .limit(1000);

  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("x-forwarded-host") ?? h.get("host")}`;
  const link = `${origin}/c/${c.slug}`;
  const space = c.spaces as unknown as { title: string | null; space_id: string } | null;

  async function toggle() {
    "use server";
    const { supabase } = await getUser();
    await supabase.from("claim_campaigns").update({ is_open: !c!.is_open }).eq("id", id);
    revalidatePath(`/dashboard/campaigns/${id}`);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/dashboard/campaigns" className="text-sm muted hover:underline">← Allowlists</Link>
          <h1 className="text-3xl font-black tracking-tight mt-1">{c.title}</h1>
          <p className="muted mt-1 text-sm">
            {c.min_reactions}+ reaction{c.min_reactions > 1 ? "s" : ""} in {space ? (space.title || `Space ${space.space_id}`) : "any of your Spaces"} ·{" "}
            <span className="capitalize">{c.chain === "any" ? "Solana or Ethereum" : c.chain}</span>
          </p>
        </div>
        <div className="flex gap-2">
          <form action={toggle}><button className="btn">{c.is_open ? "Close claims" : "Reopen claims"}</button></form>
          <a className="btn btn-primary" href={`/api/export/campaign/${id}`}>Export wallets</a>
        </div>
      </div>

      <div className="card space-y-2">
        <div className="label">Claim link — drop it in your Space or pin it</div>
        <div className="flex gap-2">
          <input readOnly value={link} className="input font-mono text-sm" />
          <CopyButton text={link} />
          <a className="btn" href={link} target="_blank" rel="noreferrer">Open</a>
        </div>
        <p className="text-xs muted">{c.is_open ? "Claims are open." : "Claims are closed — the page shows a closed notice."}</p>
      </div>

      <div className="card p-0 overflow-x-auto">
        <div className="px-4 pt-4 pb-2 font-bold">{fmtNum(claims?.length ?? 0)} wallets</div>
        {!claims?.length ? (
          <p className="px-4 pb-4 text-sm muted">No claims yet. Share the link above.</p>
        ) : (
          <table className="tbl">
            <thead><tr><th>Account</th><th>Wallet</th><th>Chain</th><th>Claimed</th></tr></thead>
            <tbody>
              {claims.map((cl) => (
                <tr key={cl.x_username + cl.wallet}>
                  <td><a className="hover:underline" href={`https://x.com/${cl.x_username}`} target="_blank" rel="noreferrer">@{cl.x_username}</a></td>
                  <td className="font-mono text-xs break-all">{cl.wallet}</td>
                  <td className="muted capitalize">{cl.chain}</td>
                  <td className="muted">{fmtDate(cl.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

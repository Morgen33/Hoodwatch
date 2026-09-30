import { getUser } from "@/lib/supabase/server";
import { SignInButton } from "@/components/SignInButton";
import { ClaimForm } from "./ClaimForm";

type Status = {
  found: boolean; title?: string; host?: string; open?: boolean; chain?: "solana" | "ethereum" | "any";
  min_reactions?: number; signed_in?: boolean; handle?: string; reactions?: number; eligible?: boolean;
  wallet?: string | null; wallet_chain?: string | null;
};

export async function generateMetadata({ params }: PageProps<"/c/[slug]">) {
  const { slug } = await params;
  const { supabase } = await getUser();
  const { data } = await supabase.rpc("claim_status", { p_slug: slug });
  const s = data as Status;
  return { title: s?.found ? `${s.title} — claim on Tapped In` : "Tapped In" };
}

export default async function ClaimPage({ params }: PageProps<"/c/[slug]">) {
  const { slug } = await params;
  const { supabase } = await getUser();
  const { data } = await supabase.rpc("claim_status", { p_slug: slug });
  const s = data as Status;

  return (
    <main className="flex-1 flex items-center justify-center px-5 py-16">
      <div className="card w-full max-w-md space-y-5">
        <div className="text-sm font-black">tapped<span style={{ color: "var(--accent)" }}>in</span></div>

        {!s?.found ? (
          <p className="muted">This claim page doesn&apos;t exist.</p>
        ) : (
          <>
            <div>
              <h1 className="text-2xl font-black tracking-tight">{s.title}</h1>
              <p className="muted text-sm mt-1">
                From <a className="link" href={`https://x.com/${s.host}`} target="_blank" rel="noreferrer">@{s.host}</a> · for listeners
                with {s.min_reactions}+ reaction{s.min_reactions! > 1 ? "s" : ""} in their Spaces
              </p>
            </div>

            {!s.open ? (
              <div className="rounded-xl p-4 text-sm" style={{ background: "var(--panel-2)" }}>Claims are closed.</div>
            ) : !s.signed_in ? (
              <div className="space-y-3">
                <p className="text-sm">Sign in with X so we can check your reactions. We only read your handle.</p>
                <SignInButton next={`/c/${slug}`} />
              </div>
            ) : !s.eligible ? (
              <div className="rounded-xl p-4 text-sm space-y-1" style={{ background: "var(--panel-2)" }}>
                <div>Signed in as <b>@{s.handle}</b></div>
                <div>
                  You have <b>{s.reactions}</b> reaction{s.reactions === 1 ? "" : "s"} logged — you need <b>{s.min_reactions}</b>.
                  Pull up to the next Space and get those emojis in 🔥
                </div>
              </div>
            ) : (
              <ClaimForm slug={slug} handle={s.handle!} reactions={s.reactions!} chain={s.chain!} existing={s.wallet ?? null} existingChain={s.wallet_chain ?? null} />
            )}
          </>
        )}
      </div>
    </main>
  );
}

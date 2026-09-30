import Link from "next/link";
import { redirect } from "next/navigation";
import { SignInButton } from "@/components/SignInButton";
import { getUser } from "@/lib/supabase/server";

export default async function Home({ searchParams }: PageProps<"/">) {
  const { user } = await getUser();
  if (user) redirect("/dashboard");
  const { error } = await searchParams;

  const features = [
    ["🔥", "Live leaderboard", "Every emoji, every account, ranked in real time while your Space runs."],
    ["🎲", "Provably fair giveaways", "“Drop a 🔥 to enter.” Draw a winner from real reactors, with a public seed anyone can verify."],
    ["👀", "Know your regulars", "See who shows up Space after Space — and who's new tonight."],
    ["📈", "When it popped off", "Reactions and listener count over time. Find the moment the room lit up."],
    ["🪪", "Wallet allowlists", "Engaged listeners connect their X and drop a wallet. Export a WL in one click."],
    ["🖼️", "Auto recap", "A shareable leaderboard card to thank your top reactors after the Space."],
  ];

  return (
    <main className="flex-1">
      <section className="mx-auto max-w-5xl px-5 pt-20 pb-14">
        <div className="pill pill-live mb-6">● born in a Hoodstreet Space</div>
        <h1 className="text-5xl sm:text-6xl font-black tracking-tight leading-[1.02]">
          See who&apos;s really <span style={{ color: "var(--accent)" }}>in the room.</span>
        </h1>
        <p className="mt-5 max-w-2xl text-lg muted">
          Tapped In tracks every emoji reaction in your X Spaces by account — then turns that engagement into
          giveaways, allowlists and a community you actually know.
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <SignInButton label="Get started with X" />
          <Link href="#how" className="btn btn-ghost">How it works</Link>
        </div>
        {error && <p className="mt-4 text-sm" style={{ color: "var(--hot)" }}>Sign in didn&apos;t go through — try again.</p>}
      </section>

      <section className="mx-auto max-w-5xl px-5 pb-16 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {features.map(([icon, title, body]) => (
          <div key={title} className="card">
            <div className="text-2xl">{icon}</div>
            <h3 className="mt-2 font-bold">{title}</h3>
            <p className="mt-1 text-sm muted">{body}</p>
          </div>
        ))}
      </section>

      <section id="how" className="mx-auto max-w-5xl px-5 pb-24">
        <h2 className="text-2xl font-bold">How it works</h2>
        <ol className="mt-4 grid gap-4 sm:grid-cols-3">
          {[
            ["1", "Sign in with X", "Your dashboard is tied to your X account."],
            ["2", "Install the extension", "Paste your Tapped In key into it once."],
            ["3", "Open a Space", "Reactions sync to your dashboard live. That's it."],
          ].map(([n, t, b]) => (
            <li key={n} className="card">
              <div className="stat" style={{ color: "var(--accent)" }}>{n}</div>
              <div className="font-bold mt-1">{t}</div>
              <div className="text-sm muted mt-1">{b}</div>
            </li>
          ))}
        </ol>
        <p className="mt-6 text-xs muted max-w-2xl">
          Reactions in a Space are visible to everyone in the room. Tapped In records them for the host. Be upfront with
          your listeners — e.g. “we track reactions for rewards” in your Space title.{" "}
          <a className="link" href="/privacy">Privacy policy</a>
        </p>
      </section>
    </main>
  );
}

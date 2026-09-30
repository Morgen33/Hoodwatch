export const metadata = { title: "Privacy — Tapped In" };

export default function Privacy() {
  return (
    <main className="mx-auto max-w-2xl px-5 py-16 space-y-5 text-sm leading-relaxed">
      <h1 className="text-3xl font-black tracking-tight">Privacy Policy</h1>
      <p className="muted">Last updated September 28, 2026</p>

      <h2 className="text-lg font-bold pt-2">What Tapped In is</h2>
      <p>
        Tapped In helps X (Twitter) Space hosts see engagement in their Spaces: which accounts reacted with which emoji,
        listener counts over time, giveaways, and optional wallet allowlists.
      </p>

      <h2 className="text-lg font-bold pt-2">What the Chrome extension collects</h2>
      <ul className="list-disc pl-5 space-y-1">
        <li>
          Only while you are in an X Space on x.com: emoji reactions sent in that Space (the emoji, the reacting account&apos;s
          public handle, display name and X user ID, and the time), the Space ID and title, and listener counts.
        </li>
        <li>This is information already shown to everyone in the Space. The extension reads it; it never posts, reacts, or sends anything into the Space.</li>
        <li>It does not read your DMs, timeline, passwords, cookies, browsing history, or any site other than x.com / twitter.com.</li>
        <li>Your Tapped In key is stored locally in the extension and used only to send this data to your own Tapped In account.</li>
      </ul>

      <h2 className="text-lg font-bold pt-2">What the website collects</h2>
      <ul className="list-disc pl-5 space-y-1">
        <li>When you sign in with X: your X handle, user ID, display name, profile image, and email if X provides it.</li>
        <li>If you submit a wallet on a claim page: the public wallet address and chain you enter, linked to your X account, visible to that campaign&apos;s host.</li>
      </ul>

      <h2 className="text-lg font-bold pt-2">How it&apos;s used and shared</h2>
      <p>
        Data is used only to show hosts their own Space analytics, run their giveaways, and build their allowlists. Each
        host can only see data from their own Spaces and campaigns. We don&apos;t sell data or use it for advertising.
        Data is stored with Supabase (database and authentication) and the site is hosted on Vercel.
      </p>

      <h2 className="text-lg font-bold pt-2">Your choices</h2>
      <p>
        Hosts can export or delete their data. Anyone who reacted in a Space and wants their data removed from a host&apos;s
        dashboard, or anyone who wants their account deleted, can contact us and we&apos;ll remove it.
      </p>

      <h2 className="text-lg font-bold pt-2">Contact</h2>
      <p>
        <a className="link" href="mailto:igottaguyoh@gmail.com">igottaguyoh@gmail.com</a>
      </p>
    </main>
  );
}

import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex-1 flex items-center justify-center px-5 py-20">
      <div className="card max-w-md text-center space-y-3">
        <div className="text-sm font-black">tapped<span style={{ color: "var(--accent)" }}>in</span></div>
        <h1 className="text-xl font-bold">This leaderboard isn&apos;t available</h1>
        <p className="text-sm muted">The link might be wrong, or the host made it private.</p>
        <Link className="link text-sm" href="/">What is Tapped In?</Link>
      </div>
    </main>
  );
}

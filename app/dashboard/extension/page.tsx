import { getUser } from "@/lib/supabase/server";
import { KeyGenerator } from "./KeyGenerator";

export default async function ExtensionPage() {
  const { supabase, user } = await getUser();
  const { data: profile } = await supabase.from("profiles").select("ingest_token_hash").eq("id", user!.id).single();

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-3xl font-black tracking-tight">Extension</h1>
        <p className="muted mt-1">The Hoodwatch Chrome extension catches reactions while you&apos;re in a Space and syncs them here.</p>
      </div>

      <div className="card space-y-3">
        <h2 className="font-bold">1. Your extension key</h2>
        <p className="text-sm muted">
          This key lets the extension write to <em>your</em> dashboard. Treat it like a password — anyone with it can add
          data to your account. Generating a new one kills the old one.
        </p>
        <KeyGenerator hasKey={!!profile?.ingest_token_hash} />
      </div>

      <div className="card space-y-2">
        <h2 className="font-bold">2. Install the extension</h2>
        <ol className="text-sm space-y-1.5 list-decimal pl-5">
          <li>
            Download the <code>extension</code> folder from the{" "}
            <a className="link" href="https://github.com/Morgen33/Hoodwatch/tree/main/extension" target="_blank" rel="noreferrer">
              Hoodwatch repo
            </a>{" "}
            (Chrome Web Store listing coming soon).
          </li>
          <li>Go to <code>chrome://extensions</code>, turn on <b>Developer mode</b>.</li>
          <li>Click <b>Load unpacked</b> and pick the <code>extension</code> folder.</li>
          <li>Click the Hoodwatch icon in your toolbar, paste your key, hit Save.</li>
          <li>If you had the old Tampermonkey script, turn it off so reactions aren&apos;t counted twice.</li>
        </ol>
      </div>

      <div className="card space-y-2">
        <h2 className="font-bold">3. Open a Space</h2>
        <p className="text-sm muted">
          Join any Space on x.com in Chrome and hit Start listening. The Hoodwatch panel pops up bottom-left and everything
          syncs here every few seconds.
        </p>
      </div>
    </div>
  );
}

# Tapped In

See who's really in the room. Tapped In tracks every emoji reaction in your X Spaces by account, then turns it into live leaderboards, provably fair giveaways, a regulars list across Spaces, and wallet allowlists.

Born in a Hoodstreet Space.

## What's in here

| Path | What it is |
|---|---|
| `app/` | Next.js 16 app (dashboard, claim pages, CSV exports, recap card) |
| `extension/` | Chrome extension (MV3) that catches reactions in a Space and syncs them |
| `proxy.ts` | Keeps the Supabase session fresh, guards `/dashboard` |
| `lib/supabase/` | Supabase clients (browser + server) |

**Backend:** Supabase project `hoodwatch` (`gyspxodpxmpzxwskrbia`). Every table has RLS: hosts only ever see their own data. Writes from the extension go through `ingest_events()`, authorized by a per-host key (stored as a sha256 hash). Giveaways (`draw_giveaway`) and wallet claims (`claim_status` / `submit_claim`) are database functions, so the rules can't be bypassed from the browser.

## Features
- **Sign in with X** (Supabase Auth, X OAuth 2.0)
- **Spaces dashboard:** reactions, unique reactors, peak listeners, top emojis
- **Space page:** leaderboard, "when it popped off" timeline (reactions/min + listeners), CSV export, recap card image
- **Giveaways:** filter by emoji + min reactions, skip past winners, public seed so anyone can verify the draw
- **Regulars:** everyone who reacted across all your Spaces, OG badge for people at half+ of your Spaces
- **Allowlists:** public claim page (`/c/<slug>`). Listeners sign in with X; if they hit the reaction threshold they submit a Solana/ETH wallet. Export as CSV.

## Run locally
```bash
npm install
npm run dev
```
Env vars are optional; the public Supabase URL + publishable key are baked in as defaults (see `lib/supabase/env.ts`). To override:
```
NEXT_PUBLIC_SUPABASE_URL=https://gyspxodpxmpzxwskrbia.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```
After deploying, add your site URL in Supabase → Authentication → URL Configuration (Site URL + `https://your-domain/**` redirect).

## Extension
1. Dashboard → Extension → generate your key
2. `chrome://extensions` → Developer mode → Load unpacked → pick `extension/`
3. Click the Tapped In icon, paste the key, save
4. Open a Space on x.com and hit Start listening

## Verifying a giveaway
`index = int(first 12 hex chars of sha256(seed + ":" + entrants.join(","))) mod entrants.length`. Entrants are the sorted, lowercased handles shown on the draw.

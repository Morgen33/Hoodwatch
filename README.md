# Hoodwatch

See who's reacting in your X Spaces — live leaderboards, verifiable giveaways, regulars across Spaces, and wallet claim / allowlist campaigns.

Born in a Hoodstreet Space.

## Stack
- Next.js (App Router) on Vercel
- Supabase (Postgres, Auth with Sign in with X, RLS)
- Chrome extension that captures Space reactions and syncs them

## Status
- [x] Supabase schema, RLS, and RPCs (ingest, giveaway draw, claims) — live and tested
- [ ] Dashboard + Sign in with X
- [ ] Chrome extension + sync
- [ ] Space page: leaderboard, timeline, giveaways, recap
- [ ] Wallet claim campaigns

## Env
```
NEXT_PUBLIC_SUPABASE_URL=https://gyspxodpxmpzxwskrbia.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=...
```

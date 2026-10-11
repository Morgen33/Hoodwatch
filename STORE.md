# Chrome Web Store listing — copy & checklist

Upload: `tappedin-extension-store.zip` (manifest at the zip root — rebuild with `npm run zip-extension`).

## Name
Tapped In — X Spaces reactions tracker

## Summary (132 chars max)
See who's reacting in your X Spaces. Live leaderboards, fair giveaways, regulars and wallet allowlists for hosts.

## Category
Social & Communication

## Description
Tapped In shows X Space hosts who's actually engaging in the room.

Join your Space on x.com and Tapped In catches every emoji reaction by account and syncs it to your dashboard:

• Live leaderboard: who's reacting, and with what
• Provably fair giveaways: "drop a 🔥 to enter" and draw a winner from real reactors, with a public seed anyone can verify
• Regulars: see who shows up Space after Space, and who's new tonight
• "When it popped off": reactions and listener count over time
• Wallet allowlists: engaged listeners sign in with X and submit a Solana or Ethereum wallet; export in one click
• Recap card: a shareable image thanking your top reactors
• Public results page: share a link to the final leaderboard when your Space ends

How it works:
1. Sign in with X at tappedin-spaces.vercel.app
2. Generate your key under Extension and paste it into the Tapped In popup
3. Open any Space on x.com. The Tapped In panel pops up and starts counting on its own

Tapped In only reads reactions already visible to everyone in the Space. It never posts, reacts, or sends anything into a Space, and it only runs on x.com.

## Privacy policy URL
https://tappedin-spaces.vercel.app/privacy

## Single purpose (for the review form)
Records emoji reactions and listener counts in X Spaces the user is listening to, and syncs them to the user's own Tapped In dashboard.

## Permission justifications
- **storage**: saves the user's Tapped In key locally.
- **host permission (supabase.co)**: sends the Space's reactions to the user's Tapped In account.
- **content script on x.com / twitter.com (and X's own Spaces domains pscp.tv / periscope.tv, inside X's embedded frames)**: reads Space reaction events while the user is in a Space. Read-only; never sends anything. When X's page doesn't open the Space chat itself, the extension's background opens the same read-only chat connection using the chat access X already issued to the signed-in user, and only listens.

## Data usage disclosures (tick these)
- Collects: "Website content" (reactions shown in the Space), "Authentication information" (the Tapped In key, stored locally)
- Not sold, not used for unrelated purposes, not used for creditworthiness

## Assets
- Screenshots (1280×800) and small promo tile (440×280): `store-assets/`
- Icon 128×128: `extension/icon128.png` (already inside the zip)

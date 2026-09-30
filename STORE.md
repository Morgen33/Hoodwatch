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

How it works:
1. Sign in with X at tappedin-spaces.vercel.app
2. Generate your key under Extension and paste it into the Tapped In popup
3. Open a Space and hit Start listening

Tapped In only reads reactions already visible to everyone in the Space. It never posts, reacts, or sends anything into a Space, and it only runs on x.com.

## Privacy policy URL
https://tappedin-spaces.vercel.app/privacy

## Single purpose (for the review form)
Records emoji reactions and listener counts in X Spaces the user is listening to, and syncs them to the user's own Tapped In dashboard.

## Permission justifications
- **storage**: saves the user's Tapped In key locally.
- **host permission (supabase.co)**: sends the Space's reactions to the user's Tapped In account.
- **content script on x.com / twitter.com**: reads Space reaction events from the page while the user is in a Space.

## Data usage disclosures (tick these)
- Collects: "Website content" (reactions shown in the Space), "Authentication information" (the Tapped In key, stored locally)
- Not sold, not used for unrelated purposes, not used for creditworthiness

## Assets you still need
- At least 1 screenshot, 1280×800 or 640×400: take one of the dashboard and one of the panel in a live Space
- Icon 128×128: `extension/icon128.png`

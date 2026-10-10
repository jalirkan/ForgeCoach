# Printing the cubes as proxies

*Written 2026-10-10. The prices are estimates. Check them on the order page before you pay.*

These are playtest copies for playing at home with friends. Never sell them or trade them as real cards.

## The short version

1. Go to **[MPC Autofill](https://mpcautofill.github.io)**, a free tool. Paste in a list from this folder.
2. Pick **S33** card stock, export the order as an XML file, and run the Autofill desktop tool.
3. The tool uploads every card to **[MakePlayingCards](https://www.makeplayingcards.com)** (MPC). You check the cart and pay.

The Vintage Cube's 180 cards on S33 stock should cost about **$45–60 plus about $15 US shipping**. That works out to about **$0.35 a card**, well under the $1 budget. Delivery takes about two to three weeks.

## The lists

| File | Cube | Cards | Two-sided cards |
|---|---|---|---|
| [`vintage.txt`](vintage.txt) | Vintage Cube | 180 | 3: Delver of Secrets; Jace, Vryn's Prodigy; Fable of the Mirror-Breaker |
| [`synergy.txt`](synergy.txt) | Synergy Cube | 180 | 3 |
| [`modern-era.txt`](modern-era.txt) | Modern-Era Cube | 180 | 14 (10 of them Pathway lands) |
| [`omega.txt`](omega.txt) | Omega Cube | 180 | 6 |
| [`fair-fight.txt`](fair-fight.txt) | Fair Fight Cube | 180 | 2 |
| [`peasant.txt`](peasant.txt) | Peasant Cube | 180 | 3 |
| [`pauper.txt`](pauper.txt) | Pauper Cube | 180 | 2 |
| [`evybaby.txt`](evybaby.txt) | Evybaby's New Cube | 360 | 8 |

Each line reads `1 Card Name`, the format MPC Autofill and most proxy printers accept. Two-sided cards are listed by their front face, and Autofill adds the back face itself. The lists don't include basic lands. Real basics cost about 10¢ each, so buy a box of them (about 15 of each colour covers two players) instead of printing them.

`scripts/proxies/lists.ts` regenerates these lists from `public/cubes/*.md`, so they stay up to date when a cube changes.

## Which card stock

MakePlayingCards (MPC) has three stocks worth choosing from:

- **S33 (superior smooth): recommended.** It's what most people use for Magic proxies. It's stiff, shuffles well, and feels close to a real card once sleeved.
- **M31 (linen):** it has a slightly textured finish closer to real cards, and costs about the same or a little more. It's a good choice if you'll play unsleeved.
- **S30 (standard smooth):** cheapest and thinnest. This is the stock you said to avoid.

Always pick **Poker size (63 × 88 mm)**, the size of a Magic card. Skip foil for the first order.

## MPC's order sizes, and how to save money

MPC charges by bracket: 18, 36, 55, 72, 90, 108, 126, 144, 162, **180**, 198, 216, 234, **396**, 504, **612** cards. The price per card drops as the order gets bigger.

- **One cube on its own:** 180 cards fills the 180 bracket exactly. Adding even one card bumps the order up to the 198 bracket.
- **Two cubes together:** 360 cards goes in the 396 bracket. That leaves 36 free slots for spare tokens or swap-in cards.
- **Three cubes together:** 540 cards fits in the 612 bracket, the cheapest price per card. If you know you'll want three cubes eventually, one order is cheaper than three.
- MPC runs sales often (10–30% off). Waiting a week can be worth it.

## Step by step

### 1. Accounts (one time)

- Create a **MakePlayingCards account with an email and password**. Don't use "Sign in with Google": the desktop tool drives a browser that can't use Google sign-in.
- Have **Chrome, Edge or Brave** installed.

### 2. Build the order on MPC Autofill (about 10 minutes)

1. Open <https://mpcautofill.github.io> and go to the **Editor**. If it asks for a server, use the default Magic community server it suggests.
2. Choose **Add cards → Text**. Paste all of [`vintage.txt`](vintage.txt) (open it, select all, copy).
3. Autofill picks a print of each card. You can click a card to choose a different print, or keep its pick for every card.
4. Choose a **card back** (cardbacks are in the editor's settings or the "Cardback" panel). Use the classic Magic back or any design you like.
5. In the project settings, set the **card stock to S33** (or M31) and leave foil off.
6. Check that the counter shows **180 cards**. Then click **Download → XML**.

### 3. Run the desktop tool (about 20–40 minutes, mostly unattended)

1. Download the desktop tool for your operating system from <https://github.com/chilli-axe/mpc-autofill/releases>.
2. Put the tool and the XML file in the same folder, for example a new folder on your Desktop.
3. **Double-click** the tool to start it. Don't drag the XML onto it.
   - On a Mac, the first launch is blocked. Go to System Settings → Privacy & Security → *Open Anyway*.
   - On Linux, run it from a terminal in that folder: `./autofill-linux.bin`
4. Answer its prompts: the browser (Chrome is the default), then **Create a new project**. Sign in to MPC when it asks. It saves progress to your account as it goes, so you can resume after a crash.
5. Wait while the browser uploads 180 fronts and the backs. Keep the computer awake (the tool does this for you).

### 4. Check out

1. On MakePlayingCards, open the project. Spot-check a few cards, the three two-sided ones especially, and confirm the stock reads S33 and the quantity reads 180.
2. Add the project to the cart. Pick standard shipping (about $15 to the US) and pay.

### If something goes wrong

- **MPC rejects the order.** MPC sometimes refuses cards that show a copyright line or a logo. Replace the flagged cards with a different print in the Autofill editor, export the XML again, and run the tool with *Continue editing an existing project*.
- **A card is missing or matched the wrong card.** Send me the name and I'll check the list.

### Other ways to buy, if you don't want to use MPC

- **Buy finished proxies:** some shops sell finished proxy cards and take a decklist. That's less work but costs more per card, quality varies, and these shops come and go. Check recent reviews first.
- **Print at home:** cheapest, but cards made with paper, glue and cutting look and feel worse than S33. It isn't worth the effort for 180 cards.

## What Claude can prepare for you

Ask for any of these by name.

- **A cut list:** tell me which cards you already own (paste them or name them) and I'll remove them from a cube's list.
- **A combined order:** "Vintage + Omega + Synergy in one 612 order" gives one list with counts, plus a suggestion for the free slots.
- **Tokens and spares:** the tokens a cube's cards make (Fable's Goblin Shaman, Lingering Souls' Spirits, Clues, Treasure, Elk…). Add them to an order to fill its free slots.
- **Swap-ins:** the Vintage Cube's "cards to watch" replacements (Tamiyo, Inquisitive Student; Unexpectedly Absent; Sword of Fire and Ice; Timetwister), so they're printed if you ever swap them in. With these the order is 185 cards, which falls in the 198 bracket.
- **A packing checklist:** a printable list in the cube's sections (White, Blue, …), for sorting cards when the box arrives.

# Handoff to the PC session: the proxy test print

*From the cloud session, 2026-10-12. Justin is continuing this with you on his PC. Read `docs/proxies/README.md` for the full background.*

## Where things stand

- **The plan:** print the MTGO Vintage Cube (570 cards: `order-2-vintage-570.txt`) plus 42 Old School cards (`order-2-oldschool-42.txt`), 612 cards in all, through MakePlayingCards (MPC) on S33 stock.
- **First, a test print:** 18 cards, `test-order-18.txt`. That's MPC's smallest bracket. The README's *Test print first* section says what each card checks.
- **Backs:**
  - One shared, generic proxy back on every card. You're making it; Justin chose no text on it.
  - Custom opaque sleeves, printed with the Vintage Cube art, tell the cubes apart.
- **The ten two-sided cards stay truly two-sided:** their second face is printed on the back. The README's helper-card plan doesn't apply.
- **Done so far:** Justin downloaded the MPC Autofill desktop tool to `~/Downloads/autofill-linux.zip`.

## What to do with Justin

1. **Set up the tool.**
   - Unzip it: `unzip ~/Downloads/autofill-linux.zip -d ~/mpc-autofill`, then `chmod +x` the program inside.
   - Make sure Google Chrome is installed (`which google-chrome`). The tool drives Chrome, Edge or Brave through Selenium, and snap Chromium may not work with it.
   - Notes on the tool: https://github.com/chilli-axe/mpc-autofill/wiki/Desktop-Tool
2. **Build the test order in Autofill.**
   - Open mpcfill.com (the same tool as mpcautofill.github.io), open the editor, and add cards as text: paste `test-order-18.txt`.
   - Set the stock to S33 and leave foil off.
   - Check that it shows 18 cards, then Download → XML into `~/mpc-autofill`.
   - Autofill can't use a custom back, so skip the back here.
3. **Run the tool.** From `~/mpc-autofill`, run the program and answer its prompts:
   - browser: Chrome;
   - Create a new project;
   - sign in to MPC with Justin's email login. Google sign-in doesn't work in the automated browser.
4. **On makeplayingcards.com:**
   - Open the saved project.
   - Set the back to the shared proxy back for every card except the two two-sided ones (Fable of the Mirror-Breaker, Delver of Secrets), which keep their second faces.
   - Check: 18 cards, poker size, S33.
   - Justin pays.
5. **Optional:** the same 18 again on M31 (linen), to compare stocks.

## After the test cards arrive

Check them with Justin:

- in a sleeve next to a real card;
- shuffle feel;
- centring of the cut;
- the two-sided cards' front and back lining up;
- the readability of Jace / Emrakul / Urza's Saga;
- dark art (Griselbrand, Sheoldred).

Then run the full order the same way: paste the 570 and the 42 into one Autofill project (612 cards). Waiting for an MPC sale (often 20–40% off) is worth it.

## Things to know

- **Omenpaths names:** two MTGO names, *Makdee and Itla, Skysnarers* and *Kavaero, Mind-Bitten*, are printed in paper as Spider-Woman, Stunning Savior and Superior Spider-Man. If Autofill misses them, search the paper name.
- **Meld cards:** Phyrexian Dragon Engine and The Mightstone and Weakstone never meld in this cube (their partners aren't in it), so print them one-sided.
- **Brief out of date:** `cardback/ART-BRIEF.md` describes a card back with print bleed. The art now goes on sleeves, so use the sleeve printer's own template instead.

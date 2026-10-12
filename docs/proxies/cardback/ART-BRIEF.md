# Card back art brief: the Vintage Cube proxies

*For the Claude session on Justin's PC with the GPU and the image models. Written 2026-10-12.*

## The job

Make the art for the back of 612 proxy cards: the MTGO Vintage Cube, printed through MakePlayingCards (`docs/proxies/README.md`, Order 2). Every card in the box gets this one back, and the cards go in **clear sleeves**, so the back is what you see whenever a card is face down.

Justin wants it to feel like the back of a **vintage Magic card**: the 1993–1990s mood of oil-painted fantasy, warm browns, leather, old maps and arcane things. He wants it to **lean into fantasy** harder than the current placeholder does. The placeholder is `vintage-cube-back.png`, a flat gold cube on dark ink.

## Hard rules

1. **Evoke the era; never copy Wizards' card back.** The back must not be mistaken for a real Magic card, for three reasons. Wizards' back is a trademark. MakePlayingCards rejects orders that copy it. And the whole point of a custom back is that everyone sees "proxy" at a glance. So:
   - no brown oval or ellipse in the centre;
   - no five coloured orbs in a pentagon;
   - no "Magic", "The Gathering" or "Deckmaster" wording, and no lettering in those fonts;
   - no swirling blue-brown vortex frame like the original.

   Take the feeling: warm brown, gold, old paper, painted fantasy. Leave the layout behind.
2. **No text from the model.** Image models garble letters. The words are added afterwards, crisp, by `vintage-cube-back.html`: *Vintage Cube*, *Playtest card*, *Proxy · Not for sale*. Leave calm space for them (see Layout).
3. **Symmetric enough to hide orientation.** A back that is clearly "up" tells a sharp opponent which way a card was put in a hand or deck. The art should read about the same rotated 180°, or be truly 180° symmetric. Mirror-symmetric left to right is a bonus.
4. **Nothing that identifies a card.** No art from a real Magic card, no card names, no mana symbols used as information.
5. **Original output only.** Generate locally; don't paste in someone else's artwork, and don't prompt "in the style of <living artist>". Period words like "1990s fantasy oil painting" or "illuminated manuscript" are fine.

## Size and layout

All numbers are for the final PNG, which `render.sh` makes at 600 dpi.

| | Pixels | Inches |
|---|---|---|
| Whole image, with bleed | **1632 × 2220** | 2.72 × 3.70 |
| Cut line (MPC trims to this) | inset **75 px** on every side → 1482 × 2070 | 2.47 × 3.45 |
| Safe area (keep anything important inside) | inset **135 px** on every side | ~0.1 in inside the cut |

- **Bleed:** the art must run all the way to the image edge, bleed included. No border that stops at the cut line, because the cut wanders about 1 mm.
- **Text bands:** keep these areas calm, mid-to-dark and low in detail so the HTML text reads cleanly over them:
  - a band about **y = 1480–1980** (lower third) for "VINTAGE / CUBE / Proxy · Not for sale";
  - a thin band about **y = 300–400** for "PLAYTEST CARD".

  If the art has a central emblem, put it around **y = 600–1250**.
- **Generate bigger, then fit.** Generate at whatever size the model likes in a 2:3 or 3:4 frame, upscale, and cover-crop to 1632 × 2220. Check the crop keeps the emblem centred.

## Print and sleeves

- **Not too dark.** Printers lose shadow detail: keep the darkest large areas around RGB 20–30, not pure black. Keep the gold mid-toned, since a bright yellow-gold prints muddy. Avoid neon saturation, which won't survive the printer's colour conversion.
- **Even, mid detail** reads best through a sleeve's glare. Big flat patches show scuffs; ultra-fine noise turns to mush at 300 dpi print.
- **Print one test card** before committing 612. MPC sells single cards. Look at it in a clear sleeve under room light.

## Directions to explore

Make **3–4 directions, 2–3 variations each**, then narrow down with Justin. Starting ideas:

1. **The Vault.** An ancient stone-and-bronze vault door seen face on: concentric rings, rivets and runes, a glowing cube-shaped keystone at the centre. "Vintage" as in *the vault where the old treasures are kept*. Naturally radial, so it's 180°-friendly.
2. **The Tome.** A worn leather book cover, tooled gold filigree and corner bosses, a gem-set cube-shaped clasp in the middle. Old, warm, scholarly; it pairs well with the sleeve's shine.
3. **The Astrolabe.** A brass astrolabe / orrery over a deep night sky. Five faint coloured stars or gems sit in the rings as a nod to the five colours, *not* five orbs in a pentagon. Arcane and cosmic.
4. **The Relic Cube.** A floating stone cube covered in carved glyphs, lit from inside, over a painted fantasy landscape: mountains, sea, distant towers, twilight. Painterly, closest to 1990s card art.
5. **The Illuminated Page.** Medieval-manuscript borders: vines, knotwork, small dragons and birds in the margins, with a gold-leaf cube emblem at the centre. Light parchment, so it would stand out against dark playmats.

Justin's ask is "vintage Magic, but more fantasy", so 1, 2 and 4 are the strongest fits. 3 and 5 are there for range.

**Prompt starters.** Adjust for the model.

- *Positive:* "ornate fantasy card back, 1990s oil painting, warm umber and antique gold, aged leather and brass, symmetrical, centered emblem of a glowing carved stone cube, intricate filigree border, rich texture, painterly, high detail"
- *Negative:* "text, letters, words, logo, watermark, signature, oval, ellipse, five orbs, pentagon, modern, flat vector, neon, photograph of a real card, blurry"

## Putting it on the card

1. Save each finished background as `docs/proxies/cardback/art/<direction>-<n>.png` (1632 × 2220). Keep the prompt, seed and model beside each in `art/<direction>-<n>.txt`.
2. In `vintage-cube-back.html`, swap the generated background in for the gradient and grid:
   ```html
   <image href="art/<file>.png" x="0" y="0" width="816" height="1110" preserveAspectRatio="xMidYMid slice"/>
   ```
   This goes right after `<defs>`, in place of the two first `<rect>`s.
   - If the art carries its own emblem, drop the drawn cube and its circle.
   - Keep the frame lines only if they suit the art.
   - Keep the three text lines.
3. Run `./render.sh`, look at `vintage-cube-back.png` at 100%, and check the cut line and the safe area with a 75 px and a 135 px outline. Add the outline in a scratch copy, never in the final file.
4. Make a contact sheet of the candidates (all variations side by side, scaled down) for Justin to choose from.
5. Commit the chosen back, its source art and its prompt notes. Push on a branch and leave merging to Justin.

## Done when

Justin has picked one back from the candidates, it renders to a 1632 × 2220 PNG that passes every hard rule above, and a test print looks right in a clear sleeve.

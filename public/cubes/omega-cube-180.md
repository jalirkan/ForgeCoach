# Omega — the greatest-hits cube, version 1 (180 cards, two-player)

*Designed 2026-10-03 for Justin and a friend: grid or Winston draft, 40-card decks, best of three. Drawn from a 938-card seed pool (the MTGO Vintage Cube of 2026-08-19, Justin's Vintage, Modern-Era, Synergy and Pauper cubes, and 80 iconic additions) in `omega-seed-pool.tsv`. Every name verified on Scryfall and checked against Forge 2.0.14's card database. Chosen on gameplay alone; cost was not a factor, and anything not owned gets proxied. Version 1 is the starting point for the cube lab, which will evolve it with AI drafts and AI-vs-AI games by swapping cards in from the seed pool.*

## What it is

The cards people remember from thirty years of Magic, at one power level. Baneslayer Angel and Swords to Plowshares, Jace and Force of Will, Hypnotic Specter and Grave Titan, Lightning Bolt and Shivan Dragon, Tarmogoyf and Craterhoof, Jitte and the Swords of X and Y, on a mana base of original dual lands and fetchlands. It's built so that the games are about creatures, removal, card advantage and planeswalkers fighting over a board, and so a newer player can learn why each of these cards is famous by playing against it.

## Design principles

1. **Every card is a greatest hit.** Each of the 180 is either a card people name when they talk about Magic (Serra-era angels and dragons, the Titans, the Swords, the Jaces), a defining staple of an era (Bitterblossom, Thragtusk, Snapcaster, Fable, Sheoldred), or the signature removal or card-advantage spell of its colour. Where two cards did the same job, the more iconic one won.
2. **Fair and interactive beats degenerate.** No Moxen, no Black Lotus, no Sol Ring, no Tinker, Sneak Attack, Show and Tell, Entomb, Natural Order, Oath, Channel, storm or two-card infinites. The biggest swings left in (Reanimate onto a Titan, Craterhoof off a board, Ugin) take a real deck and lose to the cheap interaction every colour has.
3. **Eight archetypes, deep enough for two.** Two drafters see 162 of the 180 in a grid draft, so each lane has 15–25 cards that want to be in it plus two gold signposts. Most cards sit in two or three themes, so a drafter who loses a fight over one card can pivot without wasting earlier picks.
4. **No single pick decides the draft.** The cards that win a draft on their own in other cubes (Oko, The One Ring, Black Lotus, Time Walk, Minsc & Boo, Wrenn and Six, Nadu) stay in the seed pool, not in v1. Each colour gets two or three bombs instead of one, so whoever passes a bomb sees another soon after.
5. **Balanced colours.** 24 mono-coloured cards per colour, plus 8 gold cards each colour can play (two per colour pair), so 32 cards per colour. Each colour has a two-drop curve, a top end, and its own kind of interaction: exile and wraths in white, counters and bounce in blue, kill spells and discard in black, burn in red, fight and big blockers in green.
6. **Mana for two colours plus a splash.** The ten original duals and ten fetchlands: twenty fixing lands, so about ten per drafter, and each fetchland can find seven of the ten duals. Birds, Lotus Cobra, Coalition Relic and Knight of the Reliquary add more. Mishra's Factory and Mutavault are the two colourless lands.

## Format counts

| Section | Cards |
|---|---|
| White | 24 |
| Blue | 24 |
| Black | 24 |
| Red | 24 |
| Green | 24 |
| Gold (2 per colour pair) | 20 |
| Colorless | 18 |
| Lands | 22 |
| **Total** | **180** |

94 creatures, 15 planeswalkers. Nonland mana-value curve: 3 at 0, 24 at 1, 32 at 2, 34 at 3, 30 at 4, 17 at 5, 11 at 6, 7 at 7+.

## The themes and how they connect

This is the shared tag vocabulary used here and in `omega-seed-pool.tsv` (the four source cubes' tags were mapped onto it: Pauper FLK became ETB and RMP became RAMP).

| Code | Theme | Core idea | Connects to |
|---|---|---|---|
| AGG | Aggro | Cheap efficient threats, haste, equipment carriers, burn to finish | EVA, TOK, ART, SPL |
| EVA | Evasion | Fliers and hard-to-block threats that carry equipment and Rancor | AGG, ETB, CTRL |
| TOK | Tokens / go wide | Token makers, planeswalkers that make armies, anthem effects | SAC, AGG, LIFE |
| SAC | Sacrifice | Fodder, sac outlets, death triggers, Skullclamp | TOK, GY, LIFE |
| ETB | Enter-the-battlefield / blink | Value creatures plus Ephemerate, Flickerwisp, Restoration Angel, Phantasmal Image | CTRL, REAN, TOK |
| CTR | +1/+1 counters | Counter makers and payoffs | AGG, ART |
| GY | Graveyard | Self-mill, delve, recursion, flashback, fetchlands as fuel | REAN, SPL, SAC, LND |
| REAN | Reanimation | Reanimate, Animate Dead, and the fat or ETB creatures worth bringing back | GY, FAT, ETB |
| SPL | Spells / tempo | Cantrips, prowess, cheap instants and the creatures that grow from them | AGG, GY, CTRL |
| CTRL | Control | Counterspells, wraths, card advantage, planeswalkers | SPL, ETB, FAT |
| ART | Artifacts / equipment | Swords, Jitte, Stoneforge, Treasures, Clues, artifact creatures | AGG, RAMP, SAC |
| RAMP | Mana acceleration | Mana creatures, mana rocks, land ramp | FAT, LND |
| LND | Lands | Fetchlands, landfall, land recursion, creature lands | RAMP, GY, TOK |
| LIFE | Lifegain | Lifelink, gain-life triggers; the fair answer to burn | TOK, SAC, AGG |
| FAT | Big payoffs | Six-plus-mana creatures and walkers worth ramping to or reanimating | RAMP, REAN, CTRL |

Lower-case words (removal, counter, discard, hoser) mark interaction and aren't themes.

**Hub cards** that sit in three or more themes and let you change lanes: Stoneforge Mystic (ART/AGG/ETB), Blade Splicer (ETB/TOK/ART), Young Pyromancer (SPL/TOK/SAC), Fable of the Mirror-Breaker (ART/TOK/SAC), Seasoned Pyromancer (GY/TOK/SPL), Bitterblossom (TOK/EVA/SAC), Kokusho (FAT/LIFE/SAC/REAN), Tireless Tracker (LND/ART/CTR), Hangarback Walker (ART/CTR/TOK/SAC), Grist (TOK/SAC/GY), Uro (LND/GY/RAMP), Sun Titan (FAT/GY/ETB), Lingering Souls (TOK/GY/EVA).

## The list (name — themes)

### White (24)
Thraben Inspector — ART ETB · Mother of Runes — AGG · Thalia, Guardian of Thraben — AGG · Adeline, Resplendent Cathar — AGG TOK · Stoneforge Mystic — ART AGG ETB · Luminarch Aspirant — AGG CTR · Blade Splicer — ETB TOK ART · Brimaz, King of Oreskos — TOK AGG · Flickerwisp — ETB EVA · Skyclave Apparition — ETB removal · Hero of Bladehold — TOK AGG · Restoration Angel — ETB EVA · Exalted Angel — EVA LIFE · Baneslayer Angel — EVA LIFE FAT · Swords to Plowshares — removal · Path to Exile — removal LND · Council's Judgment — removal CTRL · Wrath of God — CTRL · Ephemerate — ETB SPL · Wedding Announcement — TOK ART · Elspeth, Sun's Champion — TOK CTRL · The Wandering Emperor — CTRL TOK removal · Sun Titan — FAT GY ETB · Solitude — ETB removal REAN

### Blue (24)
Brainstorm — SPL · Ponder — SPL · Preordain — SPL · Counterspell — counter CTRL · Mana Leak — counter SPL · Force of Will — counter CTRL · Cryptic Command — counter CTRL · Fact or Fiction — CTRL GY · Delver of Secrets — SPL EVA AGG · Snapcaster Mage — SPL GY ETB · Jace, Vryn's Prodigy — SPL GY · Brazen Borrower — SPL EVA · Vendilion Clique — EVA discard · Phantasmal Image — ETB · Man-o'-War — ETB removal · Mulldrifter — ETB CTRL EVA · Control Magic — removal CTRL · Sower of Temptation — ETB removal EVA · Venser, Shaper Savant — ETB counter · Murktide Regent — SPL GY EVA · Treasure Cruise — SPL GY · Morphling — CTRL EVA · Jace, the Mind Sculptor — CTRL SPL · Consecrated Sphinx — FAT CTRL REAN

### Black (24)
Thoughtseize — discard · Hymn to Tourach — discard · Dark Confidant — AGG CTRL · Bloodghast — SAC GY AGG · Blood Artist — SAC LIFE TOK · Bitterblossom — TOK EVA SAC · Fatal Push — removal LND · Doom Blade — removal · Bone Shards — SAC GY removal · Demonic Tutor — CTRL REAN · Hypnotic Specter — EVA discard AGG · Vampire Nighthawk — EVA LIFE · Orcish Bowmasters — ETB removal TOK · Shriekmaw — ETB removal · Ravenous Chupacabra — ETB removal · Liliana of the Veil — discard GY CTRL · Liliana, the Last Hope — GY removal CTRL · Damnation — CTRL · Phyrexian Arena — CTRL · Animate Dead — REAN GY · Reanimate — REAN GY · Grave Titan — FAT TOK · Kokusho, the Evening Star — FAT LIFE SAC REAN · Sheoldred, the Apocalypse — FAT LIFE

### Red (24)
Lightning Bolt — removal SPL AGG · Chain Lightning — removal SPL AGG · Incinerate — removal SPL · Arc Trail — removal SPL · Goblin Guide — AGG · Monastery Swiftspear — AGG SPL · Ragavan, Nimble Pilferer — AGG ART · Young Pyromancer — SPL TOK SAC · Dragon's Rage Channeler — SPL GY AGG · Goblin Rabblemaster — AGG TOK · Flametongue Kavu — ETB removal · Bonecrusher Giant — removal AGG · Fable of the Mirror-Breaker — ART TOK SAC · Seasoned Pyromancer — GY TOK SPL · Ball Lightning — AGG · Fury — ETB removal REAN · Hellrider — AGG TOK · Siege-Gang Commander — TOK SAC ETB · Chandra, Torch of Defiance — CTRL RAMP removal · Glorybringer — EVA removal FAT · Goldspan Dragon — EVA ART RAMP · Thundermaw Hellkite — EVA AGG · Shivan Dragon — EVA FAT · Inferno Titan — FAT ETB removal

### Green (24)
Llanowar Elves — RAMP · Birds of Paradise — RAMP · Sakura-Tribe Elder — RAMP LND SAC · Lotus Cobra — RAMP LND · Tarmogoyf — AGG GY · Scavenging Ooze — GY LIFE CTR · Eternal Witness — ETB GY · Tireless Tracker — LND ART CTR · Courser of Kruphix — LND LIFE · Thrun, the Last Troll — AGG · Questing Beast — AGG · Vengevine — AGG GY · Rancor — AGG GY · Thragtusk — ETB LIFE SAC · Polukranos, World Eater — CTR removal · Garruk Wildspeaker — RAMP TOK · Garruk Relentless — TOK removal · Acidic Slime — ETB removal · Nissa, Who Shakes the World — LND RAMP · Rampaging Baloths — LND TOK FAT · Titania, Protector of Argoth — LND TOK GY · Primeval Titan — FAT LND RAMP · Avenger of Zendikar — LND TOK FAT · Craterhoof Behemoth — FAT AGG TOK

### Gold (20)
WU: Teferi, Hero of Dominaria — CTRL · Reflector Mage — ETB removal
UB: Psychic Frog — GY AGG REAN · Baleful Strix — ETB CTRL ART
UR: Expressive Iteration — SPL · Fire // Ice — removal SPL
BR: Kolaghan's Command — removal GY ART · Falkenrath Aristocrat — SAC AGG
RG: Bloodbraid Elf — AGG ETB · Huntmaster of the Fells — ETB TOK LIFE
GW: Knight of the Reliquary — LND AGG · Voice of Resurgence — TOK SAC
WB: Lingering Souls — TOK GY EVA · Sorin, Lord of Innistrad — TOK LIFE
GU: Uro, Titan of Nature's Wrath — LND GY RAMP · Mystic Snake — counter ETB
BG: Grist, the Hunger Tide — TOK SAC GY · Maelstrom Pulse — removal
RW: Lightning Helix — removal LIFE SPL · Figure of Destiny — AGG

### Colorless (18)
Umezawa's Jitte — ART AGG · Sword of Fire and Ice — ART AGG · Sword of Feast and Famine — ART AGG · Sword of Light and Shadow — ART AGG GY · Batterskull — ART LIFE · Skullclamp — ART SAC TOK · Walking Ballista — ART CTR · Hangarback Walker — ART CTR TOK SAC · Smuggler's Copter — ART AGG EVA · Mind Stone — ART RAMP · Everflowing Chalice — ART RAMP · Coalition Relic — ART RAMP · Solemn Simulacrum — ART ETB RAMP · Karn, Scion of Urza — ART CTRL · Wurmcoil Engine — ART FAT LIFE · Platinum Angel — ART FAT · Karn Liberated — CTRL FAT removal · Ugin, the Spirit Dragon — CTRL FAT removal

### Lands (22)
Original duals (LND): Tundra, Underground Sea, Badlands, Taiga, Savannah, Scrubland, Volcanic Island, Bayou, Plateau, Tropical Island.
Fetchlands (LND GY): Flooded Strand, Polluted Delta, Bloodstained Mire, Wooded Foothills, Windswept Heath, Marsh Flats, Scalding Tarn, Verdant Catacombs, Arid Mesa, Misty Rainforest.
Creature lands (LND AGG): Mishra's Factory, Mutavault.

## Decks this cube wants you to find

| # | Deck | Colours | Engine | Signposts |
|---|---|---|---|---|
| 1 | Boros heroes & equipment | R W | One- and two-drops (Mother of Runes, Thalia, Adeline, Goblin Guide, Swiftspear, Ragavan), Stoneforge into Jitte/Batterskull/Swords, Hellrider and Hero of Bladehold, burn to finish; Mishra's Factory and Mutavault as extra threats | Lightning Helix, Figure of Destiny |
| 2 | Izzet spells & tempo | U R | Cantrips and burn fuelling Delver, Swiftspear, Dragon's Rage Channeler, both Pyromancers and Murktide; Snapcaster, Brazen Borrower and counters to protect a lead | Expressive Iteration, Fire // Ice |
| 3 | Azorius flash & blink | W U | ETB creatures (Thraben Inspector, Skyclave, Man-o'-War, Mulldrifter, Venser, Sower) replayed by Ephemerate, Flickerwisp, Restoration Angel and Phantasmal Image; counters, Wrath and Sun Titan on top | Teferi, Hero of Dominaria; Reflector Mage |
| 4 | Dimir control & reanimation | U B | Thoughtseize, kill spells, Force/Counterspell/Cryptic, Fact or Fiction and Jace; Psychic Frog, Liliana of the Veil and Fact or Fiction bin a fatty for Reanimate/Animate Dead (Consecrated Sphinx, Grave Titan, Kokusho, Sheoldred) | Psychic Frog, Baleful Strix |
| 5 | Rakdos sacrifice & recursion | B R | Bloodghast, Bitterblossom, Young Pyromancer, Fable, Siege-Gang and Hangarback as fodder; Falkenrath Aristocrat, Siege-Gang, Bone Shards as outlets; Blood Artist, Kokusho, Skullclamp as payoffs | Kolaghan's Command, Falkenrath Aristocrat |
| 6 | Golgari graveyard midrange | B G | Tarmogoyf, Scavenging Ooze, Vengevine, Bloodghast and Eternal Witness off fetchlands and removal; both Lilianas, Thragtusk and Grist to grind | Grist, the Hunger Tide; Maelstrom Pulse |
| 7 | Green ramp & lands | G + R or U | Llanowar Elves, Birds, Sakura-Tribe Elder, Lotus Cobra, Garruk and Nissa into Primeval Titan, Avenger, Rampaging Baloths, Craterhoof, Inferno Titan, Ugin; Titania and Knight of the Reliquary off fetchlands | Bloodbraid Elf, Huntmaster of the Fells (RG); Uro, Mystic Snake (GU) |
| 8 | White tokens | W + B or G | Adeline, Brimaz, Hero of Bladehold, Wedding Announcement, Elspeth, Bitterblossom, Lingering Souls, Sorin, cashed in with Skullclamp, Hero's and Sorin's anthems and Craterhoof | Lingering Souls, Sorin (WB); Voice of Resurgence, Knight of the Reliquary (GW) |

How they pair off in a two-player draft: the aggressive decks (1, 2, 5, 8) want the cheap creatures and burn, the slower decks (3, 4, 6, 7) want the removal, counters and top end, so the two drafters usually split along that line and the games are aggro against control, the classic matchup. Every colour pair has two gold signposts, so off-plan pairs are real fallbacks rather than trainwrecks.

## Power choices

- **Power Nine: out, all of it, plus Sol Ring, Mana Crypt, Mana Vault and the Moxen.** In a two-player cube both drafters see nearly every card, so a Lotus or Mox is the obvious first pick and a turn-one Mox or Time Walk turns the die roll into the result before the newer player can do anything about it. They're the cards that make a "Vintage" cube, and Justin already has one; Omega is the fair version. They stay in the seed pool (tagged `mtgovc vintage180`), so the cube lab can test them: the first experiment worth running is adding Ancestral Recall, Time Walk and one Mox per colour and seeing whether the draft stays balanced.
- **Instead: two or three iconic bombs per colour, spread so no colour or pick dominates.** White: Elspeth, Sun's Champion, The Wandering Emperor, Baneslayer Angel. Blue: Jace, the Mind Sculptor, Force of Will, Consecrated Sphinx. Black: Sheoldred, the Apocalypse, Liliana of the Veil, Grave Titan, Demonic Tutor. Red: Ragavan, Fable of the Mirror-Breaker, Glorybringer, Inferno Titan. Green: Primeval Titan, Craterhoof Behemoth, Garruk Wildspeaker. Colourless: Umezawa's Jitte, Batterskull, Wurmcoil Engine, Ugin, Karn Liberated (colourless bombs can go in any deck, so there are only a few, and each is expensive or needs Stoneforge).
- **Reanimation: in, kept fair.** Reanimate and Animate Dead are two of black's signature cards, so they're in, but Entomb, Buried Alive, Faithless Looting, Griselbrand, Emrakul, Archon of Cruelty and Atraxa are not. The best targets are six- and seven-drops you'd also hard-cast (Grave Titan, Consecrated Sphinx, Kokusho, Sheoldred, Inferno Titan, Baneslayer, Craterhoof), and binning one takes Psychic Frog, Liliana of the Veil, Fact or Fiction or a dead creature. Answers: Swords, Path, Doom Blade, Control Magic, Scavenging Ooze, counterspells, and Thoughtseize.
- **Out (and in the seed pool for later): Oko, The One Ring, Minsc & Boo, Wrenn and Six, Nadu, Urza's Saga, Balance, Time Walk, Tinker, Sneak Attack, Show and Tell, Natural Order, Survival of the Fittest, Oath of Druids, Channel, Fastbond, Doomsday, Thassa's Oracle, Underworld Breach, Painter's Servant + Grindstone, Dark Depths + Thespian's Stage, Blightsteel Colossus, Library of Alexandria, Bazaar of Baghdad, Strip Mine, Wasteland.** Each is a single pick that decides the draft, a two-card win, or land destruction that ruins the 20-land fixing.
- **Iconic but borderline, kept: Force of Will, Hymn to Tourach, Jitte, Skullclamp, Ragavan, Sheoldred.** Each is a defining card that a newer player should get to play with and against. All six are first in line for the lab to cut if they skew results (see below).

## Cards to watch in testing

- **Umezawa's Jitte** decides creature mirrors and is colourless. If games become Jitte-or-lose, swap it for Sword of War and Peace or Sword of Body and Mind (both in the seed pool).
- **Skullclamp** with Bitterblossom, Lingering Souls, Young Pyromancer and Hangarback is the strongest fair engine. Intended; cut it if the token decks run away with the draft.
- **Sheoldred, the Apocalypse** beats the aggressive decks on her own and is a top reanimation target. If black wins too much, she's the first swap (Phyrexian Obliterator or Massacre Wurm from the pool).
- **Reanimate and Animate Dead** are the closest thing to a cheat plan. If the lab shows turn-two Grave Titans winning, cut Reanimate first.
- **Hymn to Tourach** is the card a newer player is most likely to find miserable. Inquisition of Kozilek is the swap.
- **Rakdos sacrifice** has only three real outlets (Falkenrath Aristocrat, Siege-Gang, Bone Shards). If it's the weakest lane, add Goblin Bombardment (Forge's AI can't use it, see below) or Carrion Feeder.
- **Green removal** is light by design (Scavenging Ooze, Polukranos, Garruk Relentless, Acidic Slime, Maelstrom Pulse). If green ramp keeps losing to fliers, add Beast Within or Ram Through.
- **Platinum Angel and Ugin** are the two cards most likely to feel unbeatable in a slow mirror. They're there because they're iconic and every colour has an answer to an artifact or a planeswalker (Swords, Council's Judgment, Kolaghan's Command, Acidic Slime, Maelstrom Pulse, Karn Liberated, burn, haste).

## How to draft it

Grid draft (18 grids of 9 from a shuffled 162) is recommended: both players see nearly the whole cube and can plan around the bombs the other one is taking. Winston works too and keeps more secrets. Build 40 cards with 16–17 lands (16 if you have two mana creatures), and keep a basic land box. Best of three, sideboarding from your drafted pool.

## Overlap

How v1 relates to the seed pool's source lists. Counts come from `omega-seed-pool.tsv` (`sources` column); the verification script recomputes them.

| Source | Cards in source | In Omega v1 | Share of Omega | Only from this source |
|---|---|---|---|---|
| MTGO Vintage Cube (Cube Cobra mtgovc, 2026-08-19, 540 cards) | 540 | 92 | 51% | 2 |
| Vintage Cube two-player (vintage-cube-180.md) | 180 | 108 | 60% | 0 |
| Modern-Era Cube (modern-era-cube-180.md) | 180 | 88 | 48% | 11 |
| Synergy Cube (synergy-cube-180.md) | 180 | 63 | 35% | 4 |
| Pauper Cube (pauper-cube-180.md) | 180 | 18 | 10% | 0 |
| **New to all five lists** (Omega additions) | 80 | **43** | 23% | 43 |

Cards can sit in several lists, so the "In Omega v1" column sums past 180. 135 of the 180 come from at least one of Justin's four cubes, 92 are in the current MTGO Vintage Cube, and 43 are new (in none of the five). Of the 137 carried-over cards, 17 appear in 1 source, 41 appear in 2 sources, 50 appear in 3 sources, 25 appear in 4 sources, 4 appear in 5 sources.

**The 43 new cards:** Acidic Slime, Arc Trail, Ball Lightning, Baneslayer Angel, Bitterblossom, Consecrated Sphinx, Control Magic, Doom Blade, Exalted Angel, Fact or Fiction, Falkenrath Aristocrat, Fire // Ice, Flametongue Kavu, Garruk Relentless, Goldspan Dragon, Grave Titan, Hero of Bladehold, Huntmaster of the Fells, Hypnotic Specter, Incinerate, Kokusho, the Evening Star, Liliana, the Last Hope, Maelstrom Pulse, Mishra's Factory, Morphling, Mutavault, Mystic Snake, Phyrexian Arena, Platinum Angel, Rampaging Baloths, Ravenous Chupacabra, Shivan Dragon, Shriekmaw, Siege-Gang Commander, Sorin, Lord of Innistrad, Sower of Temptation, Sword of Feast and Famine, Sword of Light and Shadow, Thrun, the Last Troll, Ugin, the Spirit Dragon, Vengevine, Venser, Shaper Savant, Wedding Announcement.

The cube is most like Justin's two-player Vintage Cube (the fair half of it, without the Power and the cheat decks) crossed with the Modern-Era Cube's creature-and-removal games. Only 18 cards come from the Pauper Cube, all of them commons that were always staples at every rarity (Lightning Bolt, Counterspell, Brainstorm, Mulldrifter, Llanowar Elves). The 43 new cards are mostly older icons none of the five lists carries any more (Baneslayer, Shivan Dragon, Hypnotic Specter, Grave Titan, Kokusho, Flametongue Kavu, Control Magic, Fact or Fiction), plus the Swords of X and Y, Ugin, Mishra's Factory and Mutavault.

## The seed pool

`omega-seed-pool.tsv` holds the 938 candidates the cube lab can swap in: the full MTGO Vintage Cube (540, Cube Cobra `mtgovc`, version of 2026-08-19), the four source cubes (180 each, heavily overlapping), and 80 additions judged missing (recent-set staples and Legacy-era icons, listed in the `sources` column as `added`). Columns: name, colour identity, type, mana value, theme tags (vocabulary above), sources, forge_supported, forge_ai_flag (All, Random or none), in_omega_v1.

- Names are Scryfall's exact names; double-faced and "prepare" cards use the front face, as Forge does (Delver of Secrets, Fable of the Mirror-Breaker, Huntmaster of the Fells, Emeritus of Ideation). Split cards keep both halves (Fire // Ice, Life // Death).
- Two MTGO Vintage Cube entries use MTGO-only "Through the Omenpaths" names. They're listed under the Scryfall and Forge names: Kavaero, Mind-Bitten is **Superior Spider-Man**, and Makdee and Itla, Skysnarers is **Spider-Woman, Stunning Savior**.
- Theme tags for v1 cards are hand-written. Pool cards from the Synergy, Vintage and Pauper cubes keep those docs' tags, mapped onto the shared vocabulary. The rest were tagged from oracle text by a keyword heuristic, with hand tags where it missed, so treat pool tags as a starting point.

## Forge notes

All 180 v1 cards, and all 938 pool cards, exist in Forge 2.0.14's card database. None of the 180 carries `AI:RemoveDeck:All`, so the Forge AI can draft and play every card in v1. One card carries `AI:RemoveDeck:Random` (excluded from random AI decks, but playable when the AI is handed it): **Demonic Tutor**, kept because it's black's most famous card and costs nothing in AI play except that random decks skip it.

Cards deliberately left out of v1 because of `AI:RemoveDeck:All`, though they would otherwise fit: Goblin Bombardment, Beast Within, Toxic Deluge, Sylvan Library, Prismatic Ending, Faithless Looting, Viscera Seer, Gideon Jura, Masticore, Embercleave, Mystic Confluence, Mishra's Bauble. The seed pool has 43 cards flagged All and 41 flagged Random; the cube lab should treat All-flagged cards with care, because AI-vs-AI results will undervalue them.

## Iteration log
- v1 (2026-10-03): initial list. 180 cards from a 938-card seed pool; Power Nine out; 8 archetypes; original duals plus fetchlands.

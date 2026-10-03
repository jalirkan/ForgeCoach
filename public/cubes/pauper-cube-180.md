# The Pauper Cube — two-player edition (180 cards)

*Designed 2026-10-03 for Justin and a friend (Grid or Winston draft, 40-card decks, best-of-3). Commons only. Every name was verified on Scryfall and every card exists in Forge 2.0.14. Prices are the cheapest non-promo paper printing on Scryfall that day (USD). Cards were picked for gameplay; price is listed for information only.*

## The commons rule

A card is in bounds if it has **ever been printed at common in any paper or MTGO set**. Scryfall's `rarity:common` on any printing is the test, checked for every card with `!"Name" unique=prints`. This is the same rule The Pauper Cube uses. Under it, Ephemerate, Prismatic Strands, Snuff Out and Kor Skyfisher are all in. Beetleback Chief is the one card here whose only common printing is MTGO-only (Vintage Masters), which the rule allows. Two cards that people often assume are common failed the check and were left out: Stitcher's Supplier and Goblin Bombardment.

## Design principles

1. **Eight archetypes for two players, not ten.** With only two drafters, ten guild decks spread the good cards too thin. Eight pairs (WU, UB, BR, RG, GW, UR, BG, RW) each get two gold signposts, so each lane is deep enough that both players can draft a real deck. WB and GU are left out as lanes, but their gain lands are in, so a WB drain deck or a GU ramp deck can still happen.
2. **Nine overlapping themes.** Most nonland cards belong to two themes, and each colour feeds three or four. A blink creature is also a flier; a token maker is also sacrifice fodder.
3. **Real interaction.** 29 removal spells, spread over every colour: burn in red, kill spells and edicts in black, Journey and O-Ring in white, creature bounce and four counterspells in blue (six counters in all), fight and Ram Through in green, plus Serrated Arrows. Games are decided by creature combat and card advantage, not by who goes off first.
4. **No degenerate combos.** Peregrine Drake is out, so the Ghostly Flicker plus Archaeomancer loop is only a value engine, with no infinite mana. Pestilence is out (Crypt Rats is the one sweeper). Goblin Bombardment fails the commons test anyway. Monarch appears twice (Palace Sentinels, Thorn of the Black Rose); in a two-player game it is a fight over who holds the crown.
5. **Mana for two colours plus a splash.** Ten gain lands (all ten pairs), eight bounce lands (one per archetype), Evolving Wilds and Ash Barrens.
6. **Balanced colours.** 26 cards in each colour, with 3–5 removal spells and a two-drop creature curve in each.

## The themes and how they connect

| Code | Theme | Core idea | Connects to |
|---|---|---|---|
| FLK | ETB / blink | Creatures with enter-the-battlefield value plus Ephemerate, Momentary Blink, Ghostly Flicker, ninjas, Kor Skyfisher, Silver Drake and Cavern Harpy to reuse them | EVA, GY, ART, TOK |
| EVA | Evasion / tempo | Cheap fliers and unblockable creatures that carry ninjas, Rancor and equipment | FLK, SPL, AGG |
| TOK | Tokens / go wide | Spirits, goblins, saprolings, Eldrazi Spawn; Rally, Bushwhacker, Raid Bombardment, Eagles to cash them in | SAC, AGG, EVA |
| SAC | Sacrifice | Fodder (tokens, Carrier Thrall, Myr Sire) plus outlets (Village Rites, Fling, Tortured Existence, Body Dropper) plus payoffs (Falkenrath Noble, Fireblade Artist) | TOK, GY, ART |
| SPL | Spells matter | Cantrips and burn feeding Swiftspear, Guttersnipe, Murmuring Mystic, Delver, delve | EVA, GY, AGG |
| GY | Graveyard | Self-mill (Mire Triton, Satyr Wayfinder, Thought Scour), delve (Gurmag, Tolarian Terror, Treasure Cruise), recursion (Gravedigger, Unearth, Desecrator Hag), flashback | SAC, SPL, FLK, RMP |
| ART | Artifacts | Clues, Food, cantrip artifacts, equipment; Kuldotha Rebirth, Deadly Dispute and Experimental Synthesizer turn them into value | SAC, AGG, FLK |
| RMP | Ramp / big things | Mana elves, Utopia Sprawl, Wall of Roots into Crusher, Tusker, Fireball, Rolling Thunder | GY, TOK, SAC |
| AGG | Aggro / combat | Equipment, auras, haste, combat tricks, anthems | TOK, EVA, SPL, ART |

Two non-theme tags appear as well: `removal` and `counter`.

**Hub cards** that sit in three themes at once: Kor Skyfisher (FLK/EVA/ART), Battle Screech (TOK/EVA/GY), Archaeomancer (FLK/GY/SPL), Mogg War Marshal and Beetleback Chief (TOK/SAC/FLK), Kuldotha Rebirth (ART/TOK/SAC), Yavimaya Elder (RMP/GY/SAC), Generous Ent (RMP/ART/FLK), Nest Invader and Writhing Chrysalis (TOK/SAC/RMP), Bloodwater Entity (SPL/EVA/GY), Flayer Husk and Myr Sire (ART/TOK/SAC). These keep you open when the draft changes direction.

## Archetypes

| Pair | Plan | Signposts | Key commons |
|---|---|---|---|
| WU | Skies and blink: fliers, ETB creatures, flicker | Silver Drake, Judge's Familiar | Kor Skyfisher, Ephemerate, Momentary Blink, Mulldrifter, Man-o'-War, Inspiring Overseer, Ghostly Flicker |
| UB | Ninjas and control: cheap evasive creatures, ninjas, removal, Gary | Cavern Harpy, Dinrova Horror | Moon-Circuit Hacker, Ninja of the Deep Hours, Okiba-Gang Shinobi, Faerie Seer, Gray Merchant, Counterspell, Snuff Out |
| BR | Sacrifice: fodder plus outlets plus drain or burn | Body Dropper, Fireblade Artist | Carrier Thrall, Nested Shambler, Mogg War Marshal, Village Rites, Fling, Falkenrath Noble, Kuldotha Rebirth, Crypt Rats |
| RG | Ramp into big threats and X burn | Writhing Chrysalis, Branching Bolt | Llanowar Elves, Arbor Elf, Utopia Sprawl, Nest Invader, Fireball, Rolling Thunder, Ulamog's Crusher, Bogardan Dragonheart |
| GW | Go-wide tokens | Selesnya Evangel, Qasali Pridemage | Battle Screech, Sprout Swarm, Saproling Migration, Rally the Peasants, Triplicate Spirits, Eagles of the North, Rancor |
| UR | Spells and prowess | Izzet Charm, Bloodwater Entity | Delver, Swiftspear, Guttersnipe, Murmuring Mystic, Tolarian Terror, Firebrand Archer, cantrips and burn |
| BG | Graveyard value | Glowspore Shaman, Desecrator Hag | Mire Triton, Satyr Wayfinder, Gravedigger, Tortured Existence, Gurmag Angler, Grapple with the Past, Pulse of Murasa, Krosan Tusker |
| RW | Aggro and equipment | Tenth District Legionnaire, Dog Walker | Seeker of the Way, Swiftspear, Rimrock Knight, Goblin Bushwhacker, Bonesplitter, Ancestral Blade, Raid Bombardment, Skewer the Critics |

## The list (name — themes, price)

### White (26)
Thraben Inspector — ART FLK 0.19 · Doomed Traveler — SAC TOK 0.05 · Faerie Guidemother — EVA AGG 0.09 · Seeker of the Way — SPL AGG 0.15 · Stormfront Pegasus — EVA AGG 0.12 · Kor Skyfisher — FLK EVA ART 0.42 · Attended Knight — TOK FLK 0.09 · Lone Missionary — FLK 0.21 · Search Party Captain — TOK AGG 0.17 · Inspiring Overseer — FLK EVA 0.14 · Militia Bugler — FLK 0.09 · Palace Sentinels — FLK 0.15 · Eagles of the North — EVA AGG TOK 0.28 · Battle Screech — TOK EVA GY 0.14 · Triplicate Spirits — TOK EVA 0.12 · Raise the Alarm — TOK SPL 0.10 · Rally the Peasants — TOK AGG GY 0.15 · Prismatic Strands — TOK SPL GY 6.53 · Ephemerate — FLK SPL 3.77 · Momentary Blink — FLK GY SPL 0.13 · Ancestral Blade — ART TOK AGG 0.09 · Journey to Nowhere — removal FLK 0.21 · Oblivion Ring — removal FLK 0.16 · Settle Beyond Reality — removal FLK 0.06 · Sunlance — removal 0.13 · Faith's Fetters — removal 0.04

### Blue (26)
Faerie Seer — EVA 0.34 · Delver of Secrets — SPL EVA 0.32 · Spellstutter Sprite — EVA FLK counter 3.79 · Moon-Circuit Hacker — EVA 0.20 · Augur of Bolas — SPL FLK 0.15 · Ninja of the Deep Hours — EVA FLK 1.44 · Pestermite — FLK EVA 0.23 · Man-o'-War — FLK removal 0.10 · Mist Raven — FLK EVA removal 0.06 · Cloudkin Seer — FLK EVA 0.15 · Archaeomancer — FLK GY SPL 0.30 · Murmuring Mystic — SPL TOK 0.32 · Mulldrifter — FLK EVA 0.29 · Tolarian Terror — SPL GY 0.16 · Brainstorm — SPL 0.73 · Ponder — SPL 1.62 · Preordain — SPL 0.64 · Thought Scour — SPL GY 0.42 · Snap — SPL EVA 3.08 · Counterspell — counter SPL 1.87 · Mana Leak — counter SPL 0.18 · Exclude — counter FLK 0.15 · Ghostly Flicker — FLK SPL 1.13 · Hard Evidence — ART SPL 0.22 · Deep Analysis — GY SPL 0.14 · Treasure Cruise — GY SPL 0.24

### Black (26)
Mire Triton — GY FLK 0.18 · Carrier Thrall — SAC TOK 0.12 · Nested Shambler — SAC TOK 0.23 · Unwilling Ingredient — SAC GY 0.17 · Plagued Rusalka — SAC removal 0.05 · Dusk Legion Zealot — FLK 0.20 · Chittering Rats — FLK 0.16 · Gravedigger — FLK GY 0.05 · Falkenrath Noble — SAC EVA 0.15 · Crypt Rats — SAC removal 0.58 · Okiba-Gang Shinobi — EVA 1.07 · Thorn of the Black Rose — FLK 0.18 · Gray Merchant of Asphodel — FLK 0.79 · Gurmag Angler — GY 0.18 · Cast Down — removal 0.42 · Disfigure — removal 0.06 · Tragic Slip — removal SAC 0.18 · Vicious Offering — removal SAC 0.08 · Snuff Out — removal 5.75 · Village Rites — SAC SPL 0.34 · Deadly Dispute — SAC ART 0.31 · Night's Whisper — SPL 0.31 · Unearth — GY FLK 0.51 · Tortured Existence — GY SAC 3.40 · Blood Fountain — ART GY 0.31 · Ecstatic Awakener — SAC 0.10

### Red (26)
Monastery Swiftspear — SPL AGG 0.28 · Fanatical Firebrand — SAC AGG 0.08 · Firebrand Archer — SPL 0.24 · Mogg War Marshal — TOK SAC FLK 0.21 · Goblin Bushwhacker — AGG TOK 1.07 · Rimrock Knight — AGG SPL 0.10 · Beetleback Chief — TOK FLK SAC 0.22 · Guttersnipe — SPL 0.23 · Ardent Elementalist — GY FLK SPL 0.15 · Bogardan Dragonheart — SAC EVA 0.17 · Dragon Fodder — TOK SAC 0.10 · Kuldotha Rebirth — ART TOK SAC 0.26 · Hordeling Outburst — TOK SPL 0.31 · Raid Bombardment — TOK AGG 0.22 · Experimental Synthesizer — ART SAC 0.33 · Lightning Bolt — removal SPL 0.73 · Chain Lightning — removal SPL 0.26 · Burst Lightning — removal SPL 0.16 · Galvanic Discharge — removal 0.29 · Flame Slash — removal 0.15 · Fireball — removal RMP 0.12 · Rolling Thunder — removal RMP 0.14 · Faithless Looting — GY SPL 0.36 · Wrenn's Resolve — SPL 1.44 · Skewer the Critics — SPL AGG 0.16 · Fling — SAC SPL 0.14

### Green (26)
Llanowar Elves — RMP 0.24 · Arbor Elf — RMP 0.41 · Utopia Sprawl — RMP 1.17 · Sakura-Tribe Elder — RMP SAC 0.30 · Wall of Roots — RMP 0.19 · Satyr Wayfinder — GY 0.06 · Nest Invader — TOK SAC RMP 0.28 · Basking Broodscale — TOK SAC 0.24 · Jewel Thief — ART AGG 0.15 · Llanowar Visionary — RMP FLK 0.15 · Yavimaya Elder — RMP GY SAC 0.14 · Mother Bear — TOK GY 0.23 · Werebear — RMP GY 0.17 · Owlbear — FLK 0.28 · Conclave Naturalists — FLK removal 0.08 · Krosan Tusker — RMP GY 0.07 · Annoyed Altisaur — RMP FLK 0.13 · Generous Ent — RMP ART FLK 1.76 · Wildheart Invoker — RMP AGG 0.04 · Sprout Swarm — TOK 3.91 · Saproling Migration — TOK 0.23 · Rancor — AGG GY 1.02 · Ram Through — removal 0.33 · Bushwhack — removal RMP 0.18 · Pulse of Murasa — GY 0.13 · Grapple with the Past — GY RMP 0.16

### Gold (16)
WU: Silver Drake — FLK EVA 0.15 · Judge's Familiar — EVA counter 0.22
UB: Cavern Harpy — FLK EVA 0.27 · Dinrova Horror — FLK removal 0.10
BR: Body Dropper — SAC 0.21 · Fireblade Artist — SAC 0.10
RG: Writhing Chrysalis — TOK SAC RMP 0.26 · Branching Bolt — removal 0.13
GW: Selesnya Evangel — TOK 0.13 · Qasali Pridemage — AGG removal 0.23
UR: Izzet Charm — SPL removal counter 0.20 · Bloodwater Entity — SPL EVA GY 0.20
BG: Glowspore Shaman — GY FLK 0.23 · Desecrator Hag — GY FLK 0.14
RW: Tenth District Legionnaire — AGG SPL 0.18 · Dog Walker — TOK AGG 0.14

### Colorless (14)
Bonesplitter — ART AGG 0.18 · Vault Skirge — ART AGG EVA 0.31 · Prophetic Prism — ART FLK 0.06 · Mind Stone — ART RMP 0.25 · Ichor Wellspring — ART SAC 0.47 · Chromatic Star — ART SAC 0.28 · Candy Trail — ART SAC 1.42 · Flayer Husk — ART TOK SAC 0.18 · Myr Sire — ART SAC TOK 0.16 · Perilous Myr — ART SAC 0.15 · Serrated Arrows — ART removal 0.31 · Renegade Freighter — ART AGG 0.10 · Guardian Idol — ART RMP 0.31 · Ulamog's Crusher — RMP 0.22

### Lands (20)
Gain lands: Tranquil Cove 0.06 · Dismal Backwater 0.08 · Bloodfell Caves 0.14 · Rugged Highlands 0.11 · Blossoming Sands 0.15 · Scoured Barrens 0.12 · Swiftwater Cliffs 0.11 · Jungle Hollow 0.14 · Wind-Scarred Crag 0.08 · Thornwood Falls 0.12
Bounce lands: Azorius Chancery 0.16 · Dimir Aqueduct 0.25 · Rakdos Carnarium 0.32 · Gruul Turf 0.24 · Selesnya Sanctuary 0.19 · Izzet Boilerworks 0.25 · Golgari Rot Farm 0.28 · Boros Garrison 0.19
Fetch: Evolving Wilds 0.09 · Ash Barrens 0.16

## Decks this cube wants you to find

- **Azorius blink-skies:** Kor Skyfisher and Silver Drake bounce Mulldrifter, Man-o'-War or Inspiring Overseer to replay them; Ephemerate, Momentary Blink and Ghostly Flicker double up; Prophetic Prism and the bounce lands are extra value off Skyfisher.
- **Dimir ninjas:** Faerie Seer, Spellstutter Sprite, Delver, Vault Skirge and Judge's Familiar connect, then Ninja of the Deep Hours, Moon-Circuit Hacker or Okiba-Gang swap in; returning a Mist Raven or Chittering Rats to replay it is the payoff. The control version adds Counterspell, Exclude, Gray Merchant and Dinrova Horror.
- **Rakdos sacrifice:** Mogg War Marshal, Carrier Thrall, Nested Shambler, Dragon Fodder and Kuldotha Rebirth as fodder; Village Rites, Vicious Offering, Fling, Tortured Existence and Body Dropper as outlets; Falkenrath Noble, Fireblade Artist and Bogardan Dragonheart as payoffs. Crypt Rats resets the board.
- **Gruul ramp:** Llanowar Elves, Arbor Elf with Utopia Sprawl, Wall of Roots and Nest Invader into Ulamog's Crusher, Writhing Chrysalis, Krosan Tusker and Annoyed Altisaur, with Fireball and Rolling Thunder as finishers.
- **Selesnya tokens:** Battle Screech, Triplicate Spirits, Sprout Swarm, Saproling Migration and Selesnya Evangel go wide; Rally the Peasants, Eagles of the North and Raid Bombardment cash in. Prismatic Strands wins combat.
- **Izzet spells:** cheap cantrips and burn with Swiftspear, Delver, Guttersnipe, Firebrand Archer, Murmuring Mystic, Tolarian Terror and Treasure Cruise; Ardent Elementalist and Bloodwater Entity give spells back.
- **Golgari graveyard:** Mire Triton, Satyr Wayfinder, Glowspore Shaman and Thought Scour fill the yard; Gravedigger, Desecrator Hag, Unearth, Pulse of Murasa and Tortured Existence reuse it; Gurmag Angler and Krosan Tusker are the bodies.
- **Boros aggro:** Seeker of the Way, Swiftspear, Rimrock Knight and Tenth District Legionnaire with Bonesplitter, Ancestral Blade, Faerie Guidemother, Goblin Bushwhacker and Skewer the Critics.
- **Off-lane decks the gain lands allow:** Orzhov drain (Gray Merchant, Crypt Rats, Battle Screech, Lone Missionary) and Simic ramp-blink (elves and Mulldrifter, Annoyed Altisaur, Ghostly Flicker).

## Cards to watch in testing

- **Prismatic Strands, Snuff Out, Ephemerate, Spellstutter Sprite, Tortured Existence** are the strongest commons here. They are meant to be early picks.
- **Crypt Rats** is the only sweeper. If go-wide decks run away, add Pestilence; if Rats dominates, swap it for Vampire Sovereign.
- **Ghostly Flicker plus Archaeomancer** loops every turn for 3 mana. That is fine without Peregrine Drake. Never add the Drake.
- **Monarch** (Palace Sentinels, Thorn of the Black Rose) is swingy in one-on-one games. Cut one if it decides too many games.
- **Basking Broodscale** only goes infinite with Blowfly Infestation or Ashnod's Altar style cards, and neither is in the cube. Keep it that way.
- **Forge AI flags (2.0.14):** these cards carry `AI:RemoveDeck`, so Forge's AI plays them badly or skips them in deckbuilding. Rated `All`: Prismatic Strands, Ghostly Flicker, Tortured Existence, Bogardan Dragonheart, Faithless Looting, Utopia Sprawl, Fireblade Artist, Prophetic Prism, Chromatic Star. Rated `Random`: Plagued Rusalka, Kuldotha Rebirth, Fling, Ichor Wellspring. All of them work in Forge; this only matters when the AI drafts or pilots them.

## How to draft it

Grid draft is the recommended method. Lay out 9 cards from a shuffled 162 in a 3×3 grid, face up. Player A takes any row or column (3 cards). Player B takes a remaining row or column (2–3 cards). Discard the rest. Repeat 18 times, alternating who picks first. You see the whole pool and can plan a deck around the hub cards.

Winston works too. Shuffle 90 (or all 180) face down and deal three one-card piles. On your turn, look at pile 1 and either take it or add a card from the stack and move to pile 2, then pile 3. If you pass all three, take the top card of the stack blind.

Build 40 cards with 17 lands (16 with Utopia Sprawl or elves). Bounce lands count as one and a half lands. Play best-of-3 with sideboarding from your drafted pool.

## Cost

- **Everything real: $78.43** for all 180 cards (White 13.78, Blue 18.27, Black 15.88, Red 7.92, Green 12.05, Gold 2.89, Colorless 4.40, Lands 3.24).
- The seven cards over $3 (Prismatic Strands 6.53, Snuff Out 5.75, Sprout Swarm 3.91, Spellstutter Sprite 3.79, Ephemerate 3.77, Tortured Existence 3.40, Snap 3.08) are $30 together. The other 173 cost about $48.
- Cost was not a selection criterion. Proxy anything you would rather not buy. Basic lands are not counted.

## Iteration log
- v1 (2026-10-03): initial list. Built from The Pauper Cube's archetypes and staples (cubecobra.com/cube/list/thepaupercube), trimmed to eight lanes for two players. Stitcher's Supplier and Goblin Bombardment were replaced by Mire Triton and Raid Bombardment because neither has a common printing.

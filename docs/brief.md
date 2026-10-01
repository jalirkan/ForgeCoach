# Forge coaching system — project brief

*Written 2026-10-01 for a Claude Code session on Justin's Linux install. Context: Justin is a newer Magic player (started September 2026) who has been coached through about ten games against the Forge AI via screenshots. The screenshot workflow produced perception errors (tapped vs untapped, summoning sickness, cards already cast this turn, mana available) and occasional card-text errors from memory. The goal is to replace it with direct access to game state.*

## Goal

A local tool that, at each decision point in a Forge game, gives Justin a concrete recommended action with a one-paragraph reason, based on exact game state and exact card text. Coaching style: tell him the play, name the heuristic it follows, flag the trap. Keep the full-game review (what went well, what to fix) as a separate mode run on the log after a game.

## What Forge exposes (verify first)

Forge is open source (Java), at github.com/Card-Forge/forge. Things to check in order:
1. **Game log.** Forge keeps a per-game log in the UI and can write it to disk; endstep.cc exports the same format (markdown with `## T7 — Pacho`, `### MAIN1`, zone-change lines like `*Bloodghast*: Battlefield -> Graveyard`). Two example logs from Justin's games are in the project (`gameLog1`, `gameLog2`). The log records every zone change, mana ability, cast, trigger, and damage event, so full state can be reconstructed from log + both deck lists.
2. **Live state.** Forge has a developer mode (Settings → Preferences → "Developer Mode") that exposes debug commands and can dump game state; check `forge-gui/src/main/java/forge/gamemodes/match` and the `GameState` serialization used by the puzzle mode (`forge-gui/res/puzzle/*.pzl` files are a readable state format: `humanlife`, `humanhand`, `humanbattlefield` with `|Tapped|SummonSick|Counters:P1P1=2` annotations). If the running game can be exported in that format, that's the ideal input.
3. **Card text.** Forge's card definitions live in `forge-gui/res/cardsfolder/` as plain text (`Name:`, `ManaCost:`, `Types:`, `Oracle:`), so exact rules text is available offline. Scryfall's API (api.scryfall.com/cards/named?exact=...) is the online fallback.

## Architecture (suggested)

- `state.py`: parse a Forge log (and/or puzzle-format state dump) plus deck lists into a state object: turn, phase, active player, each player's life/hand/library count, each permanent with controller, tapped, summoning-sick, counters, attachments, damage; graveyards; what has been cast this turn (for revolt, prowess, "first spell" effects).
- `cards.py`: load rules text for every card in both decks from Forge's cardsfolder; cache.
- `advise.py`: build the prompt: compact state table + rules text for every card in hand and on the battlefield + the deck's play guide (see below) → call Claude → print the recommendation. Keep the prompt deterministic and small; the point is that the model never has to guess what's tapped.
- `watch.py`: tail the log file; when it reaches a decision point for Justin (his main phase, declare attackers, declare blockers, or priority with instants available), run `advise.py` and print to a terminal next to Forge.
- `review.py`: after a game, summarize mistakes and good plays from the full log, same format as the reviews in this project.

Start with `state.py` + `advise.py` run by hand (paste or point at the log), get the recommendations correct, then add the watcher.

## Rules details the advisor must get right (from errors made in this project)

- Summoning sickness: a creature that entered this turn can't attack or use {T} abilities; it CAN use abilities without a tap symbol, and can be sacrificed, equipped, or targeted.
- Tap symbol in activated abilities: `{1}, {T}:` is once per untap; `{1}:` with no tap can be activated repeatedly. (Hangarback Walker is the former; Edgar's pump is the latter.)
- Which spells trigger "whenever you cast an instant or sorcery" (Young Pyromancer): instants and sorceries only, not artifacts, enchantments, or creatures.
- Equip is sorcery-speed, activated from the equipment, and can target a summoning-sick creature. Skullclamp on a 1-toughness creature kills it immediately (state-based action), triggering its draw.
- Prepared (Reality Fracture): the copy is cast, not activated; it's a spell for prowess/Pyromancer purposes. Lost if the creature leaves.
- Triggered abilities ("whenever X dies/attacks") work regardless of whether the source is tapped.
- Revolt (Fatal Push): on if any permanent you controlled left the battlefield this turn, including a fetchland or a sacrificed creature.
- Bloodghast: can't block; haste only while an opponent is at 10 or less; returns on landfall (each land, including fetched ones).
- Gravecrawler: can't block; recast from graveyard only while you control a Zombie (Stitcher's Supplier, Carrion Feeder are Zombies).
- Count lethal both ways before every attack and block.

## Decks in use

All lists are in the project docs: `synergy-cube-180.md` (the Rakdos sacrifice deck is in the chat history; reproduced below), `fra-pool-red-white-aggro.md` (red-white aggro, green-black ideal, white-blue Marvel merge), `reality-fracture-practice-decks.md`, `shield-pym-jumpstart-deck.md`.

Rakdos sacrifice (cube practice deck):
```
1 Viscera Seer
1 Carrion Feeder
1 Gravecrawler
1 Stitcher's Supplier
1 Blood Artist
1 Zulaport Cutthroat
1 Priest of Forgotten Gods
1 Young Pyromancer
1 Ophiomancer
1 Bloodghast
1 Juri, Master of the Revue
1 Mayhem Devil
1 Woe Strider
1 Midnight Reaper
1 Pia Nalaar
1 Pia and Kiran Nalaar
1 Hangarback Walker
1 Skullclamp
1 Goblin Bombardment
1 Village Rites
1 Deadly Dispute
1 Lightning Bolt
1 Fatal Push
1 Blood Crypt
1 Bloodstained Mire
1 Marsh Flats
1 Scalding Tarn
7 Swamp
6 Mountain
```

Play guide for it: lead with fodder, hold payoffs (Blood Artist, Zulaport, Devil) until there's an instant-speed outlet on the board (Seer, Bombardment, Rites, Dispute); respond to removal by sacrificing the target; Juri is a Fireball once she's big (her death trigger deals her power to any target); Skullclamp only on 1-toughness creatures; Gravecrawler + Bombardment + a Zombie is a 1-mana ping loop; don't chump with Stitcher's Supplier while the Crawler loop matters; keep count of outlets on board (0 = play like a creature deck, 1 = engine on, 2 = count drains, game ends soon).

## Coaching behavior spec

- Always state assumptions about state explicitly if anything is ambiguous, rather than guessing.
- Before recommending an activation or attack, check: is it summoning sick, does the ability need {T}, is the mana actually available (count untapped lands by color), has the land drop been used.
- Give one recommended line, in order, with mana accounting. Offer an alternative only when it's close.
- Name the heuristic the line follows ("hold the outlet," "count lethal," "fodder before payoffs") so the pattern transfers.
- Flag what the opponent can do next turn and what to keep back for it.
- Post-game review: at most three mistakes, each tied to a general rule; note what went well.

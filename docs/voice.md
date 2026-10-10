<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
# ForgeCoach — voice and words

The editor's sheet for every word a player reads: buttons, headings, help
lines, errors, empty states, the README's player sections. Code identifiers,
hash routes, storage keys and model prompts are not covered here: prompts that
were measured (`livePlan/prompt.ts`, `prompt.ts`'s formats, the bench) stay
byte for byte.

## What it is

**ForgeCoach is a practice table for Magic: play a bot or a friend with a coach
beside the board, then look back at what happened.**

Around the table: cube drafting (against bots, with a friend, or a paper draft
you track by hand), the deck you build from it, and a lab on your PC that
measures cards, decks and bots. It is for a newer player who wants to get
better by playing, not for someone who wants to be told they are good.

Everything runs in your browser. The engine (Forge, through mtg-table) and,
if you like, Claude Code run on your own PC. Nothing goes to a ForgeCoach
server, because there isn't one.

## The voice

A calm coach sitting next to you at the table.

- **Plain.** Words a player uses at a kitchen table. No decision numbers
  (D414), no protocol names, no file formats unless you are asked to handle
  the file.
- **Direct.** Say what it does. "Copy list", not "Click here to copy your deck
  list to the clipboard".
- **Specific.** "Sonnet 5.5", "your turn", "18 grids of 9". Not "the model",
  "at the right time", "lots of cards".
- **Honest about how sure we are.** A number comes with what it measures and
  how sure it is. "Not shown" is not "no effect"; a close call is never called
  a mistake; an estimate says it is an estimate. This is part of the character,
  not a footnote.
- **Never hype.** No "powerful", "smart", "seamless". The bot is not "the
  Forge AI" when it may be the search AI; the coach is not "always right".
- **Short.** One sentence where one will do. Delete text that restates the
  button above it.

## Glossary — one name per thing

| Say | For | Not |
| --- | --- | --- |
| **the bot** | the computer opponent at the table, whichever AI drives it | the Forge AI, the AI, Forge (as the opponent) |
| **Forge** | the rules engine, and its own AI when that specific AI matters (lab games, the engine review's yardstick, the opponent picker) | — |
| **the engine** / **the engine on your PC** | what `play.sh` or the app-menu launcher starts: Forge through mtg-table, plus the helper that serves reviews, win chance, rooms and bug reports | the coach helper, the helper, the bridge |
| **the coach** | Claude, giving advice | the assistant, the AI |
| **Claude Code on your PC** | the no-key coach source | the coach helper, the local helper |
| **API key** / **your API key** | your own Anthropic key | the key (alone is fine after the first mention) |
| **Auto-coach** | the coach asking on its own at the moments that matter | — |
| **Steps / Short / Detailed** | the three coach styles during a game | plan mode (Steps), terse |
| **Play vs Bot** | a game against the bot | Play vs Forge |
| **Draft vs Bot** | a cube draft against bots, then a match | Draft vs AI |
| **Draft with a friend** | a two-person grid draft through your PC, then a best of three | — |
| **Draft & build** | the deck assistant for paper drafts | Paper draft helper |
| **replay** | stepping through a recorded game | — |
| **game review** | the coach's whole-game summary | — |
| **engine review** | the engine's grade of every decision | — |
| **film room** | the turning points after a game | — |
| **Practice** | puzzles from your own games | — |
| **Your record** | the games you finished, kept in this browser | history |
| **the lab** | the overnight runs on your PC that measure cubes and bots | the runner (unless the page is about the runner) |
| **win chance** | the engine's estimate of your chances | eval, win probability |
| **your seat** | your place at a table ("Take your seat") | the seat socket |

## Rules for each kind of text

- **Buttons are verbs.** "Play", "Copy list", "Hand in this deck", "Explain
  this moment". A toggle names the thing it turns on.
- **Headings are nouns.** "Coach style", "Your record", "Turning point 2".
- **Help lines are one sentence:** what it does and where it shows. "Used for
  replays, reviews, practice and drafting — everything except a game in
  progress."
- **Errors say what happened, then what to do.** "Couldn't reach the engine on
  your PC: start ForgeCoach again (the app-menu launcher, or ./scripts/play.sh)."
- **Empty states say what will appear here and how to get it.** "No games yet.
  Every game you finish with Play vs Bot lands here."
- **Numbers always say what they measure and how sure they are.** A rate comes
  with its games or its interval; "strong" or "weak" only when the interval
  says so.
- **Settings say what changes and where.** Each setting names the screens it
  touches; a default is named as the default.

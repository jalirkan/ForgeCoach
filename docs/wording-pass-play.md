<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
# Wording pass — proposals for `src/ui/play/`

The wording pass (branch `claude/wording-pass`, voice and glossary in
`docs/voice.md`) did not touch `src/ui/play/`: the board is being built there by
another session. These are the edits it proposes, written to the same voice, for
that session to apply verbatim. Line numbers are against `origin/main` at
c184a05; search for the old text if the file has moved.

Why, in one line: the opponent is no longer always Forge's own AI (the search
AI is the default since mtg-table D414, and a table can be a friend), so the
board calls the opponent **the bot** (or its name) and the rules engine **the
engine**; Forge stays only where the specific AI matters. Steps is the default
coach style and asks at the opening hand too.

Tests that match the old text are named; update them in the same commit.

## Coach (PlanCoach.tsx, PlayCoach.tsx)

1. **`PlanCoach.tsx:59`** — Steps' Auto-coach help leaves out the opening hand
   (it asks at the mulligan and play/draw), and "blocks" reads as a noun list
   item without an owner.
   - old: `'Asks at your turn, a spell of theirs you could answer, blocks, their end step and the engine’s questions.'`
   - new: `'Asks at your opening hand, your turn, a spell of theirs you could answer, your blocks, their end step and the engine’s questions.'`
   - Matches Settings → Coach style's wording.

2. **`PlayCoach.tsx:63`** — Short/Detailed Auto-coach help; same words as
   Settings → Coach style ("at their end step").
   - old: `'Plans your next turn during your opponent’s end step.'`
   - new: `'Plans your next turn at their end step.'`

3. **`PlanCoach.tsx:202`** and **`PlayCoach.tsx:244`** — the Auto-coach
   switch's tooltip. "or your API key" reads as if both were used; it is one or
   the other, as Settings → Coach source says.
   - old: `` `${PLAN_AUTO_HELP} Uses Claude Code on your PC, or your API key.` `` (and the same with `AUTO_HELP`)
   - new: `` `${PLAN_AUTO_HELP} Answers come from Claude Code on your PC or your API key (Settings → Coach source).` ``

## The engine, not Forge (inputView.ts, DecisionSlot.tsx, PhaseStrip.tsx, askModel.ts, PlayView.tsx)

4. **`inputView.ts:178`** — the engine asks, whoever the opponent is.
   - old: `'Forge has a question for you'`
   - new: `'The engine has a question for you'`

5. **`inputView.ts:180–181`** — while nobody has priority to show, the line
   says "Forge is thinking…". Against the search AI or a friend that is wrong.
   - old: `` const who = state ? playerName(state, state.priority ?? state.activePlayer, seat) : 'Forge'; ``
     `` return base('waiting', state?.phase ? `${who === 'You' ? 'Forge' : who} is thinking…` : 'Setting up the game…'); ``
   - new: `` const who = state ? playerName(state, state.priority ?? state.activePlayer, seat) : 'The engine'; ``
     `` return base('waiting', state?.phase ? `${who === 'You' ? 'The engine' : who} is thinking…` : 'Setting up the game…'); ``

6. **`inputView.ts:240`** — Auto pay.
   - old: `', or Auto pay to let Forge pick them.'`
   - new: `', or Auto pay to let the engine pick them.'`

7. **`DecisionSlot.tsx:164`** — the small key before the engine's own prompt.
   - old: `<span className="ab-engine-k">Forge</span> {engine}`
   - new: `<span className="ab-engine-k">Engine</span> {engine}`

8. **`DecisionSlot.tsx:201`** — the primary button's tooltip.
   - old: `` ` (Forge: ${primary!.engine})` ``
   - new: `` ` (engine: ${primary!.engine})` ``

9. **`PhaseStrip.tsx:219`**
   - old: `Forge never stops in the untap step.`
   - new: `No one gets priority in the untap step, so it never stops there.`

10. **`PhaseStrip.tsx:234`**
    - old: `'On: Forge pauses here so you can act. Off: it passes for you.'`
    - new: `'On: the game stops here so you can act. Off: it passes for you.'`

11. **`PhaseStrip.tsx:237`**
    - old: `'This engine does not send phase stops — these are Forge’s defaults.'`
    - new: `'This engine does not send phase stops — these are its defaults.'`
    - Test: `phaseStrip.test.ts:52, 171` name "Forge’s defaults" only in `it()` titles; no assertion changes.

12. **`PhaseStrip.tsx:62`** (default prop) and **`PlayView.tsx:795`** — whose
    priority the strip names against the bot. The board already knows the
    bot's name (`oppName`: "Search AI", "Forge + sacrifice play", or the engine's
    own name).
    - old (PlayView): `oppLabel={vsHuman ? oppName : 'Forge'}`
    - new (PlayView): `oppLabel={oppName}`
    - old (PhaseStrip default): `oppLabel = 'Forge',`
    - new: `oppLabel = 'The bot',`

13. **`askModel.ts:453, 463, 467, 469, 475, 477`** — button tooltips.
    - `'Let Forge use its default'` → `'Let the engine use its default'`
    - `'Send Forge’s default'` → `'Use the engine’s default'`
    - `'Decline — Forge chooses nothing or its default'` → `'Decline — the engine chooses nothing or its default'`
    - `'Use the order Forge proposed'` → `'Use the order the engine proposed'`
    - `'Let Forge assign the damage'` → `'Let the engine assign the damage'`
    - `'Let Forge decide'` → `'Let the engine decide'`

## One name for leaving (PlayView.tsx, GameOverCard.tsx)

The rest of the site says "Back to the start" and "Leave the table".

14. **`PlayView.tsx:660`** — `aria-label="Back to start"` → `aria-label="Back to the start"`
15. **`PlayView.tsx:691`** — `aria-label="Leave game"` → `aria-label="Leave the table"`
16. **`GameOverCard.tsx:68`** — `leaveLabel = 'Back to start',` → `leaveLabel = 'Back to the start',`
    - Check `e2e/` for `Back to start` before applying (none at c184a05).

## Smaller

17. **`PlayView.tsx:667`** — the top bar when there is no game number or deck.
    - old: `'Playing live'`
    - new: `'Game in progress'` (the replay's coach panel says the same; "live" is the watch mode's word)

18. **`inputView.ts:314`** — the End Turn button's tooltip.
    - old: `'skip to opponent’s turn'`
    - new: `'skip to their turn'`

19. **`playKeys.ts:31`** and **`decisionModel.ts:260`** — "opponent’s end step"
    → "their end step", the board's word for the other seat elsewhere.
    - `'auto-pass: until just before my turn (opponent’s end step)'` → `'auto-pass: until just before my turn (their end step)'`
    - `'Pass until the opponent’s end step, just before your turn'` → `'Pass until their end step, just before your turn'`

Not proposed: model prompts (measured byte for byte), the "Forge AI" fallback
name in `PlayView.tsx:521` (it is the engine's own name for the seat, kept for
older engines and recordings), and "Seat taken" (a seat is the table's word).

/*
 * ForgeCoach — ui/TableDecks.tsx
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Play vs Bot's table (common-sense pass item 8): your deck and the bot's
 * deck, beside the opponent picker (PlayProfile.tsx). "As the engine has
 * them" is plain Play as before; any other choice is built here and started
 * through the match launcher (play/tableDecks.ts, App.tsx `startPlay`). Shown
 * only when the engine on this PC can start a match (`/health` `match: 1`).
 * The bot's list is never shown: only where it comes from.
 */
import { useMemo, useState } from 'react';
import { CUBES } from '../cube/cubes.ts';
import { listPools } from '../cube/pools.ts';
import { loadDraft } from '../draft/store.ts';
import {
  botDeckOptions,
  choiceFromKey,
  choiceKey,
  myDeckOptions,
  readTableChoice,
  settleChoice,
  writeTableChoice,
  type CubeRef,
  type TableChoice,
} from '../play/tableDecks.ts';
import { cx } from './util.ts';

/** The cubes a fresh deck can come from: the ones the drafting bots know (lab data or not, all draftable). */
export function tableCubes(): CubeRef[] {
  return CUBES.map((c) => ({ id: c.id, title: c.title }));
}

/** The table as chosen in this browser, settled against what is still saved. */
export function currentTableChoice(): TableChoice {
  return settleChoice(readTableChoice(), loadDraft(), listPools(), tableCubes());
}

export function TableDeckPicker({ disabled = false }: { disabled?: boolean }) {
  const draft = useMemo(() => loadDraft(), []);
  const pools = useMemo(() => listPools(), []);
  const cubes = useMemo(() => tableCubes(), []);
  const [choice, setChoice] = useState<TableChoice>(() => settleChoice(readTableChoice(), draft, pools, cubes));
  const mine = myDeckOptions(draft, pools, cubes);
  const bots = botDeckOptions(draft, pools, cubes);
  const set = (next: TableChoice) => {
    const s = settleChoice(next, draft, pools, cubes);
    setChoice(s);
    writeTableChoice(s);
  };
  const engine = choice.mine.kind === 'engine';
  return (
    <div className="play-profile table-decks" data-table-decks="">
      <label className="table-deck-row">
        <span className="tiny muted play-profile-k">Your deck</span>
        <select
          className="table-deck-select"
          value={choiceKey(choice.mine)}
          disabled={disabled}
          onChange={(e) => {
            const c = choiceFromKey(e.target.value);
            if (c) set({ ...choice, mine: c });
          }}
        >
          {mine.map((o) => (
            <option key={choiceKey(o.choice)} value={choiceKey(o.choice)}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <label className="table-deck-row">
        <span className="tiny muted play-profile-k">The bot’s deck</span>
        <select
          className="table-deck-select"
          value={engine ? 'engine' : choiceKey(choice.theirs)}
          disabled={disabled || engine}
          onChange={(e) => {
            const c = choiceFromKey(e.target.value);
            if (c) set({ ...choice, theirs: c });
          }}
        >
          {engine ? (
            <option value="engine">As the engine has it</option>
          ) : (
            bots.map((o) => (
              <option key={choiceKey(o.choice)} value={choiceKey(o.choice)}>
                {o.label}
              </option>
            ))
          )}
        </select>
      </label>
      {!engine && (
        <div className="play-profile-row" role="radiogroup" aria-label="Match">
          <span className="tiny muted play-profile-k">Match</span>
          {([1, 3] as const).map((g) => (
            <button
              key={g}
              type="button"
              role="radio"
              aria-checked={choice.games === g}
              className={cx('play-profile-opt', choice.games === g && 'is-on')}
              onClick={() => set({ ...choice, games: g })}
              disabled={disabled}
            >
              {g === 1 ? 'One game' : 'Best of three'}
            </button>
          ))}
        </div>
      )}
      <p className="tiny muted play-profile-blurb">
        {engine
          ? 'Play starts the engine on the decks it last played. Pick a deck to choose both.'
          : 'Play builds both decks and starts the engine on them (10–20 seconds). The bot’s list stays hidden, as at a real table.'}
      </p>
    </div>
  );
}

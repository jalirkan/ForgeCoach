/*
 * ForgeCoach — ui/watch/DraftReplay.tsx
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * A watch's grid draft played back pick by pick (mtg-table D440): the grid
 * as each drafter saw it on the pick screen's own GridBoard, the line it
 * took lit (drafter A gold, drafter B crimson), both pools growing beside
 * it, then the two decks with the builder's reasons. Play / pause / step /
 * speed / skip to the decks. A grid draft is face up, so everything shown
 * here was seen by both drafters; nothing comes from anywhere but draft.json.
 */
import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { cubeForMeta } from '../../cube/cubes.ts';
import { drafterLabel } from '../../watch/choices.ts';
import type { WatchDeck, WatchDraft, WatchSide } from '../../watch/data.ts';
import { atDecks, lineWords, replayView, SPEEDS, type ReplayAction, type ReplayState } from '../../watch/replay.ts';
import { prefetchCards } from '../cardData.ts';
import { CardInfoSheet } from '../deck/sheets.tsx';
import { useCubeData } from '../deck/useCubeData.ts';
import { cx } from '../util.ts';
import { Collection, usePrefs } from '../draft/Collection.tsx';
import { GridBoard } from '../draft/GridBoard.tsx';
import { ColourDots } from '../draft/Pool.tsx';
import { useCubeMeta } from '../draft/useCubeMeta.ts';

export function DraftReplay({
  draft,
  state,
  dispatch,
  sideName,
  after,
}: {
  draft: WatchDraft;
  state: ReplayState;
  dispatch: (a: ReplayAction) => void;
  /** "Drafter A · Search AI" — who each side is. */
  sideName: (s: WatchSide) => string;
  /** Under the controls (a "game 1 has started" note, the Watch button). */
  after?: ReactNode;
}) {
  const info = cubeForMeta({ cube: { file: draft.cube.file, name: draft.cube.title } });
  const data = useCubeData(info?.id ?? null);
  const ctx = info ? data.ctx : null;
  const meta = useCubeMeta(ctx);
  const [card, setCard] = useState<string | null>(null);
  const v = replayView(draft, state.i);
  const decks = atDecks(state, draft);
  const all = useMemo(() => [...new Set([...draft.pools.A, ...draft.pools.B])], [draft]);
  useEffect(() => prefetchCards(all), [all]);

  // Keys: Space play/pause, arrows step, End the decks (not while typing).
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
      if (e.key === ' ') dispatch({ kind: 'toggle' });
      else if (e.key === 'ArrowRight') dispatch({ kind: 'next' });
      else if (e.key === 'ArrowLeft') dispatch({ kind: 'prev' });
      else if (e.key === 'End') dispatch({ kind: 'decks' });
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [dispatch]);

  const pick = v.pick;
  const who = pick ? sideName(pick.seat) : '';
  return (
    <div className="wb-replay">
      <div className="wb-controls" role="group" aria-label="Draft replay">
        <span className="wb-step mono-n" aria-live="polite">
          {decks ? 'The decks' : `Grid ${v.grid} of ${draft.grids} · ${v.label.toLowerCase()}`}
        </span>
        <span className="wb-btns">
          <button className="btn-line wb-btn" onClick={() => dispatch({ kind: 'prev' })} disabled={state.i === 0} aria-label="Previous pick">
            ◀
          </button>
          <button className="btn-gold wb-btn wb-play" onClick={() => dispatch({ kind: 'toggle' })} aria-label={state.playing ? 'Pause' : 'Play'}>
            {state.playing ? '❚❚ Pause' : decks ? '▶ Play again' : '▶ Play'}
          </button>
          <button className="btn-line wb-btn" onClick={() => dispatch({ kind: 'next' })} disabled={decks} aria-label="Next pick">
            ▶
          </button>
          <span className="wb-speed" role="radiogroup" aria-label="Speed">
            {SPEEDS.map((s) => (
              <button key={s} role="radio" aria-checked={state.speed === s} className={cx('wb-chip', state.speed === s && 'is-on')} onClick={() => dispatch({ kind: 'speed', speed: s })}>
                {s}×
              </button>
            ))}
          </span>
          <button className="btn-line wb-btn" onClick={() => dispatch({ kind: 'decks' })} disabled={decks}>
            Skip to the decks
          </button>
        </span>
        <input
          className="wb-scrub"
          type="range"
          min={0}
          max={draft.picks.length}
          value={state.i}
          onChange={(e) => dispatch({ kind: 'seek', i: Number(e.target.value) })}
          aria-label="Pick"
        />
      </div>
      {after}

      {!decks && pick && v.board && (
        <section className="wb-gridrow">
          <div className="wb-gridcol">
            <p className={cx('wb-took', pick.seat === 'A' ? 'is-a' : 'is-b')}>
              <b>{who}</b> {pick.order === 1 ? 'opens grid' : 'takes from grid'} {pick.grid} with {lineWords(pick.line)}: {pick.took.join(', ')}.
              {pick.value !== null && <span className="wb-value" title="The lab drafter’s own score for this line: card ratings plus colour, curve and theme fit. Not a win chance."> Liked it {pick.value.toFixed(1)}.</span>}
            </p>
            <GridBoard
              d={v.board}
              mine={false}
              selected={pick.seat === 'A' ? pick.line : null}
              preview={null}
              hint={null}
              aiLine={pick.seat === 'B' ? pick.line : null}
              onSelect={() => undefined}
              onPreview={() => undefined}
              onInfo={setCard}
            />
          </div>
        </section>
      )}

      {decks ? (
        <section className="wb-decks">
          {(['A', 'B'] as const).map((s) => (
            <DeckCard key={s} side={s} title={sideName(s)} deck={draft.decks[s]} drafter={draft.drafters[s]} />
          ))}
        </section>
      ) : (
        <section className="wb-pools">
          {(['A', 'B'] as const).map((s) => (
            <PoolBox key={s} side={s} title={sideName(s)} names={v.pools[s]} fresh={pick?.seat === s ? v.fresh : []} meta={meta} onInfo={setCard} of={draft.pools[s].length} />
          ))}
        </section>
      )}
      {ctx && <CardInfoSheet name={card} ctx={ctx} pool={[]} onClose={() => setCard(null)} cubeId={info?.id ?? null} />}
    </div>
  );
}

function PoolBox({ side, title, names, fresh, meta, onInfo, of }: { side: WatchSide; title: string; names: string[]; fresh: string[]; meta: ReturnType<typeof useCubeMeta>; onInfo: (n: string) => void; of: number }) {
  const [prefs] = usePrefs(`watch-pool-${side}`, { layout: 'stacks', group: 'cmc', size: 72 });
  const hint = useMemo(() => new Set(fresh), [fresh]);
  return (
    <div className={cx('wb-pool', side === 'A' ? 'is-a' : 'is-b')} data-pool={side}>
      <header className="wb-pool-h">
        <h3 className="fx-label">
          {title} <span className="mono-n">{names.length}</span>
          <span className="mono-of"> / {of}</span>
        </h3>
        {meta && names.length > 0 && <ColourDots names={names} meta={meta} />}
      </header>
      {meta ? (
        <Collection names={names} meta={meta} prefs={prefs} onInfo={onInfo} hint={hint} empty={<p className="quiet-italic center">Nothing yet.</p>} />
      ) : (
        <ul className="wb-names">
          {names.map((n, i) => (
            <li key={`${n}-${i}`} className={cx(hint.has(n) && 'is-new')}>
              {n}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const COLOR_WORD: Record<string, string> = { W: 'white', U: 'blue', B: 'black', R: 'red', G: 'green', C: 'colourless' };
const colourWords = (c: string | null) => (c ? [...c].map((x) => COLOR_WORD[x] ?? x).join('-') : '');

function DeckCard({ side, title, deck, drafter }: { side: WatchSide; title: string; deck: WatchDeck; drafter: string }) {
  const why = deck.why;
  const maxCurve = Math.max(3, ...(why?.curve ?? []));
  return (
    <article className={cx('wb-deck', side === 'A' ? 'is-a' : 'is-b')} data-deck={side}>
      <header>
        <div className="fx-label">{title}</div>
        <h3 className="wb-deck-name">{deck.name}</h3>
        <p className="wb-deck-sub">
          {deck.cards} cards
          {deck.colors && ` · ${colourWords(deck.colors)}${deck.splash ? `, splashing ${colourWords(deck.splash)}` : ''}`} · drafted by the {drafterLabel(drafter).toLowerCase()}, built by {deck.builder === 'lab' ? 'the lab’s builder' : 'Forge’s builder'}
        </p>
      </header>
      {why ? (
        <div className="wb-why">
          <p>
            {why.spells ?? '?'} spells, {why.lands ?? '?'} lands, {why.creatures ?? '?'} creatures
            {why.avgCmc !== null && `, average mana value ${why.avgCmc.toFixed(2)}`}.{why.stretched && ' A stretch: the pool needed a wide splash, 18 lands or three colours.'}
          </p>
          {why.curve.length > 0 && (
            <span className="mcurve wb-curve" aria-label={`Curve from 1 to 6+: ${why.curve.join(', ')}`}>
              {why.curve.map((n, i) => (
                <span key={i} className="mcurve-col">
                  <b>{n || ''}</b>
                  <span className="mcurve-bar" style={{ height: `${Math.max(1, (n / maxCurve) * 16)}px` } as CSSProperties} />
                  <span className="mcurve-l">{i === why.curve.length - 1 ? `${i + 1}+` : i + 1}</span>
                </span>
              ))}
            </span>
          )}
          {why.themes.length > 0 && <p className="tiny muted">Themes: {why.themes.map(([t, n]) => `${t} ${n}`).join(' · ')}</p>}
          {why.score !== null && (
            <p className="tiny muted">
              The builder’s score {why.score.toFixed(1)}
              {why.alternatives.filter((a) => a.colors !== deck.colors || a.splash !== deck.splash).length > 0 &&
                `; next best: ${why.alternatives
                  .filter((a) => a.colors !== deck.colors || a.splash !== deck.splash)
                  .slice(0, 2)
                  .map((a) => `${a.colors}${a.splash ? `+${a.splash.toLowerCase()}` : ''}${a.score !== null ? ` ${a.score.toFixed(1)}` : ''}`)
                  .join(', ')}`}
              . A score of how the deck fits together, not a win chance.
            </p>
          )}
        </div>
      ) : (
        <p className="tiny muted">The lab’s builder found no legal deck{deck.labErrors.length ? ` (${deck.labErrors.join('; ')})` : ''}, so Forge’s builder made this one.</p>
      )}
      <div className="wb-lists">
        <div>
          <div className="fx-label">Main · {deck.cards}</div>
          <ul className="wb-list">
            {deck.main.map(([n, name]) => (
              <li key={name}>
                <span className="mono-n">{n}</span> {name}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <div className="fx-label">Sideboard · {deck.sideboard.reduce((s, [n]) => s + n, 0)}</div>
          <ul className="wb-list is-side">
            {deck.sideboard.map(([n, name]) => (
              <li key={name}>
                <span className="mono-n">{n}</span> {name}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </article>
  );
}



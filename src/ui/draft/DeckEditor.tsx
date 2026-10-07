/*
 * ForgeCoach — ui/draft/DeckEditor.tsx
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * "Draft complete · Build Your Deck": a sticky stat bar (count / 40 min,
 * creatures · spells · lands, a tiny curve, colour dots, Submit), the shared
 * layout bar, the mainboard as stacks with LAND and SIDEBOARD columns (tap
 * or drag a card across), and the Basic Lands panel. "Suggest a build" asks
 * the deck assistant's builder (src/cube/builder.ts) to fill the mainboard
 * and the basics; its score and reasons stay in a quiet note.
 *
 * Export (ui/DeckExport.tsx): "Copy list" sits beside Submit (the stat bar on
 * a wide screen, the bottom dock on a phone), so the deck on screen — picked
 * by hand or suggested — is one tap from another game; the full export panel
 * (count, .txt / .dck / .cod, Share…) is under the basic lands.
 */
import { useEffect, useMemo, useState } from 'react';
import { buildDecks } from '../../cube/builder.ts';
import type { CubeContext } from '../../cube/score.ts';
import { BASIC_KEYS, BASIC_NAME, deckCount, deckFromBuild, exportList, mainNames, MIN_DECK, moveCard, setBasic, type BasicKey, type DeckState } from '../../draft/deck.ts';
import { kindCounts } from '../../draft/poolView.ts';
import { IconChevronLeft } from '../Icons.tsx';
import { cx } from '../util.ts';
import { CardInfoSheet } from '../deck/sheets.tsx';
import { CopyDeckButton, DeckExport } from '../DeckExport.tsx';
import { Collection, usePrefs, ViewBar } from './Collection.tsx';
import { ColourDots, MiniCurve } from './Pool.tsx';
import { useCubeMeta } from './useCubeMeta.ts';

const BASIC_DOT: Record<BasicKey, string> = { W: '#f3e6c0', U: '#3d8fe0', B: '#2a2433', R: '#e2453a', G: '#3ea85a', C: '#9a968e' };
const BASIC_TINT: Record<BasicKey, string> = {
  W: 'rgba(243, 230, 192, 0.07)',
  U: 'rgba(61, 143, 224, 0.1)',
  B: 'rgba(120, 100, 140, 0.12)',
  R: 'rgba(226, 69, 58, 0.11)',
  G: 'rgba(62, 168, 90, 0.1)',
  C: 'rgba(154, 150, 142, 0.1)',
};

export function DeckEditor({
  ctx,
  pool,
  deck,
  onDeck,
  onSubmit,
  onBack,
  kicker = 'Draft complete',
  cubeId,
  deckName = 'Cube draft deck',
}: {
  ctx: CubeContext;
  pool: string[];
  deck: DeckState;
  onDeck: (d: DeckState) => void;
  onSubmit: () => void;
  onBack: () => void;
  kicker?: string;
  /** For the card sheet's 17Lands numbers (cubes.ts `humanData`). */
  cubeId?: string;
  /** The exported deck's name (file names, .dck / .cod). */
  deckName?: string;
}) {
  const meta = useCubeMeta(ctx)!;
  const [prefs, setPrefs] = usePrefs('deck-main', { layout: 'stacks', group: 'cmc', size: 104 });
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const main = useMemo(() => mainNames(deck), [deck]);
  const count = deckCount(deck);
  const kinds = kindCounts(main, meta);
  const ok = count >= MIN_DECK;
  const list = useMemo(() => exportList(deckName, deck), [deckName, deck]);

  const suggest = () => {
    setBusy(true);
    setTimeout(() => {
      const b = buildDecks(ctx, pool)[0];
      setBusy(false);
      if (b) onDeck(deckFromBuild(b, pool));
    }, 30);
  };

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && ok) {
        e.preventDefault();
        onSubmit();
      }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [ok, onSubmit]);

  return (
    <div className="fx de">
      <div className="de-top">
        <button className="link-back" onClick={onBack}>
          <IconChevronLeft size={14} /> Back to the table
        </button>
        <div className="fx-label de-kicker">{kicker}</div>
        <h1 className="de-title">Build Your Deck</h1>
      </div>

      <div className="de-stat">
        <span className="de-count">
          <b className={cx(!ok && 'is-short')}>{count}</b>
          <span> / {MIN_DECK} min</span>
        </span>
        <span className="de-kinds">
          <span>{kinds.creatures} creatures</span>
          <span>{kinds.spells} spells</span>
          <span>{kinds.lands} lands</span>
        </span>
        <MiniCurve names={main} meta={meta} />
        <ColourDots names={main} meta={meta} />
        <CopyDeckButton list={list} className="btn-line de-copy" short="Copy list" />
        <button className="btn-begin de-submit" onClick={onSubmit} disabled={!ok} title={ok ? undefined : `A deck needs at least ${MIN_DECK} cards`}>
          Submit deck <kbd>⌘⏎</kbd>
        </button>
      </div>

      <div className="de-tools">
        <ViewBar
          prefs={prefs}
          onChange={setPrefs}
          right={
            <button className="btn-line de-suggest" onClick={suggest} disabled={busy}>
              {busy ? 'Building…' : 'Suggest a build'}
            </button>
          }
        />
      </div>

      <div className="de-body">
        <section className="de-main">
          <h2 className="de-h">
            Mainboard <span>{count}</span>
          </h2>
          <Collection
            names={main}
            side={deck.side}
            sideLabel="Sideboard"
            meta={meta}
            prefs={prefs}
            onCard={(n, zone) => onDeck(moveCard(deck, n, zone === 'main' ? 'side' : 'main'))}
            onInfo={setInfo}
            onMove={(n, to) => onDeck(moveCard(deck, n, to))}
            empty={<p className="quiet-italic center">Tap “Suggest a build”, or tap cards in the sideboard to add them.</p>}
          />
          <p className="de-help quiet-italic">Tap a card to move it between mainboard and sideboard, or drag it. Basics come from the panel.</p>
        </section>
        <aside className="de-side">
          <h2 className="de-h">
            Basic Lands <span>{BASIC_KEYS.reduce((s, k) => s + deck.basics[k], 0)}</span>
          </h2>
          <div className="basics">
            {BASIC_KEYS.map((k) => (
              <div key={k} className={cx('basic-row', deck.basics[k] > 0 && 'is-on')} style={deck.basics[k] > 0 ? { background: BASIC_TINT[k] } : undefined}>
                <i className="basic-dot" style={{ background: BASIC_DOT[k] }} />
                <span className="basic-name">{BASIC_NAME[k]}</span>
                <button className="step" onClick={() => onDeck(setBasic(deck, k, deck.basics[k] - 1))} disabled={deck.basics[k] === 0} aria-label={`One fewer ${BASIC_NAME[k]}`}>
                  −
                </button>
                <span className="basic-n">{deck.basics[k]}</span>
                <button className="step" onClick={() => onDeck(setBasic(deck, k, deck.basics[k] + 1))} aria-label={`One more ${BASIC_NAME[k]}`}>
                  +
                </button>
              </div>
            ))}
          </div>
          {deck.suggestion && (
            <div className="de-note">
              <div className="fx-label">Suggested build</div>
              <p className="de-note-t">
                <i>{deck.suggestion.name}</i> · score {deck.suggestion.score}
              </p>
              <details>
                <summary>Why</summary>
                <ul>
                  {deck.suggestion.reasons.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
              </details>
            </div>
          )}
          <DeckExport list={list} className="de-export" />
        </aside>
      </div>

      <div className="dbuild-dock">
        <CopyDeckButton list={list} className="btn-line dock-second de-dock-copy" short="Copy list" />
        <button className="btn-gold dock-main" onClick={onSubmit} disabled={!ok}>
          Submit deck · {count}
        </button>
      </div>
      <CardInfoSheet name={info} ctx={ctx} pool={pool} onClose={() => setInfo(null)} cubeId={cubeId} />
    </div>
  );
}

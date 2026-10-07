/*
 * ForgeCoach — ui/StackPanel.tsx
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * "The Stack" (endstep-style): numbered items, 1 on top — it resolves next —
 * each with the source's art, its kind (spell / activated / triggered
 * ability), who controls it, the engine's text and its targets. The same
 * numbers sit on the board (a badge on each source and target, CardTile) and
 * lines join them (BoardArrows). Two looks: `float` — the play screen's
 * panel, in one fixed place over the board while the stack is not empty,
 * foldable to its heading; `inline` — the replay's strip between the sides.
 *
 * Adapted from mtg-table web/src/render/StackPanel.tsx (Copyright (C) 2026
 * the mtg-table authors, GPL-3.0-or-later). Redaction is stackModel.ts's: a
 * concealed or face-down source is a card back with no name.
 */
import { useLayoutEffect, useRef, useState } from 'react';
import type { GameStateBody } from '../protocol.ts';
import { useCardInfo } from './cardData.ts';
import { useCardActions } from './cardContext.ts';
import { IconChevronDown, IconLayers, TypeGlyph } from './Icons.tsx';
import { KIND_WORDS, stackText, type StackEntry } from './stackModel.ts';
import { colorClass, cx, typeKind } from './util.ts';

import './stack.css';

export function StackPanel({
  entries,
  state,
  variant,
  folded = false,
  onFold,
}: {
  entries: StackEntry[];
  state: GameStateBody;
  variant: 'float' | 'inline';
  folded?: boolean;
  onFold?: (folded: boolean) => void;
}) {
  const ref = useRef<HTMLElement>(null);
  // The float's height, for the phone board to start below it (stack.css --stack-h).
  useLayoutEffect(() => {
    const el = ref.current;
    const host = el?.parentElement;
    if (variant !== 'float' || !el || !host || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => host.style.setProperty('--stack-h', `${Math.round(el.offsetHeight + 12)}px`));
    ro.observe(el);
    return () => {
      ro.disconnect();
      host.style.removeProperty('--stack-h');
    };
  }, [variant, entries.length > 0]);
  if (entries.length === 0) return null;
  return (
    <section ref={ref} className={cx('stackp', `stackp-${variant}`, folded && 'is-folded')} aria-label={`The stack: ${entries.length} item${entries.length === 1 ? '' : 's'}`} data-stack-panel="">
      <header className="stackp-head">
        <IconLayers size={14} />
        <span className="stackp-title">The Stack</span>
        <span className="stackp-n">{entries.length}</span>
        <span className="stackp-hint">1 resolves next</span>
        {onFold && (
          <button type="button" className="icon-btn stackp-fold" onClick={() => onFold(!folded)} aria-expanded={!folded} aria-label={folded ? 'Show the stack' : 'Fold the stack'} title={folded ? 'Show the stack' : 'Fold the stack'}>
            <IconChevronDown size={15} className={cx('stackp-caret', !folded && 'is-open')} />
          </button>
        )}
      </header>
      {!folded && (
        <ol className="stackp-list">
          {entries.map((e) => (
            <StackRow key={e.item.id} entry={e} state={state} />
          ))}
        </ol>
      )}
    </section>
  );
}

function StackRow({ entry: e, state }: { entry: StackEntry; state: GameStateBody }) {
  const info = useCardInfo(e.name);
  const actions = useCardActions();
  const [wide, setWide] = useState(false);
  const art = e.name ? info?.image?.artCrop ?? info?.faces?.[0]?.image?.artCrop : undefined;
  const text = stackText(e);
  const kind = typeKind(e.source?.types || info?.typeLine);
  return (
    <li
      className={cx('stackp-item', e.n === 1 && 'is-next', e.mine ? 'is-mine' : 'is-theirs', `kind-${e.kind}`)}
      data-stack-item={e.item.id}
      data-stack-n={e.n}
    >
      <span className="stackp-numcol">
        <span className="stackp-num" aria-label={e.n === 1 ? 'Resolves next' : `Number ${e.n}`}>
          {e.n}
        </span>
        {e.n === 1 && <span className="stackp-next">next</span>}
      </span>
      <button
        type="button"
        className={cx('stackp-art', colorClass(info?.colors ?? []), e.faceDown && 'is-back')}
        onClick={() => e.source && e.name && actions.open(e.source, state)}
        disabled={!e.source || !e.name}
        aria-label={e.name ? `Details: ${e.name}` : 'Hidden source'}
        tabIndex={e.name ? 0 : -1}
      >
        {e.faceDown ? <span className="card-back" aria-hidden="true" /> : art ? <img src={art} alt="" loading="lazy" decoding="async" draggable={false} /> : <TypeGlyph kind={kind} size={16} />}
      </button>
      <div className="stackp-body">
        <div className="stackp-line">
          <span className={cx('stackp-kind', `k-${e.kind}`)}>{KIND_WORDS[e.kind]}</span>
        </div>
        <div className="stackp-name">
          {e.name ?? (e.faceDown ? 'Face-down card' : 'Hidden')}
          {e.controller && <span className="stackp-who"> · {e.controller}</span>}
        </div>
        {text ? (
          <button type="button" className={cx('stackp-text', wide && 'is-wide')} onClick={() => setWide((w) => !w)} title={text}>
            {text}
          </button>
        ) : (
          <div className="stackp-text is-hidden">Hidden</div>
        )}
        {e.targets.length > 0 && (
          <div className="stackp-targets">
            <span className="stackp-arrow" aria-hidden="true">
              →
            </span>
            {e.targets.map((t) => (
              <span key={`${t.kind}${t.id}`} className="stackp-chip">
                {t.label}
              </span>
            ))}
          </div>
        )}
      </div>
    </li>
  );
}

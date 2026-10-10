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
 * The float is a FAN (endstep-style): the items overlap like a pile, 1 on
 * top and whole (art strip, kind, text, "→ target" chips), each deeper one a
 * step further back showing its number, kind and name. Every number badge
 * stays clear of the item in front (stackModel.ts `fanPlace`, stack.css),
 * because the board's lines start there.
 *
 * Each item also carries the engine's "Always yield" control when the engine
 * offers one (stackModel.ts `yieldControlOf`; protocol M36/M37): it sends
 * `setYield {yieldKey, mode}` through the play board's `act`. The `yieldKey`
 * is an opaque bridge handle — it is never rendered, not as text, a title, a
 * data attribute or a React key; it only travels inside the act. Outside the
 * play screen (`usePlayBoard()` null) there is no control.
 *
 * Adapted from mtg-table web/src/render/StackPanel.tsx (Copyright (C) 2026
 * the mtg-table authors, GPL-3.0-or-later). Redaction is stackModel.ts's: a
 * concealed or face-down source is a card back with no name.
 */
import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import type { GameStateBody, SetYieldMode } from '../protocol.ts';
import { imageForFace } from '../cards.ts';
import { useCardInfo } from './cardData.ts';
import { useCardActions } from './cardContext.ts';
import { IconCheck, IconChevronDown, IconFastForward, IconLayers, TypeGlyph } from './Icons.tsx';
import { usePlayBoard } from './play/playBoard.ts';
import { fanPlace, KIND_WORDS, stackText, yieldActOf, yieldControlOf, type StackEntry, type YieldButton } from './stackModel.ts';
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
      {!folded &&
        (variant === 'float' ? (
          <ol className="stackp-list stackp-fan" data-fan={entries.length}>
            {entries.map((e) => (
              <FanItem key={e.item.id} entry={e} state={state} count={entries.length} />
            ))}
          </ol>
        ) : (
          <ol className="stackp-list">
            {entries.map((e) => (
              <StackRow key={e.item.id} entry={e} state={state} />
            ))}
          </ol>
        ))}
    </section>
  );
}

function StackRow({ entry: e, state }: { entry: StackEntry; state: GameStateBody }) {
  const info = useCardInfo(e.name);
  const actions = useCardActions();
  const [wide, setWide] = useState(false);
  const art = e.name ? imageForFace(info, e.name)?.artCrop : undefined;
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

/** The source's art, a card back for a face-down one, or a type glyph; opens the card's details when it is known. */
function SourceArt({ entry: e, state, className }: { entry: StackEntry; state: GameStateBody; className: string }) {
  const info = useCardInfo(e.name);
  const actions = useCardActions();
  const art = e.name ? imageForFace(info, e.name)?.artCrop : undefined;
  const kind = typeKind(e.source?.types || info?.typeLine);
  return (
    <button
      type="button"
      className={cx('stackp-art', className, colorClass(info?.colors ?? []), e.faceDown && 'is-back')}
      onClick={() => e.source && e.name && actions.open(e.source, state)}
      disabled={!e.source || !e.name}
      aria-label={e.name ? `Details: ${e.name}` : 'Hidden source'}
      tabIndex={e.name ? 0 : -1}
    >
      {e.faceDown ? <span className="card-back" aria-hidden="true" /> : art ? <img src={art} alt="" loading="lazy" decoding="async" draggable={false} /> : <TypeGlyph kind={kind} size={16} />}
    </button>
  );
}

/** One item of the float's fan: 1 whole, the others a step back with number, kind and name. */
function FanItem({ entry: e, state, count }: { entry: StackEntry; state: GameStateBody; count: number }) {
  const [wide, setWide] = useState(false);
  const text = stackText(e);
  const top = e.n === 1;
  const place = fanPlace(e.n, count);
  const style = { '--fan-i': place.depth, zIndex: place.z } as CSSProperties;
  const name = e.name ?? (e.faceDown ? 'Face-down card' : 'Hidden');
  return (
    <li
      className={cx('stackp-item', 'stackp-fan-item', top ? 'is-next' : 'is-back', e.mine ? 'is-mine' : 'is-theirs', `kind-${e.kind}`)}
      data-stack-item={e.item.id}
      data-stack-n={e.n}
      style={style}
      title={top ? undefined : [`${e.n}. ${KIND_WORDS[e.kind]}: ${name}`, text, e.targets.length ? `→ ${e.targets.map((t) => t.label).join(', ')}` : ''].filter(Boolean).join('\n')}
    >
      <span className="stackp-numcol">
        <span className="stackp-num" aria-label={top ? 'Resolves next' : `Number ${e.n}`}>
          {e.n}
        </span>
        {top && <span className="stackp-next">next</span>}
      </span>
      {top ? (
        <div className="stackp-body">
          <div className="stackp-name">
            {name}
            {e.controller && <span className="stackp-who"> · {e.controller}</span>}
          </div>
          <SourceArt entry={e} state={state} className="stackp-art-strip" />
          <div className="stackp-line">
            <span className={cx('stackp-kind', `k-${e.kind}`)}>{KIND_WORDS[e.kind]}</span>
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
          <YieldControls entry={e} />
        </div>
      ) : (
        <>
          <SourceArt entry={e} state={state} className="stackp-art-thumb" />
          <div className="stackp-body">
            <div className="stackp-line">
              <span className={cx('stackp-kind', `k-${e.kind}`)}>{KIND_WORDS[e.kind]}</span>
              {e.targets.length > 0 && (
                <span className="stackp-tcount" aria-label={`${e.targets.length} target${e.targets.length === 1 ? '' : 's'}`}>
                  →{e.targets.length}
                </span>
              )}
              <YieldControls entry={e} compact />
            </div>
            <div className="stackp-name">
              {name}
              {e.controller && <span className="stackp-who"> · {e.controller}</span>}
            </div>
          </div>
        </>
      )}
    </li>
  );
}

const YIELD_ON_TITLE = 'On — press to be asked about this ability again';

/**
 * "Always yield" for one stack item — only when the engine offers it and only
 * on the play screen. Disabled while the board may not act (an open question,
 * not connected, game over); lit from `item.yielded`, the engine's own answer.
 */
export function YieldControls({ entry: e, compact = false }: { entry: StackEntry; compact?: boolean }) {
  const board = usePlayBoard();
  if (!board) return null;
  const control = yieldControlOf(e.item, e.mine);
  if (!control) return null;
  const disabled = !board.canAct;
  const press = (mode: SetYieldMode) => {
    // The key is read at the press and goes only into the act.
    const act = yieldActOf(e.item, mode, board.canAct);
    if (act) board.act(act);
  };
  const button = (b: YieldButton, label: string, short: string, help: string) => (
    <button
      type="button"
      className={cx('stackp-yield-btn', b.on && 'is-on')}
      aria-pressed={b.on}
      disabled={disabled}
      data-yield-mode={b.send}
      onClick={() => press(b.send)}
      title={disabled ? `${label} — when you can act` : b.on ? YIELD_ON_TITLE : help}
      aria-label={label}
    >
      {b.on ? <IconCheck size={11} /> : <IconFastForward size={11} />}
      <span className="stackp-yield-label">{compact ? short : label}</span>
    </button>
  );
  return (
    <div className={cx('stackp-yield', compact && 'is-compact')} data-yield-control={control.kind}>
      {control.kind === 'auto'
        ? button(control.auto, 'Always yield', 'Auto', 'Let this ability resolve without stopping for your priority, every time')
        : (
          <>
            {button(control.yes, 'Always yes', 'Yes', 'Accept this trigger, and every later one from the same ability, without asking')}
            {button(control.no, 'Always no', 'No', 'Decline this trigger, and every later one from the same ability, without asking')}
          </>
        )}
    </div>
  );
}

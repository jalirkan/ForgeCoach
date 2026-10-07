/*
 * ForgeCoach — ui/draft/GridBoard.tsx
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The 3×3 grid as large cards. Row arrows sit at the left, column arrows on
 * top; pointing at one (or tapping it) lights its cards and dims the rest,
 * and the decision panel then takes it. The AI's line glows crimson for a
 * beat before it leaves. With hints on, the pick helper's line carries a
 * quiet gold mark; with a `why` blurb, pointing at, focusing or tapping that
 * arrow opens the "why this line" popover (GridHint.tsx).
 */
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { LINES, lineName, type GridDraft } from '../../draft/draft.ts';
import type { GridBlurb } from '../../draft/gridBlurb.ts';
import { cx } from '../util.ts';
import { DCard, type CardState } from './DCard.tsx';
import { GridHintPopover } from './GridHint.tsx';

export function GridBoard({
  d,
  mine,
  selected,
  preview,
  hint,
  aiLine,
  onSelect,
  onPreview,
  onInfo,
  why,
  whyExtra,
}: {
  d: GridDraft;
  /** It is your pick. */
  mine: boolean;
  selected: number | null;
  preview: number | null;
  hint: number | null;
  aiLine: number | null;
  onSelect: (l: number | null) => void;
  onPreview: (l: number | null) => void;
  onInfo: (n: string) => void;
  /** The hint's blurb (draft/gridBlurb.ts); none, no popover. */
  why?: GridBlurb | null;
  /** Under the blurb in the popover. */
  whyExtra?: ReactNode;
}) {
  // The hint popover: 'hover' closes when the pointer or focus leaves, 'pin' (a tap, or a click inside) on a tap outside or Escape.
  const [whyOpen, setWhyOpen] = useState<'hover' | 'pin' | null>(null);
  const closeTimer = useRef<number | undefined>(undefined);
  const lastPointer = useRef('mouse');
  const popRef = useRef<HTMLDivElement>(null);
  const hintRef = useRef<HTMLButtonElement>(null);
  const showWhy = !!why && hint !== null;
  const openHover = () => {
    window.clearTimeout(closeTimer.current);
    setWhyOpen((w) => w ?? 'hover');
  };
  const closeHover = () => {
    window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => setWhyOpen((w) => (w === 'hover' ? null : w)), 200);
  };
  useEffect(() => () => window.clearTimeout(closeTimer.current), []);
  // A new grid or hint closes it.
  useEffect(() => setWhyOpen(null), [hint, why]);
  useEffect(() => {
    if (!whyOpen) return;
    const down = (e: PointerEvent) => {
      const t = e.target as Node;
      if (popRef.current?.contains(t) || hintRef.current?.contains(t)) return;
      setWhyOpen(null);
    };
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setWhyOpen(null);
    document.addEventListener('pointerdown', down);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('pointerdown', down);
      document.removeEventListener('keydown', key);
    };
  }, [whyOpen]);

  const lit = aiLine ?? preview ?? selected;
  const litSlots = new Set(lit !== null ? (LINES[lit] ?? []) : []);
  const has = (l: number) => (LINES[l] ?? []).some((i) => d.slots[i]);
  const legal = (l: number) => mine && l !== d.firstLine && has(l);

  const arrow = (l: number) => {
    const col = l >= 3;
    const on = selected === l;
    const isHint = hint === l && showWhy;
    return (
      <button
        key={l}
        ref={isHint ? hintRef : undefined}
        className={cx('garrow', col ? 'is-col' : 'is-row', on && 'is-on', hint === l && 'is-hint', aiLine === l && 'is-ai')}
        style={{ gridArea: col ? `c${l - 2}` : `r${l + 1}` } as CSSProperties}
        disabled={!legal(l)}
        aria-pressed={on}
        aria-label={`Select the ${lineName(l)}`}
        aria-expanded={isHint ? whyOpen !== null : undefined}
        aria-controls={isHint && whyOpen ? 'ghint-pop' : undefined}
        onClick={() => {
          onSelect(on ? null : l);
          // A tap on the hint also opens (or closes) its popover; a mouse has hover for that.
          if (isHint && lastPointer.current !== 'mouse') setWhyOpen((w) => (w === 'pin' ? null : 'pin'));
          lastPointer.current = 'mouse'; // until the next pointerdown: keyboard focus opens it again
        }}
        onPointerDown={(e) => {
          lastPointer.current = e.pointerType;
        }}
        onPointerEnter={(e) => {
          if (e.pointerType !== 'mouse') return;
          onPreview(l);
          if (isHint) openHover();
        }}
        onPointerLeave={(e) => {
          if (e.pointerType !== 'mouse') return;
          onPreview(null);
          if (isHint) closeHover();
        }}
        onFocus={() => {
          onPreview(l);
          if (isHint && lastPointer.current === 'mouse') openHover();
        }}
        onBlur={() => {
          onPreview(null);
          if (isHint) closeHover();
        }}
      >
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path d={col ? 'M12 5v13m-6-6 6 6 6-6' : 'M5 12h13m-6-6 6 6-6 6'} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {hint === l && <span className="garrow-hint">Hint</span>}
      </button>
    );
  };

  return (
    <div className="gboard-wrap">
      <div className={cx('gboard', lit !== null && 'has-lit', aiLine !== null && 'is-ai-turn')}>
        <span className="gcorner" aria-hidden="true">
          <span className="fx-label">Grid</span>
          <b>{Math.min(d.g + 1, d.grids)}</b>
        </span>
        {[3, 4, 5].map(arrow)}
        {[0, 1, 2].map(arrow)}
        {d.slots.map((name, i) => {
          const area = { gridArea: `s${i}` } as CSSProperties;
          if (!name) return <span key={`e${i}`} className="gslot-empty" style={area} />;
          const inLit = litSlots.has(i);
          const states: CardState[] = [];
          if (lit !== null) states.push(inLit ? (aiLine !== null ? 'ai' : 'sel') : 'dim');
          if (hint !== null && (LINES[hint] ?? []).includes(i) && lit === null) states.push('hint');
          return (
            <DCard
              key={name}
              name={name}
              big
              className="gslot"
              style={area}
              states={states}
              onClick={() => onInfo(name)}
              label={`${name} — row ${Math.floor(i / 3) + 1}, column ${(i % 3) + 1}`}
            />
          );
        })}
        {showWhy && whyOpen && (
          <GridHintPopover ref={popRef} id="ghint-pop" blurb={why!} low={hint === 0} onEnter={openHover} onLeave={closeHover} onPin={() => setWhyOpen('pin')}>
            {whyExtra}
          </GridHintPopover>
        )}
      </div>
    </div>
  );
}

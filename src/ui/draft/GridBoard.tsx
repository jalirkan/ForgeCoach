/*
 * ForgeCoach — ui/draft/GridBoard.tsx
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The 3×3 grid as large cards. Row arrows sit at the left, column arrows on
 * top; pointing at one (or tapping it) lights its cards and dims the rest,
 * and the decision panel then takes it. The AI's line glows crimson for a
 * beat before it leaves. With hints on, the pick helper's line carries a
 * quiet gold mark.
 */
import type { CSSProperties } from 'react';
import { LINES, lineName, type GridDraft } from '../../draft/draft.ts';
import { cx } from '../util.ts';
import { DCard, type CardState } from './DCard.tsx';

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
}) {
  const lit = aiLine ?? preview ?? selected;
  const litSlots = new Set(lit !== null ? (LINES[lit] ?? []) : []);
  const has = (l: number) => (LINES[l] ?? []).some((i) => d.slots[i]);
  const legal = (l: number) => mine && l !== d.firstLine && has(l);

  const arrow = (l: number) => {
    const col = l >= 3;
    const on = selected === l;
    return (
      <button
        key={l}
        className={cx('garrow', col ? 'is-col' : 'is-row', on && 'is-on', hint === l && 'is-hint', aiLine === l && 'is-ai')}
        style={{ gridArea: col ? `c${l - 2}` : `r${l + 1}` } as CSSProperties}
        disabled={!legal(l)}
        aria-pressed={on}
        aria-label={`Select the ${lineName(l)}`}
        onClick={() => onSelect(on ? null : l)}
        onPointerEnter={(e) => e.pointerType === 'mouse' && onPreview(l)}
        onPointerLeave={(e) => e.pointerType === 'mouse' && onPreview(null)}
        onFocus={() => onPreview(l)}
        onBlur={() => onPreview(null)}
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
      </div>
    </div>
  );
}

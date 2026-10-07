/*
 * ForgeCoach — ui/draft/GridHint.tsx
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The grid hint's "why this line" popover (draft/gridBlurb.ts): the call, one
 * line per card with its value and reasons, what the pick leaves the other
 * drafter, and a close-call note. GridBoard opens it from the Hint arrow:
 * pointing at it (mouse), focusing it (keyboard), or tapping it (touch, which
 * also selects the line as before); tapping outside or Escape closes it.
 * `children` go under the blurb (the coach's "Explain more").
 */
import { forwardRef, type ReactNode } from 'react';
import type { GridBlurb } from '../../draft/gridBlurb.ts';
import { cx } from '../util.ts';

export const GridHintPopover = forwardRef<HTMLDivElement, { blurb: GridBlurb; low: boolean; id: string; onEnter: () => void; onLeave: () => void; onPin: () => void; children?: ReactNode }>(
  function GridHintPopover({ blurb, low, id, onEnter, onLeave, onPin, children }, ref) {
    return (
      <div
        ref={ref}
        id={id}
        role="dialog"
        aria-label="Why the hint"
        className={cx('ghint-pop', low && 'is-low')}
        onPointerEnter={(e) => e.pointerType === 'mouse' && onEnter()}
        onPointerLeave={(e) => e.pointerType === 'mouse' && onLeave()}
        onPointerDown={onPin}
        onFocus={onEnter}
      >
        <div className="ghint-title">
          <span className="fx-label">Hint</span> {blurb.title}
        </div>
        <ul className="ghint-cards">
          {blurb.cards.map((c) => (
            <li key={c.name}>
              <span className="ghint-name">{c.name}</span>
              <span className="ghint-val" title="Pick value for you">
                {Math.round(c.value)}
              </span>
              {c.reasons.length > 0 && <span className="ghint-why">{c.reasons.join(' · ')}</span>}
            </li>
          ))}
        </ul>
        {blurb.leaves && <p className="ghint-note">{blurb.leaves}</p>}
        {blurb.close && <p className="ghint-note is-close">{blurb.close}</p>}
        {children}
      </div>
    );
  },
);

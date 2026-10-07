/*
 * ForgeCoach — ui/draft/GridHint.tsx
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The grid hint's "why this line" popover (draft/gridBlurb.ts): the call, one
 * line per card with its value and reasons, what the pick leaves the other
 * drafter, and a close-call note. GridBoard opens it from the Hint arrow:
 * pointing at it (mouse), focusing it (keyboard), or tapping it (touch, which
 * also selects the line as before); tapping outside or Escape closes it.
 * `children` go under the blurb: the coach's "Explain more" (GridWhyCoach).
 */
import { forwardRef, type ReactNode } from 'react';
import type { GridBlurb } from '../../draft/gridBlurb.ts';
import type { Prompt } from '../../prompt.ts';
import { startAnswer, stopAnswer, useAnswer } from '../answers.ts';
import { isHelperThinking, thinkingLine } from '../coachWait.ts';
import { useNowWhile } from '../hooks.ts';
import { Markdown } from '../Markdown.tsx';
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

/**
 * "Explain more": the coach's two or three sentences on why the line's cards go
 * together (draft/gridWhyPrompt.ts), through answers.ts `startAnswer` (the
 * player's coach source and thinking settings). The answer is kept per grid and
 * line under `answerKey`, so re-opening the popover shows it without asking again.
 */
export function GridWhyCoach({ answerKey, makePrompt, onSettings }: { answerKey: string; makePrompt: () => Promise<Prompt>; onSettings: () => void }) {
  const answer = useAnswer(answerKey);
  const busy = answer?.status === 'preparing' || answer?.status === 'queued' || answer?.status === 'streaming';
  const now = useNowWhile(isHelperThinking(answer));
  const thinking = thinkingLine(answer, now);
  const ask = () => void startAnswer(answerKey, makePrompt);
  return (
    <div className="ghint-coach" aria-live="polite">
      {answer?.text && <Markdown text={answer.text} streaming={answer.status === 'streaming'} />}
      {answer?.status === 'preparing' && <p className="ghint-wait pulse">Asking the coach…</p>}
      {answer?.status === 'queued' && <p className="ghint-wait pulse">Waiting for the coach…</p>}
      {answer?.status === 'streaming' && !answer.text && <p className="ghint-wait pulse">{thinking ?? 'Thinking it through…'}</p>}
      {answer?.status === 'stopped' && <p className="ghint-wait">Stopped.</p>}
      {answer?.status === 'error' && (
        <p className="ghint-wait is-bad">
          {answer.error}{' '}
          <button type="button" className="link-btn" onClick={onSettings}>
            Coach settings
          </button>
        </p>
      )}
      {busy ? (
        <button type="button" className="ghint-btn" onClick={() => stopAnswer(answerKey)}>
          Stop
        </button>
      ) : answer?.status !== 'done' ? (
        <button type="button" className="ghint-btn" onClick={ask}>
          {answer ? 'Ask again' : 'Explain more'}
        </button>
      ) : null}
    </div>
  );
}

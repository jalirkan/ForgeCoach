/*
 * ForgeCoach — ui/review/ReviewTimeline.tsx
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The game's graded decisions by turn. Each chip says its kind and verdict in
 * words (and a short glyph), key moments carry their rank; colour only
 * repeats what the text says.
 */
import type { GameLog } from '../../log.ts';
import { decisionState, isTie, reviewTimeline, TYPE_WORDS, verdictLabel, type ReviewDecision, type ReviewVerdict } from '../../gameReview.ts';
import { phaseLabel } from '../../decisions.ts';
import { cx } from '../util.ts';

const GLYPH: Record<ReviewVerdict, string> = { mistake: '!', close: '≈', best: '✓', 'not-graded': '–' };
const SHORT: Record<ReviewVerdict, string> = { mistake: 'Mistake', close: 'Close', best: 'Best', 'not-graded': 'Not graded' };

export function ReviewTimeline({
  log,
  decisions,
  keyMoments,
  selected,
  onSelect,
}: {
  log: GameLog;
  decisions: ReviewDecision[];
  keyMoments: number[];
  selected: number | null;
  onSelect: (frame: number) => void;
}) {
  const turns = reviewTimeline(decisions, keyMoments);
  return (
    <ol className="rv-tl" aria-label="Your decisions, by turn">
      {turns.map((t, ti) => {
        const st = decisionState(log, t.items[0]!.decision);
        const yours = st ? st.activePlayer === log.seat : null;
        return (
          <li key={`${t.turn}-${ti}`} className="rv-tl-turn">
            <div className="rv-tl-head">
              <b>Turn {t.turn ?? '?'}</b>
              {yours !== null && <span className="muted tiny">{yours ? 'yours' : 'theirs'}</span>}
            </div>
            <div className="rv-tl-chips">
              {t.items.map(({ decision: d, keyRank }) => {
                const phase = phaseLabel(d.phase ?? decisionState(log, d)?.phase ?? null);
                const words = `Turn ${t.turn ?? '?'}, ${TYPE_WORDS[d.type].toLowerCase()} (${phase}): ${verdictLabel(d)}${keyRank ? `, key moment ${keyRank}` : ''}`;
                return (
                  <button
                    key={d.frame}
                    type="button"
                    className={cx('rv-chip', `v-${d.verdict}`, keyRank !== null && 'is-key', selected === d.frame && 'is-on')}
                    aria-pressed={selected === d.frame}
                    aria-label={words}
                    title={words}
                    onClick={() => onSelect(d.frame)}
                  >
                    <span className="rv-chip-glyph" aria-hidden="true">
                      {isTie(d) ? '=' : GLYPH[d.verdict]}
                    </span>
                    <span className="rv-chip-type">{TYPE_WORDS[d.type]}</span>
                    <span className="rv-chip-verdict">{isTie(d) ? 'Tie' : d.status === 'trivial' ? 'One option' : SHORT[d.verdict]}</span>
                    {keyRank !== null && <span className="rv-chip-key">#{keyRank}</span>}
                  </button>
                );
              })}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

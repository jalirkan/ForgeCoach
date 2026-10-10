/*
 * ForgeCoach — ui/draft/WinstonBoard.tsx
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Winston: the face-down stack and three piles as stacked backs with count
 * badges, the pile being looked at lifted and glowing. On your turn its cards
 * are fanned large below; a card the stack adds deals in. On the AI's turn
 * the piles alone tell the story (a pile grows when it passes, empties when
 * it takes) and you never see what it took unless you saw it yourself.
 */
import type { CSSProperties } from 'react';
import { canPass, type WinstonDraft } from '../../draft/draft.ts';
import { cx } from '../util.ts';
import { BackStack, DCard } from './DCard.tsx';

export function WinstonBoard({
  d,
  mine,
  hintTake,
  onInfo,
}: {
  d: WinstonDraft;
  mine: boolean;
  /** The pick helper's call for this pile (hints on): true take, false pass, null none. */
  hintTake: boolean | null;
  onInfo: (n: string) => void;
}) {
  const pile = d.piles[d.look] ?? [];
  const seen = new Set(d.seen.you);
  const n = pile.length;
  // A pile you looked at before and that has grown since: mark the cards you haven't seen.
  const grown = pile.some((c) => seen.has(c));
  return (
    <div className="wboard">
      <div className="wrow" role="list" aria-label="The stack and the piles">
        <div className="wspot is-stack" role="listitem">
          <BackStack n={d.stack.length} />
          <span className="wspot-l fx-label">Stack</span>
        </div>
        {d.piles.map((p, i) => {
          const looking = i === d.look;
          const state = looking ? (mine ? 'Looking' : 'AI looking') : i < d.look ? 'Passed' : '';
          return (
            <div key={i} className={cx('wspot', looking && 'is-look', looking && !mine && 'is-ai')} role="listitem" aria-label={`Pile ${i + 1}: ${p.length} cards${state ? `, ${state.toLowerCase()}` : ''}`}>
              <BackStack n={p.length} glow={looking && mine} key={`${i}:${p[0] ?? ''}`} className={cx(looking && 'is-lift')} />
              <span className="wspot-l">
                <span className="fx-label">Pile {i + 1}</span>
                {state && <span className="wspot-s">{state}</span>}
              </span>
            </div>
          );
        })}
      </div>

      {mine ? (
        <div className="wfan-wrap">
          <div className="wfan-h">
            <span className="serif-h">
              Pile {d.look + 1} <span className="muted-count">· {n} card{n === 1 ? '' : 's'}</span>
            </span>
            {!canPass(d) && <span className="tag-gold">Must take</span>}
            {hintTake !== null && <span className={cx('tag-hint', hintTake ? 'is-take' : 'is-pass')}>Hint: {hintTake ? 'take' : 'pass'}</span>}
          </div>
          <div className={cx('wfan', n > 3 && 'is-many', n > 6 && 'is-lots')} style={{ '--n': n } as CSSProperties}>
            {pile.map((name, i) => (
              <DCard
                key={name}
                name={name}
                big
                className="wfan-card"
                style={{ '--k': i } as CSSProperties}
                states={['new', hintTake ? 'hint' : null]}
                onClick={() => onInfo(name)}
                badge={grown && !seen.has(name) ? <span className="new-tag">New</span> : undefined}
              />
            ))}
          </div>
        </div>
      ) : (
        <div className="wwait">
          <span className="wwait-dot" />
          <p className="serif-i">The bot is looking at pile {d.look + 1}…</p>
        </div>
      )}
    </div>
  );
}

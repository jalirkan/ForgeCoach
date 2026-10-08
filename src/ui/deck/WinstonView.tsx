/*
 * ForgeCoach — ui/deck/WinstonView.tsx
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The Winston pick helper: which pile you are looking at, its cards, and
 * whether to take it or pass, with the numbers behind the call.
 */
import { useMemo, useState } from 'react';
import type { CubeContext } from '../../cube/score.ts';
import type { SavedPool } from '../../cube/pools.ts';
import { recommendWinston } from '../../cube/pick.ts';
import { IconPlus, IconX } from '../Icons.tsx';
import { cx } from '../util.ts';
import { CubeCard } from './CubeCard.tsx';
import { CardPicker } from './sheets.tsx';
import { HumanPickAdvice, HumanPicksSource, useHumanPicks } from '../HumanPicks.tsx';

export function WinstonView({ ctx, pool, onChange, onInfo }: { ctx: CubeContext; pool: SavedPool; onChange: (p: SavedPool) => void; onInfo: (n: string) => void }) {
  const pile = pool.pile ?? [];
  const idx = pool.pileIndex ?? 1;
  const [sizes, setSizes] = useState<[number, number, number]>([1, 1, 1]);
  const [picking, setPicking] = useState(false);
  const set = (p: Partial<SavedPool>) => onChange({ ...pool, format: 'winston', ...p, updatedAt: Date.now() });
  const advice = useMemo(
    () => (pile.length ? recommendWinston({ pile, pileIndex: idx, sizes, pool: pool.cards, oppPool: pool.opp }, ctx) : null),
    [pile, idx, sizes, pool.cards, pool.opp, ctx],
  );
  const humanPicks = useHumanPicks(pool.cubeId);
  const exclude = useMemo(() => new Set([...pool.cards, ...pool.opp, ...pile]), [pool.cards, pool.opp, pile]);

  return (
    <div className="wv">
      <div className="wv-left">
        <div className="wv-piles" role="tablist" aria-label="Pile you are looking at">
          {([1, 2, 3] as const).map((i) => (
            <div key={i} className={cx('wv-pile', idx === i && 'is-on')}>
              <button role="tab" aria-selected={idx === i} className="wv-pile-n" onClick={() => set({ pileIndex: i })}>
                Pile {i}
              </button>
              {i > idx ? (
                <span className="wv-size" title="Cards in this pile">
                  <button
                    className="icon-btn wv-step"
                    aria-label={`Fewer cards in pile ${i}`}
                    onClick={() => setSizes(sizes.map((s, k) => (k === i - 1 ? Math.max(1, s - 1) : s)) as [number, number, number])}
                  >
                    −
                  </button>
                  <span>{sizes[i - 1]}</span>
                  <button
                    className="icon-btn wv-step"
                    aria-label={`More cards in pile ${i}`}
                    onClick={() => setSizes(sizes.map((s, k) => (k === i - 1 ? Math.min(9, s + 1) : s)) as [number, number, number])}
                  >
                    +
                  </button>
                </span>
              ) : (
                <span className="muted tiny">{i === idx ? 'looking' : 'passed'}</span>
              )}
            </div>
          ))}
        </div>
        <div className="wv-cards">
          {pile.map((n) => (
            <div key={n} className="wv-card">
              <CubeCard name={n} colors={ctx.facts.get(n)?.colors} chip={Math.round(advice?.cards.find((c) => c.name === n)?.value ?? 0)} onClick={() => onInfo(n)} />
              <button className="wv-remove" onClick={() => set({ pile: pile.filter((x) => x !== n) })} aria-label={`Remove ${n} from the pile`}>
                <IconX size={12} />
              </button>
            </div>
          ))}
          <button className="gv-empty wv-add" onClick={() => setPicking(true)} aria-label="Add a card to the pile">
            <IconPlus size={18} />
            <span className="tiny">Add card</span>
          </button>
        </div>
        <div className="wv-actions">
          <button className="btn btn-primary" disabled={!pile.length} onClick={() => set({ cards: [...pool.cards, ...pile], pile: [], pileIndex: 1 })}>
            I took it
          </button>
          <button className="btn btn-quiet" disabled={!pile.length || idx === 3} onClick={() => set({ pile: [], pileIndex: Math.min(3, idx + 1) as 1 | 2 | 3 })}>
            I passed — next pile
          </button>
          <button className="btn btn-quiet" disabled={!pile.length} onClick={() => set({ opp: [...pool.opp, ...pile], pile: [], pileIndex: 1 })}>
            They took it
          </button>
        </div>
      </div>

      <div className="wv-right">
        {!advice ? (
          <div className="card-box notice">
            <p className="muted">Add the cards of the pile you are looking at. Set the sizes of the piles still ahead (they are face down) for a sharper call.</p>
          </div>
        ) : (
          <div className={cx('card-box adv', advice.action === 'take' ? 'is-take' : 'is-pass')}>
            <div className="adv-kicker">Pile {idx}</div>
            <div className="adv-title">
              <b>{advice.action === 'take' ? 'Take it' : 'Pass'}</b>
            </div>
            <div className="adv-nums">
              <span>
                take <b>{advice.take}</b>
              </span>
              <span>
                pass <b>{advice.pass}</b>
              </span>
              {advice.margin > 0 && <span className="muted">margin {advice.margin}</span>}
            </div>
            <ul className="adv-reasons">
              {advice.reasons.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
            <HumanPickAdvice data={humanPicks} names={pile} pool={pool.cards} ctx={ctx} />
            {humanPicks && <HumanPicksSource data={humanPicks} />}
          </div>
        )}
      </div>

      <CardPicker
        open={picking}
        title={`Add to pile ${idx}`}
        ctx={ctx}
        exclude={exclude}
        pool={pool.cards}
        onClose={() => setPicking(false)}
        onPick={(n) => {
          set({ pile: [...pile, n] });
          setPicking(false);
        }}
      />
    </div>
  );
}

/*
 * ForgeCoach — ui/deck/GridView.tsx
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The Grid pick helper: enter the nine cards (tap a slot, type a name), see
 * which row or column to take and why — including what the opponent can take
 * after you — then record who took what so the pool keeps up.
 */
import { useMemo, useState } from 'react';
import type { CubeContext } from '../../cube/score.ts';
import type { SavedPool } from '../../cube/pools.ts';
import { GRID_LINES, pickValue, poolProfile, recommendGrid, type GridLine } from '../../cube/pick.ts';
import { IconPlus, IconSpark, IconTrash } from '../Icons.tsx';
import { cx } from '../util.ts';
import { CubeCard } from './CubeCard.tsx';
import { CardPicker } from './sheets.tsx';

const EMPTY: Array<string | null> = [null, null, null, null, null, null, null, null, null];

export function GridView({ ctx, pool, onChange, onInfo }: { ctx: CubeContext; pool: SavedPool; onChange: (p: SavedPool) => void; onInfo: (n: string) => void }) {
  const slots = pool.grid && pool.grid.length === 9 ? pool.grid : EMPTY;
  const [picking, setPicking] = useState<number | null>(null);
  const [who, setWho] = useState<'me' | 'them'>('me');
  const filled = slots.filter(Boolean).length;
  const advice = useMemo(() => (filled >= 2 ? recommendGrid(slots, pool.cards, ctx, pool.opp) : null), [slots, filled, pool.cards, pool.opp, ctx]);
  const best = advice?.best ?? null;
  const prof = useMemo(() => poolProfile(pool.cards, ctx), [pool.cards, ctx]);
  const totals = new Map(advice?.options.map((o) => [o.line.id, o.total]) ?? []);
  const exclude = useMemo(() => new Set([...pool.cards, ...pool.opp, ...slots.filter((s): s is string => !!s)]), [pool.cards, pool.opp, slots]);

  const setSlots = (next: Array<string | null>, extra: Partial<SavedPool> = {}) => onChange({ ...pool, grid: next, format: 'grid', ...extra, updatedAt: Date.now() });

  const take = (line: GridLine) => {
    const cards = line.slots.map((i) => slots[i]).filter((s): s is string => !!s);
    if (!cards.length) return;
    const next = slots.map((s, i) => (line.slots.includes(i) ? null : s));
    if (who === 'me') setSlots(next, { cards: [...pool.cards, ...cards] });
    else setSlots(next, { opp: [...pool.opp, ...cards] });
    setWho(who === 'me' ? 'them' : 'me');
  };

  const lineBtn = (line: GridLine, cls: string) => {
    const has = line.slots.some((i) => slots[i]);
    const t = totals.get(line.id);
    return (
      <button
        key={line.id}
        className={cx('gl-btn', cls, best?.line.id === line.id && 'is-best')}
        disabled={!has}
        onClick={() => take(line)}
        title={`${who === 'me' ? 'I take' : 'They take'} the ${line.label.toLowerCase()}`}
        aria-label={`${who === 'me' ? 'I take' : 'They take'} the ${line.label.toLowerCase()}`}
      >
        <span className="gl-arrow" aria-hidden="true">
          {cls === 'gl-col' ? '↓' : '→'}
        </span>
        {t !== undefined && <span className="gl-total">{Math.round(t)}</span>}
      </button>
    );
  };

  return (
    <div className="gv">
      <div className="gv-board-wrap">
        <div className="gv-bar">
          <div className="seg" role="tablist" aria-label="Who picks now">
            <button className={cx(who === 'me' && 'is-on')} onClick={() => setWho('me')} role="tab" aria-selected={who === 'me'}>
              I pick
            </button>
            <button className={cx(who === 'them' && 'is-on')} onClick={() => setWho('them')} role="tab" aria-selected={who === 'them'}>
              They pick
            </button>
          </div>
          <button className="btn btn-quiet btn-sm" onClick={() => setSlots(EMPTY.slice())} disabled={filled === 0}>
            <IconTrash size={13} /> New grid
          </button>
        </div>
        <div className="gv-board">
          <span className="gv-corner muted tiny">{filled}/9</span>
          {GRID_LINES.slice(3).map((l) => lineBtn(l, 'gl-col'))}
          {[0, 1, 2].map((r) => (
            <div key={r} className="gv-rowwrap">
              {lineBtn(GRID_LINES[r]!, 'gl-row')}
              {[0, 1, 2].map((c) => {
                const i = r * 3 + c;
                const name = slots[i];
                const hl = !!best && best.line.slots.includes(i) && !!name;
                return name ? (
                  <CubeCard
                    key={i}
                    name={name}
                    colors={ctx.facts.get(name)?.colors}
                    chip={Math.round(pickValue(name, pool.cards, ctx, prof).total)}
                    highlight={hl}
                    onClick={() => setPicking(i)}
                    onInfo={() => onInfo(name)}
                    className="gv-slot"
                    label={`${name} — tap to change`}
                  />
                ) : (
                  <button key={i} className="gv-empty" onClick={() => setPicking(i)} aria-label={`Add a card to slot ${i + 1}`}>
                    <IconPlus size={18} />
                  </button>
                );
              })}
            </div>
          ))}
        </div>
        <p className="tiny muted gv-hint">Tap a slot to enter its card. Tap an arrow when a row or column is taken — it goes to {who === 'me' ? 'your pool' : 'their picks'}.</p>
      </div>

      <div className="gv-advice">
        {!advice || !best ? (
          <div className="card-box notice">
            <p className="muted">Enter the grid’s cards to get a pick. With all nine there you pick first; with a line already gone you pick second.</p>
          </div>
        ) : (
          <>
            <div className="card-box adv">
              <div className="adv-kicker">
                <IconSpark size={13} /> {advice.first ? 'You pick first' : 'You pick second'}
              </div>
              <div className="adv-title">
                Take the <b>{best.line.label.toLowerCase()}</b>
              </div>
              <div className="adv-cards">{best.cards.join(' · ')}</div>
              <ul className="adv-reasons">
                {best.reasons.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
              <div className="adv-nums">
                <span>
                  worth <b>{best.mine}</b> to you
                </span>
                {best.reply && (
                  <span>
                    − ½ × <b>{best.reply.value}</b> they take next
                  </span>
                )}
                <span>
                  = <b>{best.total}</b>
                </span>
              </div>
            </div>
            <div className="card-box adv-list">
              <div className="box-h">Every line</div>
              {advice.options.map((o) => (
                <div key={o.line.id} className={cx('adv-row', o === best && 'is-best')}>
                  <span className="adv-row-l">{o.line.label}</span>
                  <span className="adv-row-c">{o.cards.join(', ')}</span>
                  <span className="adv-row-v">{Math.round(o.total)}</span>
                </div>
              ))}
              {!pool.opp.length && advice.first && <p className="tiny muted">Their replies are judged by plain card value — record their picks (“They pick”) to judge them for their colours.</p>}
            </div>
          </>
        )}
      </div>

      <CardPicker
        open={picking !== null}
        title={picking !== null ? `Slot ${picking + 1} (row ${Math.floor(picking / 3) + 1}, column ${(picking % 3) + 1})` : ''}
        ctx={ctx}
        exclude={exclude}
        pool={pool.cards}
        onClose={() => setPicking(null)}
        onRemove={picking !== null && slots[picking] ? () => (setSlots(slots.map((s, i) => (i === picking ? null : s))), setPicking(null)) : undefined}
        onPick={(n) => {
          if (picking === null) return;
          const next = slots.map((s, i) => (i === picking ? n : s));
          setSlots(next);
          // Move on to the next empty slot, for fast entry.
          const after = next.findIndex((s, i) => !s && i > picking);
          const anyEmpty = next.findIndex((s) => !s);
          setPicking(after >= 0 ? after : anyEmpty >= 0 ? anyEmpty : null);
        }}
      />
    </div>
  );
}

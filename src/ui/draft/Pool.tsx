/*
 * ForgeCoach — ui/draft/Pool.tsx
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Your pool while drafting: a quiet summary for the side column (curve bars,
 * colour pips, the list by colour with stacked duplicates) and the full view
 * as a modal of large card images in columns, with sort pills — after the
 * board game's graveyard viewer.
 */
import { useMemo, useState } from 'react';
import type { CubeContext } from '../../cube/score.ts';
import { colourCounts, colourKey, curveOf, poolColumns, typeSummary, type PoolSort } from '../../draft/poolView.ts';
import { useCardInfo } from '../cardData.ts';
import { ManaCost, Pip } from '../Mana.tsx';
import { Sheet } from '../Sheet.tsx';
import { cx } from '../util.ts';
import { CountBadge, DCard } from './DCard.tsx';

const CURVE_LABELS = ['1', '2', '3', '4', '5', '6+'];

export function CurveBars({ pool, ctx, compact }: { pool: string[]; ctx: CubeContext; compact?: boolean }) {
  const curve = curveOf(pool, ctx);
  const max = Math.max(4, ...curve);
  return (
    <div className={cx('curve', compact && 'is-compact')} aria-label={`Curve: ${curve.map((n, i) => `${n} at ${CURVE_LABELS[i]}`).join(', ')}`}>
      {curve.map((n, i) => (
        <div key={i} className="curve-col">
          <span className="curve-n">{n || ''}</span>
          <span className="curve-bar">
            <span style={{ height: `${(n / max) * 100}%` }} />
          </span>
          <span className="curve-l">{CURVE_LABELS[i]}</span>
        </div>
      ))}
    </div>
  );
}

export function ColourPips({ pool, ctx }: { pool: string[]; ctx: CubeContext }) {
  const counts = colourCounts(pool, ctx);
  return (
    <div className="cpips">
      {(['W', 'U', 'B', 'R', 'G'] as const).map((c) => (
        <span key={c} className={cx('cpip', !counts[c] && 'is-zero')}>
          <Pip sym={c} size="sm" />
          <b>{counts[c]}</b>
        </span>
      ))}
    </div>
  );
}

function ListRow({ name, count, onInfo }: { name: string; count: number; onInfo: (n: string) => void }) {
  const info = useCardInfo(name);
  return (
    <button className="plist-row" onClick={() => onInfo(name)}>
      <span className="plist-name">{name}</span>
      {count > 1 && <CountBadge n={count} />}
      <span className="plist-cost">{info?.manaCost ? <ManaCost cost={info.manaCost.split(' // ')[0]} size="sm" /> : null}</span>
    </button>
  );
}

const GROUP_LABEL: Record<string, string> = { W: 'White', U: 'Blue', B: 'Black', R: 'Red', G: 'Green', M: 'Gold', C: 'Colourless', L: 'Lands' };

/** The side-column summary. */
export function PoolSummary({ pool, ctx, onOpen, onInfo, title = 'Your pool' }: { pool: string[]; ctx: CubeContext; onOpen: () => void; onInfo: (n: string) => void; title?: string }) {
  const cols = useMemo(() => poolColumns(pool, ctx, 'colour'), [pool, ctx]);
  return (
    <section className="ppanel">
      <header className="ppanel-h">
        <h3 className="serif-h">
          {title} <span className="muted-count">· {pool.length} cards</span>
        </h3>
        <button className="pill" onClick={onOpen} disabled={!pool.length}>
          View
        </button>
      </header>
      {pool.length === 0 ? (
        <p className="quiet-italic">Nothing yet. Your picks gather here.</p>
      ) : (
        <>
          <div className="ppanel-stats">
            <CurveBars pool={pool} ctx={ctx} compact />
            <ColourPips pool={pool} ctx={ctx} />
          </div>
          <p className="ppanel-types">{typeSummary(pool, ctx)}</p>
          <div className="plist">
            {cols.map((c) => (
              <div key={c.key} className="plist-group">
                <div className={cx('plist-h', `g-${c.key}`)}>
                  {GROUP_LABEL[c.key] ?? c.label} <span>{c.size}</span>
                </div>
                {c.entries.map((e) => (
                  <ListRow key={e.name} name={e.name} count={e.count} onInfo={onInfo} />
                ))}
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

const SORTS: Array<[PoolSort, string]> = [
  ['curve', 'Curve'],
  ['colour', 'Colour'],
  ['picks', 'Pick order'],
];

/** The full pool: large images in columns. */
export function PoolSheet({
  open,
  onClose,
  pool,
  ctx,
  title,
  onInfo,
  hiddenCount = 0,
}: {
  open: boolean;
  onClose: () => void;
  pool: string[];
  ctx: CubeContext;
  title: string;
  onInfo: (n: string) => void;
  /** Cards in the pool the player has not seen (the AI's Winston picks): shown as backs. */
  hiddenCount?: number;
}) {
  const [sort, setSort] = useState<PoolSort>('curve');
  const cols = useMemo(() => poolColumns(pool, ctx, sort), [pool, ctx, sort]);
  const total = pool.length + hiddenCount;
  return (
    <Sheet
      open={open}
      onClose={onClose}
      width={1180}
      className="fx fx-sheet pool-sheet"
      title={
        <span className="serif-title">
          {title} <span className="muted-count">· {total} cards</span>
        </span>
      }
      subtitle={pool.length ? typeSummary(pool, ctx) + (hiddenCount ? ` · ${hiddenCount} unseen` : '') : undefined}
      footer={
        <button className="btn-wide" onClick={onClose}>
          Close
        </button>
      }
    >
      <div className="psheet-bar">
        <div className="pills" role="tablist" aria-label="Sort">
          {SORTS.map(([s, l]) => (
            <button key={s} role="tab" aria-selected={sort === s} className={cx('pill', sort === s && 'is-on')} onClick={() => setSort(s)}>
              {l}
            </button>
          ))}
        </div>
        <div className="psheet-stats">
          <CurveBars pool={pool} ctx={ctx} compact />
          <ColourPips pool={pool} ctx={ctx} />
        </div>
      </div>
      {pool.length === 0 && !hiddenCount ? (
        <p className="quiet-italic">No cards yet.</p>
      ) : (
        <div className={cx('pcols', sort === 'picks' && 'is-rows')}>
          {cols.map((c) => (
            <div key={c.key} className={cx('pcol', `g-${colourKey(c.entries[0]?.name ?? '', ctx)}`)}>
              <div className="pcol-h">
                {c.label} <span>{c.size}</span>
              </div>
              <div className="pcol-cards">
                {c.entries.map((e) => (
                  <DCard key={e.name} name={e.name} className="pcol-card" onClick={() => onInfo(e.name)} badge={e.count > 1 ? <CountBadge n={e.count} /> : undefined} />
                ))}
              </div>
            </div>
          ))}
          {hiddenCount > 0 && (
            <div className="pcol">
              <div className="pcol-h">
                Unseen <span>{hiddenCount}</span>
              </div>
              <div className="pcol-cards">
                <span className="pcol-card dback-wrap">
                  <span className="dback" />
                  <CountBadge n={hiddenCount} className="dc-badge" />
                </span>
              </div>
            </div>
          )}
        </div>
      )}
    </Sheet>
  );
}

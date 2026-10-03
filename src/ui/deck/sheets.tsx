/*
 * ForgeCoach — ui/deck/sheets.tsx
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The deck assistant's two sheets: a searchable card picker (for grid slots
 * and Winston piles) and a card's details (image, text, value, lab numbers).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { CubeContext } from '../../cube/score.ts';
import { cardPrior, cardValue, metaValue, pct } from '../../cube/score.ts';
import { pickValue, poolProfile, type PoolProfile } from '../../cube/pick.ts';
import { useCardInfo } from '../cardData.ts';
import { ManaCost, SymbolText } from '../Mana.tsx';
import { Sheet } from '../Sheet.tsx';
import { IconTrash } from '../Icons.tsx';
import { colorClass, cx } from '../util.ts';

const norm = (s: string) => s.toLowerCase().replace(/[’']/g, "'");

function PickRow({ name, ctx, pool, prof, onPick }: { name: string; ctx: CubeContext; pool: string[]; prof: PoolProfile; onPick: (n: string) => void }) {
  const info = useCardInfo(name);
  const f = ctx.facts.get(name);
  const v = pickValue(name, pool, ctx, prof).total;
  return (
    <button className={cx('pick-row', colorClass([...(f?.colors ?? '')]))} onClick={() => onPick(name)}>
      <span className="pick-row-name">{name}</span>
      <span className="pick-row-cost">{info?.manaCost && <ManaCost cost={info.manaCost.split(' // ')[0]} size="sm" />}</span>
      <span className="pick-row-type muted">{(info?.typeLine ?? f?.typeLine ?? '').split(' // ')[0]?.replace(/ — .*/, '')}</span>
      <span className="pick-row-v">{Math.round(v)}</span>
    </button>
  );
}

export function CardPicker({
  open,
  title,
  ctx,
  exclude,
  pool,
  onPick,
  onClose,
  onRemove,
}: {
  open: boolean;
  title: string;
  ctx: CubeContext;
  exclude: Set<string>;
  pool: string[];
  onPick: (name: string) => void;
  onClose: () => void;
  onRemove?: () => void;
}) {
  const [q, setQ] = useState('');
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (open) {
      setQ('');
      setTimeout(() => input.current?.focus(), 30);
    }
  }, [open]);
  const prof = useMemo(() => poolProfile(pool, ctx), [pool, ctx]);
  const rows = useMemo(() => {
    const nq = norm(q.trim());
    return ctx.cube.cards
      .filter((c) => !exclude.has(c.name) && (!nq || norm(c.name).includes(nq)))
      .sort((a, b) => {
        if (nq) {
          const sa = norm(a.name).startsWith(nq) ? 0 : 1;
          const sb = norm(b.name).startsWith(nq) ? 0 : 1;
          if (sa !== sb) return sa - sb;
        }
        return a.name < b.name ? -1 : 1;
      })
      .slice(0, 60)
      .map((c) => c.name);
  }, [q, ctx, exclude]);
  return (
    <Sheet open={open} onClose={onClose} title={title} width={520} className="picker-sheet">
      <div className="picker-top">
        <input
          ref={input}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Type a card name…"
          aria-label="Search cards"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && rows[0]) onPick(rows[0]);
          }}
        />
        {onRemove && (
          <button className="btn btn-quiet" onClick={onRemove}>
            <IconTrash size={14} /> Empty slot
          </button>
        )}
      </div>
      <div className="picker-list" role="list">
        {rows.map((n) => (
          <PickRow key={n} name={n} ctx={ctx} pool={pool} prof={prof} onPick={onPick} />
        ))}
        {rows.length === 0 && <p className="muted small">No card in this cube matches.</p>}
      </div>
      <p className="tiny muted">The number is the card’s pick value for your pool.</p>
    </Sheet>
  );
}

export function CardInfoSheet({ name, ctx, pool, onClose }: { name: string | null; ctx: CubeContext; pool: string[]; onClose: () => void }) {
  const info = useCardInfo(name);
  const card = name ? ctx.byName.get(name) : undefined;
  const img = info?.image?.normal ?? info?.faces?.[0]?.image?.normal;
  const m = name ? metaValue(name, ctx) : null;
  const stats = name ? ctx.meta?.meta.cards[name] : undefined;
  const pv = name ? pickValue(name, pool, ctx) : null;
  return (
    <Sheet open={name !== null} onClose={onClose} title={name ?? ''} width={680} className="cardinfo-sheet">
      {name && (
        <div className="ci">
          <div className="ci-img">{img ? <img src={img} alt={name} /> : <div className="ci-img-ph" />}</div>
          <div className="ci-body">
            {info?.found ? (
              <>
                <div className="ci-line">
                  <ManaCost cost={info.manaCost} size="md" /> <span className="muted">{info.typeLine}</span>
                </div>
                <p className="ci-text">
                  <SymbolText text={info.oracleText} />
                </p>
              </>
            ) : (
              <p className="muted small">Card text is loading (or unavailable offline).</p>
            )}
            <dl className="ci-stats">
              <dt>Value</dt>
              <dd>
                <b>{cardValue(name, ctx)}</b>{' '}
                <span className="muted">
                  (prior {cardPrior(name, ctx)}
                  {m ? `, lab ${Math.round(m.value)} weighted ${Math.round(m.weight * 100)}%` : ''})
                </span>
              </dd>
              {pv && (
                <>
                  <dt>For your pool</dt>
                  <dd>
                    <b>{pv.total}</b>{' '}
                    <span className="muted">
                      = {pv.card} card {pv.synergy >= 0 ? '+' : '−'} {Math.abs(pv.synergy)} synergy {pv.colour >= 0 ? '+' : '−'} {Math.abs(pv.colour)} colour
                    </span>
                  </dd>
                </>
              )}
              {card && (card.themes.length > 0 || card.tags.length > 0) && (
                <>
                  <dt>Themes</dt>
                  <dd>
                    {card.themes.map((t) => (
                      <span key={t} className="tag" title={ctx.themeName.get(t)}>
                        {t}
                      </span>
                    ))}{' '}
                    {card.tags.map((t) => (
                      <span key={t} className="tag tag-muted">
                        {t}
                      </span>
                    ))}
                  </dd>
                </>
              )}
              {stats && typeof stats.winRate === 'number' && (
                <>
                  <dt>Cube lab</dt>
                  <dd>
                    won {pct(stats.winRate)} of {stats.games ?? 0} games
                    {stats.ci ? ` (likely ${pct(stats.ci[0])}–${pct(stats.ci[1])})` : ''}
                    {typeof stats.inclusionRate === 'number' ? ` · made ${pct(stats.inclusionRate)} of decks` : ''}
                    {typeof stats.pickRate === 'number' ? ` · picked ${pct(stats.pickRate)} when seen` : ''}
                  </dd>
                </>
              )}
              {card?.price !== undefined && (
                <>
                  <dt>Price</dt>
                  <dd>${card.price.toFixed(2)}</dd>
                </>
              )}
            </dl>
          </div>
        </div>
      )}
    </Sheet>
  );
}

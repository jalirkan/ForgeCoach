/*
 * ForgeCoach — ui/draft/Collection.tsx
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * One way to look at a set of cards, shared by the draft's pool, the deck
 * builder and the cube page:
 *
 *   LAYOUT  Stacks (a column per group, cards overlapped to their title bars,
 *           the last one whole) · Gallery (large images in rows) · List
 *           (ruled rows with a count and the cost);
 *   GROUP   CMC · Type · Color · Rarity · None;
 *   SIZE    a slider for the card width.
 *
 * An optional side zone (the sideboard, or the pool's SIDE column) takes
 * cards by drag and drop or by tap, as the caller decides. Layout, group and
 * size are remembered per `prefsKey`.
 */
import { useEffect, useMemo, useState, type CSSProperties, type DragEvent, type ReactNode } from 'react';
import './collection.css';
import { groupCards, type GroupBy, type Layout, type MetaOf } from '../../draft/poolView.ts';
import { useCardInfo } from '../cardData.ts';
import { IconInfo } from '../Icons.tsx';
import { ManaCost } from '../Mana.tsx';
import { cx, readLS, writeLS } from '../util.ts';
import { CountBadge, DCard } from './DCard.tsx';

export type Zone = 'main' | 'side';

export interface CollectionPrefs {
  layout: Layout;
  group: GroupBy;
  size: number;
}

const LAYOUTS: Array<[Layout, string]> = [
  ['stacks', 'Stacks'],
  ['gallery', 'Gallery'],
  ['list', 'List'],
];
const GROUPS: Array<[GroupBy, string]> = [
  ['cmc', 'CMC'],
  ['type', 'Type'],
  ['color', 'Color'],
  ['rarity', 'Rarity'],
  ['none', 'None'],
];

export function usePrefs(key: string, init: CollectionPrefs): [CollectionPrefs, (p: Partial<CollectionPrefs>) => void] {
  const [p, setP] = useState<CollectionPrefs>(() => {
    try {
      const raw = JSON.parse(readLS(`forgecoach.view.${key}`) ?? 'null') as Partial<CollectionPrefs> | null;
      // Phones start a size smaller, so more columns fit.
      const phone = typeof window !== 'undefined' && window.innerWidth < 600;
      return { ...init, ...(phone ? { size: Math.round(init.size * 0.8) } : {}), ...(raw ?? {}) };
    } catch {
      return init;
    }
  });
  return [
    p,
    (q) =>
      setP((cur) => {
        const next = { ...cur, ...q };
        writeLS(`forgecoach.view.${key}`, JSON.stringify(next));
        return next;
      }),
  ];
}

/** The LAYOUT / GROUP / SIZE bar. */
export function ViewBar({ prefs, onChange, right, compact }: { prefs: CollectionPrefs; onChange: (p: Partial<CollectionPrefs>) => void; right?: ReactNode; compact?: boolean }) {
  return (
    <div className={cx('vbar', compact && 'is-compact')}>
      <div className="vbar-set">
        <span className="vbar-l">Layout</span>
        <div className="vseg" role="radiogroup" aria-label="Layout">
          {LAYOUTS.map(([l, label], i) => (
            <button key={l} role="radio" aria-checked={prefs.layout === l} className={cx(prefs.layout === l && 'is-on')} onClick={() => onChange({ layout: l })}>
              {label}
              <sup>{i + 1}</sup>
            </button>
          ))}
        </div>
      </div>
      <div className="vbar-set">
        <span className="vbar-l">Group</span>
        <div className="vseg" role="radiogroup" aria-label="Group by">
          {GROUPS.map(([g, label]) => (
            <button key={g} role="radio" aria-checked={prefs.group === g} className={cx(prefs.group === g && 'is-on')} onClick={() => onChange({ group: g })}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="vbar-right">
        {right}
        <SizeSlider value={prefs.size} onChange={(size) => onChange({ size })} />
      </div>
    </div>
  );
}

export function SizeSlider({ value, onChange, min = 64, max = 220 }: { value: number; onChange: (v: number) => void; min?: number; max?: number }) {
  return (
    <label className="vsize">
      <span>Size</span>
      <input type="range" min={min} max={max} step={2} value={value} onChange={(e) => onChange(Number(e.target.value))} style={{ '--p': `${((value - min) / (max - min)) * 100}%` } as CSSProperties} />
      <b>{value}</b>
    </label>
  );
}

function ListRow({ name, count, onClick, onInfo, hint }: { name: string; count: number; onClick?: () => void; onInfo?: () => void; hint?: boolean }) {
  const info = useCardInfo(name);
  return (
    <div className={cx('lrow', hint && 'is-hint')}>
      <span className="lrow-n">{count}</span>
      <button className="lrow-name" onClick={onClick ?? onInfo}>
        {name}
      </button>
      <span className="lrow-cost">{info?.manaCost ? <ManaCost cost={info.manaCost.split(' // ')[0]} size="sm" /> : null}</span>
      {onInfo && onClick && (
        <button className="lrow-i" onClick={onInfo} aria-label={`About ${name}`}>
          <IconInfo size={13} />
        </button>
      )}
    </div>
  );
}

function dragData(e: DragEvent, name: string, zone: Zone) {
  e.dataTransfer.setData('text/x-forgecoach-card', JSON.stringify({ name, zone }));
  e.dataTransfer.effectAllowed = 'move';
}
function readDrag(e: DragEvent): { name: string; zone: Zone } | null {
  try {
    return JSON.parse(e.dataTransfer.getData('text/x-forgecoach-card')) as { name: string; zone: Zone };
  } catch {
    return null;
  }
}

export function Collection({
  names,
  meta,
  prefs,
  side,
  sideLabel = 'Side',
  onCard,
  onInfo,
  onMove,
  hint,
  empty,
  className,
}: {
  names: string[];
  meta: MetaOf;
  prefs: CollectionPrefs;
  /** The side zone's cards (undefined: no side zone). */
  side?: string[];
  sideLabel?: string;
  /** A tap on a card (default: onInfo). */
  onCard?: (name: string, zone: Zone) => void;
  onInfo?: (name: string) => void;
  /** A card dragged to the other zone. */
  onMove?: (name: string, to: Zone) => void;
  /** Cards to glow softly (hints). */
  hint?: Set<string>;
  empty?: ReactNode;
  className?: string;
}) {
  const groups = useMemo(() => groupCards(names, meta, prefs.group), [names, meta, prefs.group]);
  const sideEntries = useMemo(() => (side ? groupCards(side, meta, 'none')[0]?.entries ?? [] : []), [side, meta]);
  const [over, setOver] = useState<Zone | null>(null);
  useEffect(() => {
    const end = () => setOver(null);
    window.addEventListener('dragend', end);
    return () => window.removeEventListener('dragend', end);
  }, []);
  const tap = (n: string, z: Zone) => (onCard ? () => onCard(n, z) : onInfo ? () => onInfo(n) : undefined);
  const dropZone = (z: Zone) =>
    onMove
      ? {
          onDragOver: (e: DragEvent) => {
            if (Array.from(e.dataTransfer.types).includes('text/x-forgecoach-card')) {
              e.preventDefault();
              setOver(z);
            }
          },
          onDragLeave: () => setOver((o) => (o === z ? null : o)),
          onDrop: (e: DragEvent) => {
            const d = readDrag(e);
            setOver(null);
            if (d && d.zone !== z) {
              e.preventDefault();
              onMove(d.name, z);
            }
          },
        }
      : {};
  const card = (n: string, count: number, z: Zone, cls: string) => (
    <div
      key={n}
      className={cx('cwrap', cls)}
      draggable={!!onMove}
      onDragStart={onMove ? (e) => dragData(e, n, z) : undefined}
    >
      <DCard name={n} onClick={tap(n, z)} states={[hint?.has(n) ? 'hint' : null]} badge={count > 1 ? <CountBadge n={count} /> : undefined} label={n} />
      {onInfo && onCard && (
        <button className="cwrap-i" onClick={() => onInfo(n)} aria-label={`About ${n}`}>
          <IconInfo size={12} />
        </button>
      )}
    </div>
  );
  const style = { '--cw': `${prefs.size}px` } as CSSProperties;
  const nothing = names.length === 0 && (!side || side.length === 0);

  if (prefs.layout === 'list') {
    return (
      <div className={cx('coll is-list', className)} style={style}>
        {nothing && empty}
        {groups.map((g) => (
          <section key={g.key} className="lgroup" {...dropZone('main')}>
            <h4 className="ghead">
              {g.label} <span>· {g.size}</span>
            </h4>
            {g.entries.map((e) => (
              <ListRow key={e.name} name={e.name} count={e.count} onClick={tap(e.name, 'main')} onInfo={onInfo ? () => onInfo(e.name) : undefined} hint={hint?.has(e.name)} />
            ))}
          </section>
        ))}
        {side && (
          <section className={cx('lgroup is-side', over === 'side' && 'is-over')} {...dropZone('side')}>
            <h4 className="ghead is-gold">
              {sideLabel} <span>· {side.length}</span>
            </h4>
            {sideEntries.map((e) => (
              <ListRow key={e.name} name={e.name} count={e.count} onClick={tap(e.name, 'side')} onInfo={onInfo ? () => onInfo(e.name) : undefined} />
            ))}
            {side.length === 0 && <p className="quiet-italic small">Nothing on the side.</p>}
          </section>
        )}
      </div>
    );
  }

  if (prefs.layout === 'gallery') {
    return (
      <div className={cx('coll is-gallery', className)} style={style}>
        {nothing && empty}
        {groups.map((g) => (
          <section key={g.key} className={cx('ggroup', over === 'main' && 'is-over')} {...dropZone('main')}>
            <h4 className="ghead">
              {g.label} <span>· {g.size}</span>
            </h4>
            <div className="gcards">{g.entries.map((e) => card(e.name, e.count, 'main', 'is-gal'))}</div>
          </section>
        ))}
        {side && (
          <section className={cx('ggroup is-side', over === 'side' && 'is-over')} {...dropZone('side')}>
            <h4 className="ghead is-gold">
              {sideLabel} <span>· {side.length}</span>
            </h4>
            <div className="gcards">
              {sideEntries.map((e) => card(e.name, e.count, 'side', 'is-gal'))}
              {side.length === 0 && <span className="sdrop">Drop cards here</span>}
            </div>
          </section>
        )}
      </div>
    );
  }

  return (
    <div className={cx('coll is-stacks', className)} style={style}>
      {nothing && empty}
      {!nothing && (
        <div className="scols">
          <div className={cx('szone', over === 'main' && 'is-over')} {...dropZone('main')}>
            {groups.map((g) => (
              <div key={g.key} className="scol">
                <h4 className="shead">
                  {g.label} <span>{g.size}</span>
                </h4>
                <div className="sstack">{g.entries.map((e) => card(e.name, e.count, 'main', 'is-stack'))}</div>
              </div>
            ))}
          </div>
          {side && (
            <div className={cx('scol is-side', over === 'side' && 'is-over')} {...dropZone('side')}>
              <h4 className="shead is-gold">
                {sideLabel} <span>{side.length || ''}</span>
              </h4>
              <div className="sstack">
                {sideEntries.map((e) => card(e.name, e.count, 'side', 'is-stack'))}
                {side.length === 0 && <span className="sdrop" />}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

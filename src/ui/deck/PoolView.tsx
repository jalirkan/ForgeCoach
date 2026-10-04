/*
 * ForgeCoach — ui/deck/PoolView.tsx
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Entering a pool: the whole cube as cards, tap to take (or untake), search,
 * colour filters, the opponent's picks on a second switch, paste, and add
 * from photo (PhotoSheet).
 */
import { useMemo, useState } from 'react';
import type { CubeContext } from '../../cube/score.ts';
import type { SavedPool } from '../../cube/pools.ts';
import { parsePaste } from '../../cube/pools.ts';
import { pickValue, poolColours, poolProfile } from '../../cube/pick.ts';
import { colourLabel } from '../../cube/colors.ts';
import { Sheet } from '../Sheet.tsx';
import { PipRow } from '../Mana.tsx';
import { IconCamera, IconFile, IconX } from '../Icons.tsx';
import { cx } from '../util.ts';
import { CubeCard } from './CubeCard.tsx';
import { PhotoSheet } from './PhotoSheet.tsx';

type Filter = 'all' | 'W' | 'U' | 'B' | 'R' | 'G' | 'M' | 'C' | 'L' | 'mine' | 'opp';
const FILTERS: Array<[Filter, string]> = [
  ['all', 'All'],
  ['mine', 'My pool'],
  ['W', 'W'],
  ['U', 'U'],
  ['B', 'B'],
  ['R', 'R'],
  ['G', 'G'],
  ['M', 'Gold'],
  ['C', 'Colorless'],
  ['L', 'Lands'],
  ['opp', 'Theirs'],
];

const norm = (s: string) => s.toLowerCase().replace(/[’']/g, "'");

export function PoolView({ ctx, pool, onChange, onInfo }: { ctx: CubeContext; pool: SavedPool; onChange: (p: SavedPool) => void; onInfo: (name: string) => void }) {
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [who, setWho] = useState<'mine' | 'opp'>('mine');
  const [sort, setSort] = useState<'list' | 'value'>('list');
  const [paste, setPaste] = useState(false);
  const [photo, setPhoto] = useState(false);
  const mine = useMemo(() => new Set(pool.cards), [pool.cards]);
  const opp = useMemo(() => new Set(pool.opp), [pool.opp]);
  const pair = useMemo(() => poolColours(pool.cards, ctx), [pool.cards, ctx]);
  const values = useMemo(() => {
    const prof = poolProfile(pool.cards, ctx);
    return new Map(ctx.cube.cards.map((c) => [c.name, pickValue(c.name, pool.cards, ctx, prof).total]));
  }, [pool.cards, ctx]);

  const shown = useMemo(() => {
    const nq = norm(q.trim());
    const list = ctx.cube.cards.filter((c) => {
      if (nq && !norm(c.name).includes(nq)) return false;
      const f = ctx.facts.get(c.name);
      const cols = f?.colors ?? c.colorHint;
      switch (filter) {
        case 'all':
          return true;
        case 'mine':
          return mine.has(c.name);
        case 'opp':
          return opp.has(c.name);
        case 'M':
          return cols.length >= 2;
        case 'C':
          return !c.land && cols.length === 0;
        case 'L':
          return c.land || !!f?.land;
        default:
          return cols.includes(filter) && !c.land;
      }
    });
    if (sort === 'value') {
      list.sort((a, b) => (values.get(b.name) ?? 0) - (values.get(a.name) ?? 0) || (a.name < b.name ? -1 : 1));
    }
    return list;
  }, [ctx, q, filter, mine, opp, sort, values]);

  const toggle = (name: string) => {
    if (mine.has(name)) onChange({ ...pool, cards: pool.cards.filter((n) => n !== name), updatedAt: Date.now() });
    else if (opp.has(name)) onChange({ ...pool, opp: pool.opp.filter((n) => n !== name), updatedAt: Date.now() });
    else if (who === 'mine') onChange({ ...pool, cards: [...pool.cards, name], updatedAt: Date.now() });
    else onChange({ ...pool, opp: [...pool.opp, name], updatedAt: Date.now() });
  };

  const value = (name: string) => Math.round(values.get(name) ?? 0);

  return (
    <div className="pv">
      <div className="pv-summary">
        <div className="pv-count">
          <b>{pool.cards.length}</b> <span className="muted">cards</span>
          {pair.length === 2 && (
            <span className="pv-pair">
              <PipRow colors={[...pair]} /> <span className="muted small">leaning {colourLabel(pair)}</span>
            </span>
          )}
          {pool.opp.length > 0 && <span className="muted small"> · {pool.opp.length} theirs</span>}
        </div>
        <div className="pv-actions">
          <div className="seg pv-who" role="tablist" aria-label="Tapping a card adds it to">
            <button className={cx(who === 'mine' && 'is-on')} onClick={() => setWho('mine')} aria-selected={who === 'mine'} role="tab">
              I took
            </button>
            <button className={cx(who === 'opp' && 'is-on')} onClick={() => setWho('opp')} aria-selected={who === 'opp'} role="tab">
              They took
            </button>
          </div>
          <button className="btn btn-quiet" onClick={() => setPhoto(true)}>
            <IconCamera size={14} /> Add from photo
          </button>
          <button className="btn btn-quiet" onClick={() => setPaste(true)}>
            <IconFile size={14} /> Paste list
          </button>
        </div>
      </div>

      <div className="pv-tools">
        <div className="pv-search">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${ctx.cube.cards.length} cards`} aria-label="Search the cube" />
          {q && (
            <button className="icon-btn" onClick={() => setQ('')} aria-label="Clear search">
              <IconX size={15} />
            </button>
          )}
        </div>
        <div className="seg pv-sort" aria-label="Sort">
          <button className={cx(sort === 'list' && 'is-on')} onClick={() => setSort('list')}>
            Cube order
          </button>
          <button className={cx(sort === 'value' && 'is-on')} onClick={() => setSort('value')}>
            Best for me
          </button>
        </div>
      </div>
      <div className="chips-row" role="tablist" aria-label="Filter">
        {FILTERS.map(([f, label]) => (
          <button key={f} className={cx('fchip', filter === f && 'is-on', /^[WUBRG]$/.test(f) && `fchip-${f}`)} onClick={() => setFilter(f)} role="tab" aria-selected={filter === f}>
            {/^[WUBRG]$/.test(f) ? <PipRow colors={[f]} /> : label}
            {f === 'mine' && <span className="fchip-n">{pool.cards.length}</span>}
            {f === 'opp' && pool.opp.length > 0 && <span className="fchip-n">{pool.opp.length}</span>}
          </button>
        ))}
      </div>

      <div className="cc-grid">
        {shown.map((c) => {
          const m = mine.has(c.name) ? 'mine' : opp.has(c.name) ? 'opp' : null;
          const v = m ? null : value(c.name);
          return (
            <CubeCard
              key={c.name}
              name={c.name}
              colors={ctx.facts.get(c.name)?.colors ?? c.colorHint}
              mark={m}
              chip={v}
              chipTone={v === null ? null : v >= 68 ? 'good' : v < 45 ? 'bad' : 'mid'}
              onClick={() => toggle(c.name)}
              onInfo={() => onInfo(c.name)}
              label={`${c.name}${m === 'mine' ? ', in your pool' : m === 'opp' ? ', taken by the opponent' : ''}`}
            />
          );
        })}
        {shown.length === 0 && <p className="muted pv-empty">{filter === 'mine' ? 'Your pool is empty — tap cards in “All” as you draft them, add them from a photo, or paste a list.' : 'Nothing matches.'}</p>}
      </div>
      <PasteSheet open={paste} onClose={() => setPaste(false)} ctx={ctx} pool={pool} onChange={onChange} />
      <PhotoSheet open={photo} onClose={() => setPhoto(false)} ctx={ctx} pool={pool} onChange={onChange} />
    </div>
  );
}

function PasteSheet({ open, onClose, ctx, pool, onChange }: { open: boolean; onClose: () => void; ctx: CubeContext; pool: SavedPool; onChange: (p: SavedPool) => void }) {
  const [text, setText] = useState('');
  const [target, setTarget] = useState<'mine' | 'opp'>('mine');
  const [mode, setMode] = useState<'add' | 'replace'>('add');
  const res = useMemo(() => parsePaste(text, ctx.cube.cards.map((c) => c.name)), [text, ctx]);
  const apply = () => {
    const key = target === 'mine' ? 'cards' : 'opp';
    const base = mode === 'replace' ? [] : pool[key];
    const have = new Set(base);
    const next = [...base, ...res.cards.filter((c) => !have.has(c))];
    onChange({ ...pool, [key]: next, updatedAt: Date.now() });
    setText('');
    onClose();
  };
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Paste a card list"
      subtitle="One card per line; counts, set codes and Forge .dck lines are fine."
      width={560}
      footer={
        <>
          <span className="muted small grow">
            {res.cards.length} cube card{res.cards.length === 1 ? '' : 's'}
            {res.unknown.length ? ` · ${res.unknown.length} not in this cube` : ''}
            {res.basics ? ` · ${res.basics} basics ignored` : ''}
          </span>
          <button className="btn btn-primary" disabled={res.cards.length === 0} onClick={apply}>
            {mode === 'replace' ? 'Replace' : 'Add'} {res.cards.length}
          </button>
        </>
      }
    >
      <div className="paste-opts">
        <div className="seg">
          <button className={cx(target === 'mine' && 'is-on')} onClick={() => setTarget('mine')}>
            My pool
          </button>
          <button className={cx(target === 'opp' && 'is-on')} onClick={() => setTarget('opp')}>
            Their picks
          </button>
        </div>
        <div className="seg">
          <button className={cx(mode === 'add' && 'is-on')} onClick={() => setMode('add')}>
            Add
          </button>
          <button className={cx(mode === 'replace' && 'is-on')} onClick={() => setMode('replace')}>
            Replace
          </button>
        </div>
      </div>
      <textarea className="paste-text" value={text} onChange={(e) => setText(e.target.value)} placeholder={'1 Skullclamp\n1 Young Pyromancer\nBlood Artist\n…'} rows={10} spellCheck={false} />
      {res.unknown.length > 0 && <p className="tiny muted">Not in this cube: {res.unknown.slice(0, 12).join(' · ')}{res.unknown.length > 12 ? '…' : ''}</p>}
    </Sheet>
  );
}

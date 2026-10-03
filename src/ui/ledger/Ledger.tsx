/*
 * ForgeCoach — ui/ledger/Ledger.tsx
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The frame and small parts the ledger pages share (Cube metagame, Your
 * record, Lab): the top bar with its nav, segmented controls, colour dots, the
 * win-rate interval strip and a hover tooltip.
 */
import './ledger.css';
import { useState, type ReactNode } from 'react';
import { stripGeometry } from '../../cube/metaView.ts';
import { cx } from '../util.ts';

export type LedgerPage = 'meta' | 'history' | 'lab';

export function LedgerShell({ page, children }: { page: LedgerPage; children: ReactNode }) {
  return (
    <div className="ledger">
      <header className="lg-top">
        <a className="lg-brand" href="#" aria-label="ForgeCoach home">
          <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M3 9h13l2-3h3v3l-3 2v2H8l-1 2h4v3H5v-3l1-2-3-1z" fill="currentColor" />
          </svg>
          <span className="lg-brand-word">ForgeCoach</span>
        </a>
        <nav className="lg-nav" aria-label="Pages">
          <a href="#">Play</a>
          <a href="#meta" aria-current={page === 'meta' ? 'page' : undefined}>
            Metagame
          </a>
          <a href="#history" aria-current={page === 'history' ? 'page' : undefined}>
            Your record
          </a>
          <a href="#lab" aria-current={page === 'lab' ? 'page' : undefined}>
            Lab
          </a>
        </nav>
      </header>
      <main className="lg-wrap">{children}</main>
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: Array<{ value: T; label: ReactNode; title?: string }>;
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div className="lg-seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={o.value === value} title={o.title} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Dots({ colors }: { colors: string }) {
  const list = colors ? [...colors] : ['C'];
  return (
    <span className="lg-dots" aria-label={colors ? `Colours ${colors}` : 'Colourless'}>
      {list.map((c) => (
        <span key={c} className={cx('lg-dot', `lg-dot-${c}`)} />
      ))}
    </span>
  );
}

/** A win rate on a 0–100 % track: a dot, whisker ticks for the interval, a faint 50 % tick. */
export function IntervalStrip({ win, ci, className }: { win: number | null; ci: [number, number] | null; className?: string }) {
  if (win === null) return <div className={cx('lg-strip', className)} aria-hidden="true" />;
  const g = stripGeometry(win, ci);
  return (
    <div
      className={cx('lg-strip', className)}
      role="img"
      aria-label={`Win ${(win * 100).toFixed(1)}%${ci ? `, 95% interval ${(ci[0] * 100).toFixed(0)}–${(ci[1] * 100).toFixed(0)}%` : ''}`}
    >
      <span className="lg-strip-mid" style={{ left: `${g.mid}%` }} />
      {g.lo !== null && g.hi !== null && <span className="lg-strip-ci" style={{ left: `${g.lo}%`, width: `${g.hi - g.lo}%` }} />}
      <span className="lg-strip-dot" style={{ left: `${g.dot}%` }} />
    </div>
  );
}

export interface TipState {
  x: number;
  y: number;
  body: ReactNode;
}

/** A pointer-following tooltip: `show(e, body)` on enter/move, `hide()` on leave. */
export function useTip() {
  const [tip, setTip] = useState<TipState | null>(null);
  const show = (e: { clientX: number; clientY: number }, body: ReactNode) => setTip({ x: e.clientX, y: e.clientY, body });
  const hide = () => setTip(null);
  const node = tip ? (
    <div
      className="lg-tip"
      style={{
        left: Math.min(tip.x + 14, (typeof window !== 'undefined' ? window.innerWidth : 1e4) - 200),
        top: tip.y + 16,
      }}
      role="tooltip"
    >
      {tip.body}
    </div>
  ) : null;
  return { show, hide, node };
}

export function SearchIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

/** A sortable table header cell. */
export function SortTh<K extends string>({
  k,
  sort,
  desc,
  onSort,
  children,
  num,
  title,
  className,
}: {
  k: K;
  sort: K;
  desc: boolean;
  onSort: (k: K) => void;
  children: ReactNode;
  num?: boolean;
  title?: string;
  className?: string;
}) {
  return (
    <th className={cx(num && 'num', className) || undefined} aria-sort={sort === k ? (desc ? 'descending' : 'ascending') : undefined} title={title}>
      <button type="button" onClick={() => onSort(k)}>
        {children}
      </button>
    </th>
  );
}

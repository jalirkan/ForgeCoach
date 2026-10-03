/*
 * ForgeCoach — ui/draft/Pool.tsx
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Pools as panels and sheets, on the shared Collection: the "MY POOL n / 45"
 * panel under the pick screen (with a SIDE column you can drag to), the full
 * pool as a modal after the board game's graveyard viewer, the mini curve and
 * the colour dots used in headers and stat bars.
 */
import type { CSSProperties, ReactNode } from 'react';
import { colourCounts, curveOf, typeSummary, type MetaOf } from '../../draft/poolView.ts';
import { Sheet } from '../Sheet.tsx';
import { cx } from '../util.ts';
import { Collection, usePrefs, ViewBar, type Zone } from './Collection.tsx';

const DOT: Record<string, string> = { W: '#f3e6c0', U: '#3d8fe0', B: '#2a2433', R: '#e2453a', G: '#3ea85a' };

/** Colour dots with counts: ● 9 ● 11 ● 7 … */
export function ColourDots({ names, meta, className }: { names: string[]; meta: MetaOf; className?: string }) {
  const c = colourCounts(names, meta);
  return (
    <span className={cx('cdots', className)}>
      {(['W', 'U', 'B', 'R', 'G'] as const).map((k) => (
        <span key={k} className={cx('cdot', !c[k] && 'is-zero')} title={`${c[k]} ${k}`}>
          <i style={{ background: DOT[k] } as CSSProperties} />
          {c[k]}
        </span>
      ))}
    </span>
  );
}

/** A tiny inline curve: gold counts over mana values 0–6+. */
export function MiniCurve({ names, meta }: { names: string[]; meta: MetaOf }) {
  const curve = curveOf(names, meta);
  const max = Math.max(3, ...curve);
  return (
    <span className="mcurve" aria-label={`Curve: ${curve.join(', ')}`}>
      {curve.map((n, i) => (
        <span key={i} className="mcurve-col">
          <b>{n || ''}</b>
          <span className="mcurve-bar" style={{ height: `${Math.max(1, (n / max) * 16)}px` }} />
          <span className="mcurve-l">{i === 6 ? '6+' : i}</span>
        </span>
      ))}
    </span>
  );
}

/** The pool panel under the pick screen. */
export function PoolPanel({
  names,
  side,
  meta,
  of,
  onMove,
  onInfo,
  title = 'My pool',
  right,
}: {
  names: string[];
  side: string[];
  meta: MetaOf;
  of: number;
  onMove: (name: string, to: Zone) => void;
  onInfo: (n: string) => void;
  title?: string;
  right?: ReactNode;
}) {
  const [prefs, setPrefs] = usePrefs('draft-pool', { layout: 'stacks', group: 'cmc', size: 104 });
  const total = names.length + side.length;
  return (
    <section className="ppool">
      <header className="ppool-h">
        <h2 className="fx-label ppool-t">
          {title} <span className="mono-n">{total}</span>
          <span className="mono-of"> / {of}</span>
        </h2>
        {total > 0 && (
          <span className="ppool-sum">
            {typeSummary([...names, ...side], meta)} <ColourDots names={[...names, ...side]} meta={meta} />
          </span>
        )}
        {right}
      </header>
      <ViewBar prefs={prefs} onChange={setPrefs} />
      <Collection
        names={names}
        side={side}
        meta={meta}
        prefs={prefs}
        onInfo={onInfo}
        onMove={onMove}
        empty={<p className="quiet-italic center">Your picks will pile up here.</p>}
      />
    </section>
  );
}

/** A pool as a modal: serif title, count, type line, the layout bar, large images, a full-width Close. */
export function PoolSheet({
  open,
  onClose,
  names,
  meta,
  title,
  onInfo,
  hiddenCount = 0,
  prefsKey = 'pool-sheet',
}: {
  open: boolean;
  onClose: () => void;
  names: string[];
  meta: MetaOf;
  title: string;
  onInfo: (n: string) => void;
  /** Cards the player has not seen (the AI's hidden picks): counted, never named. */
  hiddenCount?: number;
  prefsKey?: string;
}) {
  const [prefs, setPrefs] = usePrefs(prefsKey, { layout: 'gallery', group: 'cmc', size: 150 });
  const total = names.length + hiddenCount;
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
      subtitle={[names.length ? typeSummary(names, meta) : '', hiddenCount ? `${hiddenCount} you haven’t seen` : ''].filter(Boolean).join(' · ') || undefined}
      footer={
        <button className="btn-wide" onClick={onClose}>
          Close
        </button>
      }
    >
      <ViewBar prefs={prefs} onChange={setPrefs} compact />
      <Collection names={names} meta={meta} prefs={prefs} onInfo={onInfo} empty={<p className="quiet-italic center">Nothing here yet.</p>} />
    </Sheet>
  );
}

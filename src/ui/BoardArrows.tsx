/*
 * ForgeCoach — ui/BoardArrows.tsx
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The stack's lines (endstep-style): from each item in the stack panel to its
 * source on the battlefield and to each target, with the item's number at
 * the far end. One SVG fixed over the viewport (the panel and the cards live
 * in different scroll containers), measured from the DOM: `[data-stack-item]`
 * rows, `.tile[data-card-id]` tiles, `[data-phead-player]` life totals.
 * A stack item's end is its number badge (`.stackp-num`) wherever the fan
 * put it — measured, never assumed: a badge scrolled out of the panel's list,
 * or covered by something drawn over it, is no anchor, and the item's lines
 * start at its source card instead (arrows.ts `buildStackArrows`).
 * Geometry: arrows.ts (ported from mtg-table). Decoration only — every fact
 * is also text in the panel — so it is aria-hidden and takes no clicks.
 */
import { useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { buildStackArrows, centreWithin, type ArrowSpec, type RectBox, type RectKey } from './arrows.ts';
import type { StackEntry } from './stackModel.ts';

function rectOf(el: Element | null): RectBox | undefined {
  if (!el) return undefined;
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return undefined;
  // Off screen (a row scrolled away): no line rather than one to nowhere.
  if (r.bottom < 0 || r.right < 0 || r.top > window.innerHeight || r.left > window.innerWidth) return undefined;
  return { x: r.left, y: r.top, width: r.width, height: r.height };
}

/** A stack item's badge, if it can be seen: inside its list's scrolled box and not under another item of the panel. */
function badgeRect(id: string): RectBox | undefined {
  const row = document.querySelector(`[data-stack-item="${id}"]`);
  const badge = row?.querySelector('.stackp-num') ?? row ?? null;
  const box = rectOf(badge);
  if (!box || !row) return box;
  const list = row.closest('.stackp-list');
  const clip = rectOf(list);
  if (list && (!clip || !centreWithin(box, clip))) return undefined;
  if (typeof document.elementFromPoint === 'function') {
    const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
    // Covered by another item of the fan: no anchor. (The lines' own SVG takes
    // no pointer events, so it is never the hit; something outside the panel —
    // a dialog, a card preview — passes over and is not the fan's fault.)
    if (hit && !row.contains(hit) && row.closest('[data-stack-panel]')?.contains(hit)) return undefined;
  }
  return box;
}

export function domLookup(key: RectKey): RectBox | undefined {
  const id = key.slice(2);
  switch (key[0]) {
    case 's':
      return badgeRect(id);
    case 'c':
      return rectOf(document.querySelector(`.board .tile[data-card-id="${id}"] .tile-slot`) ?? document.querySelector(`.board [data-card-ids~="${id}"] .tile-slot`));
    case 'p':
      return rectOf(document.querySelector(`.board [data-phead-player="${id}"] .life`) ?? document.querySelector(`.board [data-phead-player="${id}"]`));
  }
  return undefined;
}

export function BoardArrows({ entries, version }: { entries: StackEntry[]; version: unknown }) {
  const [arrows, setArrows] = useState<ArrowSpec[]>([]);
  const sig = entries.map((e) => `${e.item.id}:${e.n}:${e.item.targetCardIds.join(',')}:${e.item.targetPlayerIds.join(',')}`).join('|');
  useLayoutEffect(() => {
    if (entries.length === 0) {
      setArrows((a) => (a.length ? [] : a));
      return;
    }
    let frame = 0;
    const measure = () => {
      frame = 0;
      setArrows(buildStackArrows(entries, domLookup));
    };
    const later = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    measure();
    window.addEventListener('resize', later);
    window.addEventListener('scroll', later, true);
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(later) : null;
    const board = document.querySelector('.board');
    if (board) ro?.observe(board);
    const panel = document.querySelector('[data-stack-panel]');
    if (panel) ro?.observe(panel);
    // The fan's items move as the pile changes; measure again once they settle.
    panel?.addEventListener('transitionend', later);
    // Card images and the panel's art arrive after the first layout.
    const settle = [window.setTimeout(later, 120), window.setTimeout(later, 600)];
    return () => {
      window.removeEventListener('resize', later);
      window.removeEventListener('scroll', later, true);
      ro?.disconnect();
      panel?.removeEventListener('transitionend', later);
      settle.forEach((t) => window.clearTimeout(t));
      if (frame) cancelAnimationFrame(frame);
    };
    // `sig` stands for `entries`; `version` for the tiles having moved.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, version]);
  if (arrows.length === 0 || typeof document === 'undefined') return null;
  return createPortal(<ArrowPaths arrows={arrows} />, document.body);
}

/** The drawing half, taking the specs (tested without a DOM). */
export function ArrowPaths({ arrows }: { arrows: ArrowSpec[] }) {
  return (
    <svg className="stack-arrows" aria-hidden="true" focusable="false" data-arrows={arrows.length}>
      {arrows.map((a) => (
        <g key={a.key} className={`stack-arrow is-${a.cls} ${a.mine ? 'is-mine' : 'is-theirs'}${a.n === 1 ? ' is-next' : ''}`} data-arrow={a.key}>
          <title>{a.title}</title>
          <path className="stack-arrow-under" d={a.path} />
          <path className="stack-arrow-line" d={a.path} />
          <polygon className="stack-arrow-head" points={a.head} />
          {a.to.startsWith('p:') && (
            <g className="stack-arrow-badge" transform={`translate(${a.end.x} ${a.end.y})`}>
              <circle r={9} />
              <text dy="0.35em" textAnchor="middle">
                {a.n}
              </text>
            </g>
          )}
        </g>
      ))}
    </svg>
  );
}

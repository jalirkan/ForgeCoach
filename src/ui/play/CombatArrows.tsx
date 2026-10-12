/*
 * ForgeCoach — ui/play/CombatArrows.tsx
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Combat's lines over the board (`combatLayout.ts` lists them): a curved
 * blue line from each attacker to each creature blocking it — badge to badge
 * (the pair's number, `combatLines.ts`), so a double block is two lines into
 * one attacker's badge — and a thin gold line from an attack to the
 * planeswalker it attacks. This component only finds the cards on screen and
 * draws between them. It sits inside `.board`, so it scrolls with it.
 *
 * Each path carries `data-line-from` / `data-line-to` (card ids, or `lane`)
 * for the e2e and the playtest's checks.
 */
import { useLayoutEffect, useRef, useState } from 'react';
import { arcBetween, curveBetween, lanes, type Box, type Curve, type Pt } from './combatLines.ts';
import type { CombatLine } from './combatLayout.ts';

interface Drawn {
  key: string;
  line: CombatLine;
  curve: Curve;
}

/** The centre of a card's pair badge (its number), else null. */
function badgeOf(host: Element, id: number, hr: DOMRect): { at: Pt; r: number } | null {
  const el = host.querySelector(`.tile[data-card-id="${id}"] .tile-pair`);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return null;
  return { at: { x: r.left - hr.left + r.width / 2, y: r.top - hr.top + r.height / 2 }, r: r.width / 2 };
}

/**
 * A point of a card that its row or lane has scrolled out of view (both scroll sideways once full,
 * lane.css / cards.css) is met at that row's visible edge — where its "+N ›" chip or fade is — and
 * not out in the hidden part. Null when the point is in view.
 */
function atRowEdge(host: Element, id: number, p: Pt, hr: DOMRect): Pt | null {
  const row = host.querySelector(`.tile[data-card-id="${id}"]`)?.closest('.lane-cols, .bf-cards');
  if (!row || row.scrollWidth <= row.clientWidth + 1) return null;
  const r = row.getBoundingClientRect();
  const lo = r.left - hr.left + 6;
  const hi = r.right - hr.left - 6;
  if (lo >= hi || (p.x >= lo && p.x <= hi)) return null;
  return { x: Math.min(hi, Math.max(lo, p.x)), y: p.y };
}

function boxOf(el: Element | null, host: DOMRect): Box | null {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return null;
  return { x: r.left - host.left, y: r.top - host.top, w: r.width, h: r.height };
}

export function CombatArrows({ lines, version }: { lines: readonly CombatLine[]; version: unknown }) {
  const ref = useRef<SVGSVGElement>(null);
  const [drawn, setDrawn] = useState<{ w: number; h: number; lines: Drawn[] }>({ w: 0, h: 0, lines: [] });
  const sig = JSON.stringify(lines);

  useLayoutEffect(() => {
    const svg = ref.current;
    const host = svg?.parentElement;
    if (!svg || !host) return;
    if (lines.length === 0) {
      setDrawn((d) => (d.lines.length ? { w: 0, h: 0, lines: [] } : d));
      return;
    }
    let frame = 0;
    const measure = () => {
      frame = 0;
      const hr = host.getBoundingClientRect();
      const tile = (id: number) => host.querySelector(`.tile[data-card-id="${id}"] .tile-slot`) ?? host.querySelector(`[data-card-id="${id}"]`);
      const fan = lanes(lines);
      const out: Drawn[] = [];
      lines.forEach((line, i) => {
        const from = 'card' in line.from ? `c${line.from.card}` : `l${line.from.lane}`;
        const key = `${line.kind}-${from}-${line.to.card}`;
        if (line.kind === 'block' && 'card' in line.from) {
          // Badge to badge; a card whose badge is not drawn (yet) is met at its top-centre.
          const at = (id: number): { at: Pt; r: number } | null => {
            const box = boxOf(tile(id), hr);
            const b = badgeOf(host, id, hr) ?? (box ? { at: { x: box.x + box.w / 2, y: box.y + 6 }, r: 0 } : null);
            if (!b) return null;
            const edge = atRowEdge(host, id, b.at, hr);
            return edge ? { at: edge, r: 0 } : b;
          };
          const a = at(line.from.card);
          const b = at(line.to.card);
          if (!a || !b) return;
          out.push({ key, line, curve: arcBetween(a.at, b.at, 0, Math.max(a.r, b.r)) });
          return;
        }
        const a = boxOf('card' in line.from ? tile(line.from.card) : host.querySelector(`[data-lane-label="${line.from.lane}"]`), hr);
        const b = boxOf(tile(line.to.card), hr);
        if (!a || !b) return;
        out.push({ key, line, curve: curveBetween(a, b, fan[i], 6) });
      });
      setDrawn({ w: host.scrollWidth, h: host.scrollHeight, lines: out });
    };
    const later = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    measure();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(later) : null;
    ro?.observe(host);
    window.addEventListener('resize', later);
    // Rows that scroll sideways move their tiles without resizing anything.
    host.addEventListener('scroll', later, true);
    // Card images arrive after the first layout; a card sliding into the lane settles after it.
    const settle = window.setTimeout(later, 400);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', later);
      host.removeEventListener('scroll', later, true);
      window.clearTimeout(settle);
      if (frame) cancelAnimationFrame(frame);
    };
    // `sig` stands for `lines`; `version` (the state) for the tiles having moved.
  }, [sig, version]);

  return (
    <svg ref={ref} className="combat-arrows" width={drawn.w || undefined} height={drawn.h || undefined} aria-hidden="true">
      {drawn.lines.map(({ key, line, curve }) => (
        <path
          key={key}
          className={`combat-line is-${line.kind}${line.pending ? ' is-pending' : ''}`}
          d={curve.d}
          data-line-from={'card' in line.from ? line.from.card : 'lane'}
          data-line-to={line.to.card}
        />
      ))}
    </svg>
  );
}

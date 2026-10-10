/*
 * ForgeCoach — ui/play/CombatArrows.tsx
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Combat's few lines over the board. Combat is drawn by placement — the
 * attack lane and each blocker in front of its attacker (`CombatLane.tsx`) —
 * so a line exists only where position cannot say it (`combatLayout.ts`): a
 * blocker that also blocks a second attacker, and an attack on a planeswalker,
 * which sits in its own row. Thin, in the board's gold, no arrowheads. This
 * component only finds the cards on screen and draws between them. It sits
 * inside `.board`, so it scrolls with it.
 */
import { useLayoutEffect, useRef, useState } from 'react';
import { curveBetween, lanes, type Box, type Curve } from './combatLines.ts';
import type { CombatLine } from './combatLayout.ts';

interface Drawn {
  key: string;
  line: CombatLine;
  curve: Curve;
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
        const a = boxOf('card' in line.from ? tile(line.from.card) : host.querySelector(`[data-lane-label="${line.from.lane}"]`), hr);
        const b = boxOf(tile(line.to.card), hr);
        if (!a || !b) return;
        const from = 'card' in line.from ? `c${line.from.card}` : `l${line.from.lane}`;
        out.push({ key: `${line.kind}-${from}-${line.to.card}`, line, curve: curveBetween(a, b, fan[i], 6) });
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
        <path key={key} className={`combat-line is-${line.kind}${line.pending ? ' is-pending' : ''}`} d={curve.d} />
      ))}
    </svg>
  );
}

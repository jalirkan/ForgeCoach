/*
 * ForgeCoach — ui/play/CombatArrows.tsx
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The combat lines over the board (endstep-style): blue curves from each
 * blocker to its attacker (the pair's number is on both cards, CardTile), red curves from
 * an unblocked attacker to the player or planeswalker it attacks. Which lines
 * exist is `combatLines.ts` (the wire's combat bands, plus the blocks this
 * browser has clicked); this component only finds the tiles on screen and
 * draws between them. It sits inside `.board`, so it scrolls with it.
 */
import { useLayoutEffect, useRef, useState } from 'react';
import { curveBetween, lanes, type Box, type CombatLink, type Curve } from './combatLines.ts';

interface Drawn {
  key: string;
  link: CombatLink;
  curve: Curve;
}

function boxOf(el: Element | null, host: DOMRect): Box | null {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return null;
  return { x: r.left - host.left, y: r.top - host.top, w: r.width, h: r.height };
}

export function CombatArrows({ links, version }: { links: CombatLink[]; version: unknown }) {
  const ref = useRef<SVGSVGElement>(null);
  const [drawn, setDrawn] = useState<{ w: number; h: number; lines: Drawn[] }>({ w: 0, h: 0, lines: [] });
  const sig = JSON.stringify(links);

  useLayoutEffect(() => {
    const svg = ref.current;
    const host = svg?.parentElement;
    if (!svg || !host) return;
    if (links.length === 0) {
      setDrawn((d) => (d.lines.length ? { w: 0, h: 0, lines: [] } : d));
      return;
    }
    let frame = 0;
    const measure = () => {
      frame = 0;
      const hr = host.getBoundingClientRect();
      const tile = (id: number) => host.querySelector(`.tile[data-card-id="${id}"] .tile-slot`) ?? host.querySelector(`[data-card-id="${id}"]`);
      const ln = lanes(links);
      // Phones: the life total is a one-line bar under the cards; stop just above it so the
      // arrowheads do not cover the number. The desktop rail keeps the line meeting the total.
      const lifeInset = host.closest('.play-phone-main') ? -5 : 10;
      const lines: Drawn[] = [];
      links.forEach((link, i) => {
        const a = boxOf(tile(link.from.card), hr);
        const b =
          'card' in link.to
            ? boxOf(tile(link.to.card), hr)
            : boxOf(host.querySelector(`[data-phead-player="${link.to.player}"] .life`) ?? host.querySelector(`[data-phead-player="${link.to.player}"]`), hr);
        if (!a || !b) return;
        lines.push({ key: `${link.kind}-${link.from.card}-${'card' in link.to ? `c${link.to.card}` : `p${link.to.player}`}`, link, curve: curveBetween(a, b, ln[i], 'card' in link.to ? 10 : lifeInset) });
      });
      setDrawn({ w: host.scrollWidth, h: host.scrollHeight, lines });
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
    // Card images arrive after the first layout.
    const settle = window.setTimeout(later, 400);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', later);
      host.removeEventListener('scroll', later, true);
      window.clearTimeout(settle);
      if (frame) cancelAnimationFrame(frame);
    };
    // `sig` stands for `links`; `version` (the state) for the tiles having moved.
  }, [sig, version]);

  return (
    <svg ref={ref} className="combat-arrows" width={drawn.w || undefined} height={drawn.h || undefined} aria-hidden="true">
      <defs>
        <marker id="combat-arrowhead" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--atk-line)" />
        </marker>
      </defs>
      {drawn.lines.map(({ key, link, curve }) => (
        <g key={key} className={`combat-line is-${link.kind}${link.pending ? ' is-pending' : ''}`}>
          <path className="combat-line-glow" d={curve.d} />
          <path className="combat-line-path" d={curve.d} markerEnd={link.kind === 'attack' ? 'url(#combat-arrowhead)' : undefined} />
          {/* The pair's number sits on the cards themselves (CardTile, combatMarks). */}
          {link.kind === 'attack' && <circle className="combat-line-dot" cx={curve.start.x} cy={curve.start.y} r={4} />}
        </g>
      ))}
    </svg>
  );
}

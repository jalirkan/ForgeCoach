/*
 * ForgeCoach — ui/play/CombatArrows.tsx
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Combat's lines over the board (`combatLayout.ts` lists them): a curved
 * blue line from each attacker to each creature blocking it — badge to badge
 * (the pair's number, `combatLines.ts`), so a double block is two lines into
 * one attacker's badge — and a red arrow from each attacker, in its row, to
 * what it attacks: the defending player's portrait or the planeswalker. This
 * component only finds the cards and portraits on screen and draws between
 * them. It sits inside `.board`, so it scrolls with it.
 *
 * Each path carries `data-line-from` (a card id) and `data-line-to` (a card
 * id, or `player<id>`) for the e2e and the playtest's checks.
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
 * A point of a card that its row has scrolled out of view (a full row scrolls sideways, cards.css) is
 * met at that row's visible edge — where its fade is — and not out in the hidden part. Null when the
 * point is in view.
 */
function atRowEdge(host: Element, id: number, p: Pt, hr: DOMRect): Pt | null {
  const row = host.querySelector(`.tile[data-card-id="${id}"]`)?.closest('.bf-cards');
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
      const toKey = (t: CombatLine['to']) => ('card' in t ? `${t.card}` : `player${t.player}`);
      lines.forEach((line, i) => {
        const key = `${line.kind}-${line.from.card}-${toKey(line.to)}`;
        if (line.kind === 'block' && 'card' in line.to) {
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
        // An attack: from the attacker's tile (met at its row's edge when scrolled away) to the portrait or planeswalker.
        const a = boxOf(tile(line.from.card), hr);
        const b = boxOf('card' in line.to ? tile(line.to.card) : host.querySelector(`[data-player-id="${line.to.player}"]`), hr);
        if (!a || !b) return;
        const edge = atRowEdge(host, line.from.card, { x: a.x + a.w / 2, y: a.y + a.h / 2 }, hr);
        out.push({ key, line, curve: curveBetween(edge ? { x: edge.x - 1, y: a.y, w: 2, h: a.h } : a, b, fan[i], 6) });
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
    // Card images arrive after the first layout; a tapping card settles after it.
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
      <defs>
        <marker id="combat-arrowhead" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path className="combat-arrowhead" d="M 0 0 L 10 5 L 0 10 z" />
        </marker>
      </defs>
      {drawn.lines.map(({ key, line, curve }) => (
        <path
          key={key}
          className={`combat-line is-${line.kind}${line.pending ? ' is-pending' : ''}`}
          d={curve.d}
          markerEnd={line.kind === 'target' ? 'url(#combat-arrowhead)' : undefined}
          data-line-from={line.from.card}
          data-line-to={'card' in line.to ? line.to.card : `player${line.to.player}`}
        />
      ))}
    </svg>
  );
}

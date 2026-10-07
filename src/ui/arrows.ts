/*
 * ForgeCoach — ui/arrows.ts
 * Copyright (C) 2026 the mtg-table authors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The stack's lines over the board: from each stack item to its source card
 * and to everything it targets. Ported from mtg-table web/src/render/arrows.ts
 * (edgePoint, headPoints, arcBetween, buildArrows' stack half and its
 * namespaced keys): `s:` a stack item, `c:` a card, `p:` a player — a stack
 * item id and a card id collide (protocol §10.1), so nothing is ever looked
 * up by a bare number.
 *
 * Pure: entries and a rect lookup in, paths out. An endpoint that is not on
 * screen (a target in a zone the board does not draw, a panel that is
 * folded) is not an arrow — the fact stays as text in the stack panel.
 */
import type { StackEntry } from './stackModel.ts';

export type RectKey = `c:${number}` | `p:${number}` | `s:${number}`;
export const cardKey = (id: number): RectKey => `c:${id}`;
export const playerKey = (id: number): RectKey => `p:${id}`;
export const stackKey = (id: number): RectKey => `s:${id}`;

export interface RectBox {
  x: number;
  y: number;
  width: number;
  height: number;
}
interface Point {
  x: number;
  y: number;
}

export type ArrowClass = 'source' | 'target';

export interface ArrowSpec {
  key: string;
  cls: ArrowClass;
  /** The stack item's number (1 = resolves next). */
  n: number;
  /** The item belongs to the viewing seat. */
  mine: boolean;
  from: RectKey;
  to: RectKey;
  path: string;
  head: string;
  /** Where the number badge sits: the line's far end. */
  end: Point;
  title: string;
}

export function centre(box: RectBox): Point {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Where the ray from the box's centre toward `toward` leaves the box. */
export function edgePoint(box: RectBox, from: Point, toward: Point): Point {
  const dx = toward.x - from.x;
  const dy = toward.y - from.y;
  if (dx === 0 && dy === 0) return from;
  const hw = box.width / 2;
  const hh = box.height / 2;
  const sx = dx === 0 ? Number.POSITIVE_INFINITY : hw / Math.abs(dx);
  const sy = dy === 0 ? Number.POSITIVE_INFINITY : hh / Math.abs(dy);
  const s = Math.min(sx, sy);
  return { x: from.x + dx * s, y: from.y + dy * s };
}

const round = (n: number) => Math.round(n * 10) / 10;

export function headPoints(tip: Point, angle: number, size = 10): string {
  const back = angle + Math.PI;
  const spread = 0.42;
  const p1 = { x: tip.x + Math.cos(back - spread) * size, y: tip.y + Math.sin(back - spread) * size };
  const p2 = { x: tip.x + Math.cos(back + spread) * size, y: tip.y + Math.sin(back + spread) * size };
  return [tip, p1, p2].map((p) => `${round(p.x)},${round(p.y)}`).join(' ');
}

/** One gentle arc between two boxes, edge to edge; the bow is clamped so short and long lines both read. */
export function arcBetween(a: RectBox, b: RectBox, bowScale = 1): { path: string; head: string; end: Point } {
  const ac = centre(a);
  const bc = centre(b);
  const s = edgePoint(a, ac, bc);
  const e = edgePoint(b, bc, ac);
  const dx = e.x - s.x;
  const dy = e.y - s.y;
  const d = Math.hypot(dx, dy) || 1;
  const bow = Math.min(90, Math.max(24, d * 0.18)) * bowScale;
  const c = { x: (s.x + e.x) / 2 - (dy / d) * bow, y: (s.y + e.y) / 2 + (dx / d) * bow };
  const angle = Math.atan2(e.y - c.y, e.x - c.x);
  return {
    path: `M${round(s.x)} ${round(s.y)} Q${round(c.x)} ${round(c.y)} ${round(e.x)} ${round(e.y)}`,
    head: headPoints(e, angle),
    end: { x: round(e.x), y: round(e.y) },
  };
}

export type RectLookup = (key: RectKey) => RectBox | undefined;

/**
 * Every stack line this frame draws: item → source (an ability's host on the
 * battlefield) and item → each target. The item end is its row in the stack
 * panel, or — when the panel is folded or off screen — its source card.
 */
export function buildStackArrows(entries: StackEntry[], get: RectLookup): ArrowSpec[] {
  const out: ArrowSpec[] = [];
  const seen = new Set<string>();
  const push = (e: StackEntry, cls: ArrowClass, from: RectKey, to: RectKey, title: string, bow: number) => {
    if (from === to) return;
    const key = `${cls}:${from}>${to}`;
    if (seen.has(key)) return;
    const a = get(from);
    const b = get(to);
    if (!a || !b) return;
    seen.add(key);
    out.push({ key, cls, n: e.n, mine: e.mine, from, to, title, ...arcBetween(a, b, bow) });
  };
  for (const e of entries) {
    const src = e.item.sourceCardId;
    const row = stackKey(e.item.id);
    const anchor: RectKey | null = get(row) ? row : src !== null && e.sourceOnBoard && get(cardKey(src)) ? cardKey(src) : null;
    if (!anchor) continue;
    if (anchor === row && src !== null && e.sourceOnBoard) push(e, 'source', row, cardKey(src), `${e.n}: from ${e.name ?? 'its source'}`, 0.35);
    for (const t of e.targets) {
      push(e, 'target', anchor, t.kind === 'card' ? cardKey(t.id) : playerKey(t.id), `${e.n}: targets ${t.label}`, 0.8);
    }
  }
  return out;
}

/*
 * ForgeCoach — ui/play/combatLines.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The combat lines drawn over the board (endstep-style): a curve from each
 * blocker to the attacker it blocks, numbered at both ends, and a curve from
 * an unblocked attacker to what it attacks (a player or a planeswalker).
 *
 * Pure: which links exist (from `state.combat` — protocol §3.1 — plus the
 * blocks this browser has clicked but the engine has not yet confirmed) and
 * the geometry of one curve between two rectangles. No DOM.
 *
 * Only what the wire says: a link is drawn between ids the viewer can see on
 * the battlefield, or to a player. A band with a null defender gets no
 * defender line; a concealed id is skipped, never guessed at.
 */
import type { AnyCard, Card, GameStateBody } from '../../protocol.ts';
import { isHidden } from '../../protocol.ts';

export type LinkKind = 'block' | 'attack';

export interface CombatLink {
  kind: LinkKind;
  /** The blocker (block) or the attacker (attack). */
  from: { card: number };
  /** The attacker (block) or the defender (attack). */
  to: { card: number } | { player: number };
  /** Badge number: one per blocked attacker, in band order, 1-based. 0 for attack lines. */
  n: number;
  /** A block this browser clicked; the engine reports it only on confirm. */
  pending: boolean;
}

function visibleOnBattlefield(state: GameStateBody): Map<number, Card> {
  const m = new Map<number, Card>();
  for (const p of state.players)
    for (const c of p.zones.battlefield.cards as AnyCard[]) if (!isHidden(c)) m.set(c.id, c as Card);
  return m;
}

/**
 * The lines to draw now. `pending` maps a blocker id this browser clicked to
 * the attacker it was sent against (null when the prompt named none); the
 * engine's own bands win wherever they say anything about a blocker.
 */
export function combatLinks(state: GameStateBody | null, pending: ReadonlyMap<number, number | null> = new Map()): CombatLink[] {
  if (!state) return [];
  const seen = visibleOnBattlefield(state);
  const bands = state.combat?.bands ?? [];
  const out: CombatLink[] = [];
  const confirmed = new Set<number>();
  for (const b of bands) for (const id of b.blockerIds) confirmed.add(id);
  // Blocks by attacker, confirmed first, then this browser's picks.
  const blocks = new Map<number, { id: number; pending: boolean }[]>();
  for (const b of bands) {
    const atk = b.attackerIds.find((id) => seen.has(id));
    if (atk === undefined) continue;
    for (const id of b.blockerIds) if (seen.has(id) && id !== atk) push(blocks, atk, { id, pending: false });
  }
  for (const [blocker, atk] of pending) {
    if (atk === null || confirmed.has(blocker) || !seen.has(blocker) || !seen.has(atk)) continue;
    push(blocks, atk, { id: blocker, pending: true });
  }
  let n = 0;
  const attackerOrder = [...new Set([...bands.flatMap((b) => b.attackerIds), ...blocks.keys()])];
  for (const atk of attackerOrder) {
    const bl = blocks.get(atk);
    if (!bl || bl.length === 0) continue;
    n++;
    for (const b of bl) out.push({ kind: 'block', from: { card: b.id }, to: { card: atk }, n, pending: b.pending });
  }
  for (const b of bands) {
    if (!b.defender) continue;
    for (const atk of b.attackerIds) {
      if (!seen.has(atk) || blocks.get(atk)?.length) continue;
      if (b.defender.kind === 'card') {
        if (seen.has(b.defender.id)) out.push({ kind: 'attack', from: { card: atk }, to: { card: b.defender.id }, n: 0, pending: false });
      } else if (state.players.some((p) => p.id === b.defender!.id)) {
        out.push({ kind: 'attack', from: { card: atk }, to: { player: b.defender.id }, n: 0, pending: false });
      }
    }
  }
  return out;
}

function push<K, V>(m: Map<K, V[]>, k: K, v: V) {
  const l = m.get(k);
  if (l) l.push(v);
  else m.set(k, [v]);
}

// ---------------------------------------------------------------------------
// Geometry

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface Pt {
  x: number;
  y: number;
}

export interface Curve {
  /** SVG path data (a cubic Bézier). */
  d: string;
  start: Pt;
  end: Pt;
}

/**
 * A curve from box `a` to box `b`: leaving `a` from the edge that faces `b`
 * (top or bottom when they are stacked, which is the usual case — the two
 * sides of the table), bowing sideways a little so stacked lines separate.
 * `lane` (0, 1, 2…) fans out several lines that share an end.
 */
export function curveBetween(a: Box, b: Box, lane = 0): Curve {
  const ac = { x: a.x + a.w / 2, y: a.y + a.h / 2 };
  const bc = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  const vertical = Math.abs(bc.y - ac.y) >= Math.abs(bc.x - ac.x) * 0.5;
  const fan = lane === 0 ? 0 : (lane % 2 ? 1 : -1) * Math.ceil(lane / 2) * Math.min(14, a.w / 6);
  let start: Pt;
  let end: Pt;
  if (vertical) {
    const down = bc.y > ac.y;
    start = { x: ac.x + fan, y: down ? a.y + a.h : a.y };
    end = { x: bc.x + fan, y: down ? b.y : b.y + b.h };
    // Badges sit just inside the cards' edges.
    start = { x: start.x, y: start.y + (down ? -10 : 10) };
    end = { x: end.x, y: end.y + (down ? 10 : -10) };
  } else {
    const right = bc.x > ac.x;
    start = { x: right ? a.x + a.w - 10 : a.x + 10, y: ac.y + fan };
    end = { x: right ? b.x + 10 : b.x + b.w - 10, y: bc.y + fan };
  }
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const k = 0.42;
  // Controls along the main axis, nudged sideways for a gentle S-bow.
  const bow = Math.max(-60, Math.min(60, dx * 0.25)) + fan;
  const c1 = vertical ? { x: start.x + bow, y: start.y + dy * k } : { x: start.x + dx * k, y: start.y + bow };
  const c2 = vertical ? { x: end.x - bow * 0.4, y: end.y - dy * k } : { x: end.x - dx * k, y: end.y - bow * 0.4 };
  const r = (n: number) => Math.round(n * 10) / 10;
  return {
    d: `M ${r(start.x)} ${r(start.y)} C ${r(c1.x)} ${r(c1.y)}, ${r(c2.x)} ${r(c2.y)}, ${r(end.x)} ${r(end.y)}`,
    start: { x: r(start.x), y: r(start.y) },
    end: { x: r(end.x), y: r(end.y) },
  };
}

/** Lane numbers so lines sharing an attacker (or a defender) fan out instead of overlapping. */
export function lanes(links: CombatLink[]): number[] {
  const count = new Map<string, number>();
  return links.map((l) => {
    const key = 'card' in l.to ? `c${l.to.card}` : `p${l.to.player}`;
    const n = count.get(key) ?? 0;
    count.set(key, n + 1);
    return n;
  });
}

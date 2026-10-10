/*
 * ForgeCoach — ui/play/combatLines.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Combat's marks and the geometry of its few lines. The board draws combat
 * by placement (`combatLayout.ts`: the attack lane, blockers in front of
 * their attacker); here are the small numbered chips an attacker and its
 * blockers share, and the curve for a line where position cannot say it.
 *
 * Pure: the marks come from `state.combat` — protocol §3.1 — plus the blocks
 * and attacks declared but not yet confirmed (the engine's own M65
 * `selectable.chosen` when the frame carries it, else this browser's clicks).
 * Only ids the viewer can see on the battlefield are marked; a concealed id is
 * skipped, never guessed at. No DOM.
 */
import type { AnyCard, Card, ChosenAttack, GameStateBody } from '../../protocol.ts';
import { isHidden } from '../../protocol.ts';

function visibleOnBattlefield(state: GameStateBody): Map<number, Card> {
  const m = new Map<number, Card>();
  for (const p of state.players)
    for (const c of p.zones.battlefield.cards as AnyCard[]) if (!isHidden(c)) m.set(c.id, c as Card);
  return m;
}

/**
 * One number per attacker (endstep-style), in the engine's band order, then
 * any attacker only this browser's clicks know of: the attacker and every
 * creature blocking it wear the same number.
 */
function attackerNumbers(bands: readonly { attackerIds: number[] }[], extra: Iterable<number>, seen: Map<number, Card>): Map<number, number> {
  const m = new Map<number, number>();
  for (const id of [...bands.flatMap((b) => b.attackerIds), ...extra]) if (seen.has(id) && !m.has(id)) m.set(id, m.size + 1);
  return m;
}

export interface CombatMark {
  /** The pair's number: the attacker's, shared by its blockers. */
  n: number;
  role: 'attacker' | 'blocker';
  /** Only this browser's clicks say so (the engine reports a declaration on confirm). */
  pending: boolean;
  /** The attacker a block click goes to right now (Forge's "current attacker"). */
  current: boolean;
  /** What an attacker attacks: a player id or a planeswalker / battle id, when the wire says. */
  defender: { kind: 'player' | 'card'; id: number } | null;
  /** A blocker's attacker (null for an attacker). */
  attackerId: number | null;
}

/**
 * The numbered badges for combat: every attacker and its blockers share a
 * number. `pending` maps a blocker this browser clicked to its attacker;
 * `pendingAttackers` are attackers clicked but not confirmed; `current` is
 * the attacker the block prompt names; `pendingAttacks` (M65) says what a
 * not-yet-confirmed attacker attacks.
 */
export function combatMarks(
  state: GameStateBody | null,
  pending: ReadonlyMap<number, number | null> = new Map(),
  pendingAttackers: ReadonlySet<number> = new Set(),
  current: number | null = null,
  pendingAttacks: readonly ChosenAttack[] = [],
): Map<number, CombatMark> {
  const out = new Map<number, CombatMark>();
  if (!state) return out;
  const seen = visibleOnBattlefield(state);
  const bands = state.combat?.bands ?? [];
  const confirmedAtk = new Set(bands.flatMap((b) => b.attackerIds));
  const pendingBlk = [...pending].filter(([b, a]) => a !== null && seen.has(b) && seen.has(a)) as [number, number][];
  const numbers = attackerNumbers(bands, [...pendingAttackers, ...pendingBlk.map(([, a]) => a)], seen);
  const defenderOf = new Map<number, CombatMark['defender']>();
  for (const a of pendingAttacks) defenderOf.set(a.attackerId, { kind: a.defender.kind, id: a.defender.id });
  for (const b of bands) for (const a of b.attackerIds) defenderOf.set(a, b.defender ? { kind: b.defender.kind, id: b.defender.id } : null);
  for (const [id, n] of numbers) out.set(id, { n, role: 'attacker', pending: !confirmedAtk.has(id), current: id === current, defender: defenderOf.get(id) ?? null, attackerId: null });
  for (const b of bands)
    for (const blk of b.blockerIds) {
      const a = b.attackerIds.find((x) => numbers.has(x));
      if (a !== undefined && seen.has(blk) && !out.has(blk)) out.set(blk, { n: numbers.get(a)!, role: 'blocker', pending: false, current: false, defender: null, attackerId: a });
    }
  for (const [blk, a] of pendingBlk) if (!out.has(blk) && numbers.has(a)) out.set(blk, { n: numbers.get(a)!, role: 'blocker', pending: true, current: false, defender: null, attackerId: a });
  // The current attacker of a block prompt, even before anything blocks it.
  if (current !== null && seen.has(current) && !out.has(current)) out.set(current, { n: numbers.size + 1, role: 'attacker', pending: true, current: true, defender: null, attackerId: null });
  return out;
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
/** Where along a card's width a vertical line meets it. */
const ANCHOR = 0.625;

/**
 * `endInset`: how far inside `b`'s edge the line ends (a badge sits there);
 * negative stops short of it (a phone's line to a player's life total).
 */
export function curveBetween(a: Box, b: Box, lane = 0, endInset = 10): Curve {
  const ac = { x: a.x + a.w / 2, y: a.y + a.h / 2 };
  const bc = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  const vertical = Math.abs(bc.y - ac.y) >= Math.abs(bc.x - ac.x) * 0.5;
  // Stacked: meet the cards right of centre, clear of the P/T box (bottom left) and the name (top left).
  const ax = a.x + a.w * ANCHOR;
  const bx = b.x + b.w * ANCHOR;
  const fan = lane === 0 ? 0 : (lane % 2 ? 1 : -1) * Math.ceil(lane / 2) * Math.min(14, a.w / 6);
  let start: Pt;
  let end: Pt;
  if (vertical) {
    const down = bc.y > ac.y;
    start = { x: ax + fan, y: down ? a.y + a.h : a.y };
    end = { x: bx + fan, y: down ? b.y : b.y + b.h };
    // Badges sit just inside the cards' edges.
    start = { x: start.x, y: start.y + (down ? -10 : 10) };
    end = { x: end.x, y: end.y + (down ? endInset : -endInset) };
  } else {
    const right = bc.x > ac.x;
    start = { x: right ? a.x + a.w - 10 : a.x + 10, y: ac.y + fan };
    end = { x: right ? b.x + endInset : b.x + b.w - endInset, y: bc.y + fan };
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

/** Fan numbers so lines sharing an end fan out instead of overlapping. */
export function lanes(links: readonly { to: { card: number } }[]): number[] {
  const count = new Map<number, number>();
  return links.map((l) => {
    const n = count.get(l.to.card) ?? 0;
    count.set(l.to.card, n + 1);
    return n;
  });
}

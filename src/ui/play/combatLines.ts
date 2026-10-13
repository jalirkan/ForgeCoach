/*
 * ForgeCoach — ui/play/combatLines.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Combat's marks and the geometry of its lines (endstep-style, the combat
 * study §2 and §4): an attacker with blockers wears a numbered badge, every
 * creature blocking it wears the same number, and a curved line joins the
 * attacker to each of its blockers — on the board, between the real cards
 * (`combatLayout.ts` lists the lines; the attackers sit in the attack lane,
 * the blockers stay in their rows).
 *
 * Numbers go 1, 2, 3… over the attackers that have a blocker, in the engine's
 * attack order: an unblocked attacker has no pair, so no badge (it is in the
 * attack lane, which says "attacking" already), and the numbers never skip.
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

export interface CombatMark {
  /** The pair's number, shared by an attacker and its blockers; null for an attacker nothing blocks (no badge). */
  n: number | null;
  role: 'attacker' | 'blocker';
  /** Only the declaration under way says so (the engine reports a declaration in `combat` on confirm). */
  pending: boolean;
  /** What an attacker attacks: a player id or a planeswalker / battle id, when the wire says. */
  defender: { kind: 'player' | 'card'; id: number } | null;
  /** A blocker's attacker (null for an attacker). */
  attackerId: number | null;
}

/**
 * The marks for combat. `pending` maps a blocker chosen in the open
 * declaration to its attacker (null: the wire did not say which — such a
 * blocker gets no mark); `pendingAttackers` are attackers chosen but not
 * confirmed; `pendingAttacks` (M65) says what a not-yet-confirmed attacker
 * attacks.
 */
export function combatMarks(
  state: GameStateBody | null,
  pending: ReadonlyMap<number, number | null> = new Map(),
  pendingAttackers: ReadonlySet<number> = new Set(),
  pendingAttacks: readonly ChosenAttack[] = [],
): Map<number, CombatMark> {
  const out = new Map<number, CombatMark>();
  if (!state) return out;
  const seen = visibleOnBattlefield(state);
  const bands = state.combat?.bands ?? [];
  const confirmedAtk = new Set(bands.flatMap((b) => b.attackerIds));
  // Every attacker, in the engine's order, then any only the open declaration knows of.
  const order: number[] = [];
  for (const id of [...bands.flatMap((b) => b.attackerIds), ...pendingAttackers]) if (seen.has(id) && !order.includes(id)) order.push(id);
  // Blocker → attacker pairs: the engine's bands, then the declaration under way.
  const pairs: { blk: number; atk: number; pending: boolean }[] = [];
  for (const b of bands)
    for (const blk of b.blockerIds) {
      const a = b.attackerIds.find((x) => seen.has(x));
      // The bridge before M52 listed an unblocked attacker as blocking itself.
      if (a !== undefined && seen.has(blk) && blk !== a) pairs.push({ blk, atk: a, pending: false });
    }
  for (const [blk, a] of pending) if (a !== null && seen.has(blk) && seen.has(a) && order.includes(a)) pairs.push({ blk, atk: a, pending: true });
  const blocked = new Set(pairs.map((p) => p.atk));
  const numbers = new Map<number, number>();
  for (const id of order) if (blocked.has(id)) numbers.set(id, numbers.size + 1);
  const defenderOf = new Map<number, CombatMark['defender']>();
  for (const a of pendingAttacks) defenderOf.set(a.attackerId, { kind: a.defender.kind, id: a.defender.id });
  for (const b of bands) for (const a of b.attackerIds) defenderOf.set(a, b.defender ? { kind: b.defender.kind, id: b.defender.id } : null);
  for (const id of order) out.set(id, { n: numbers.get(id) ?? null, role: 'attacker', pending: !confirmedAtk.has(id), defender: defenderOf.get(id) ?? null, attackerId: null });
  // A creature blocking two attackers wears the first one's number (a line goes to each).
  for (const p of pairs) if (!out.has(p.blk)) out.set(p.blk, { n: numbers.get(p.atk)!, role: 'blocker', pending: p.pending, defender: null, attackerId: p.atk });
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

/**
 * A block line (the combat study's "curved blue line"): from the attacker's
 * badge `p` to the blocker's badge `q`, bowed to one side, stopping `inset`
 * short of each end so it meets each badge's rim, not its number. `lane`
 * (0, 1, 2…) bends lines that share their two ends apart.
 */
export function arcBetween(p: Pt, q: Pt, lane = 0, inset = 0): Curve {
  const dx = q.x - p.x;
  const dy = q.y - p.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const cut = Math.min(inset, len / 3);
  const start = { x: p.x + ux * cut, y: p.y + uy * cut };
  const end = { x: q.x - ux * cut, y: q.y - uy * cut };
  // The bow: a fifth of the length, at most 70 px, to the left of travel (a steady arc, not an S);
  // further lanes bow further.
  const bow = Math.min(70, len * 0.2) + lane * 16;
  const nx = -uy;
  const ny = ux;
  const c1 = { x: start.x + (end.x - start.x) * 0.3 + nx * bow, y: start.y + (end.y - start.y) * 0.3 + ny * bow };
  const c2 = { x: start.x + (end.x - start.x) * 0.7 + nx * bow, y: start.y + (end.y - start.y) * 0.7 + ny * bow };
  const r = (n: number) => Math.round(n * 10) / 10;
  return {
    d: `M ${r(start.x)} ${r(start.y)} C ${r(c1.x)} ${r(c1.y)}, ${r(c2.x)} ${r(c2.y)}, ${r(end.x)} ${r(end.y)}`,
    start: { x: r(start.x), y: r(start.y) },
    end: { x: r(end.x), y: r(end.y) },
  };
}

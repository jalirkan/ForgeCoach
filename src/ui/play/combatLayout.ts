/*
 * ForgeCoach — ui/play/combatLayout.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * How combat is drawn (the combat study, 2026-10-12, §1, §2, §4 and §6.1, and
 * Justin's play test, 2026-10-17): the board has no combat list and never
 * rearranges itself around an attack or a block. A declared attacker stays in
 * its own row — tapped, so lying down, with the red attacking outline — and a
 * line runs from it to what it attacks: the defending player's portrait or
 * the planeswalker. A creature blocking it stays in its own row too, and a
 * curved line joins the attacker to it (one line per blocker, so a double
 * block is two lines into one attacker); the pair's numbered badge is
 * `combatLines.ts`'s. (Until 2026-10-17 attackers were lifted into an attack
 * lane between the halves; it was redundant and ate the board's height.)
 *
 * When the attackers do not all attack the same thing, each wears a small
 * chip with its target's initial as well as its line.
 *
 * Pure: the redacted state, the board's combat marks (which fold in blocks
 * and attackers chosen but not yet confirmed — the engine's M65 `chosen`, or
 * this browser's clicks on an older engine) and a namer in; lines and chips
 * out. No rules: nothing here decides what may attack or block; a line is
 * drawn only where the wire (or the engine's own `chosen`) says. Only ids the
 * viewer can see on the battlefield are joined; a concealed id is skipped,
 * never guessed at, and no attacker's name is read here at all.
 */
import type { AnyCard, Card, EntityRef, GameStateBody } from '../../protocol.ts';
import { isHidden } from '../../protocol.ts';
import type { CardCombatMark } from '../cardContext.ts';

/** What an attacker attacks, as the board says it. */
export interface LaneTarget {
  kind: 'player' | 'card';
  id: number;
  /** "You", the opponent's name, or a planeswalker's short name ("Karn"). */
  label: string;
  /** One letter for the chip on a card. */
  initial: string;
}

/** A declared attacker, in the engine's order. */
export interface AttackerInfo {
  attackerId: number;
  controller: number;
  target: LaneTarget | null;
}

/** Where a combat line ends: a card on the battlefield, or a player's portrait. */
export type CombatLineEnd = { card: number } | { player: number };

/** A line on the board: an attacker to each of its blockers, or an attacker to what it attacks. */
export interface CombatLine {
  kind: 'block' | 'target';
  from: { card: number };
  to: CombatLineEnd;
  pending: boolean;
}

export interface CombatLayout {
  /** The attackers the engine lists, in its order (they stay in their rows). */
  attackers: AttackerInfo[];
  lines: CombatLine[];
  /** A target chip on an attacker's card: when the attackers' targets differ, and on one being declared at a planeswalker. */
  chips: ReadonlyMap<number, LaneTarget>;
}

export const EMPTY_LAYOUT: CombatLayout = { attackers: [], lines: [], chips: new Map() };

export interface LayoutNames {
  /** What the board calls a player ("You", the bot's name). */
  player(id: number): string;
  /** The letter on that player's portrait (the chip matches it). */
  avatar?(id: number): string;
}

function visibleOnBattlefield(state: GameStateBody): Map<number, Card> {
  const m = new Map<number, Card>();
  for (const p of state.players)
    for (const c of p.zones.battlefield.cards as AnyCard[]) if (!isHidden(c)) m.set(c.id, c as Card);
  return m;
}

/** Whose battlefield holds each card: the side the board draws it on. */
function sides(state: GameStateBody): Map<number, number> {
  const m = new Map<number, number>();
  for (const p of state.players) for (const c of p.zones.battlefield.cards) m.set(c.id, p.id);
  return m;
}

/** "Karn, Scion of Urza" → "Karn"; "Jace Beleren" stays whole. */
export function shortName(name: string): string {
  const head = name.split(',')[0]!.trim();
  return head || name.trim();
}

/** The lane's word for a defender, or null when the wire names nothing the viewer can see. */
export function targetOf(d: EntityRef | null | undefined, state: GameStateBody, seen: Map<number, Card>, names: LayoutNames): LaneTarget | null {
  if (!d) return null;
  if (d.kind === 'player') {
    if (!state.players.some((p) => p.id === d.id)) return null;
    const label = names.player(d.id);
    return { kind: 'player', id: d.id, label, initial: ((names.avatar?.(d.id) ?? label) || '?').charAt(0).toUpperCase() };
  }
  const c = seen.get(d.id);
  if (!c) return null;
  // A face-down card's name is "" on the wire: it is "a permanent", never its hidden face.
  const label = c.name ? shortName(c.name) : 'a permanent';
  return { kind: 'card', id: d.id, label, initial: c.name ? label.charAt(0).toUpperCase() : '?' };
}

const sameTarget = (a: LaneTarget | null, b: LaneTarget | null) => !!a && !!b && a.kind === b.kind && a.id === b.id;

/**
 * The combat layout for one state. `marks`: the board's combat marks
 * (`combatLines.ts` `combatMarks`), whose pending blockers carry the attacker
 * they were sent against and whose pending attackers carry their defender.
 */
export function combatLayout(
  state: GameStateBody | null,
  names: LayoutNames,
  marks: ReadonlyMap<number, CardCombatMark> = new Map(),
): CombatLayout {
  if (!state) return EMPTY_LAYOUT;
  const seen = visibleOnBattlefield(state);
  const sideOf = sides(state);
  const bands = state.combat?.bands ?? [];
  const attackers: AttackerInfo[] = [];
  const lines: CombatLine[] = [];
  const chips = new Map<number, LaneTarget>();
  // Attackers, in the engine's order.
  const bandOf = new Map<number, (typeof bands)[number]>();
  for (const b of bands)
    for (const id of b.attackerIds) {
      if (!seen.has(id) || bandOf.has(id)) continue;
      bandOf.set(id, b);
      attackers.push({ attackerId: id, controller: sideOf.get(id)!, target: targetOf(b.defender, state, seen, names) });
    }
  const attacking = new Set(attackers.map((c) => c.attackerId));
  // Blocks: a line from the attacker to each blocker — the engine's bands, then the declaration
  // under way (a blocker of two attackers gets a line to each). Both stay in their rows.
  const drawn = new Set<string>();
  const block = (blocker: number, attacker: number, pending: boolean) => {
    const key = `${attacker}>${blocker}`;
    if (!seen.has(blocker) || !attacking.has(attacker) || blocker === attacker || attacking.has(blocker) || drawn.has(key)) return;
    drawn.add(key);
    lines.push({ kind: 'block', from: { card: attacker }, to: { card: blocker }, pending });
  };
  for (const c of attackers) for (const blk of bandOf.get(c.attackerId)!.blockerIds) block(blk, c.attackerId, false);
  for (const [id, m] of marks) if (m.role === 'blocker' && m.pending && m.attackerId !== undefined && m.attackerId !== null) block(id, m.attackerId, true);
  // What each attacks: a line to the player's portrait or the planeswalker; a chip too when targets differ.
  const first = attackers[0]?.target ?? null;
  const allSame = !!first && attackers.every((c) => sameTarget(c.target, first));
  for (const c of attackers) {
    if (!c.target) continue;
    lines.push({ kind: 'target', from: { card: c.attackerId }, to: c.target.kind === 'card' ? { card: c.target.id } : { player: c.target.id }, pending: false });
    if (!allSame) chips.set(c.attackerId, c.target);
  }
  // Attackers being declared (not yet in a band): their line, pending; a chip when it is a planeswalker.
  for (const [id, m] of marks) {
    if (m.role !== 'attacker' || !m.pending || bandOf.has(id) || !seen.has(id) || !m.defender) continue;
    const t = targetOf(m.defender, state, seen, names);
    if (!t) continue;
    if (t.kind === 'card') chips.set(id, t);
    lines.push({ kind: 'target', from: { card: id }, to: t.kind === 'card' ? { card: t.id } : { player: t.id }, pending: true });
  }
  if (!attackers.length && !lines.length) return EMPTY_LAYOUT;
  return { attackers, lines, chips };
}

/**
 * Hide the summoning-sick "Zz" while it means nothing: during the other
 * player's combat (you only block there, and summoning sickness never stops a
 * block). Your own turn keeps it.
 */
export function hideSickMark(state: GameStateBody | null, seat: number): boolean {
  return !!state && state.activePlayer !== seat && typeof state.phase === 'string' && state.phase.startsWith('COMBAT');
}

/*
 * ForgeCoach — ui/play/combatLayout.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Where combat is drawn (the Endstep study, items 11–14, 18, 20): the board
 * has no combat list. Each attacking creature lifts out of its row into the
 * ATTACK LANE — a lighter band on its controller's side, nearest the centre
 * line — in the order the engine lists the attackers. A creature blocking it
 * sits in the BLOCK LANE on the defender's side, in the same column, so a
 * block is read by position; several blockers fan in front of one attacker.
 * Both lanes are built from one column list, so their columns line up.
 *
 * What an attacker attacks is a small chip on the card, or — when every
 * attacker has the same target, the common case — one label at the lane's
 * edge ("→ You", "→ Karn"). A thin line is kept only where position cannot
 * say it: a blocker that also blocks a second attacker (it sits in front of
 * the first), and an attack on a planeswalker (which sits in its own row).
 *
 * Pure: the redacted state, the board's combat marks (which fold in blocks
 * and attackers chosen but not yet confirmed — the engine's M65 `chosen`, or
 * this browser's clicks on an older engine) and a namer in; columns out. No
 * rules: nothing here decides what may attack or block; a card is placed only
 * where the wire (or the engine's own `chosen`) says it is. Only ids the
 * viewer can see on the battlefield are placed; a concealed id is skipped,
 * never guessed at, and no attacker's name is read here at all.
 */
import type { AnyCard, Card, EntityRef, GameStateBody } from '../../protocol.ts';
import { isHidden } from '../../protocol.ts';
import type { CardCombatMark } from '../cardContext.ts';

/** What an attacker attacks, as the lane draws it. */
export interface LaneTarget {
  kind: 'player' | 'card';
  id: number;
  /** "You", the opponent's name, or a planeswalker's short name ("Karn"). */
  label: string;
  /** One letter for the chip on a card. */
  initial: string;
}

export interface LaneBlocker {
  id: number;
  /** Chosen in the open declaration, not yet confirmed (the engine shows blocks in `combat` only after). */
  pending: boolean;
  /** Drawn lying down (a tapped blocker is wider). */
  tapped: boolean;
  controller: number;
}

export interface LaneColumn {
  attackerId: number;
  /** The attacker's controller: whose attack lane holds it. */
  controller: number;
  tapped: boolean;
  target: LaneTarget | null;
  /** Show `target` as a chip on the card (targets differ between attackers). */
  chip: boolean;
  blockers: LaneBlocker[];
  /** The attacker the next block click goes to (Forge's current attacker), in a block declaration. */
  current: boolean;
  /** Column width in card widths: the wider of the attacker and its fan of blockers. */
  weight: number;
}

export type CombatLineEnd = { card: number } | { lane: number };

/** A thin line where position cannot say it. */
export interface CombatLine {
  kind: 'block' | 'target';
  from: CombatLineEnd;
  to: { card: number };
  pending: boolean;
}

export interface CombatLayout {
  columns: LaneColumn[];
  /** One target for the whole lane (every attacker attacks it): the label at the lane's edge. */
  laneTarget: LaneTarget | null;
  /** Every id drawn in a lane (they leave their rows). */
  placed: ReadonlySet<number>;
  lines: CombatLine[];
  /** A chip for an attacker being declared (still in its row, tilted) that attacks a planeswalker. */
  pendingChips: ReadonlyMap<number, LaneTarget>;
  /** Sum of the column weights, plus a little for the gaps (both lanes use it, so they line up). */
  weight: number;
  /** Some attacker is upright (vigilance): the attack lane needs a card's full height. */
  upright: boolean;
}

export const EMPTY_LAYOUT: CombatLayout = {
  columns: [],
  laneTarget: null,
  placed: new Set(),
  lines: [],
  pendingChips: new Map(),
  weight: 0,
  upright: false,
};

/** How much of a card each further blocker in a fan adds (they overlap). */
export const FAN_STEP = 0.55;
/** A tapped card lies in a slot as wide as the card is tall. */
const TAPPED_W = 88 / 63;

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
  const columns: LaneColumn[] = [];
  const placed = new Set<number>();
  const lines: CombatLine[] = [];
  // Attackers, in the engine's order.
  const bandOf = new Map<number, (typeof bands)[number]>();
  for (const b of bands)
    for (const id of b.attackerIds) {
      const c = seen.get(id);
      if (!c || placed.has(id)) continue;
      placed.add(id);
      bandOf.set(id, b);
      columns.push({
        attackerId: id,
        controller: sideOf.get(id)!,
        tapped: c.tapped,
        target: targetOf(b.defender, state, seen, names),
        chip: false,
        blockers: [],
        current: marks.get(id)?.current === true,
        weight: 0,
      });
    }
  if (columns.length === 0) {
    const chips = pendingChips(state, seen, names, marks, lines);
    return chips.size ? { ...EMPTY_LAYOUT, pendingChips: chips, lines } : EMPTY_LAYOUT;
  }
  const col = new Map(columns.map((c) => [c.attackerId, c]));
  // Blockers: the engine's bands, then the declaration under way. A blocker in two bands sits in
  // front of the first attacker it blocks and gets a line to the other.
  const place = (blocker: number, attacker: number, pending: boolean) => {
    const b = seen.get(blocker);
    const target = col.get(attacker);
    if (!b || !target || blocker === attacker || col.has(blocker)) return;
    if (placed.has(blocker)) {
      if (!target.blockers.some((x) => x.id === blocker)) lines.push({ kind: 'block', from: { card: blocker }, to: { card: attacker }, pending });
      return;
    }
    placed.add(blocker);
    target.blockers.push({ id: blocker, pending, tapped: b.tapped, controller: sideOf.get(blocker)! });
  };
  for (const c of columns) for (const blk of bandOf.get(c.attackerId)!.blockerIds) place(blk, c.attackerId, false);
  for (const [id, m] of marks) if (m.role === 'blocker' && m.pending && m.attackerId !== undefined && m.attackerId !== null) place(id, m.attackerId, true);
  // Targets: one label when all agree, else a chip per card.
  const first = columns[0]!.target;
  const laneTarget = first && columns.every((c) => sameTarget(c.target, first)) ? first : null;
  for (const c of columns) c.chip = !laneTarget && !!c.target;
  if (laneTarget?.kind === 'card') lines.push({ kind: 'target', from: { lane: columns[0]!.controller }, to: { card: laneTarget.id }, pending: false });
  else for (const c of columns) if (c.target?.kind === 'card') lines.push({ kind: 'target', from: { card: c.attackerId }, to: { card: c.target.id }, pending: false });
  // Widths.
  let weight = 0;
  for (const c of columns) {
    const atk = c.tapped ? TAPPED_W : 1;
    const fan = c.blockers.length === 0 ? 0 : (c.blockers.some((b) => b.tapped) ? TAPPED_W : 1) + (c.blockers.length - 1) * FAN_STEP;
    c.weight = Math.round(Math.max(atk, fan) * 100) / 100;
    weight += c.weight;
  }
  return {
    columns,
    laneTarget,
    placed,
    lines,
    pendingChips: pendingChips(state, seen, names, marks, lines),
    weight: Math.round((weight + 0.12 * columns.length) * 100) / 100,
    upright: columns.some((c) => !c.tapped),
  };
}

/** Attackers being declared that attack a planeswalker: a chip on the tilted card, and a line to it. */
function pendingChips(state: GameStateBody, seen: Map<number, Card>, names: LayoutNames, marks: ReadonlyMap<number, CardCombatMark>, lines: CombatLine[]): Map<number, LaneTarget> {
  const out = new Map<number, LaneTarget>();
  const banded = new Set((state.combat?.bands ?? []).flatMap((b) => b.attackerIds));
  for (const [id, m] of marks) {
    if (m.role !== 'attacker' || !m.pending || banded.has(id) || !seen.has(id) || m.defender?.kind !== 'card') continue;
    const t = targetOf(m.defender, state, seen, names);
    if (!t) continue;
    out.set(id, t);
    lines.push({ kind: 'target', from: { card: id }, to: { card: t.id }, pending: true });
  }
  return out;
}

/**
 * Which lanes a player's side draws: the attack lane (its attackers) and the
 * block lane (the blockers it controls — or, while the viewing seat declares
 * blocks, the empty slot in front of the attacker its next block goes to).
 */
export function laneRole(layout: CombatLayout, playerId: number, seat: number | null): { attack: boolean; block: boolean } {
  const attack = layout.columns.some((c) => c.controller === playerId);
  const block =
    layout.columns.some((c) => c.blockers.some((b) => b.controller === playerId)) ||
    (playerId === seat && !attack && layout.columns.some((c) => c.current));
  return { attack, block };
}

/**
 * Hide the summoning-sick "Zz" while it means nothing: during the other
 * player's combat (you only block there, and summoning sickness never stops a
 * block). Your own turn keeps it.
 */
export function hideSickMark(state: GameStateBody | null, seat: number): boolean {
  return !!state && state.activePlayer !== seat && typeof state.phase === 'string' && state.phase.startsWith('COMBAT');
}

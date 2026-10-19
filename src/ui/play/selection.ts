/*
 * ForgeCoach — ui/play/selection.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The selection model of the decision panel (endstep-style): while the engine
 * wants cards clicked (attackers, blockers, targets, a discard, mana to pay),
 * the board dims what a click cannot drive and the panel keeps a live count —
 * "● 1 SELECTED — 1 blocker(s) assigned — click more or confirm" — beside the
 * buttons, worded for the moment (the combat study, 2026-10-12, §1 and §4:
 * "Done selecting" → "One selected" → "2 attackers"; "Done blocking" → "One
 * blocking" → "2 blocking").
 *
 * Pure. The counts are the engine's own when the frame says (M65
 * `selectable.chosen`: the targets, list entries, blockers and attackers chosen
 * so far — `wireChoice` below), else what this browser clicked (an engine
 * before M65 reports attackers and blockers only on confirm); never an
 * inference about the board.
 */
import type { ChosenAttack, SelectionChosen } from '../../protocol.ts';
import type { InputView } from './inputView.ts';

/** What the engine says is chosen in the open input (M65), shaped for the board. */
export interface WireChoice {
  /** Cards chosen outside a declaration: targets, list entries. */
  cards: ReadonlySet<number>;
  /** Players chosen (targets, list entries). */
  players: ReadonlySet<number>;
  /** Attackers declared so far (an attack declaration), else empty. */
  attackers: ReadonlySet<number>;
  /** What each declared attacker attacks. */
  attacks: readonly ChosenAttack[];
  /** Blocker → the attacker it blocks (a block declaration); a blocker with no pair row → null. */
  blockers: ReadonlyMap<number, number | null>;
}

/**
 * The board's picture of `chosenOf(input)`, or null when the frame does not
 * say (absent or null is "unknown", never "nothing chosen"): the caller then
 * keeps its own clicks, exactly as before M65.
 */
export function wireChoice(chosen: SelectionChosen | null, mode: InputView['mode']): WireChoice | null {
  if (!chosen) return null;
  const attack = mode === 'attack';
  const block = mode === 'block';
  const blockers = new Map<number, number | null>();
  if (block) {
    for (const b of chosen.blocks) if (!blockers.has(b.blockerId)) blockers.set(b.blockerId, b.attackerId);
    for (const id of chosen.cardIds) if (!blockers.has(id)) blockers.set(id, null);
  }
  return {
    cards: new Set(attack || block ? [] : chosen.cardIds),
    players: new Set(chosen.playerIds),
    attackers: new Set(attack ? [...chosen.cardIds, ...chosen.attacks.map((a) => a.attackerId)] : []),
    attacks: attack ? chosen.attacks : [],
    blockers,
  };
}

export interface SelectionSummary {
  /** A selection is under way: dim the cards a click cannot drive. */
  active: boolean;
  /** Cards picked so far, or null when the wire gives no way to know. */
  count: number | null;
  /** The status line: "Click to select" / "1 blocker assigned — click more or confirm". */
  line: string | null;
  /** Words for the confirm button, when the moment has better ones than the engine's label. */
  confirm: string | null;
}

const SELECTING = new Set<InputView['mode']>(['attack', 'block', 'target', 'discard', 'pay']);

/**
 * How a block is declared on this board (blocker first, the combat study §4;
 * blockPlan.ts turns it into the engine's attacker-first clicks): your
 * creature, then the attacker it blocks. The same two clicks on a block that
 * is already there take it off; your creature then another attacker moves it.
 */
export const BLOCK_HOW = 'Click a creature, then click the attacker it blocks';
/** Your creature is picked: the attacker is the second click. */
export const BLOCK_ARMED = 'Selected blocker — now click an attacker to assign';
/** An attacker is picked first (the other order works too): your creature is the second click. */
export const BLOCK_ARMED_ATTACKER = 'Selected attacker — now click the creature that blocks it';
/** Declaring attackers (the combat study §1). */
export const ATTACK_HOW = 'Click your creatures to attack';

/** The primary button of a block declaration: "Done blocking", "One blocking", "2 blocking". */
export function blockConfirmWords(n: number): string {
  return n <= 0 ? 'Done blocking' : n === 1 ? 'One blocking' : `${n} blocking`;
}

/** The primary button of an attack declaration: "Done selecting", "One selected", "2 attackers". */
export function attackConfirmWords(n: number): string {
  return n <= 0 ? 'Done selecting' : n === 1 ? 'One selected' : `${n} attackers`;
}

export function selectionSummary(
  view: InputView,
  picked: { attackers: number; blockers: number },
  /** The first click of a block gesture is down (blockPlan.ts `BlockPick`). */
  armed: 'blocker' | 'attacker' | null = null,
): SelectionSummary {
  if (!SELECTING.has(view.mode)) return { active: false, count: null, line: null, confirm: null };
  switch (view.mode) {
    case 'block': {
      const n = picked.blockers;
      return {
        active: true,
        count: n,
        line:
          armed === 'blocker'
            ? BLOCK_ARMED
            : armed === 'attacker'
              ? BLOCK_ARMED_ATTACKER
              : n > 0
                ? `${n} blocker(s) assigned — click more or confirm`
                : BLOCK_HOW,
        confirm: blockConfirmWords(n),
      };
    }
    case 'attack': {
      const n = picked.attackers;
      return { active: true, count: n, line: ATTACK_HOW, confirm: attackConfirmWords(n) };
    }
    case 'pay':
      return { active: true, count: null, line: 'Tap lands to pay', confirm: null };
    default:
      // The prompt's context ("First target: Tireless Tracker. Choose a different target…") says more than "Click to select".
      return {
        active: true,
        count: null,
        line: view.context ? view.context : view.needClick ? (view.clickWhat === 'player' ? 'Click a player’s portrait' : 'Click to select') : null,
        confirm: null,
      };
  }
}

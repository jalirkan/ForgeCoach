/*
 * ForgeCoach — ui/play/blockPlan.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Declaring blockers, as the engine's own clicks. Forge's block input
 * (`InputBlock.onCardSelected`, read with javap on the pinned 2.0.14 jar) has
 * a "current attacker" — the one its prompt names, "Select creatures to block
 * <attacker> (<id>) or select another attacker…" — and takes three clicks:
 *
 *   - a click on an attacker makes it the current attacker;
 *   - a click on your creature that is blocking the current attacker takes
 *     that block off (`Combat.removeBlockAssignment`);
 *   - a click on any other creature of yours blocks the current attacker,
 *     if `CombatUtil.canBlock(attacker, creature, combat)` says it may — and a
 *     creature already blocking another attacker may not, unless it can block
 *     more than one, so the engine refuses that click ("Not selectable").
 *
 * The engine's Cancel is off in this input (`updateButtons(…, ok, cancel=false, …)`),
 * so there is no reset: a block comes off one creature at a time.
 *
 * This module turns what the player means into those clicks, in order:
 * clicking an attacker, clicking a creature to block the current attacker or
 * to take its block off are one click each, as before. Two things the engine
 * would refuse in one click become a short sequence of its own clicks:
 *
 *   - MOVE: your creature blocks attacker X and another attacker is current —
 *     click X, the creature (off X), the current attacker, the creature (onto
 *     it). A creature that may block two attackers is moved too, not doubled.
 *   - TAKE OFF (the × on a blocker): when its attacker is not current — click
 *     its attacker, the creature (off), and the current attacker again, so the
 *     prompt keeps naming the attacker you were working on.
 *
 * Nothing here decides what may block what: every click is the engine's, and
 * the engine refuses what it will not take. `blocks` is what is chosen so far
 * (the engine's M65 `selectable.chosen.blocks` when the frame carries it, else
 * this browser's own clicks); `next` is this browser's picture after the
 * clicks, used only on an engine before M65.
 */
import type { AnyCard, Card, GameStateBody } from '../../protocol.ts';
import { isHidden, keywordsOf } from '../../protocol.ts';

/** Blocker → the attacker it blocks (null: the wire did not say which). */
export type BlockMap = ReadonlyMap<number, number | null>;

export interface BlockPlan {
  /** Card ids to send `act: clickCard` for, in this order. */
  clicks: number[];
  /** The blocks after the clicks, if the engine takes them all. */
  next: Map<number, number | null>;
  /** The creature a click tries to put on an attacker, and that attacker (to word a refusal). */
  tries: { blocker: number; attacker: number } | null;
}

/** A click on an attacker: it becomes the one blocks go to. */
export function clickAttacker(attacker: number, blocks: BlockMap): BlockPlan {
  return { clicks: [attacker], next: new Map(blocks), tries: null };
}

/** A click on one of your creatures, with `current` the attacker the prompt names (null: none named). */
export function clickBlocker(blocker: number, current: number | null, blocks: BlockMap): BlockPlan {
  const next = new Map(blocks);
  const on = blocks.has(blocker) ? blocks.get(blocker)! : undefined;
  if (current === null) {
    // No attacker named: the engine takes no block. A click on a blocking creature still
    // reaches the engine, as before; nothing changes here.
    return { clicks: [blocker], next, tries: null };
  }
  if (on === undefined) {
    next.set(blocker, current);
    return { clicks: [blocker], next, tries: { blocker, attacker: current } };
  }
  if (on === current || on === null) {
    // Blocking the named attacker (or the wire did not say which): the engine takes it off.
    next.delete(blocker);
    return { clicks: [blocker], next, tries: null };
  }
  // Blocking another attacker: take it off that one, then put it on the named one.
  next.set(blocker, current);
  return { clicks: [on, blocker, current, blocker], next, tries: { blocker, attacker: current } };
}

/** The × on a declared blocker: take its block off, leaving the named attacker named. */
export function takeOff(blocker: number, current: number | null, blocks: BlockMap): BlockPlan {
  const next = new Map(blocks);
  const on = blocks.has(blocker) ? blocks.get(blocker)! : undefined;
  if (on === undefined) return { clicks: [], next, tries: null };
  next.delete(blocker);
  if (on === null || on === current) return { clicks: [blocker], next, tries: null };
  return { clicks: current === null ? [on, blocker] : [on, blocker, current], next, tries: null };
}

// ---------------------------------------------------------------------------
// When the engine refuses a block

export interface RefusalCards {
  blocker: { name: string; keywords: readonly string[] } | null;
  attacker: { name: string; keywords: readonly string[] } | null;
}

/**
 * The line for a block the engine refused ("Not selectable"), in the game's
 * terms as far as the wire lets us: the names, and — when the attacker flies
 * and the creature has neither flying nor reach, both keywords on the wire —
 * that it can't block a flyer. Never "cannot be selected now"; never a guess
 * past the keywords (the engine knows the other reasons, the wire does not).
 */
export function refusalLine(cards: RefusalCards): string | null {
  const b = cards.blocker;
  const a = cards.attacker;
  if (!b || !b.name) return null;
  const who = a && a.name ? a.name : 'that attacker';
  const has = (k: readonly string[], w: string) => k.includes(w);
  if (a && has(a.keywords, 'FLYING') && !has(b.keywords, 'FLYING') && !has(b.keywords, 'REACH')) return `${b.name} can't block ${who}: it can't block a flyer.`;
  return `${b.name} can't block ${who}: not a legal block for this attacker. Click another attacker first.`;
}

/**
 * The flash line for an engine notice during a block declaration, or null to
 * keep the usual one. Only a "Not selectable" naming one of the seat's own
 * creatures on the battlefield is reworded; the attacker is the one the click
 * tried (`tried`), else the one the prompt names.
 */
export function blockRefusal(
  title: string,
  text: string | null | undefined,
  state: GameStateBody | null,
  tried: { blocker: number; attacker: number } | null,
  current: number | null,
  seat: number | null,
): string | null {
  if (!state || !/^not selectable$/i.test(title.trim())) return null;
  const m = /\bcard (\d+)\b/.exec(text ?? '');
  if (!m) return null;
  const id = Number(m[1]);
  const find = (cid: number): Card | null => {
    for (const p of state.players) for (const c of p.zones.battlefield.cards as AnyCard[]) if (c.id === cid && !isHidden(c)) return c as Card;
    return null;
  };
  const blocker = find(id);
  if (!blocker || blocker.controller !== seat) return null;
  const atkId = tried && tried.blocker === id ? tried.attacker : current;
  const attacker = atkId === null ? null : find(atkId);
  const view = (c: Card | null) => (c ? { name: c.name, keywords: keywordsOf(c) } : null);
  return refusalLine({ blocker: view(blocker), attacker: view(attacker) });
}

/**
 * The flash line when the engine refuses an attacker click ("Not selectable")
 * on one of the seat's own creatures: "Reveillark can't attack: it entered
 * this turn" when the card's own summoning-sick flag says so and the wire
 * lists no haste, else "…: not a legal attacker". Null for any other notice.
 */
export function attackRefusal(title: string, text: string | null | undefined, state: GameStateBody | null, seat: number | null): string | null {
  if (!state || !/^not selectable$/i.test(title.trim())) return null;
  const m = /\bcard (\d+)\b/.exec(text ?? '');
  if (!m) return null;
  const id = Number(m[1]);
  let card: Card | null = null;
  for (const p of state.players) for (const c of p.zones.battlefield.cards as AnyCard[]) if (c.id === id && !isHidden(c)) card = c as Card;
  if (!card || card.controller !== seat || !card.name) return null;
  if (card.sick && !keywordsOf(card).includes('HASTE')) return `${card.name} can't attack: it entered this turn.`;
  return `${card.name} can't attack: not a legal attacker.`;
}

/*
 * ForgeCoach — ui/play/blockPlan.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Declaring attackers and blockers, as the engine's own clicks.
 *
 * BLOCKS. The board presents a block blocker first (the combat study,
 * 2026-10-12, §4): click your creature (it lifts), then the attacker it
 * blocks. Forge's block input is attacker first (`InputBlock.onCardSelected`,
 * read with javap on the pinned 2.0.14 jar): it has a "current attacker" — the
 * one its prompt names, "Select creatures to block <attacker> (<id>) or select
 * another attacker…" — and takes three clicks:
 *
 *   - a click on an attacker makes it the current attacker;
 *   - a click on your creature that is blocking the current attacker takes
 *     that block off (`Combat.removeBlockAssignment`);
 *   - a click on any other creature of yours blocks the current attacker,
 *     if `CombatUtil.canBlock(attacker, creature, combat)` says it may — and a
 *     creature already blocking another attacker may not, unless it can block
 *     more than one, so the engine refuses that click ("Not selectable").
 *
 * So the pair the player picks (`blockGesture`) becomes the engine's clicks
 * (`assignBlock`), the attacker's first:
 *
 *   - ASSIGN: creature, attacker → click the attacker (unless it is already
 *     the current one), then the creature;
 *   - REMOVE: a creature, then the attacker it already blocks → the same two
 *     clicks; the engine takes the block off;
 *   - MOVE: a creature blocking attacker X, then another attacker → click X,
 *     the creature (off X), the attacker, the creature (onto it). A creature
 *     that may block two attackers is moved too, not doubled.
 *
 * The other order works as well (an attacker, then your creature), so a click
 * on an attacker is never lost. The engine's Cancel is off in this input, so
 * NO BLOCKS (`noBlocksClicks`) takes each block off by the same clicks, then
 * the slot presses OK.
 *
 * ATTACKS. A click on your creature is the engine's own `clickCard` (Forge
 * toggles it); SKIP COMBAT (`skipCombatActs`) is the engine's Cancel while it
 * reads "Call Back" (Forge clears the attackers), then OK — OK with nobody
 * attacking is Forge's "no attack".
 *
 * Nothing here decides what may block or attack what: every click is the
 * engine's, and the engine refuses what it will not take. `blocks` is what is
 * chosen so far (the engine's M65 `selectable.chosen.blocks` when the frame
 * carries it, else this browser's own clicks); `next` is this browser's
 * picture after the clicks, used only on an engine before M65.
 */
import type { ActBody, AnyCard, Card, GameStateBody } from '../../protocol.ts';
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

/**
 * Put `blocker` on `attacker` — or take it off, when it already blocks that
 * attacker; `current` is the attacker the engine's prompt names (null: none).
 */
export function assignBlock(blocker: number, attacker: number, current: number | null, blocks: BlockMap): BlockPlan {
  const next = new Map(blocks);
  const on = blocks.has(blocker) ? blocks.get(blocker)! : undefined;
  const name = (a: number) => (a === current ? [] : [a]);
  if (on === attacker) {
    next.delete(blocker);
    return { clicks: [...name(attacker), blocker], next, tries: null };
  }
  next.set(blocker, attacker);
  if (on === undefined || on === null) return { clicks: [...name(attacker), blocker], next, tries: { blocker, attacker } };
  // Blocking another attacker: off that one, then onto this one.
  return { clicks: [...name(on), blocker, attacker, blocker], next, tries: { blocker, attacker } };
}

/** The first click of a block gesture, waiting for its pair. */
export type BlockPick = { kind: 'blocker' | 'attacker'; id: number } | null;

export interface BlockStep {
  /** What waits for its pair after this click. */
  pick: BlockPick;
  /** The engine's clicks, when this click completed a pair. */
  plan: BlockPlan | null;
}

/**
 * One click in a block declaration: your creature (`blocker`) or an attacker.
 * The first click of a pair is picked (a second click on it puts it down);
 * the second completes the pair: `assignBlock`. Two clicks of one kind: the
 * later one is picked instead.
 */
export function blockGesture(pick: BlockPick, click: { kind: 'blocker' | 'attacker'; id: number }, current: number | null, blocks: BlockMap): BlockStep {
  if (pick && pick.kind !== click.kind) {
    const blocker = click.kind === 'blocker' ? click.id : pick.id;
    const attacker = click.kind === 'attacker' ? click.id : pick.id;
    return { pick: null, plan: assignBlock(blocker, attacker, current, blocks) };
  }
  if (pick && pick.id === click.id) return { pick: null, plan: null };
  return { pick: { kind: click.kind, id: click.id }, plan: null };
}

/**
 * NO BLOCKS: the clicks that take every block off, attacker by attacker (name
 * it unless it is current, then click each of its blockers). A blocker whose
 * attacker the wire did not say is left alone: a click on it could be taken
 * as a new block instead. The slot sends the engine's OK after these.
 */
export function noBlocksClicks(current: number | null, blocks: BlockMap): number[] {
  const byAttacker = new Map<number, number[]>();
  for (const [b, a] of blocks) if (a !== null) byAttacker.set(a, [...(byAttacker.get(a) ?? []), b]);
  const out: number[] = [];
  let named = current;
  for (const [a, bs] of byAttacker) {
    if (a !== named) out.push(a);
    named = a;
    out.push(...bs);
  }
  return out;
}

/**
 * SKIP COMBAT: no attackers. While the engine's Cancel reads "Call Back"
 * (something is attacking) it clears them first; then OK. The engine's label
 * is the truth about whether anything is declared, not this browser's clicks.
 */
export function skipCombatActs(cancel: { label: string; enabled: boolean }): ActBody[] {
  return cancel.enabled && /call back/i.test(cancel.label) ? [{ action: 'buttonCancel' }, { action: 'buttonOk' }] : [{ action: 'buttonOk' }];
}

// ---------------------------------------------------------------------------
// When the engine refuses a block

/**
 * The card a "Not selectable" notice names, from the visible state. The bridge
 * names it by its label ("Flayer Husk (63) cannot be selected now", or "Flayer
 * Husk" alone) or, for a card it may not name, "card 63": the id when the text
 * carries one, else the one visible card of that name (yours first). Null when
 * the board cannot tell which card it is.
 */
export function refusedCard(text: string | null | undefined, state: GameStateBody | null, seat: number | null): Card | null {
  if (!state) return null;
  const t = String(text ?? '');
  const all: Card[] = [];
  for (const p of state.players) for (const z of Object.values(p.zones)) for (const c of z.cards as AnyCard[]) if (!isHidden(c)) all.push(c as Card);
  const m = /\bcard (\d+)\b/.exec(t) ?? /\((\d+)\)\s*cannot be selected/.exec(t);
  if (m) return all.find((c) => c.id === Number(m[1])) ?? null;
  const name = /^(.+?)\s+cannot be selected/.exec(t.trim())?.[1]?.trim();
  if (!name) return null;
  const named = all.filter((c) => c.name === name);
  const mine = named.filter((c) => c.controller === seat || (c.zone === 'hand' && c.owner === seat));
  const pick = mine.length ? mine : named;
  return pick.length === 1 ? pick[0]! : pick.find((c) => c.zone === 'battlefield') ?? pick[0] ?? null;
}

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
  return `${b.name} can't block ${who}: not a legal block for this attacker.`;
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
  const find = (cid: number): Card | null => {
    for (const p of state.players) for (const c of p.zones.battlefield.cards as AnyCard[]) if (c.id === cid && !isHidden(c)) return c as Card;
    return null;
  };
  const named = refusedCard(text, state, seat);
  const blocker = named && named.zone === 'battlefield' ? named : null;
  if (!blocker || blocker.controller !== seat) return null;
  const id = blocker.id;
  if (!/creature/i.test(blocker.types ?? '')) return `${blocker.name} can't block: only creatures block.`;
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
  const named = refusedCard(text, state, seat);
  const card = named && named.zone === 'battlefield' ? named : null;
  if (!card || card.controller !== seat || !card.name) return null;
  if (!/creature/i.test(card.types ?? '')) return `${card.name} can't attack: only creatures attack.`;
  if (card.tapped) return `${card.name} can't attack: it is tapped.`;
  if (card.sick && !keywordsOf(card).includes('HASTE')) return `${card.name} can't attack: it entered this turn.`;
  return `${card.name} can't attack: not a legal attacker.`;
}

// ---------------------------------------------------------------------------
// Skip combat / No blocks wait for the engine's answer to the last click

/**
 * How long Skip combat / No blocks waits for the engine's answer to the last
 * click before going ahead anyway (a refused click is answered with a notice,
 * not a new input).
 */
export const SKIP_WAIT_MS = 1500;

/**
 * Whether Skip combat / No blocks must wait: an act went out (`sentAtInput`,
 * the input seq it was sent under) and no newer input has arrived. Both read
 * the engine's latest word — its Cancel's label, its M65 `chosen` — so pressed
 * right after a click (A, then Esc) they would otherwise act on the input
 * before it, and OK would confirm the attack the click just made.
 */
export function skipMustWait(sentAtInput: number | null, inputSeq: number): boolean {
  return sentAtInput !== null && sentAtInput >= inputSeq;
}

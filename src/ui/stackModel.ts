/*
 * ForgeCoach — ui/stackModel.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The stack as the board shows it (endstep-style): numbered items, the top —
 * the one that resolves next — as 1; each with its source card (for its art
 * and name), its kind (spell, activated or triggered ability), its
 * controller, the engine's text, and what it targets. The same numbers go on
 * the board: a badge on each source card and on each target, and a line from
 * the item to each (ui/StackPanel.tsx, ui/BoardArrows.tsx).
 *
 * Adapted from mtg-table web/src/render/StackPanel.tsx (Copyright (C) 2026
 * the mtg-table authors, GPL-3.0-or-later): `state.stack` is bottom first and
 * shown reversed; a stack item id is a different id space from card ids
 * (protocol §10.1), so the source is reached only through `sourceCardId`,
 * resolved against `stackCards` first.
 *
 * Pure. Redaction: only what the viewing seat's state carries — a concealed
 * or face-down source (§3.3) has no name and no art here, and an empty `text`
 * (the bridge blanked it, §3.6) is "Hidden", never filled in.
 */
import type { AnyCard, Card, GameStateBody, StackItem } from '../protocol.ts';
import { isHidden } from '../protocol.ts';
import type { CardStackMarks } from './cardContext.ts';

export type StackKind = 'spell' | 'activated' | 'triggered' | 'ability';

export interface StackEntry {
  /** 1 = the top of the stack, resolves next. */
  n: number;
  item: StackItem;
  /** The source as this seat may see it; null when concealed or missing. */
  source: Card | null;
  /** The source's name, or null when this seat may not know it. */
  name: string | null;
  /** A face-down source (morph, manifest): drawn as a card back. */
  faceDown: boolean;
  kind: StackKind;
  /** Who controls it: "You", the player's name, or null. */
  controller: string | null;
  mine: boolean;
  /** The engine's text, verbatim; '' when the bridge blanked it. */
  text: string;
  /** Targets as words: card names (or "a hidden card") and player names. */
  targets: { kind: 'card' | 'player'; id: number; label: string }[];
  /** The source is a permanent on the battlefield (an ability's host): a line goes to it. */
  sourceOnBoard: boolean;
}

function playerWord(state: GameStateBody, id: number | null, seat: number | null): string | null {
  if (id === null) return null;
  if (id === seat) return 'You';
  return state.players.find((p) => p.id === id)?.name ?? null;
}

function battlefieldIds(state: GameStateBody): Set<number> {
  const s = new Set<number>();
  for (const p of state.players) for (const c of p.zones.battlefield.cards) s.add(c.id);
  return s;
}

function findCard(state: GameStateBody, id: number): AnyCard | undefined {
  const s = (state.stackCards ?? []).find((c) => c.id === id);
  if (s) return s;
  for (const p of state.players) for (const z of Object.values(p.zones)) for (const c of z.cards) if (c.id === id) return c;
  return undefined;
}

/** Spell, activated or triggered: the engine's flags first, then the source's zone, then Forge's own trigger wording. */
export function stackKind(item: StackItem, source: AnyCard | undefined): StackKind {
  if (item.isAbility === false) return 'spell';
  const onStack = !!source && !isHidden(source) && (source as Card).zone === 'stack';
  if (item.isAbility === undefined && onStack) return 'spell';
  if (item.isOptionalTrigger) return 'triggered';
  const t = item.text.replace(/\(Targeting:.*$/s, '');
  if (/(^|[—\-.:]\s*)(When|Whenever|At the beginning|At the end|At end)\b/i.test(t)) return 'triggered';
  if (/\{[^}]+\}[^:]*:|^\s*[^—]*\bTap\b[^:]*:/i.test(t)) return 'activated';
  if (item.isAbility === undefined) return onStack ? 'spell' : 'ability';
  return 'ability';
}

export const KIND_WORDS: Record<StackKind, string> = {
  spell: 'Spell',
  activated: 'Activated ability',
  triggered: 'Triggered ability',
  ability: 'Ability',
};

function cardWord(c: AnyCard | undefined): string {
  if (!c) return 'a card';
  if (isHidden(c)) return 'a hidden card';
  const k = c as Card;
  if (k.faceDown && !k.name) return 'a face-down card';
  return k.name || 'a card';
}

/** The stack, top first, numbered from 1. */
export function stackEntries(state: GameStateBody | null, seat: number | null): StackEntry[] {
  if (!state || state.stack.length === 0) return [];
  const onBoard = battlefieldIds(state);
  return [...state.stack].reverse().map((item, i) => {
    const raw = item.sourceCardId === null ? undefined : findCard(state, item.sourceCardId);
    const visible = raw && !isHidden(raw) ? (raw as Card) : null;
    const faceDown = !!raw && (isHidden(raw) || !!(raw as Card).faceDown);
    const name = visible && visible.name && !visible.faceDown ? visible.name : null;
    return {
      n: i + 1,
      item,
      source: visible,
      name,
      faceDown,
      kind: stackKind(item, raw),
      controller: playerWord(state, item.controller, seat),
      mine: seat !== null && item.controller === seat,
      text: item.text,
      targets: [
        ...item.targetCardIds.map((id) => ({ kind: 'card' as const, id, label: cardWord(findCard(state, id)) })),
        ...item.targetPlayerIds.map((id) => ({ kind: 'player' as const, id, label: playerWord(state, id, seat) ?? 'a player' })),
      ],
      sourceOnBoard: item.sourceCardId !== null && onBoard.has(item.sourceCardId),
    };
  });
}

/** The engine's text without its "(Targeting: …)" tail when the targets are listed beside it. */
export function stackText(e: StackEntry): string {
  if (e.text === '') return '';
  return e.targets.length ? e.text.replace(/\s*\(Targeting:.*\)\s*$/s, '').trim() : e.text;
}

export type { CardStackMarks };

/** The numbered badges for board cards: card id → which stack items come from it or point at it. */
export function stackMarks(entries: StackEntry[]): Map<number, CardStackMarks> {
  const m = new Map<number, CardStackMarks>();
  const get = (id: number) => {
    let x = m.get(id);
    if (!x) m.set(id, (x = { sources: [], targets: [] }));
    return x;
  };
  for (const e of entries) {
    if (e.sourceOnBoard && e.item.sourceCardId !== null) get(e.item.sourceCardId).sources.push(e.n);
    for (const t of e.targets) if (t.kind === 'card') get(t.id).targets.push(e.n);
  }
  return m;
}

/** Players a stack item targets: player id → item numbers. */
export function stackPlayerMarks(entries: StackEntry[]): Map<number, number[]> {
  const m = new Map<number, number[]>();
  for (const e of entries) for (const t of e.targets) if (t.kind === 'player') m.set(t.id, [...(m.get(t.id) ?? []), e.n]);
  return m;
}

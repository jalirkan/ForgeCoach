/*
 * ForgeCoach — livePlan/board.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The small facts about one `state` the plan modules need, ported from mtg-table
 * tools/llm-seat (lib/frames.mjs, D419). Pure and DOM-free; no rules logic —
 * what a card IS comes from the wire, what it may DO from the engine
 * (`state.playable`, M61; `state.activatable`, M63).
 */
import type { AnyCard, GameStateBody, PlayerState } from '../protocol.ts';

/** A card as these modules read it: every field optional (a redacted stub has few). */
export interface LooseCard {
  id: number;
  name?: string;
  types?: string;
  manaCost?: string | null;
  power?: string | null;
  toughness?: string | null;
  loyalty?: string | null;
  keywords?: string[];
  damage?: number;
  counters?: Record<string, number>;
  tapped?: boolean;
  sick?: boolean;
  attacking?: boolean;
  blocking?: boolean;
  faceDown?: boolean;
  token?: boolean;
  attachedToId?: number | null;
  controller?: number | null;
  owner?: number | null;
  zone?: string;
  hidden?: boolean;
}

export const ZONES = ['hand', 'battlefield', 'graveyard', 'exile', 'command', 'library'] as const;

export const loose = (c: AnyCard | null | undefined): LooseCard | null => (c ? (c as unknown as LooseCard) : null);

/** The viewing seat's and the other player's objects in one state. */
export function playersOf(state: GameStateBody | null | undefined, me: number): { mine: PlayerState | null; opp: PlayerState | null } {
  const ps = Array.isArray(state?.players) ? state!.players : [];
  return { mine: ps.find((p) => p.id === me) ?? null, opp: ps.find((p) => p.id !== me) ?? null };
}

/** Every card object visible in one state, by id (zones, then the stack's cards). */
export function cardsById(state: GameStateBody | null | undefined): Map<number, LooseCard> {
  const out = new Map<number, LooseCard>();
  for (const p of state?.players ?? []) {
    for (const z of ZONES) {
      for (const c of (p.zones?.[z]?.cards ?? []) as AnyCard[]) if (typeof c?.id === 'number') out.set(c.id, loose(c)!);
    }
  }
  for (const c of state?.stackCards ?? []) if (typeof c?.id === 'number' && !out.has(c.id)) out.set(c.id, loose(c)!);
  return out;
}

/** A card's public name, or null for a redacted stub or a concealed face (§3.3). */
export function nameOf(card: LooseCard | null | undefined): string | null {
  if (!card || card.hidden === true || (card as { faceDownHidden?: boolean }).faceDownHidden === true) return null;
  return typeof card.name === 'string' && card.name !== '' ? card.name : null;
}

export const isCreature = (c: LooseCard | null | undefined): boolean => /\bCreature\b/.test(String(c?.types ?? ''));
export const isLand = (c: LooseCard | null | undefined): boolean => /\bLand\b/.test(String(c?.types ?? ''));
export const hasKeyword = (c: LooseCard | null | undefined, k: string): boolean => Array.isArray(c?.keywords) && c!.keywords!.includes(k);

/** The cards of one zone of one player, as loose cards. */
export function zoneCards(p: PlayerState | null | undefined, zone: (typeof ZONES)[number]): LooseCard[] {
  return ((p?.zones?.[zone]?.cards ?? []) as AnyCard[]).map((c) => loose(c)!);
}

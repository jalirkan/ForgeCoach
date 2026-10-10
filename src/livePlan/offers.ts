/*
 * ForgeCoach — livePlan/offers.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * What the engine lets the player do at their priority, read the seat's way
 * (mtg-table tools/llm-seat lib/decision.mjs, D419): `state.playable` (M61)
 * for the cards outside the battlefield, `state.activatable` (M63) for the
 * permanents' non-mana abilities. On an engine older than either, the hand
 * (everything at sorcery speed in the player's own main phase with an empty
 * stack, else only instants and FLASH cards) and the permanents whose card text
 * has a non-mana activated ability — marked `legacy`, so the prompt says the
 * engine did not list them.
 */
import type { GameStateBody } from '../protocol.ts';
import { activatableOf, playableOf } from '../protocol.ts';
import { cardsById, hasKeyword, isLand, nameOf, playersOf, zoneCards } from './board.ts';
import { hasNonManaActivated, needsTap, type Oracle } from './oracle.ts';

export interface Offer {
  verb: 'land' | 'cast' | 'activate';
  cardId: number;
  zone: string;
  /** The engine's label for the ability (activate, and cast when a card has several). */
  abilityLabel?: string;
  /** From the engine's own M63 list. */
  engine?: true;
  /** Read off the hand or the card text: the engine did not list it. */
  legacy?: true;
}

export interface Offers extends Array<Offer> {
  /** The engine sent no `playable` list: the cards are the hand (offersText says so). */
  legacy?: boolean;
  /** The engine's `activatable` list was present (M63): no card-text guessing for the battlefield. */
  engineActivatable?: boolean;
}

/** The player has priority with no question open (a plain priority input). */
export function atPriority(state: GameStateBody | null | undefined, me: number, input: { prompt?: string } | null | undefined, ask: unknown): boolean {
  if (!state || ask) return false;
  if (state.priority !== me) return false;
  return !input || /^Priority:/.test(String(input.prompt ?? ''));
}

/** The engine's options at the player's priority (empty when they are not at priority). */
export function offersOf(state: GameStateBody, me: number, oracle: Oracle | null): Offers {
  const out: Offers = [];
  const cards = cardsById(state);
  const { mine } = playersOf(state, me);
  const own = state.activePlayer === me;
  const main = state.phase === 'MAIN1' || state.phase === 'MAIN2';
  const stackEmpty = !Array.isArray(state.stack) || state.stack.length === 0;
  const playable = playableOf(state);
  if (playable) {
    for (const e of playable) {
      const c = cards.get(e.cardId);
      for (const ab of e.abilities) {
        // a land in hand plays, unless the ability is another one (Ash Barrens' landcycling)
        const land = isLand(c) && ab.isSpell === false && e.zone === 'hand' && !/cycling|channel|:|\{/i.test(String(ab.label ?? ''));
        const verb = land ? 'land' : ab.isSpell ? 'cast' : 'activate';
        out.push({ verb, cardId: e.cardId, zone: e.zone, ...(verb !== 'land' ? { abilityLabel: String(ab.label ?? '') } : {}) });
      }
    }
  } else if (mine) {
    out.legacy = true;
    const sorcerySpeed = own && main && stackEmpty;
    for (const c of zoneCards(mine, 'hand')) {
      if (c.hidden === true || typeof c.id !== 'number') continue;
      if (isLand(c)) {
        if (sorcerySpeed) out.push({ verb: 'land', cardId: c.id, zone: 'hand', legacy: true });
      } else if (sorcerySpeed || /\bInstant\b/.test(String(c.types ?? '')) || hasKeyword(c, 'FLASH')) {
        out.push({ verb: 'cast', cardId: c.id, zone: 'hand', legacy: true });
      }
    }
  }
  const activatable = activatableOf(state);
  if (state.activatable !== undefined) {
    out.engineActivatable = true;
    for (const e of activatable ?? []) {
      for (const ab of e.abilities) out.push({ verb: 'activate', cardId: e.cardId, zone: 'battlefield', abilityLabel: String(ab.label ?? ''), engine: true });
    }
  } else if (mine && oracle) {
    for (const c of zoneCards(mine, 'battlefield')) {
      if (c.hidden === true || c.controller !== me) continue;
      const text = nameOf(c) ? oracle.text(nameOf(c)!) : null;
      if (!hasNonManaActivated(text)) continue;
      if (c.tapped && needsTap(text)) continue;
      out.push({ verb: 'activate', cardId: c.id, zone: 'battlefield', legacy: true });
    }
  }
  return out;
}

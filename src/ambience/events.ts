/*
 * ForgeCoach — ambience/events.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Frame-to-frame changes turned into scenery events: a land entered (which
 * player, biome, slot, the stage it grew to), and the hooks for later effects:
 * a creature entered, an attack was declared, damage was dealt.
 *
 * Land events come from diffing two {@link Scenery} values (robust to any
 * event batching); the others from the state's own §3.6 event batch, which
 * carries ids only. A card is described only when the newer state shows it to
 * the viewer. Pure, DOM-free, and cheap: one pass over the slots and the batch.
 */
import type { AnyCard, GameStateBody } from '../protocol.ts';
import { hasType, parseManaCost, visibleCard } from '../state.ts';
import type { Biome, Scenery } from './model.ts';
import { slotsOf } from './model.ts';

export interface LandEnteredEvent {
  kind: 'land';
  player: number;
  biome: Biome;
  slot: number;
  /** True when this land claimed a new slot. */
  newSlot: boolean;
  prevStage: number;
  stage: number;
  weight: number;
}

export interface CreatureEnteredEvent {
  kind: 'creature';
  player: number;
  cardId: number;
  /** Colour letters from its mana cost (W U B R G); [] for colourless or unknown. */
  colors: string[];
  token: boolean;
}

export interface AttackEvent {
  kind: 'attack';
  player: number;
  attackerIds: number[];
  /** The defending player when the band names one. */
  defender: number | null;
}

export interface DamageDealtEvent {
  kind: 'damage';
  /** The player who took it, or the controller of the card that took it (when visible). */
  player: number | null;
  targetKind: 'player' | 'card';
  targetId: number;
  amount: number;
  combat: boolean;
  sourceCardId: number;
}

export type SceneryEvent = LandEnteredEvent | CreatureEnteredEvent | AttackEvent | DamageDealtEvent;

/** Land events: every slot whose weight rose between two sceneries. */
export function landEvents(prev: Scenery | null, next: Scenery): LandEnteredEvent[] {
  const out: LandEnteredEvent[] = [];
  for (const p of next.players) {
    const before = slotsOf(prev, p.playerId);
    for (const s of p.slots) {
      const b = before.find((x) => x.biome === s.biome);
      if (b && s.weight <= b.weight + 1e-9) continue;
      if (!b && !(s.weight > 0)) continue;
      out.push({
        kind: 'land',
        player: p.playerId,
        biome: s.biome,
        slot: s.index,
        newSlot: !b,
        prevStage: b?.stage ?? 0,
        stage: s.stage,
        weight: s.weight,
      });
    }
  }
  return out;
}

function cardIn(state: GameStateBody, id: number): AnyCard | null {
  for (const p of state.players) for (const c of p.zones.battlefield?.cards ?? []) if (c.id === id) return c;
  return null;
}

function colorsOf(cost: string | null | undefined): string[] {
  const out = new Set<string>();
  for (const s of parseManaCost(cost)) if (s.kind === 'color') for (const c of s.colors) if (/^[WUBRG]$/.test(c)) out.add(c);
  return [...out];
}

/** Creature / attack / damage events from the newer state's event batch. */
export function battleEvents(next: GameStateBody): SceneryEvent[] {
  const out: SceneryEvent[] = [];
  for (const ev of next.events ?? []) {
    if (ev.kind === 'zone') {
      if (ev.to?.zone !== 'battlefield' || ev.from?.zone === 'battlefield') continue;
      const c = visibleCard(cardIn(next, ev.cardId));
      if (!c || c.faceDown || !hasType(c, 'Creature')) continue;
      out.push({ kind: 'creature', player: c.controller ?? ev.to.player ?? -1, cardId: c.id, colors: colorsOf(c.manaCost), token: c.token });
    } else if (ev.kind === 'attackers') {
      for (const band of ev.bands ?? []) {
        if (!band.attackerIds?.length) continue;
        out.push({ kind: 'attack', player: ev.player, attackerIds: [...band.attackerIds], defender: band.defender?.kind === 'player' ? band.defender.id : null });
      }
    } else if (ev.kind === 'damage') {
      if (!(ev.amount > 0)) continue;
      let player: number | null = null;
      if (ev.target.kind === 'player') player = ev.target.id;
      else {
        const c = cardIn(next, ev.target.id);
        player = c?.controller ?? null;
      }
      out.push({ kind: 'damage', player, targetKind: ev.target.kind, targetId: ev.target.id, amount: ev.amount, combat: ev.combat, sourceCardId: ev.sourceCardId });
    }
  }
  return out;
}

/** Everything that happened between two frames, lands first. */
export function sceneryEvents(prev: Scenery | null, next: Scenery, nextState: GameStateBody | null): SceneryEvent[] {
  return [...landEvents(prev, next), ...(nextState ? battleEvents(nextState) : [])];
}

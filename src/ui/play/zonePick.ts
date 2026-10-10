/*
 * ForgeCoach — ui/play/zonePick.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Choices the board does not draw. Forge's targeting (`TargetSelection` →
 * `InputSelectTargets`) asks for a card in a graveyard, in exile or in a
 * library the same way it asks for a creature: an `input` whose
 * `selectable.cardIds` lists the legal ids, with `openZones` as a hint of
 * which zone panels to open (mtg-table protocol §4, §4.3). The board draws
 * only battlefields and your hand, so without this a "return target card
 * from your graveyard" trigger outlines nothing and looks like it never
 * happened (the first two-person game: "it never popped up").
 *
 * Pure: which selectable ids have no tile on the board, where each one is,
 * and how many the engine already counts as chosen (M65 `selectable.chosen`
 * when the frame carries it, else `input.highlighted`, which
 * `InputSelectTargets.addTarget` sets). No rules: the engine judges
 * every click (§4.1); this only makes sure there is something to click.
 *
 * Only what the redacted state carries: an id that is not in this frame
 * (a library card the seat may not see, §4) is offered as a card back with
 * no name — a click on it is the engine's to judge, and it names nothing.
 */
import type { AnyCard, GameStateBody, InputBody } from '../../protocol.ts';
import { chosenOf, isHidden } from '../../protocol.ts';
import type { InputMode } from './inputView.ts';

export type PickZone = 'graveyard' | 'exile' | 'library' | 'command' | 'stack' | 'hand' | 'unknown';

export interface OffBoardPick {
  id: number;
  /** The card as the state carries it; null when the frame does not have it. */
  card: AnyCard | null;
  zone: PickZone;
  /** The owner of the zone (null for the stack or an unknown id). */
  owner: number | null;
  /** The engine counts it as chosen already (`input.highlighted`). */
  chosen: boolean;
}

export interface ZonePick {
  picks: OffBoardPick[];
  /** Zones to name in the heading, in order: "Your graveyard", "Forge AI's exile". */
  zones: { zone: PickZone; owner: number | null }[];
  /** Every selectable id the engine counts as chosen, on the board or off it. */
  chosenCount: number;
  min: number;
  max: number;
}

/** Modes where a selectable set is a live question, not a transient leftover (Forge updates the prompt and the set in separate frames). */
const PICKING = new Set<InputMode>(['target', 'discard', 'other']);

/**
 * Where a card is on the board this seat sees: battlefield (any player) and
 * the viewer's own hand are drawn as tiles; everything else is not.
 */
function locate(state: GameStateBody, id: number): { card: AnyCard; zone: PickZone | 'battlefield'; owner: number | null; drawn: boolean } | null {
  for (const p of state.players) {
    for (const [zone, z] of Object.entries(p.zones) as [string, { cards: AnyCard[] }][]) {
      const card = z.cards.find((c) => c.id === id);
      if (!card) continue;
      if (zone === 'battlefield') return { card, zone: 'battlefield', owner: p.id, drawn: true };
      if (zone === 'hand') return { card, zone: 'hand', owner: p.id, drawn: false };
      return { card, zone: zone as PickZone, owner: p.id, drawn: false };
    }
  }
  const s = (state.stackCards ?? []).find((c) => c.id === id);
  if (s) return { card: s, zone: 'stack', owner: null, drawn: false };
  return null;
}

/**
 * The selectable cards that need a picker because the board has no tile for
 * them. Your own hand counts as drawn (the hand dock), unless `handDrawn` is
 * false (a phone with the hand folded still opens it — inputView `handNeeded`).
 */
export function zonePick(input: InputBody | null, state: GameStateBody | null, seat: number | null, mode: InputMode): ZonePick | null {
  if (!input || !state || !PICKING.has(mode)) return null;
  const sel = input.selectable;
  if (sel.mode !== 'cards' || sel.cardIds.length === 0) return null;
  const highlighted = new Set(chosenOf(input)?.cardIds ?? input.highlighted ?? []);
  const picks: OffBoardPick[] = [];
  for (const id of sel.cardIds) {
    const at = locate(state, id);
    if (at?.drawn) continue;
    if (at && at.zone === 'hand' && at.owner === seat) continue;
    picks.push({
      id,
      card: at?.card ?? null,
      zone: at ? (at.zone as PickZone) : 'unknown',
      owner: at?.owner ?? null,
      chosen: highlighted.has(id),
    });
  }
  if (picks.length === 0) return null;
  const zones: ZonePick['zones'] = [];
  for (const p of picks) if (!zones.some((z) => z.zone === p.zone && z.owner === p.owner)) zones.push({ zone: p.zone, owner: p.owner });
  return {
    picks,
    zones,
    chosenCount: sel.cardIds.filter((id) => highlighted.has(id)).length,
    min: sel.min,
    max: sel.max,
  };
}

const ZONE_WORD: Record<PickZone, string> = {
  graveyard: 'graveyard',
  exile: 'exile',
  library: 'library',
  command: 'command zone',
  stack: 'the stack',
  hand: 'hand',
  unknown: 'a hidden zone',
};

/** "your graveyard", "Forge AI’s exile", "the stack". */
export function zoneWords(zone: PickZone, owner: number | null, seat: number | null, state: GameStateBody | null): string {
  if (zone === 'stack' || zone === 'unknown' || owner === null) return ZONE_WORD[zone];
  const who = owner === seat ? 'your' : `${state?.players.find((p) => p.id === owner)?.name ?? 'the opponent'}’s`;
  return `${who} ${ZONE_WORD[zone]}`;
}

/** The heading: "Choose from your graveyard", "Choose from your graveyard and exile". */
export function zonePickTitle(pick: ZonePick, seat: number | null, state: GameStateBody | null): string {
  const words = pick.zones.map((z) => zoneWords(z.zone, z.owner, seat, state));
  const joined = words.length <= 1 ? (words[0] ?? 'a zone') : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
  return `Choose from ${joined}`;
}

/** "Choose 1", "Choose up to 2", "Choose 1–3"; null when the engine sent no numbers. */
export function pickCountWords(min: number, max: number): string | null {
  if (max <= 0) return null;
  if (min === max) return `Choose ${max}`;
  if (min <= 0) return `Choose up to ${max}`;
  return `Choose ${min}–${max}`;
}

/** A card the picker may name: never a concealed one. */
export function pickName(card: AnyCard | null): string | null {
  if (!card || isHidden(card)) return null;
  return card.name || null;
}

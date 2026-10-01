/*
 * ForgeCoach — cards.ts  (CONTRACT STUB — the cards agent replaces the bodies)
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
export interface CardFace {
  name: string;
  manaCost: string;
  typeLine: string;
  oracleText: string;
  power?: string;
  toughness?: string;
  loyalty?: string;
  image?: CardImages;
}
export interface CardImages {
  small?: string;
  normal?: string;
  large?: string;
  artCrop?: string;
}
export interface CardInfo {
  /** The name we asked for (Forge's spelling). */
  name: string;
  /** False when Scryfall had no match; the other fields are then empty. */
  found: boolean;
  manaCost: string;
  typeLine: string;
  /** Full oracle text; for multi-face cards, the faces joined with "\n//\n". */
  oracleText: string;
  power?: string;
  toughness?: string;
  loyalty?: string;
  /** Scryfall produced_mana, e.g. ["U","B"]. Empty when it makes no mana. */
  producedMana: string[];
  colors: string[];
  image?: CardImages;
  faces?: CardFace[];
  scryfallUri?: string;
}

/** Fetch (or read from cache) every name; never rejects for unknown names. */
export async function getCards(_names: string[], _opts?: { signal?: AbortSignal }): Promise<Map<string, CardInfo>> {
  throw new Error('not implemented');
}

/** Synchronous cache read, for render paths. */
export function getCachedCard(_name: string): CardInfo | undefined {
  return undefined;
}

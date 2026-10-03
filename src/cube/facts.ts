/*
 * ForgeCoach — cube/facts.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * What a cube card IS, for scoring and deckbuilding: colours, mana value,
 * pips, types, what mana it makes. From Scryfall (cards.ts) when that has the
 * card, else from the cube-lab meta's card list, else from what the document
 * implies (its section's colour; mana value unknown). Pure functions.
 */
import type { CardInfo } from '../cards.ts';
import { manaValueOf, pipsOf, producesOf, wubrg, type Colour } from './colors.ts';
import type { CubeCard } from './parseCube.ts';
import type { MetaCubeCard } from './meta.ts';

export interface CardFacts {
  name: string;
  /** The card's colours, WUBRG order; '' for colourless cards and for lands. */
  colors: string;
  /** Mana value (0 for lands). */
  mv: number;
  pips: Partial<Record<Colour, number>>;
  manaCost: string;
  typeLine: string;
  land: boolean;
  creature: boolean;
  planeswalker: boolean;
  instant: boolean;
  sorcery: boolean;
  artifact: boolean;
  enchantment: boolean;
  power: number | null;
  toughness: number | null;
  /** Colours this card can make or fetch, WUBRG order. */
  produces: string;
  /** A nonland card that makes or fetches two or more colours (Prism, Birds, Sakura-Tribe Elder). */
  fixer: boolean;
  oracle: string;
  /** Where the facts came from: 'scryfall', 'meta', or 'doc' (the document only: mana value is a guess). */
  source: 'scryfall' | 'meta' | 'doc';
}

const num = (s: string | undefined): number | null => (s !== undefined && /^\d+$/.test(s) ? Number(s) : null);

function typeFlags(typeLine: string) {
  const first = typeLine.split(' // ')[0] ?? typeLine;
  return {
    land: /\bLand\b/.test(first) && !/\bCreature\b/.test(first),
    creature: /\bCreature\b/.test(first),
    planeswalker: /\bPlaneswalker\b/.test(first),
    instant: /\bInstant\b/.test(first),
    sorcery: /\bSorcery\b/.test(first),
    artifact: /\bArtifact\b/.test(first),
    enchantment: /\bEnchantment\b/.test(first),
  };
}

/** Facts for one cube card from whatever is known about it. */
export function cardFacts(card: CubeCard, info?: CardInfo | null, meta?: MetaCubeCard | null): CardFacts {
  if (info?.found) {
    const flags = typeFlags(info.typeLine);
    const land = flags.land || card.land;
    const manaCost = info.manaCost.split(' // ')[0] ?? '';
    const produces = producesOf(info.oracleText, info.producedMana);
    return {
      name: card.name,
      colors: land ? '' : wubrg(info.colors.length ? info.colors : card.colorHint),
      mv: land ? 0 : manaValueOf(manaCost),
      pips: land ? {} : pipsOf(manaCost),
      manaCost,
      typeLine: info.typeLine,
      ...flags,
      land,
      power: num(info.power),
      toughness: num(info.toughness),
      produces,
      fixer: !land && produces.length >= 2,
      oracle: info.oracleText,
      source: 'scryfall',
    };
  }
  if (meta) {
    const types = Array.isArray(meta.types) ? meta.types.join(' ') : (meta.types ?? '');
    const flags = typeFlags(types);
    const land = flags.land || card.land;
    const colors = wubrg(Array.isArray(meta.colors) ? meta.colors : (meta.colors ?? card.colorHint));
    const pips: Partial<Record<Colour, number>> = {};
    for (const c of colors) pips[c as Colour] = 1;
    return {
      name: card.name,
      colors: land ? '' : colors,
      mv: land ? 0 : (meta.mv ?? 3),
      pips: land ? {} : pips,
      manaCost: '',
      typeLine: types,
      ...flags,
      land,
      power: null,
      toughness: null,
      produces: '',
      fixer: false,
      oracle: '',
      source: 'meta',
    };
  }
  const pips: Partial<Record<Colour, number>> = {};
  for (const c of card.colorHint) pips[c as Colour] = 1;
  return {
    name: card.name,
    colors: card.land ? '' : card.colorHint,
    mv: card.land ? 0 : 3,
    pips: card.land ? {} : pips,
    manaCost: '',
    typeLine: card.land ? 'Land' : '',
    land: card.land,
    creature: false,
    planeswalker: false,
    instant: false,
    sorcery: false,
    artifact: false,
    enchantment: false,
    power: null,
    toughness: null,
    produces: '',
    fixer: false,
    oracle: '',
    source: 'doc',
  };
}

/** Is every colour of this card in `allowed`? Colourless always is. */
export function castableIn(f: Pick<CardFacts, 'colors'>, allowed: string): boolean {
  for (const c of f.colors) if (!allowed.includes(c)) return false;
  return true;
}

/** The one colour outside `pair` this card needs, if it needs exactly one and at most one pip of it. */
export function splashColourOf(f: Pick<CardFacts, 'colors' | 'pips'>, pair: string): string | null {
  const off = [...f.colors].filter((c) => !pair.includes(c));
  if (off.length !== 1) return null;
  const s = off[0] as Colour;
  return (f.pips[s] ?? 1) <= 1 ? s : null;
}

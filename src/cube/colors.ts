/*
 * ForgeCoach — cube/colors.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Colour helpers shared by the cube modules: WUBRG order, the ten pairs,
 * guild and shard names, basic land names, mana costs to pips and mana value.
 */

export const COLOURS = ['W', 'U', 'B', 'R', 'G'] as const;
export type Colour = (typeof COLOURS)[number];

export const COLOUR_NAME: Record<Colour, string> = { W: 'White', U: 'Blue', B: 'Black', R: 'Red', G: 'Green' };
export const BASIC_OF: Record<Colour, string> = { W: 'Plains', U: 'Island', B: 'Swamp', R: 'Mountain', G: 'Forest' };
export const BASIC_NAMES = new Set(Object.values(BASIC_OF));
const BASIC_TYPE_COLOUR: Record<string, Colour> = { Plains: 'W', Island: 'U', Swamp: 'B', Mountain: 'R', Forest: 'G' };

/** Letters of `s` that are colours, unique, in WUBRG order. */
export function wubrg(s: Iterable<string>): string {
  const set = new Set(s);
  return COLOURS.filter((c) => set.has(c)).join('');
}

/** The ten two-colour pairs, WUBRG-ordered. */
export function colourPairs(): string[] {
  const out: string[] = [];
  for (let i = 0; i < 5; i++) for (let k = i + 1; k < 5; k++) out.push(`${COLOURS[i]}${COLOURS[k]}`);
  return out;
}

/** Guild, shard and wedge names, keyed by WUBRG colours. */
export const GUILD: Record<string, string> = {
  WU: 'Azorius', UB: 'Dimir', BR: 'Rakdos', RG: 'Gruul', WG: 'Selesnya',
  WB: 'Orzhov', UR: 'Izzet', BG: 'Golgari', WR: 'Boros', UG: 'Simic',
  WUG: 'Bant', WUB: 'Esper', UBR: 'Grixis', BRG: 'Jund', WRG: 'Naya',
  WBG: 'Abzan', WUR: 'Jeskai', UBG: 'Sultai', WBR: 'Mardu', URG: 'Temur',
};
const GUILD_COLOURS: Record<string, string> = Object.fromEntries(Object.entries(GUILD).map(([k, v]) => [v.toLowerCase(), k]));

/** Colours of a guild/shard/wedge word ("Rakdos" → "BR"), or null. */
export function guildColours(word: string): string | null {
  return GUILD_COLOURS[word.toLowerCase()] ?? null;
}

/** "BR" → "Rakdos"; "B" → "Mono-Black"; "" → "Colorless". */
export function colourLabel(colors: string): string {
  if (!colors) return 'Colorless';
  if (colors.length === 1) return `Mono-${COLOUR_NAME[colors as Colour]}`;
  return GUILD[wubrg(colors)] ?? wubrg(colors);
}

/** Every `{…}` symbol of a mana cost, in order (first face only for a split/MDFC cost). */
export function costSymbols(cost: string): string[] {
  const first = cost.split(' // ')[0] ?? '';
  return [...first.matchAll(/\{([^}]+)\}/g)].map((m) => m[1] ?? '');
}

/** Coloured pips of a cost; a hybrid pip counts once for each of its colours. */
export function pipsOf(cost: string): Partial<Record<Colour, number>> {
  const out: Partial<Record<Colour, number>> = {};
  for (const sym of costSymbols(cost)) for (const c of COLOURS) if (sym.includes(c)) out[c] = (out[c] ?? 0) + 1;
  return out;
}

/** Mana value of a (first-face) cost: generic numbers plus one per other symbol; X is 0. */
export function manaValueOf(cost: string): number {
  let mv = 0;
  for (const sym of costSymbols(cost)) {
    if (/^\d+$/.test(sym)) mv += Number(sym);
    else if (sym === 'X' || sym === 'Y' || sym === 'Z') continue;
    else if (/^2\//.test(sym)) mv += 2;
    else mv += 1;
  }
  return mv;
}

/**
 * The colours a card can make or fetch, from its oracle text and Scryfall's
 * produced_mana: every colour of an "Add" clause, all five for "any color",
 * the basic land types a search names (a fetchland), all five for "a basic land".
 */
export function producesOf(oracle: string, produced: string[] = []): string {
  const out = new Set<string>(produced.filter((c) => (COLOURS as readonly string[]).includes(c)));
  for (const m of oracle.matchAll(/search your library for ([^.]*?)cards?\b/gi)) {
    const what = m[1] ?? '';
    if (/basic land/i.test(what)) COLOURS.forEach((c) => out.add(c));
    for (const [t, c] of Object.entries(BASIC_TYPE_COLOUR)) if (new RegExp(`\\b${t}\\b`).test(what)) out.add(c);
  }
  for (const m of oracle.matchAll(/\badd ([^.]*)/gi)) {
    const clause = m[1] ?? '';
    if (/any colou?r/i.test(clause)) COLOURS.forEach((c) => out.add(c));
    for (const s of clause.matchAll(/\{([WUBRG])\}/g)) out.add(s[1] ?? '');
  }
  return wubrg(out);
}

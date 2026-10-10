/*
 * ForgeCoach — draft/deck.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The deck you build after a draft: the pool split into mainboard and
 * sideboard, plus basic lands (free, any number). It starts with the whole
 * pool in the mainboard, as at a real table; "Suggest a build" fills it from
 * the deck assistant's best build (src/cube/builder.ts). Pure and plain JSON,
 * so it is saved with the draft.
 */
import { BASIC_OF, BASIC_NAMES } from '../cube/colors.ts';
import { mainDeck, sideboard, type DeckBuild } from '../cube/builder.ts';
import { safeDeckName, type MatchDeck } from './launch.ts';
import { makeDeckList, type DeckList } from '../cube/deckExport.ts';

export const BASIC_KEYS = ['W', 'U', 'B', 'R', 'G', 'C'] as const;
export type BasicKey = (typeof BASIC_KEYS)[number];
export const BASIC_NAME: Record<BasicKey, string> = { ...BASIC_OF, C: 'Wastes' };
export const MIN_DECK = 40;

export interface DeckState {
  main: string[];
  side: string[];
  basics: Record<BasicKey, number>;
  /** The suggestion last applied, for the side note. */
  suggestion?: { name: string; score: number; reasons: string[] };
}

export const noBasics = (): Record<BasicKey, number> => ({ W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 });

export function initialDeck(pool: string[]): DeckState {
  return { main: pool.filter((n) => !BASIC_NAMES.has(n)), side: [], basics: noBasics() };
}

/** The deck assistant's build, as a deck: its spells and nonbasic lands main, the rest of the pool on the side. */
export function deckFromBuild(b: DeckBuild, pool: string[]): DeckState {
  const main = [...b.spells, ...b.nonbasics];
  const side = [...pool].filter((n) => !BASIC_NAMES.has(n));
  for (const n of main) {
    const i = side.indexOf(n);
    if (i >= 0) side.splice(i, 1);
  }
  const basics = noBasics();
  for (const k of BASIC_KEYS) if (k !== 'C') basics[k] = b.basics[k] ?? 0;
  return { main, side, basics, suggestion: { name: b.name, score: b.score, reasons: b.reasons } };
}

export const basicCount = (d: DeckState) => BASIC_KEYS.reduce((s, k) => s + (d.basics[k] ?? 0), 0);
export const deckCount = (d: DeckState) => d.main.length + basicCount(d);

/** The mainboard as names, basics expanded (for the stacks' LAND column and the stats). */
export function mainNames(d: DeckState): string[] {
  const out = [...d.main];
  for (const k of BASIC_KEYS) for (let i = 0; i < (d.basics[k] ?? 0); i++) out.push(BASIC_NAME[k]);
  return out;
}

/** Move one copy of `name` to the other board. Basics leave the deck instead of going to the side. */
export function moveCard(d: DeckState, name: string, to: 'main' | 'side'): DeckState {
  const basic = (Object.entries(BASIC_NAME) as Array<[BasicKey, string]>).find(([, n]) => n === name)?.[0];
  if (basic) return to === 'side' ? setBasic(d, basic, (d.basics[basic] ?? 0) - 1) : d;
  const from = to === 'main' ? d.side : d.main;
  const i = from.indexOf(name);
  if (i < 0) return d;
  const rest = [...from.slice(0, i), ...from.slice(i + 1)];
  return to === 'main' ? { ...d, side: rest, main: [...d.main, name] } : { ...d, main: rest, side: [...d.side, name] };
}

export function setBasic(d: DeckState, k: BasicKey, n: number): DeckState {
  return { ...d, basics: { ...d.basics, [k]: Math.max(0, Math.min(40, Math.round(n))) } };
}

function counted(names: string[]): Array<[number, string]> {
  const m = new Map<string, number>();
  for (const n of names) m.set(n, (m.get(n) ?? 0) + 1);
  return [...m.entries()].map(([n, c]) => [c, n]);
}

/** The match launcher's deck shape. */
export function toMatchDeck(name: string, d: DeckState): MatchDeck {
  return { name: safeDeckName(name), main: counted(mainNames(d)), sideboard: counted(d.side) };
}

/** A build plus its pool as the launcher's deck shape (the AI's deck: named by its archetype). */
export function matchDeck(name: string, b: DeckBuild, pool: string[]): MatchDeck {
  return { name: safeDeckName(name), main: mainDeck(b), sideboard: counted(sideboard(b, pool)) };
}

/**
 * A launcher deck the engine can load, for a cube whose document lists cards
 * Forge has no script for yet (cube/parseCube.ts `forgeMissing`): those cards
 * leave the sideboard (the launcher refuses a deck that names one anywhere);
 * any in the main deck are named in `blocked` for the player to take out.
 * The export (`exportList`) keeps everything, for other games.
 */
export function forForge(d: MatchDeck, missing: Iterable<string> | undefined): { deck: MatchDeck; blocked: string[] } {
  const out = new Set(missing ?? []);
  const deck: MatchDeck = d.sideboard ? { ...d, sideboard: capSideboard(d.sideboard.filter(([, n]) => !out.has(n))) } : d;
  return { deck, blocked: d.main.filter(([, n]) => out.has(n)).map(([, n]) => n) };
}

/**
 * Forge plays a match as Constructed, whose sideboard holds at most 15 cards:
 * between games it refuses any deck that leaves more than that beside it and
 * asks again, forever (a drafted pool's leftovers are often 40 or more). So
 * the engine gets the first 15 copies; the export keeps the whole pool.
 */
export const FORGE_SIDEBOARD_MAX = 15;

function capSideboard(side: Array<[number, string]>): Array<[number, string]> {
  let left = FORGE_SIDEBOARD_MAX;
  const out: Array<[number, string]> = [];
  for (const [n, name] of side) {
    if (left <= 0) break;
    const k = Math.min(n, left);
    out.push([k, name]);
    left -= k;
  }
  return out;
}

/** This player's deck as the shared export's deck (cube/deckExport.ts): exactly the deck on screen, its sideboard the rest of the pool. */
export function exportList(name: string, d: DeckState): DeckList {
  return makeDeckList(name, counted(mainNames(d)), counted(d.side));
}

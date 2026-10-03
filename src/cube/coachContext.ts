/*
 * ForgeCoach — cube/coachContext.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The "Cube context" section of the coach and review prompts: what the cube
 * lab's meta.json says about the archetype the player's deck most resembles,
 * the opponent's archetype when its public deck NAME gives it away, the key
 * cards the player holds, the typical land count, and how much to trust it.
 *
 * Hidden-information rule: only the viewing seat's own visible cards and the
 * AI deck's public name are read. The opponent's zones are never touched.
 * DOM-free; the meta lookup is injected (loadCubeCoachInput).
 */
import type { GameLog } from '../log.ts';
import { isHidden, seatMatchOf, type AnyCard, type Card, type GameStateBody } from '../protocol.ts';
import { cubeOfDeck } from '../history/record.ts';
import { CUBES, cubeInfo, type CubeInfo } from './cubes.ts';
import { wubrg } from './colors.ts';
import { aiFlag } from './metaView.ts';
import type { CubeMeta, MetaArchetype } from './meta.ts';

/** What the prompt builders need: the cube and its meta (null when none could be loaded). */
export interface CubeCoachInput {
  cubeId: string;
  title?: string;
  meta: CubeMeta | null;
}

/** Fewer games than this behind an archetype and the numbers are not shown. */
export const MIN_ARCHETYPE_GAMES = 10;
/** Hard cap on the section, in characters (about 25 lines of the longest kind it writes). */
export const CUBE_SECTION_MAX_CHARS = 1500;
export const CUBE_SECTION_MAX_LINES = 25;
const MIN_CARDS_SEEN = 4;
const MAX_KEY_CARDS = 5;

const pct = (x: number) => `${Math.round(x * 100)}%`;

/** The cube this game was played with, from the deck's name or path; null when it names none. */
export function cubeIdOfLog(log: GameLog): string | null {
  const mine = log.hello ? seatMatchOf(log.hello, log.seat) : null;
  const path = log.header.decks?.find((d) => d.player === log.seat)?.path ?? log.hello?.match?.yourDeck?.path;
  return cubeOfDeck(mine?.deck, path);
}

/** The AI deck's public name (never its contents), or null. */
export function opponentDeckName(log: GameLog): string | null {
  const opp = log.hello?.players.find((p) => p.id !== log.seat);
  return log.hello && opp ? (seatMatchOf(log.hello, opp.id)?.deck ?? null) : null;
}

/** Names of the viewing seat's own visible, non-token cards in the states up to `upTo` (a frame index). */
export function ownCardNames(log: GameLog, upTo = Infinity): Set<string> {
  const out = new Set<string>();
  const add = (c: AnyCard) => {
    if (isHidden(c)) return;
    const k = c as Card;
    if (k.token || k.faceDown || !k.name) return;
    out.add(k.name);
  };
  for (let i = 0; i < log.frames.length && i <= upTo; i++) {
    const f = log.frames[i]!;
    if (f.type !== 'state' || (f.dir ?? 's2c') !== 's2c') continue;
    const me = (f.body as GameStateBody).players.find((p) => p.id === log.seat);
    if (!me) continue;
    for (const z of ['hand', 'battlefield', 'graveyard', 'exile', 'command'] as const) me.zones[z]?.cards.forEach(add);
  }
  return out;
}

const colorsOf = (c: { colors?: string | string[] } | undefined): string[] => (c?.colors ? [...(Array.isArray(c.colors) ? c.colors.join('') : c.colors)].filter((x) => 'WUBRG'.includes(x)) : []);

/** The archetype the cards most resemble: its colours, then key-card and sample-deck overlap, then games. */
export function closestArchetype(meta: CubeMeta, names: Set<string>): MetaArchetype | null {
  const cube = new Map((meta.cube.cards ?? []).map((c) => [c.name, c]));
  const counts = new Map<string, number>();
  let nonland = 0;
  for (const n of names) {
    const c = cube.get(n);
    if (!c) continue;
    const types = Array.isArray(c.types) ? c.types.join(' ') : (c.types ?? '');
    if (/\bLand\b/.test(types)) continue;
    nonland++;
    for (const col of colorsOf(c)) counts.set(col, (counts.get(col) ?? 0) + 1);
  }
  if (nonland < MIN_CARDS_SEEN) return null;
  const floor = Math.max(2, Math.ceil(nonland * 0.2));
  const cols = [...counts].filter(([, n]) => n >= floor).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  if (!cols.length) return null;
  const tries = [cols.map(([c]) => c).join('')];
  if (cols.length > 2) tries.push(cols.slice(0, 2).map(([c]) => c).join(''));
  for (const t of tries) {
    const cands = meta.archetypes.filter((a) => a.colors === wubrg(t));
    if (!cands.length) continue;
    const score = (a: MetaArchetype) => {
      const key = (a.keyCards ?? []).filter((k) => names.has(k)).length;
      const seen = new Set<string>();
      for (const d of a.sampleDecks ?? []) for (const k of d) if (names.has(k)) seen.add(k);
      return key * 2 + seen.size;
    };
    return [...cands].sort((a, b) => score(b) - score(a) || (b.games ?? 0) - (a.games ?? 0) || a.id.localeCompare(b.id))[0] ?? null;
  }
  return null;
}

/** An archetype whose id the AI deck's name states ("AI Drafter - WU-ETB"), else null. Never inferred from cards. */
export function archetypeNamedIn(meta: CubeMeta, deckName: string | null): MetaArchetype | null {
  if (!deckName) return null;
  const hit = meta.archetypes.filter((a) => new RegExp(`(^|[^A-Za-z-])${a.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^A-Za-z-])`, 'i').test(deckName));
  return hit.sort((a, b) => b.id.length - a.id.length)[0] ?? null;
}

/** Win rate shrunk toward the lab's mean, with the lab's own prior when it states one. */
function shrunkRate(a: MetaArchetype, meta: CubeMeta): number | null {
  if (typeof a.winRate !== 'number' || !a.games) return null;
  const sh = (meta.sample as { shrinkage?: { mean?: number; strength?: number } } | undefined)?.shrinkage;
  const mean = typeof sh?.mean === 'number' ? sh.mean : 0.5;
  const k = typeof sh?.strength === 'number' ? sh.strength : 20;
  return (a.winRate * a.games + k * mean) / (a.games + k);
}

function rateText(a: MetaArchetype, meta: CubeMeta): string {
  const r = shrunkRate(a, meta);
  return `shrunk win rate ${r === null ? '?' : pct(r)}${a.ci ? ` (95% interval ${pct(a.ci[0])}–${pct(a.ci[1])})` : ''} over ${a.games ?? 0} games`;
}

const aiUnreliable = (meta: CubeMeta, name: string) => aiFlag(meta.cards[name] as Record<string, unknown> | undefined, (meta.cube.cards ?? []).find((c) => c.name === name) as unknown as Record<string, unknown> | undefined);

/**
 * The section, or null when the game is not a cube game. `upTo` limits which
 * frames count as "cards you have" (a per-decision prompt passes its frame).
 */
export function buildCubeContext(log: GameLog, input: CubeCoachInput | undefined, upTo = Infinity): string | null {
  if (!input) return null;
  const title = input.title ?? cubeInfo(input.cubeId)?.title ?? input.cubeId;
  const head = `# Cube context — ${title}`;
  const meta = input.meta;
  if (!meta) return `${head}\nCube lab data is thin or missing for this cube: no archetype numbers to go on.`;
  const names = ownCardNames(log, upTo);
  const arch = closestArchetype(meta, names);
  if (!arch || (arch.games ?? 0) < MIN_ARCHETYPE_GAMES) {
    const why = arch ? `its closest archetype (${arch.id}) has only ${arch.games ?? 0} games` : 'the deck is not yet clear enough to match an archetype';
    return `${head}\nCube lab data is thin here (${why}); treat any cube-wide numbers as weak evidence.`;
  }
  const lines: string[] = [head];
  lines.push(`Your deck most resembles ${arch.id}: ${rateText(arch, meta)}.`);
  const opp = archetypeNamedIn(meta, opponentDeckName(log));
  if (opp) lines.push(opp.games && opp.games >= MIN_ARCHETYPE_GAMES ? `Opponent's deck is named ${opp.id}: ${rateText(opp, meta)}.` : `Opponent's deck is named ${opp.id}: too few lab games to quote.`);
  const keys = (arch.keyCards ?? []).filter((k) => names.has(k)).slice(0, MAX_KEY_CARDS);
  if (keys.length) {
    const bits = keys.map((k) => {
      const s = meta.cards[k];
      const rate = typeof s?.winRateShrunk === 'number' ? `${pct(s.winRateShrunk)} in ${s.games ?? '?'}g` : 'no rate';
      return `${k} ${aiUnreliable(meta, k) ? `${rate}, AI stats unreliable` : rate}`;
    });
    lines.push(`Key ${arch.id} cards you have (shrunk win rate): ${bits.join('; ')}.`);
  }
  const flagged = [...names].filter((n) => !keys.includes(n) && aiUnreliable(meta, n)).sort().slice(0, 3);
  if (flagged.length) lines.push(`Forge's AI plays these poorly, so their lab stats are unreliable: ${flagged.join(', ')}.`);
  if (typeof arch.avgLands === 'number') lines.push(`Typical land count for ${arch.id}: ${Math.round(arch.avgLands)} (average ${Math.round(arch.avgLands * 10) / 10}).`);
  const total = meta.sample?.games;
  lines.push(`These numbers come from AI-vs-AI Forge games (${total ?? 'N'} in this cube's sample, ${arch.games} behind ${arch.id}); small samples are weak evidence.`);
  return capSection(lines);
}

/** At most CUBE_SECTION_MAX_LINES lines and CUBE_SECTION_MAX_CHARS characters; the caveat (last line) always stays. */
export function capSection(lines: string[], maxChars = CUBE_SECTION_MAX_CHARS, maxLines = CUBE_SECTION_MAX_LINES): string {
  const ls = lines.map((l) => (l.length > 400 ? `${l.slice(0, 399)}…` : l));
  const last = ls[ls.length - 1]!;
  let body = ls.slice(0, -1).slice(0, maxLines - 1);
  const join = () => [...body, last].join('\n');
  while (join().length > maxChars && body.length > 1) body = body.slice(0, -1);
  const out = join();
  return out.length > maxChars ? `${out.slice(0, maxChars - 1)}…` : out;
}

// ---------------------------------------------------------------------------
// Loading (the UI injects the two lookups; tests inject fakes)

export interface MetaLookups {
  imported: (cubeId: string) => Promise<CubeMeta | null>;
  shipped: (info: CubeInfo) => Promise<CubeMeta | null>;
}

/** The cube input for a log, or undefined when the game is not a cube game. An imported meta wins over the shipped one. */
export async function loadCubeCoachInput(log: GameLog, lookups: MetaLookups): Promise<CubeCoachInput | undefined> {
  const id = cubeIdOfLog(log);
  const info = id ? CUBES.find((c) => c.id === id) : undefined;
  if (!id || !info) return undefined;
  let meta: CubeMeta | null = null;
  try {
    meta = (await lookups.imported(id)) ?? (await lookups.shipped(info));
  } catch {
    meta = null;
  }
  return { cubeId: id, title: info.title, meta };
}

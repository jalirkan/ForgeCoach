/*
 * ForgeCoach — scripts/human-cards/stats.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The pure half of the human-card generator (cli.ts): one pass over 17Lands'
 * public game data (`game_data_public.<set>.<event>.csv.gz`, one row per game,
 * with `won` and per card `opening_hand_<name>`, `drawn_<name>`,
 * `tutored_<name>`, `deck_<name>` counts) into per-card games and wins, then
 * one compact file per covered cube (src/cube/human.ts's schema 1).
 *
 * Counted as in mtg-table's tools/ml/cards17l.py (D396), which followed
 * 17Lands' own definitions: a card counts in a game when it is in the deck;
 * GIH when it was in the opening hand or drawn (tutored alone does not count);
 * OH when in the opening hand; GNS when in the deck and neither in the opening
 * hand, drawn nor tutored. Rows whose `won` is not True/False are skipped.
 * Only counts leave this file: no draft ids, ranks or anything about a player.
 */
import { HUMAN_SCHEMA, normName, type HumanCardCounts, type HumanCards, type HumanSource } from '../../src/cube/human.ts';

/** Splits one CSV line (RFC 4180 quotes; no embedded newlines in 17Lands' files). */
export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (q) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else q = false;
      } else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

export interface Counts {
  gp: number;
  gpW: number;
  gih: number;
  gihW: number;
  oh: number;
  ohW: number;
  gns: number;
  gnsW: number;
}

export interface GameStats {
  games: number;
  wins: number;
  badRows: number;
  /** With a half: games left out because their draft is in the other half, or has no draft id. */
  otherHalf: number;
  noDraftId: number;
  events: Record<string, number>;
  cards: Map<string, Counts>;
}

/** 32-bit FNV-1a over a string's UTF-8 bytes. */
export function fnv1a32(s: string): number {
  let h = 0x811c9dc5;
  for (const b of new TextEncoder().encode(s)) {
    h ^= b;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Which half a draft's games go to (docs/human-blend.md): FNV-1a-32(draft_id) & 1. */
export const halfOf = (draftId: string): 0 | 1 => (fnv1a32(draftId) & 1) as 0 | 1;

const blank = (): Counts => ({ gp: 0, gpW: 0, gih: 0, gihW: 0, oh: 0, ohW: 0, gns: 0, gnsW: 0 });
const some = (v: string | undefined) => v !== undefined && v !== '' && v !== '0' && v !== '0.0';

/**
 * A streaming accumulator over one or more files' rows (each file starts with `header`).
 * With `half` (0 or 1) only the games of drafts in that half count (`halfOf`), so the
 * two halves split the data by draft; games with no draft id go to neither.
 */
export class GameCounter {
  readonly stats: GameStats = { games: 0, wins: 0, badRows: 0, otherHalf: 0, noDraftId: 0, events: {}, cards: new Map() };
  private draft = -1;
  constructor(readonly half: 0 | 1 | null = null) {}
  private cols: Array<{ c: Counts; deck: number; oh?: number; drawn?: number; tutored?: number }> = [];
  private won = -1;
  private event = -1;
  private width = 0;

  header(cells: string[]): void {
    const ix = new Map(cells.map((c, i) => [c, i]));
    const won = ix.get('won');
    if (won === undefined) throw new Error('not a 17Lands game-data file: no `won` column');
    this.won = won;
    this.event = ix.get('event_type') ?? -1;
    this.draft = ix.get('draft_id') ?? -1;
    if (this.half !== null && this.draft < 0) throw new Error('splitting by half needs a `draft_id` column');
    this.width = cells.length;
    this.cols = [];
    for (const c of cells) {
      if (!c.startsWith('deck_')) continue;
      const name = c.slice('deck_'.length);
      let counts = this.stats.cards.get(name);
      if (!counts) this.stats.cards.set(name, (counts = blank()));
      this.cols.push({ c: counts, deck: ix.get(c)!, oh: ix.get(`opening_hand_${name}`), drawn: ix.get(`drawn_${name}`), tutored: ix.get(`tutored_${name}`) });
    }
  }

  row(cells: string[]): void {
    const s = this.stats;
    const w = cells[this.won];
    if (cells.length !== this.width || (w !== 'True' && w !== 'False')) {
      s.badRows++;
      return;
    }
    if (this.half !== null) {
      const id = cells[this.draft] ?? '';
      if (!id) {
        s.noDraftId++;
        return;
      }
      if (halfOf(id) !== this.half) {
        s.otherHalf++;
        return;
      }
    }
    const won = w === 'True' ? 1 : 0;
    s.games++;
    s.wins += won;
    const ev = this.event >= 0 ? cells[this.event]! : '';
    s.events[ev] = (s.events[ev] ?? 0) + 1;
    for (const col of this.cols) {
      if (!some(cells[col.deck])) continue;
      const c = col.c;
      c.gp++;
      c.gpW += won;
      const oh = col.oh !== undefined && some(cells[col.oh]);
      const dr = col.drawn !== undefined && some(cells[col.drawn]);
      const tu = col.tutored !== undefined && some(cells[col.tutored]);
      if (oh || dr) {
        c.gih++;
        c.gihW += won;
      }
      if (oh) {
        c.oh++;
        c.ohW += won;
      }
      if (!(oh || dr || tu)) {
        c.gns++;
        c.gnsW += won;
      }
    }
  }
}

/** Default: the D396 compared set's threshold. */
export const MIN_GIH = 500;
/**
 * A cube gets a file only when at least this share of its cards has numbers:
 * the data then describes a cube of the same kind. 17Lands' cube is Arena's
 * Powered Cube; an unpowered cube that shares half its cards (Omega, Modern-Era
 * at 55–60%) is a different environment, where a card's win rate amid Moxen
 * and cheat decks would mislead.
 */
export const MIN_COVERAGE = 0.75;

export interface Coverage {
  file: string;
  title: string;
  cards: number;
  /** Cube cards whose name is in 17Lands' data at all. */
  inData: number;
  /** … with at least minGih games in hand. */
  matched: number;
}

/** Matches a cube's card names against the data (front face, normalised) and counts. */
export function coverage(stats: GameStats, cube: { file: string; title: string; names: string[] }, minGih = MIN_GIH): { cov: Coverage; cards: Record<string, HumanCardCounts> } {
  const byKey = new Map<string, Counts>();
  for (const [n, c] of stats.cards) if (!byKey.has(normName(n))) byKey.set(normName(n), c);
  const names = [...new Set(cube.names)];
  const cards: Record<string, HumanCardCounts> = {};
  let inData = 0;
  for (const n of names) {
    const c = byKey.get(normName(n));
    if (!c) continue;
    inData++;
    if (c.gih < minGih) continue;
    cards[n] = { gih: c.gih, gihW: c.gihW, oh: c.oh, ohW: c.ohW, gns: c.gns, gnsW: c.gnsW };
  }
  return { cov: { file: cube.file, title: cube.title, cards: names.length, inData, matched: Object.keys(cards).length }, cards };
}

/** The committed file for one cube. */
export function humanFile(stats: GameStats, cube: { file: string; title: string; names: string[] }, source: HumanSource, generated: string, minGih = MIN_GIH): HumanCards {
  const { cov, cards } = coverage(stats, cube, minGih);
  let gih = 0;
  let gihW = 0;
  for (const c of stats.cards.values()) {
    gih += c.gih;
    gihW += c.gihW;
  }
  const sorted: Record<string, HumanCardCounts> = {};
  for (const k of Object.keys(cards).sort((a, b) => a.localeCompare(b, 'en'))) sorted[k] = cards[k]!;
  return {
    schema: HUMAN_SCHEMA,
    source,
    generated,
    cube: { file: cube.file, title: cube.title, cards: cov.cards, matched: cov.matched },
    minGih,
    games: stats.games,
    wins: stats.wins,
    gih: { games: gih, wins: gihW },
    cards: sorted,
  };
}

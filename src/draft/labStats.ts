/*
 * ForgeCoach — draft/labStats.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The cube lab's numbers for one card on offer, made honest for the pick
 * screen's "Lab numbers" panel. Pure and DOM-free.
 *
 * WHAT IS SHOWN, only when the meta has it:
 *  - how the lab's drafters took it: `early.picks / early.of` when the lab
 *    writes it (see LAB_FIELDS_WANTED; not in schema 1 yet), else the average
 *    pick index and how often it was taken when seen (`pickRate`);
 *  - how often it made the final 40 when picked (`inDecks / picked`);
 *  - its decks' win rate with a 95% Wilson interval from `wins / games` (the
 *    decisive games of decks that ran it) and the game count.
 *
 * HONESTY.
 *  - Every number is Forge-vs-Forge: the lab's AI drafted, built and played
 *    both seats. It measures the card in Forge's hands, not in a person's.
 *  - A card is called strong (weak) only when its whole interval lies above
 *    (below) 0.5. An interval that includes 0.5 says nothing either way.
 *  - The colour baseline sits beside the rate: the win rate of the lab's decks
 *    playing each of the card's colours (`colorBaselines` when the lab writes
 *    it, else summed from the meta's archetypes). Red decks win 53–55% in the
 *    lab, so its card test over-flags red cards as a group: a red card "above
 *    0.5" may only be riding its colour. The panel says so.
 */
import type { CubeMeta, MetaCardStats } from '../cube/meta.ts';
import { wilson } from '../bench/benchStats.ts';

/** Fields the panel would use if the lab's meta.json carried them (schema-1 additions; see the PR). */
export const LAB_FIELDS_WANTED = {
  'cards.<name>.early': '{ "picks": int, "of": int, "window": string } — drafts where the card was taken within the window (e.g. "first 3 picks of a pack/pile") out of the drafts where it was seen in that window',
  colorBaselines: '{ "W"|"U"|"B"|"R"|"G"|"C": { "games": int, "wins": int } } — decisive games of decks whose main colours include that colour (C: colourless-only decks)',
} as const;

export interface Rate {
  k: number;
  n: number;
  p: number;
  lo: number;
  hi: number;
}

export type LabVerdict = 'strong' | 'weak' | 'unclear';

export interface ColourBaseline {
  colour: string;
  games: number;
  wins: number;
  p: number;
  /** Where it came from: the lab's own field, or summed from its archetypes. */
  from: 'lab' | 'archetypes';
}

export interface LabCardView {
  name: string;
  /** Picked early (only when the lab writes `early`). */
  early: (Rate & { window: string }) | null;
  /** Average pick index (1 = first), when present. */
  avgPick: number | null;
  /** Taken when seen. */
  taken: { picked: number; seen: number; p: number } | null;
  /** Made the final 40 when picked. */
  inDeck: { inDecks: number; picked: number; p: number } | null;
  /** Its decks' win rate, Wilson 95%. */
  win: Rate | null;
  verdict: LabVerdict;
  baselines: ColourBaseline[];
  /** The card is red: the red over-flag note applies. */
  red: boolean;
  /** Why the deck numbers are hidden, when they are (see `deckNumbersHidden`). */
  hidden: string | null;
}

const num = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null);
const count = (x: unknown): number | null => {
  const n = num(x);
  return n !== null && n >= 0 ? Math.round(n) : null;
};

/** A Wilson 95% rate, or null without games. */
export function rateOf(k: number, n: number): Rate | null {
  if (!(n > 0) || k < 0 || k > n) return null;
  const w = wilson(k, n);
  return w ? { k, n, p: k / n, lo: w.lo, hi: w.hi } : null;
}

/** Strong / weak only when the interval excludes 0.5. */
export function verdictOf(r: Pick<Rate, 'lo' | 'hi'> | null): LabVerdict {
  if (!r) return 'unclear';
  if (r.lo > 0.5) return 'strong';
  if (r.hi < 0.5) return 'weak';
  return 'unclear';
}

const COLOURS = ['W', 'U', 'B', 'R', 'G'] as const;

/** Per-colour deck win rates: the lab's `colorBaselines` when present, else summed over the archetypes containing each colour. */
export function colourBaselines(meta: CubeMeta | null): Map<string, ColourBaseline> {
  const out = new Map<string, ColourBaseline>();
  if (!meta) return out;
  const lab: unknown = meta.colorBaselines;
  if (lab && typeof lab === 'object' && !Array.isArray(lab)) {
    for (const [c, v] of Object.entries(lab as Record<string, unknown>)) {
      if (!/^[WUBRGC]$/.test(c) || !v || typeof v !== 'object') continue;
      const games = count((v as Record<string, unknown>).games);
      const wins = count((v as Record<string, unknown>).wins);
      if (games && wins !== null && wins <= games) out.set(c, { colour: c, games, wins, p: wins / games, from: 'lab' });
    }
    if (out.size) return out;
  }
  for (const c of COLOURS) {
    let games = 0;
    let wins = 0;
    for (const a of meta.archetypes) {
      const g = count(a.games);
      const w = num(a.winRate);
      if (!g || w === null || w < 0 || w > 1 || !a.colors.includes(c)) continue;
      games += g;
      wins += w * g;
    }
    if (games > 0) out.set(c, { colour: c, games, wins: Math.round(wins), p: wins / games, from: 'archetypes' });
  }
  return out;
}

function earlyOf(s: MetaCardStats): LabCardView['early'] {
  const e = (s as unknown as { early?: unknown }).early;
  if (!e || typeof e !== 'object') return null;
  const o = e as Record<string, unknown>;
  const k = count(o.picks);
  const n = count(o.of);
  if (k === null || n === null) return null;
  const r = rateOf(k, n);
  return r ? { ...r, window: typeof o.window === 'string' ? o.window.slice(0, 60) : 'early' } : null;
}

/** The panel's view of one card; null when the meta says nothing about it. `colors` is the card's colours (WUBRG letters, '' colourless). */
/**
 * A suspicious zero is hidden, not shown. The lab's meta writer (mtg-table
 * tools/cubelab/meta.ts) counts only a played deck's NONLAND cards for
 * `inDecks`, `games` and `wins`, so every land reads "0 of N in the 40" and has
 * no games: a recording gap, not a 0%. A nonland card picked more than
 * SUSPECT_PICKS times and never in a deck is hidden too until that is checked.
 */
export const SUSPECT_PICKS = 10;
export const LAND_HIDDEN = 'The lab’s meta counts only nonland cards in decks, so a land’s deck numbers are not recorded.';
export const ZERO_HIDDEN = 'Never in a deck though picked often: likely a gap in how the lab records decks, so the deck numbers are hidden.';

export function deckNumbersHidden(s: MetaCardStats, land: boolean): string | null {
  if (land) return LAND_HIDDEN;
  const picked = count(s.picked);
  const inDecks = count(s.inDecks);
  if (inDecks === 0 && picked !== null && picked > SUSPECT_PICKS) return ZERO_HIDDEN;
  return null;
}

export function labCardView(
  meta: CubeMeta | null,
  name: string,
  colors: string,
  baselines: Map<string, ColourBaseline> = colourBaselines(meta),
  opts: { land?: boolean } = {},
): LabCardView | null {
  const s = meta?.cards[name];
  if (!s) return null;
  const picked = count(s.picked);
  const seen = count(s.seen);
  const inDecks = count(s.inDecks);
  const games = count(s.games);
  const wins = count(s.wins);
  const avg = num(s.avgPickIndex);
  const hidden = deckNumbersHidden(s, opts.land === true);
  const win = !hidden && games !== null && wins !== null ? rateOf(wins, games) : null;
  const view: LabCardView = {
    name,
    early: earlyOf(s),
    avgPick: avg !== null && avg > 0 ? avg : null,
    taken: picked !== null && seen ? (picked <= seen ? { picked, seen, p: picked / seen } : null) : null,
    inDeck: !hidden && inDecks !== null && picked ? (inDecks <= picked ? { inDecks, picked, p: inDecks / picked } : null) : null,
    win,
    verdict: verdictOf(win),
    baselines: [...colors]
      .filter((c) => COLOURS.includes(c as (typeof COLOURS)[number]))
      .map((c) => baselines.get(c))
      .filter((b): b is ColourBaseline => !!b),
    red: colors.includes('R'),
    hidden,
  };
  if (!view.early && view.avgPick === null && !view.taken && !view.inDeck && !view.win) return null;
  return view;
}

// ---------------------------------------------------------------------------
// Words

export const pc = (p: number) => `${Math.round(p * 100)}%`;

export const VERDICT_WORDS: Record<LabVerdict, string> = {
  strong: 'strong in the lab: the interval is above 50%',
  weak: 'weak in the lab: the interval is below 50%',
  unclear: 'neither strong nor weak: the interval includes 50%',
};

export const FORGE_CAVEAT = 'Forge-vs-Forge games: these measure the card in Forge’s hands (its drafting, building and play), not in yours.';
export const RED_NOTE = 'The lab’s card test currently over-flags red cards as a group (across its recent runs red decks won 53–55%): compare a red card with the red baseline beside it, not with 50%.';

/** "41% of decks · 12 of 29 games won · 95% 25–59%" style line for the win rate. */
export function winLine(r: Rate): string {
  return `${pc(r.p)} (95% ${Math.round(r.lo * 100)}–${Math.round(r.hi * 100)}%) over ${r.n} game${r.n === 1 ? '' : 's'}`;
}

export function baselineLine(b: ColourBaseline): string {
  return `${b.colour} decks ${pc(b.p)} over ${b.games} game${b.games === 1 ? '' : 's'}`;
}

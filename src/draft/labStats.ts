/*
 * ForgeCoach — draft/labStats.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The cube lab's numbers for one card on offer, made honest for the pick
 * screen's "Lab numbers" panel. Pure and DOM-free.
 *
 * WHAT IS SHOWN, only when the meta has it:
 *  - how the lab's drafters took it: `early.picks / early.of` when the lab
 *    writes it (see LAB_FIELDS_WANTED; not in schema 1 yet), else how often
 *    it was taken when seen, and the average pick index except in a Grid
 *    meta (a Grid card is taken about when it shows up, so every card's
 *    average sits near the middle and says little: J075 has 23–30 for all);
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
 *    it, else summed from the meta's archetypes). When one colour's decks win
 *    clearly away from 50% (its interval excludes 0.5), a card of that colour
 *    "above 0.5" may only be riding its colour: the panel names the colour
 *    furthest from 50% (`colourSkew`), computed from the meta, never fixed.
 *  - "Small sample" is said only for cards with fewer than SMALL_SAMPLE_GAMES
 *    games (`smallSampleNote`).
 *  - Lab strength (the matchup model, card-power.json): points per copy with a
 *    95% interval from the posterior SD; strong (weak) only when the interval is
 *    clear of 0 (`powerVerdict`). A card Forge's AI never builds is "not rated",
 *    never given a number (`powerRow`); lands get no row.
 */
import type { CubeMeta, MetaCardStats } from '../cube/meta.ts';
import { nightsLabel, pointsLine, signed, type CardPowerData } from '../cube/cardPower.ts';

export { pointsLine, signed };
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

/**
 * A suspicious zero is hidden, not shown. Metas written before mtg-table D380
 * counted only a played deck's NONLAND cards for `inDecks`, `games` and `wins`,
 * so a land there reads "0 of N in the 40" with no games: a recording gap, not a
 * 0%. From D380 on lands are counted (`landsCounted`: some land in the meta has
 * decks), so a land's numbers show, and a land never built is judged like any
 * other card. A card picked more than SUSPECT_PICKS times and never built is a
 * real zero (D380: the lab's deckbuilder leaves low-rated cards out), but its
 * deck numbers describe Forge's builder more than the card, so they stay hidden.
 */
export const SUSPECT_PICKS = 10;
export const LAND_HIDDEN = 'This meta predates the lab counting lands in decks, so a land’s deck numbers are not recorded.';
export const ZERO_HIDDEN = 'Picked often but never built: the lab’s deckbuilder leaves it out on its rating, so its deck numbers say more about Forge’s builder than the card.';

export function deckNumbersHidden(s: MetaCardStats, land: boolean, landsCounted = false): string | null {
  const picked = count(s.picked);
  const inDecks = count(s.inDecks);
  if (land && !landsCounted && !(inDecks !== null && inDecks > 0)) return LAND_HIDDEN;
  if (inDecks === 0 && picked !== null && picked > SUSPECT_PICKS) return ZERO_HIDDEN;
  return null;
}

const landsCountedCache = new WeakMap<CubeMeta, boolean>();
/** Whether the meta counts lands in decks (D380 on): some land in its cube list was built at least once. */
export function landsCounted(meta: CubeMeta): boolean {
  let v = landsCountedCache.get(meta);
  if (v === undefined) {
    v = (meta.cube?.cards ?? []).some((c) => {
      const types = Array.isArray(c.types) ? c.types.join(' ') : (c.types ?? '');
      const n = count(meta.cards[c.name]?.inDecks);
      return /\bLand\b/.test(types) && n !== null && n > 0;
    });
    landsCountedCache.set(meta, v);
  }
  return v;
}

/** The panel's view of one card; null when the meta says nothing about it. `colors` is the card's colours (WUBRG letters, '' colourless). */
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
  const avg = meta?.sample?.format === 'grid' ? null : num(s.avgPickIndex);
  const hidden = deckNumbersHidden(s, opts.land === true, landsCounted(meta!));
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

/** A count with thousands separators: 5167 → "5,167". */
export const fmt = (n: number) => Math.round(n).toLocaleString('en-US');

const COLOUR_NAMES: Record<string, string> = { W: 'White', U: 'Blue', B: 'Black', R: 'Red', G: 'Green', C: 'Colourless' };

/** The colour whose decks' win rate is furthest from 50%, with its Wilson 95% interval; null when that interval includes 50% (or there are no baselines). */
export function colourSkew(baselines: Map<string, ColourBaseline>): (ColourBaseline & { rate: Rate }) | null {
  let best: (ColourBaseline & { rate: Rate }) | null = null;
  for (const b of baselines.values()) {
    const rate = rateOf(b.wins, b.games);
    if (!rate) continue;
    if (!best || Math.abs(rate.p - 0.5) > Math.abs(best.rate.p - 0.5)) best = { ...b, rate };
  }
  return best && verdictOf(best.rate) !== 'unclear' ? best : null;
}

/** The panel's colour note, from `colourSkew`. */
export function colourNote(s: ColourBaseline & { rate: Rate }): string {
  const name = COLOUR_NAMES[s.colour] ?? s.colour;
  const side = s.rate.p > 0.5 ? 'above' : 'below';
  return `In this cube’s lab, ${name} decks won ${winLine(s.rate)}, clearly ${side} 50%: a ${name.toLowerCase()} card’s rate partly reflects its colour, so compare a card with its colour baseline beside it, not with 50%.`;
}

/** Below this many games a card's win rate is called a small sample. */
export const SMALL_SAMPLE_GAMES = 100;

/** The footer's sample sentence: names the cards with fewer than SMALL_SAMPLE_GAMES games, else null (the Forge-vs-Forge caveat stands alone). */
export function smallSampleNote(views: ReadonlyArray<LabCardView | null>): string | null {
  const small = views.filter((v): v is LabCardView => !!v?.win && v.win.n < SMALL_SAMPLE_GAMES).map((v) => v.name);
  if (!small.length) return null;
  return `Small sample${small.length === 1 ? '' : 's'}: ${small.join(', ')} ${small.length === 1 ? 'has' : 'have'} fewer than ${SMALL_SAMPLE_GAMES} games, so read ${small.length === 1 ? 'its' : 'their'} interval${small.length === 1 ? '' : 's'}, not the rate.`;
}

/** "41% (95% 25–59%) over 1,229 games" style line for the win rate. */
export function winLine(r: Rate): string {
  return `${pc(r.p)} (95% ${Math.round(r.lo * 100)}–${Math.round(r.hi * 100)}%) over ${fmt(r.n)} game${r.n === 1 ? '' : 's'}`;
}

export function baselineLine(b: ColourBaseline): string {
  return `${b.colour} decks ${pc(b.p)} over ${fmt(b.games)} game${b.games === 1 ? '' : 's'}`;
}

// ---------------------------------------------------------------------------
// The matchup model's card strength (cube/cardPower.ts, mtg-table J062 M0)

/** One card's lab strength for the panel: points per copy with a 95% interval, or why there is none. */
export interface PowerView {
  /** Win-rate points per copy at even odds, against the average nonland card. */
  points: number;
  lo: number;
  hi: number;
  games: number;
  verdict: LabVerdict;
  /** Forge's AI builds it only sometimes (AI:RemoveDeck:Random): rated, with a note. */
  random: boolean;
}

export type PowerRow = { kind: 'rated'; view: PowerView } | { kind: 'unrated' } | null;

/** Strong / weak only when the 95% interval of the points excludes 0. */
export function powerVerdict(lo: number, hi: number): LabVerdict {
  if (lo > 0) return 'strong';
  if (hi < 0) return 'weak';
  return 'unclear';
}

/**
 * The panel's lab-strength row for a card: rated (points, 95% interval, verdict),
 * unrated (Forge's AI never builds it: the model's number is only its feature
 * prior, never shown), or null (no data, or a land: power is measured against
 * the average nonland card).
 */
export function powerRow(data: CardPowerData | null, name: string, land: boolean): PowerRow {
  const c = data?.cards.get(name);
  if (!data || !c || land || c.land) return null;
  if (c.unrated || c.power === null || c.sd === null) return { kind: 'unrated' };
  const k = data.pointsPerLogit;
  const lo = k * (c.power - 1.96 * c.sd);
  const hi = k * (c.power + 1.96 * c.sd);
  return { kind: 'rated', view: { points: k * c.power, lo, hi, games: c.games, verdict: powerVerdict(lo, hi), random: c.ai === 'random' } };
}

export const POWER_VERDICT_WORDS: Record<LabVerdict, string> = {
  strong: 'stronger than the average card: the interval is above 0',
  weak: 'weaker than the average card: the interval is below 0',
  unclear: 'not shown stronger or weaker: the interval includes 0',
};

export const UNRATED_WORDS = 'Not rated: Forge’s AI never builds this card (AI:RemoveDeck:All), so the lab has no games of it to rate.';
export const RANDOM_WORDS = 'Forge’s AI builds it only some of the time (AI:RemoveDeck:Random).';

/** The panel's footnote for the lab-strength row. */
export function powerNote(data: CardPowerData): string {
  return `Lab strength = the lab’s matchup model (${data.source.job}, ${nightsLabel(data)}, ${fmt(data.source.games)} games): a card’s own effect per copy on its deck’s win chance, in win-rate points at even odds against the average nonland card of the lab’s cubes, with a 95% interval. It credits the card, not the deck it sat in, so it predicts held-out games better than the win rates above.`;
}

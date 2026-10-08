/*
 * ForgeCoach — cube/labTrust.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * How far to trust the cube lab's (Forge-vs-Forge) number for a kind of card:
 * docs/human-blend.md part 2 B. The lab's card win rates were compared with
 * 17Lands' human win rates (GIH WR) on the Vintage cube, where both draft the
 * same cards, band by band (type, mana value, colourless): Spearman rho with a
 * 95% bootstrap interval. The table below is that run's output
 * (`npm run human-blend -- agree DIR`), committed; the page computes nothing
 * about it and calls no model.
 *
 * Levels from the interval (fixed before the run): fair when its lower end is
 * at least 0.3, rough when above 0 but under 0.3, shaky when it reaches 0. A
 * band with fewer than MIN_BAND cards has no level: a card in one is
 * "untested" for it (the run's 5+ drops, 19 cards, and colourless, 12 — a
 * deviation recorded in the doc: the pre-registration said such a band is not
 * used, which would have let a 6-drop borrow its type's "fair"). A card takes
 * the weakest level among the bands it is in, untested lowest (ties: mana
 * value, then colourless, then type). Lands get none.
 */
import type { CardFacts } from './facts.ts';
import { metaValue, usesHumanData, type CubeContext } from './score.ts';

export type TrustBand = 'all' | 'creature' | 'noncreature' | 'mv2' | 'mv34' | 'mv5' | 'colourless';
export type TrustLevel = 'fair' | 'rough' | 'shaky' | 'untested';

export interface BandAgreement {
  band: TrustBand;
  /** Nonland Vintage cards with both a human row and lab games. */
  n: number;
  rho: number;
  lo: number;
  hi: number;
}

/** A band needs this many cards for a level (docs/human-blend.md part 2 B); under it, "untested". */
export const MIN_BAND = 20;

/** The run of 2026-10-08 (Vintage: shipped meta against the shipped 17Lands file). */
export const LAB_AGREEMENT: readonly BandAgreement[] = [
  { band: 'all', n: 131, rho: 0.477, lo: 0.34, hi: 0.599 },
  { band: 'creature', n: 57, rho: 0.583, lo: 0.394, hi: 0.719 },
  { band: 'noncreature', n: 74, rho: 0.364, lo: 0.139, hi: 0.558 },
  { band: 'mv2', n: 66, rho: 0.539, lo: 0.328, hi: 0.705 },
  { band: 'mv34', n: 46, rho: 0.562, lo: 0.305, hi: 0.746 },
  { band: 'mv5', n: 19, rho: 0.204, lo: -0.321, hi: 0.642 },
  { band: 'colourless', n: 12, rho: -0.084, lo: -0.591, hi: 0.507 },
];

/** The plain words for a band, as the label ends: "shaky for 5+ drops". */
export const BAND_WORDS: Record<TrustBand, string> = {
  all: 'cards in general',
  creature: 'creatures',
  noncreature: 'noncreature spells',
  mv2: 'cards costing 2 or less',
  mv34: '3–4 drops',
  mv5: '5+ drops',
  colourless: 'colourless cards',
};

export const LEVEL_WORDS: Record<TrustLevel, string> = { fair: 'a fair guide', rough: 'a rough guide', shaky: 'shaky', untested: 'untested' };

export function levelOf(a: Pick<BandAgreement, 'lo' | 'n'>): TrustLevel {
  if (a.n < MIN_BAND) return 'untested';
  if (a.lo >= 0.3) return 'fair';
  if (a.lo > 0) return 'rough';
  return 'shaky';
}

/** The bands a nonland card is in, in tie-break order (mana value, colourless, type); [] for a land. */
export function bandsOf(f: Pick<CardFacts, 'land' | 'creature' | 'mv' | 'colors'>): TrustBand[] {
  if (f.land) return [];
  const out: TrustBand[] = [f.mv <= 2 ? 'mv2' : f.mv <= 4 ? 'mv34' : 'mv5'];
  if (!f.colors) out.push('colourless');
  out.push(f.creature ? 'creature' : 'noncreature');
  return out;
}

export interface LabTrust {
  level: TrustLevel;
  band: TrustBand;
  agreement: BandAgreement;
}

const LEVEL_RANK: Record<TrustLevel, number> = { untested: -1, shaky: 0, rough: 1, fair: 2 };

/** The label for one card, or null (a land, no facts, or no band in the table). `table` is injectable for tests. */
export function labTrust(f: Pick<CardFacts, 'land' | 'creature' | 'mv' | 'colors'> | null | undefined, table: readonly BandAgreement[] = LAB_AGREEMENT): LabTrust | null {
  if (!f) return null;
  let best: LabTrust | null = null;
  for (const band of bandsOf(f)) {
    const a = table.find((r) => r.band === band);
    if (!a) continue;
    const level = levelOf(a);
    if (!best || LEVEL_RANK[level] < LEVEL_RANK[best.level]) best = { level, band, agreement: a };
  }
  return best;
}

const r2 = (x: number) => (x < 0 ? '−' : '') + Math.abs(x).toFixed(2);

/** "Lab number: shaky for 5+ drops" */
export function labTrustLine(t: LabTrust): string {
  return `Lab number: ${LEVEL_WORDS[t.level]} for ${BAND_WORDS[t.band]}`;
}

/** The measurement behind it, for a tooltip or a small line. */
export function labTrustDetail(t: LabTrust): string {
  const a = t.agreement;
  if (t.level === 'untested') return `Only ${a.n} Vintage cube ${BAND_WORDS[t.band]} have both lab and human (17Lands) numbers: too few to say how well Forge’s win rates for them agree with human players’.`;
  return `On the Vintage cube, Forge’s win rates for ${BAND_WORDS[t.band]} agree with human players’ (17Lands) at ρ ${r2(a.rho)} [${r2(a.lo)}, ${r2(a.hi)}], ${a.n} cards.`;
}

/**
 * The label for a cube card whose value rests on the lab: it has lab games in the cube's meta and its value
 * does not use human data (a card with human numbers is valued by them). Null otherwise.
 */
export function labTrustFor(name: string, ctx: CubeContext): LabTrust | null {
  if (!metaValue(name, ctx) || usesHumanData(name, ctx)) return null;
  return labTrust(ctx.facts.get(name));
}

/**
 * A note for advice over several cards (grid line, Winston pile, booster pack): the lab-valued cards whose
 * label is not "a fair guide", grouped by label — "Lab number: untested for 5+ drops (Wurmcoil Engine);
 * a rough guide for noncreature spells (Opt, Counterspell)." Null when every lab-valued card is fair, or none is lab-valued.
 */
export function labTrustNote(names: Iterable<string>, ctx: CubeContext): string | null {
  const groups = new Map<string, { t: LabTrust; names: string[] }>();
  for (const n of new Set(names)) {
    const t = labTrustFor(n, ctx);
    if (!t || t.level === 'fair') continue;
    const key = `${t.level}|${t.band}`;
    const g = groups.get(key) ?? { t, names: [] };
    g.names.push(n);
    groups.set(key, g);
  }
  if (!groups.size) return null;
  const parts = [...groups.values()]
    .sort((a, b) => LEVEL_RANK[a.t.level] - LEVEL_RANK[b.t.level])
    .map((g) => `${LEVEL_WORDS[g.t.level]} for ${BAND_WORDS[g.t.band]} (${g.names.join(', ')})`);
  return `Lab number: ${parts.join('; ')}.`;
}

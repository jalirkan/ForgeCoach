/*
 * ForgeCoach — cube/guides/lab.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The cube lab's numbers for a guide, read from meta.json at runtime (never
 * written into a guide): the best archetype by shrunk win rate with its
 * sample size, the land-count split, and each guide archetype's own record.
 * Every number comes with the caveat that these are Forge AIs playing each
 * other, in small samples.
 */
import type { CubeMeta } from '../meta.ts';
import { archetypeRows, pct, shrinkage, shrinkRate, type ArchetypeRow } from '../metaView.ts';
import type { GuideArchetype } from './types.ts';

/** Fewer lab games than this and a number is "too few to read". */
export const LAB_MIN_GAMES = 10;

export interface GuideLab {
  /** One or two facts, plain sentences. */
  facts: string[];
  caveat: string;
}

const p0 = (x: number) => pct(x, 0);

/** The best lab archetype by shrunk win rate, among those with enough games. */
export function topArchetype(meta: CubeMeta, docThemes?: Record<string, string>): ArchetypeRow | null {
  const rows = archetypeRows(meta, docThemes).filter((r) => r.games >= LAB_MIN_GAMES && typeof r.win === 'number');
  rows.sort((a, b) => (b.win ?? 0) - (a.win ?? 0) || b.games - a.games || a.id.localeCompare(b.id));
  return rows[0] ?? null;
}

/** One or two facts from a cube's meta.json for its guide, or null without one. */
export function guideLabFacts(meta: CubeMeta | null, docThemes?: Record<string, string>): GuideLab | null {
  if (!meta || meta.archetypes.length === 0) return null;
  const facts: string[] = [];
  const top = topArchetype(meta, docThemes);
  if (top) {
    facts.push(
      `Best archetype in the lab: ${top.name} (${top.id}), ${p0(top.win ?? 0)} win rate after shrinking toward the mean, over ${top.games} games from ${top.decks} deck${top.decks === 1 ? '' : 's'}${top.ci ? ` (raw 95% interval ${p0(top.ci[0])}–${p0(top.ci[1])})` : ''}.`,
    );
  } else {
    const most = archetypeRows(meta, docThemes).sort((a, b) => b.games - a.games)[0];
    if (most) facts.push(`No archetype has ${LAB_MIN_GAMES} lab games yet; the most played is ${most.name}, with ${most.games}.`);
  }
  const lands = Object.entries(meta.lands?.overall ?? {})
    .filter(([, s]) => typeof s?.games === 'number' && s.games >= LAB_MIN_GAMES && typeof s.winRate === 'number')
    .sort((a, b) => Number(a[0]) - Number(b[0]));
  if (lands.length >= 2) facts.push(`Land counts: ${lands.map(([n, s]) => `${n} lands won ${p0(s.winRate)} of ${s.games} games`).join(', ')}.`);
  else if (meta.splash && typeof meta.splash.games === 'number' && meta.splash.games >= LAB_MIN_GAMES && typeof meta.splash.winRate === 'number')
    facts.push(`Decks that splashed a third colour won ${p0(meta.splash.winRate)} of ${meta.splash.games} games.`);
  if (!facts.length) return null;
  const s = meta.sample;
  const size = [typeof s?.games === 'number' ? `${s.games} games` : null, typeof s?.drafts === 'number' ? `${s.drafts} drafts` : null].filter(Boolean).join(' from ');
  return {
    facts,
    caveat: `From the cube lab${size ? `: ${size}` : ''} of Forge AIs drafting and playing each other. Samples are small and Forge is not you, so treat these as hints.`,
  };
}

function rowFits(r: ArchetypeRow, lab: NonNullable<GuideArchetype['lab']>): boolean {
  if (lab.colors && ![...lab.colors].every((c) => r.colors.includes(c))) return false;
  if (lab.themes?.length) return !!r.theme && lab.themes.includes(r.theme);
  return true;
}

export interface ArchetypeLab {
  ids: string[];
  games: number;
  /** Shrunk win rate over all the matching rows' games; null when they have none. */
  win: number | null;
  thin: boolean;
  text: string;
}

/** A guide archetype's record in the lab: the matching lab archetypes' games pooled and shrunk. */
export function archetypeLab(meta: CubeMeta | null, a: GuideArchetype, docThemes?: Record<string, string>): ArchetypeLab | null {
  if (!meta || !a.lab) return null;
  const lab = a.lab;
  const rows = archetypeRows(meta, docThemes).filter((r) => rowFits(r, lab));
  if (!rows.length) return null;
  const games = rows.reduce((t, r) => t + r.games, 0);
  const wins = rows.reduce((t, r) => t + (r.winRaw ?? 0) * r.games, 0);
  const prior = shrinkage(meta);
  const win = games > 0 ? shrinkRate(wins / games, games, prior.strength, prior.mean ?? 0.5) : null;
  const ids = rows.sort((x, y) => y.games - x.games).map((r) => r.id);
  const thin = games < LAB_MIN_GAMES;
  const shown = ids.slice(0, 3).join(', ') + (ids.length > 3 ? '…' : '');
  const text = thin
    ? `Lab: ${shown}, only ${games} game${games === 1 ? '' : 's'}: too few to read.`
    : `Lab: ${shown}, ${games} games, ${p0(win ?? 0)} win rate (shrunk toward the mean).`;
  return { ids, games, win, thin, text };
}

/*
 * ForgeCoach — draft/blueNote.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Two lines of words from mtg-table's lab result J111 (blueJ111.ts). Pure,
 * deterministic, no model calls, and nothing here feeds a score, a rating or
 * the AI drafter: a per-colour correction of the lab's numbers failed its
 * pre-registered test (docs/human-blend.md part 3), so only the words ship.
 *
 *  - `blueOverdraftLine`: the cube lab's AI drafter (the same one Draft vs AI
 *    drafts against) puts blue in far more of its decks than the cube's colour
 *    balance predicts, so other colours tend to be open. Only for the cubes
 *    J111 covered: Evan's cube (evybaby) was not in it, so it gets nothing.
 *  - `blueCaveat`: wherever a blue colour baseline or a blue pair's lab win
 *    rate shows, blue's rate is held down by Forge's play with blue (at equal
 *    deck quality, every J111 cube), not by the cards; 17Lands' human data has
 *    blue cards middling, and two drafters fighting over blue had no effect.
 */
import { BLUE_J111, type BlueStats } from './blueJ111.ts';

/** J111's numbers for a cube, or null when J111 did not cover it. */
export function blueStatsFor(cubeId: string | null | undefined): BlueStats | null {
  return (cubeId && Object.prototype.hasOwnProperty.call(BLUE_J111, cubeId) ? BLUE_J111[cubeId] : null) ?? null;
}

const pc = (p: number) => `${Math.round(p * 100)}%`;
const times = (x: number) => `${x.toFixed(1)}×`;

/** Draft vs AI's line: the AI drafter over-drafts blue. Null for a cube J111 did not cover. */
export function blueOverdraftLine(cubeId: string | null | undefined): string | null {
  const s = blueStatsFor(cubeId);
  if (!s) return null;
  return `The AI drafter over-drafts blue: in this cube’s lab, ${pc(s.deckShare)} of its decks played blue, ${times(s.overFactor)} the ${pc(s.expectedShare)} the cube’s colour balance predicts, so other colours tend to be open.`;
}

/** Does a colour string (WUBRG letters, an archetype id like "UR", a pair key like "WU+B") include blue? */
export const hasBlue = (colors: string | null | undefined): boolean => !!colors && /U/.test(colors.toUpperCase().replace(/[^WUBRGC]/g, ''));

/** The caveat beside a blue colour baseline or blue pair's lab win rate. Null when nothing blue shows or J111 did not cover the cube. */
export function blueCaveat(cubeId: string | null | undefined, colors: string | null | undefined): string | null {
  const s = blueStatsFor(cubeId);
  if (!s || !hasBlue(colors)) return null;
  return `Blue’s lab win rate is held down by Forge’s play with blue, not by the cards: at equal deck quality its blue decks won ${pc(s.equalQualityWin)} (95% ${Math.round(s.equalQualityLo * 100)}–${Math.round(s.equalQualityHi * 100)}%) in this cube’s lab. Human players don’t see this.`;
}

/** Where the lines come from, for a title attribute. */
export const BLUE_SOURCE = 'Cube lab result J111 (Forge-vs-Forge drafts): words only, no number on this page is changed by it.';

/** Does a deck build's "Why this build" show its meta archetype's (colour pair's) lab win rate? Mirrors builder.ts `reasonsFor`. */
export function buildShowsPairRate(metaArchetype: string | null | undefined, archetypes: ReadonlyArray<{ id: string; games?: number; winRate?: number }> | null | undefined): boolean {
  if (!metaArchetype || !archetypes) return false;
  const a = archetypes.find((x) => x.id === metaArchetype);
  return !!a && typeof a.winRate === 'number' && (a.games ?? 0) >= 10;
}

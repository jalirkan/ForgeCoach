/*
 * ForgeCoach — ambience/light.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The light pass (spec 1.13, the cloud's side of COVERAGE.md's linkages): one
 * grade over a player's half of the scenery, from the game rather than the
 * pictures, so no new painting is needed. Pure; the board applies it as a CSS
 * filter and a soft-light tint (SceneryLayer, scenery.css `.scn-lit`).
 *
 * - The game's arc: cool and a little flat on the first turns, warmer and
 *   richer as the game goes on (turn counts player turns, protocol §3.1; the
 *   arc is done by `ARC_TURNS`).
 * - Low life: at 5 life or less a storm comes over that player's half --
 *   greyer, darker, a cold slate tint -- deepening to 0.
 * - Game over: the winner's half takes a gold glow; the loser's goes to dusk;
 *   a draw dims both a little.
 *
 * The stages are painted at their own times of day (dawn to night), so a
 * shared "table hour" across both halves needs each stage's hour from the
 * pack; it is not here until a manifest says it.
 */
import type { GameLog } from '../log.ts';
import type { GameStateBody, OverBody } from '../protocol.ts';

export type LightOutcome = 'won' | 'lost' | 'draw' | null;

export interface LightInput {
  /** The game's turn (player turns, §3.1); 0 or less before the first. */
  turn: number;
  /** This player's life now. */
  life: number;
  /** The game's ending, from this player's side, once it is over at the board's frame. */
  outcome: LightOutcome;
}

export interface LightGrade {
  brightness: number;
  contrast: number;
  saturate: number;
  /** The soft-light tint, as r, g, b (0-255). */
  tint: [number, number, number];
  /** The tint layer's opacity (0-1). */
  tintAlpha: number;
}

/** The arc runs from cool to warm over this many player turns (eight rounds). */
export const ARC_TURNS = 16;
/** A storm starts at this life and is full at 0. */
export const STORM_LIFE = 5;

const COOL: [number, number, number] = [110, 150, 205];
const WARM: [number, number, number] = [238, 168, 96];
const STORM: [number, number, number] = [70, 86, 108];
const GOLD: [number, number, number] = [246, 202, 120];
const DUSK: [number, number, number] = [62, 52, 96];

export const NEUTRAL: LightGrade = { brightness: 1, contrast: 1, saturate: 1, tint: [128, 128, 128], tintAlpha: 0 };

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const mix = (a: [number, number, number], b: [number, number, number], t: number): [number, number, number] => [0, 1, 2].map((i) => Math.round(a[i]! + (b[i]! - a[i]!) * t)) as [number, number, number];
const r3 = (x: number) => Math.round(x * 1000) / 1000;

/** How far through the arc a turn is (0 at the first turn, 1 from `ARC_TURNS` on). */
export function arcOf(turn: number): number {
  return clamp01((turn - 1) / (ARC_TURNS - 1));
}

/** How stormy a life total is (0 above `STORM_LIFE`, 1 at 0 or less). */
export function stormOf(life: number): number {
  return life > STORM_LIFE ? 0 : clamp01((STORM_LIFE + 1 - life) / (STORM_LIFE + 1));
}

/** The grade for one player's half. */
export function gradeFor(i: LightInput): LightGrade {
  const p = arcOf(i.turn);
  let brightness = 1;
  let contrast = 0.96 + 0.1 * p;
  let saturate = 0.94 + 0.12 * p;
  let tint = mix(COOL, WARM, p);
  let tintAlpha = 0.14;

  const s = i.outcome ? 0 : stormOf(i.life);
  if (s > 0) {
    saturate *= 1 - 0.5 * s;
    brightness *= 1 - 0.2 * s;
    contrast *= 1 + 0.1 * s;
    tint = mix(tint, STORM, s);
    tintAlpha = Math.max(tintAlpha, 0.34 * s);
  }

  if (i.outcome === 'won') {
    brightness *= 1.06;
    saturate *= 1.08;
    tint = GOLD;
    tintAlpha = 0.22;
  } else if (i.outcome === 'lost') {
    brightness *= 0.8;
    saturate *= 0.6;
    tint = DUSK;
    tintAlpha = 0.3;
  } else if (i.outcome === 'draw') {
    brightness *= 0.9;
    saturate *= 0.8;
    tint = DUSK;
    tintAlpha = 0.18;
  }
  return { brightness: r3(brightness), contrast: r3(contrast), saturate: r3(saturate), tint, tintAlpha: r3(tintAlpha) };
}

/** The grade as CSS: the half's `filter` and its tint layer's colour and opacity. */
export function gradeCss(g: LightGrade): { filter: string; tint: string; tintAlpha: string } {
  return {
    filter: `brightness(${g.brightness}) contrast(${g.contrast}) saturate(${g.saturate})`,
    tint: `rgb(${g.tint[0]}, ${g.tint[1]}, ${g.tint[2]})`,
    tintAlpha: String(g.tintAlpha),
  };
}

/** The game's ending as seen by `playerId`, if the log's `over` frame is at or before `frameIndex`; else null. */
export function outcomeAt(log: Pick<GameLog, 'frames'>, frameIndex: number, playerId: number): LightOutcome {
  for (let i = Math.min(frameIndex, log.frames.length - 1); i >= 0; i--) {
    const f = log.frames[i]!;
    if (f.type !== 'over') continue;
    const w = (f.body as OverBody).winner;
    return w === null ? 'draw' : w === playerId ? 'won' : 'lost';
  }
  return null;
}

/** One player's light input from the board's state and the log at the board's frame (null without that player). */
export function lightInputOf(log: Pick<GameLog, 'frames'>, frameIndex: number, state: GameStateBody | null, playerId: number): LightInput | null {
  const p = state?.players.find((x) => x.id === playerId);
  if (!state || !p) return null;
  return { turn: state.turn, life: p.life, outcome: outcomeAt(log, frameIndex, playerId) };
}

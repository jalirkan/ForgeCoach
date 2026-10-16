/*
 * ForgeCoach — watch/choices.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Who drafts and who plays each side of a watch (mtg-table D440), what the
 * form sends as POST /watch, and when it may be sent. DOM-free.
 *
 * What the helper takes today (docs/watch-bots.md; tools/watch-runner.mjs
 * `validateWatch`, which refuses unknown fields with a 400):
 *
 *   {"cube", "seed"?, "games"?: 1|3|5|7, "playerA"?, "playerB"?, "pace"?: 0..5000}
 *
 *   - a player is a Forge AI profile (Default, Cautious, Reckless,
 *     Experimental: a style, never a difficulty, D107) or "search"
 *     (search-v2, the live search seat). The form starts both sides on the
 *     search AI (D414: search-v2 is the default player wherever we pick one);
 *     the route's own default, when nothing is sent, is Default.
 *   - both sides draft with the lab's drafter. The route takes no drafter.
 *
 * D439 gives the cube lab two more drafters (`forge-ranks`, `llm:<model>`),
 * on the command line only. Should the helper come to advertise drafters or
 * players for /watch, the form reads them from /health — `watchDrafters` /
 * `watchPlayers`, lists of D439-style names — and sends `drafterA`/`drafterB`
 * only then. Those names are this file's proposal, not yet in the contract:
 * until a helper sends them the form offers exactly what the route takes, and
 * nothing it would refuse ever goes out.
 *
 * Any Claude choice (an `llm:` name) costs the owner money through his Claude
 * Code login, so it is never a default, it carries a cost note, and Start
 * stays off until the player ticks the confirm box (`canStart`).
 */
import type { WatchSide } from './data.ts';

export interface SeatOption {
  id: string;
  /** The chip's word. */
  label: string;
  /** One line under the chips. */
  blurb: string;
  /** A Claude seat: spends on the owner's Claude Code login. */
  costly?: boolean;
  /** For a costly seat: what it costs, as well as it is known. */
  cost?: string;
}

export const PROFILES = ['Default', 'Cautious', 'Reckless', 'Experimental'] as const;

const PROFILE_BLURB: Record<string, string> = {
  Default: 'Forge’s own AI, balanced play.',
  Cautious: 'Forge’s own AI, preferring defence and card advantage.',
  Reckless: 'Forge’s own AI, aggressive: attacks often.',
  Experimental: 'Forge’s own AI with unpredictable heuristics.',
};

export const SEARCH_PLAYER: SeatOption = {
  id: 'search',
  label: 'Search AI',
  blurb: 'Forge’s Default plus sacrifice play and a look-ahead at its plays, attacks and blocks (search-v2). Thinks 1–3 s a decision, so games run slower.',
};

/** The players the route takes today: the search AI first (the default), then the four profiles. */
export const BASE_PLAYERS: SeatOption[] = [SEARCH_PLAYER, ...PROFILES.map((p) => ({ id: p, label: p, blurb: PROFILE_BLURB[p]! }))];

export const LAB_DRAFTER: SeatOption = {
  id: 'lab',
  label: 'Lab drafter',
  blurb: 'The cube lab’s drafter: lab ratings, the cube’s themes, two colours a third of the way in.',
};

/** D439's Claude models, with the one measured cost (a Haiku draft) and the list-price estimate for the others. */
const LLM_MODELS: Record<string, { label: string; draft: string }> = {
  haiku: { label: 'Haiku 5.5', draft: 'about $0.015 a draft (measured once, 18 calls)' },
  sonnet: { label: 'Sonnet 5.5', draft: 'about $0.30 a draft (an estimate from Haiku’s token counts at Sonnet’s list price)' },
  opus: { label: 'Opus 5.5', draft: 'more than Sonnet: not measured' },
};

/** A drafter the helper names (D439 spec): known ones only, else null. */
export function drafterOption(spec: string): SeatOption | null {
  if (spec === 'lab') return LAB_DRAFTER;
  if (spec === 'forge-ranks') {
    return { id: spec, label: 'Forge ranks', blurb: 'Forge’s own card ranks, no themes, commits to two colours after its first line (the lab’s copy of how Forge drafts).' };
  }
  const m = /^llm:(haiku|sonnet|opus)(?::thinking=(off|low|default))?$/.exec(spec);
  if (m) {
    const model = LLM_MODELS[m[1]!]!;
    return {
      id: spec,
      label: model.label,
      blurb: `Claude (${model.label}) picks each of the 18 grids through Claude Code on your PC; the lab drafter’s line when it does not answer.`,
      costly: true,
      cost: `${model.label} drafting one side: ${model.draft}, on your Claude Code login.`,
    };
  }
  return null;
}

/** A player the helper names beyond the route's own: a Claude seat only, when it says so. */
export function playerOption(spec: string): SeatOption | null {
  const m = /^llm:(haiku|sonnet|opus)$/.exec(spec);
  if (!m) return null;
  const model = LLM_MODELS[m[1]!]!;
  return {
    id: spec,
    label: model.label,
    blurb: `Claude (${model.label}) plays this side through Claude Code on your PC.`,
    costly: true,
    cost: `${model.label} playing one side: a call for every turn of every game, cost not measured here; on your Claude Code login.`,
  };
}

/** What the helper on this PC lets a watch pick. */
export interface WatchCaps {
  /** `/health` `"watch": 1`. */
  watch: boolean;
  /** `/health` `"watchRunning"`. */
  running: string | null;
  drafters: SeatOption[];
  players: SeatOption[];
  /** The drafter fields may be sent (the helper listed drafters). */
  sendsDrafters: boolean;
}

const list = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, 16) : []);
const RUNNING = /^watch-[A-Za-z0-9._-]{1,120}$/;

/** Reads /health for the watch (a missing or older helper: no watch). */
export function watchCapsOf(health: unknown): WatchCaps {
  const h = (health && typeof health === 'object' ? health : {}) as Record<string, unknown>;
  const advertisedDrafters = list(h.watchDrafters).map(drafterOption).filter((o): o is SeatOption => o !== null);
  const drafters = advertisedDrafters.some((o) => o.id === 'lab') ? advertisedDrafters : [LAB_DRAFTER, ...advertisedDrafters];
  const extraPlayers = list(h.watchPlayers).map(playerOption).filter((o): o is SeatOption => o !== null);
  return {
    watch: h.watch === 1,
    running: typeof h.watchRunning === 'string' && RUNNING.test(h.watchRunning) ? h.watchRunning : null,
    drafters: dedupe(drafters),
    players: dedupe([...BASE_PLAYERS, ...extraPlayers]),
    sendsDrafters: advertisedDrafters.length > 0,
  };
}

function dedupe(o: SeatOption[]): SeatOption[] {
  const seen = new Set<string>();
  return o.filter((x) => !seen.has(x.id) && seen.add(x.id));
}

export const BEST_OF = [1, 3, 5] as const;
export type BestOf = (typeof BEST_OF)[number];

export const PACES: Array<{ ms: number; label: string; blurb: string }> = [
  { ms: 600, label: 'Watchable', blurb: 'A pause at every play: a few minutes a game.' },
  { ms: 150, label: 'Quick', blurb: 'A short pause: a minute or two a game.' },
  { ms: 0, label: 'As fast as it goes', blurb: 'No pauses: seconds a game between two Forge profiles, under a minute with the search AI.' },
];

export interface WatchForm {
  /** The cube's file stem (cubes.ts `file`): the route's `cube`. */
  cube: string;
  drafter: Record<WatchSide, string>;
  player: Record<WatchSide, string>;
  bestOf: BestOf;
  paceMs: number;
  /** Empty: a random seed (the answer says which). */
  seed: string;
  /** The player ticked "I accept the cost" (needed only with a Claude seat). */
  costOk: boolean;
}

/** A fresh form: the lab drafter both sides, the search AI both sides (D414), best of 3, the default pace. Never a Claude seat. */
export function defaultForm(cube: string, caps: Pick<WatchCaps, 'players'>): WatchForm {
  const player = caps.players.some((p) => p.id === 'search') ? 'search' : 'Default';
  return { cube, drafter: { A: 'lab', B: 'lab' }, player: { A: player, B: player }, bestOf: 3, paceMs: 600, seed: '', costOk: false };
}

export const MAX_SEED = 799_999_999;

/** The seed field: null (random), a number, or a problem. */
export function seedOf(text: string): { seed: number | null } | { problem: string } {
  const t = text.trim();
  if (!t) return { seed: null };
  if (!/^\d{1,9}$/.test(t) || Number(t) < 1 || Number(t) > MAX_SEED) return { problem: `A seed is a whole number from 1 to ${MAX_SEED.toLocaleString('en-US')}, or empty for a random one.` };
  return { seed: Number(t) };
}

/** The costly seats picked, in form order, with their notes. */
export function costlyPicks(f: WatchForm, caps: Pick<WatchCaps, 'drafters' | 'players'>): SeatOption[] {
  const out: SeatOption[] = [];
  for (const s of ['A', 'B'] as const) {
    const d = caps.drafters.find((o) => o.id === f.drafter[s]);
    const p = caps.players.find((o) => o.id === f.player[s]);
    if (d?.costly) out.push(d);
    if (p?.costly) out.push(p);
  }
  return out;
}

export type WatchBody = {
  cube: string;
  games: BestOf;
  playerA: string;
  playerB: string;
  pace: number;
  seed?: number;
  drafterA?: string;
  drafterB?: string;
};

/** The POST /watch body for a form, or why it cannot go. Only fields this helper takes. */
export function watchRequest(f: WatchForm, caps: WatchCaps): { body: WatchBody } | { problem: string } {
  if (!caps.watch) return { problem: 'The engine on your PC doesn’t run watches. Update mtg-table and start it again.' };
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(f.cube)) return { problem: 'Pick a cube.' };
  for (const s of ['A', 'B'] as const) {
    if (!caps.players.some((o) => o.id === f.player[s])) return { problem: `Pick who plays side ${s}.` };
    if (!caps.drafters.some((o) => o.id === f.drafter[s])) return { problem: `Pick who drafts side ${s}.` };
    if (!caps.sendsDrafters && f.drafter[s] !== 'lab') return { problem: 'This engine drafts with the lab drafter only.' };
  }
  if (!(BEST_OF as readonly number[]).includes(f.bestOf)) return { problem: 'Best of 1, 3 or 5.' };
  if (!Number.isInteger(f.paceMs) || f.paceMs < 0 || f.paceMs > 5000) return { problem: 'Pick a pace.' };
  const s = seedOf(f.seed);
  if ('problem' in s) return s;
  if (costlyPicks(f, caps).length && !f.costOk) return { problem: 'Tick the box to accept what Claude costs, or pick a bot for every side.' };
  const body: WatchBody = { cube: f.cube, games: f.bestOf, playerA: f.player.A, playerB: f.player.B, pace: f.paceMs };
  if (s.seed !== null) body.seed = s.seed;
  if (caps.sendsDrafters) {
    body.drafterA = f.drafter.A;
    body.drafterB = f.drafter.B;
  }
  return { body };
}

/** Start is on: the request is well formed (and a Claude seat's cost was accepted). */
export const canStart = (f: WatchForm, caps: WatchCaps): boolean => 'body' in watchRequest(f, caps);

/** A seat's words, from match.json's player ("search" → Search AI). */
export function playerLabel(player: string | null | undefined): string {
  if (!player) return 'a bot';
  if (/^search(-v2)?$/i.test(player)) return 'Search AI';
  return playerOption(player)?.label ?? player;
}

/** A drafter's words, from draft.json's drafter. */
export function drafterLabel(spec: string | null | undefined): string {
  if (!spec) return 'Lab drafter';
  return drafterOption(spec)?.label ?? spec;
}

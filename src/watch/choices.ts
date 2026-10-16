/*
 * ForgeCoach — watch/choices.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Who drafts and who plays each side of a watch (mtg-table D440, D443), the
 * cube (D444), what the form sends as POST /watch, and when it may be sent.
 * DOM-free.
 *
 * What the helper takes (docs/watch-bots.md; tools/watch-runner.mjs
 * `validateWatch`, which refuses unknown fields with a 400):
 *
 *   {"cube", "seed"?, "games"?: 1|3|5|7, "drafterA"?, "drafterB"?,
 *    "playerA"?, "playerB"?, "pace"?: 0..5000, "cubeDoc"?: {title, markdown}}
 *
 * Everything past D440's first fields is read from /health, so an older
 * helper gets exactly what it took before:
 *
 *   - `watchDrafters: [{id, label, costNote?}]` (D443): `lab`, `forge-ranks`,
 *     `llm:haiku`, `llm:sonnet`. Without it both sides draft with the lab
 *     drafter and no drafter field is sent. At most one side drafts with
 *     anything but `lab` (the route's 400; `drafterBlock` greys the other side).
 *   - `watchPlayers: [{id, label}]` (D443): one per Forge AI profile on that PC,
 *     plus `search-v2`. When the helper lists them, they are the only players
 *     offered; without the list, the search AI and the four stock profiles (a
 *     profile is a style, never a difficulty, D107). There is no Claude player.
 *   - `watchLlmCap: {maxUsd, maxCalls, maxFallbackRate}` (D442/D443): the cap a
 *     Claude drafter runs under, said beside its cost note.
 *   - `watchCustom: 1` (D444): a cube of your own (`my-<slug>`) goes with its
 *     document as `cubeDoc` (`cubeDocOf`).
 *
 * A Claude drafter (an entry with a `costNote`, or an `llm:` id) costs the owner
 * money through his Claude Code login, so it is never a default, it carries its
 * cost note, and Start stays off until the player ticks the confirm box.
 */
import type { WatchCost, WatchSide } from './data.ts';
import { cleanText } from '../lab/status.ts';

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

const SEARCH_BLURB = 'Forge’s Default plus sacrifice play and a look-ahead at its plays, attacks and blocks (search-v2). Thinks 1–3 s a decision, so games run slower.';

export const SEARCH_PLAYER: SeatOption = { id: 'search', label: 'Search AI', blurb: SEARCH_BLURB };

/** The players an older helper takes (no `watchPlayers`): the search AI first (the default), then the four profiles. */
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

/** A drafter by its id (D439 names): known ones only, else null. */
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

/** The cap a Claude drafter runs under for one watch (`/health` `watchLlmCap`). */
export interface LlmCap {
  maxUsd: number;
  maxCalls: number;
  maxFallbackRate: number;
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
  /** `/health` `watchLlmCap`, when it says. */
  llmCap: LlmCap | null;
  /** `/health` `"watchCustom": 1`: a cube of your own may be watched (cubeDoc). */
  custom: boolean;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const RUNNING = /^watch-[A-Za-z0-9._-]{1,120}$/;
const SEAT_ID = /^[A-Za-z0-9][A-Za-z0-9:=._-]{0,63}$/;

/** `[{id, label, costNote?}]` from /health: well-formed entries only, at most 16. */
function entries(v: unknown): Array<{ id: string; label: string | null; costNote: string | null }> | null {
  if (!Array.isArray(v)) return null;
  const out: Array<{ id: string; label: string | null; costNote: string | null }> = [];
  for (const e of v.slice(0, 32)) {
    if (!isObj(e) || typeof e.id !== 'string' || !SEAT_ID.test(e.id)) continue;
    out.push({ id: e.id, label: cleanText(e.label, 80), costNote: cleanText(e.costNote, 500) });
  }
  return out.slice(0, 16);
}

/** A drafter the helper lists: ours by id (with the helper's own cost note), else its label. */
function listedDrafter(e: { id: string; label: string | null; costNote: string | null }): SeatOption | null {
  const known = drafterOption(e.id);
  const costly = !!e.costNote || e.id.startsWith('llm:') || !!known?.costly;
  if (known) return { ...known, ...(costly ? { costly: true, cost: e.costNote ? `${known.label} drafting one side: ${e.costNote}` : known.cost } : {}) };
  if (!e.label) return null;
  return { id: e.id, label: e.label, blurb: e.label, ...(costly ? { costly: true, cost: `${e.label}: ${e.costNote ?? 'spends on your Claude Code login; cost not stated'}` } : {}) };
}

/** A player the helper lists: the search AI, a known profile in our words, another profile by its label. Never a Claude seat. */
function listedPlayer(e: { id: string; label: string | null }): SeatOption | null {
  if (/^llm:/i.test(e.id)) return null;
  if (/^search(-v2)?$/i.test(e.id)) return { ...SEARCH_PLAYER, id: e.id };
  const stock = PROFILES.find((p) => p.toLowerCase() === e.id.toLowerCase());
  if (stock) return { id: e.id, label: stock, blurb: PROFILE_BLURB[stock]! };
  return { id: e.id, label: e.id, blurb: `Forge’s own AI, the ${e.id} profile on your PC${e.label && e.label !== e.id ? ` (${e.label})` : ''}.` };
}

function capOf(v: unknown): LlmCap | null {
  if (!isObj(v)) return null;
  const { maxUsd, maxCalls, maxFallbackRate } = v;
  if (typeof maxUsd !== 'number' || !(maxUsd > 0) || maxUsd > 1000) return null;
  if (typeof maxCalls !== 'number' || !Number.isInteger(maxCalls) || maxCalls < 1 || maxCalls > 100_000) return null;
  const rate = typeof maxFallbackRate === 'number' && maxFallbackRate >= 0 && maxFallbackRate <= 1 ? maxFallbackRate : null;
  return rate === null ? null : { maxUsd, maxCalls, maxFallbackRate: rate };
}

/** Reads /health for the watch (a missing or older helper: no watch, or D440's choices only). */
export function watchCapsOf(health: unknown): WatchCaps {
  const h = isObj(health) ? health : {};
  const listedD = entries(h.watchDrafters);
  const advertised = (listedD ?? []).map(listedDrafter).filter((o): o is SeatOption => o !== null);
  const drafters = advertised.some((o) => o.id === 'lab') ? advertised : [LAB_DRAFTER, ...advertised];
  const listedP = entries(h.watchPlayers);
  const players = listedP ? listedP.map(listedPlayer).filter((o): o is SeatOption => o !== null) : null;
  return {
    watch: h.watch === 1,
    running: typeof h.watchRunning === 'string' && RUNNING.test(h.watchRunning) ? h.watchRunning : null,
    drafters: dedupe(drafters),
    players: dedupe(players && players.length ? players : BASE_PLAYERS),
    sendsDrafters: advertised.length > 0,
    llmCap: capOf(h.watchLlmCap),
    custom: h.watchCustom === 1,
  };
}

function dedupe(o: SeatOption[]): SeatOption[] {
  const seen = new Set<string>();
  return o.filter((x) => !seen.has(x.id.toLowerCase()) && seen.add(x.id.toLowerCase()));
}

/** Dollars: "$1", "$0.30". */
export const money = (usd: number): string => (Number.isInteger(usd) ? `$${usd}` : `$${usd.toFixed(2)}`);

/** The cap's line, for the cost box: "Capped at $1 a watch and 40 calls; …". */
export function capLine(cap: LlmCap | null): string | null {
  if (!cap) return null;
  const pct = Math.round(cap.maxFallbackRate * 100);
  const stop = cap.maxFallbackRate >= 1 ? '' : `; the watch stops if more than ${pct}% of Claude’s picks fall back to the lab drafter`;
  return `Capped at ${money(cap.maxUsd)} a watch (list price) and ${cap.maxCalls} calls${stop}.`;
}

/** Why `id` can't draft `side` with the other side as it is, or null: one side at most drafts with anything but the lab drafter (D443). */
export function drafterBlock(f: Pick<WatchForm, 'drafter'>, side: WatchSide, id: string): string | null {
  const other = side === 'A' ? 'B' : 'A';
  if (id === 'lab' || f.drafter[other] === 'lab') return null;
  return `Drafter ${other} already drafts with something other than the lab drafter: one side at most.`;
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

/** A fresh form: the lab drafter both sides, the search AI both sides (D414) when offered, best of 3, the default pace. Never a Claude seat. */
export function defaultForm(cube: string, caps: Pick<WatchCaps, 'players'>): WatchForm {
  const search = caps.players.find((p) => /^search(-v2)?$/i.test(p.id));
  const plain = caps.players.find((p) => p.id.toLowerCase() === 'default') ?? caps.players.find((p) => !p.costly);
  const player = search?.id ?? plain?.id ?? 'Default';
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

/** A cube of your own, as POST /watch carries it (D444). */
export interface CubeDoc {
  title: string;
  markdown: string;
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
  cubeDoc?: CubeDoc;
};

/** The route's own limits for a cubeDoc (watch-runner.mjs `checkCubeDoc`). */
export const MAX_CUBE_TITLE = 80;
export const MAX_CUBE_DOC_BYTES = 256 * 1024;
/** A custom cube's id as the route takes it. */
export const CUSTOM_WATCH_CUBE = /^my-[a-z0-9-]{1,60}$/;

/** A custom cube's title and document as a cubeDoc, or why it can't go. */
export function cubeDocOf(title: string, markdown: string): { cubeDoc: CubeDoc } | { problem: string } {
  // One line, no control characters, 1–80 characters (code points).
  // eslint-disable-next-line no-control-regex
  const t = [...title.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim()].slice(0, MAX_CUBE_TITLE).join('').trim();
  if (!t) return { problem: 'This cube has no title: give it one in the cube builder.' };
  if (!markdown.trim()) return { problem: 'This cube has no list saved: open it in the cube builder and save it again.' };
  const bytes = new TextEncoder().encode(markdown).length;
  if (bytes > MAX_CUBE_DOC_BYTES) return { problem: `This cube’s list is ${Math.ceil(bytes / 1024)} KB; the engine takes at most ${MAX_CUBE_DOC_BYTES / 1024} KB.` };
  if (markdown.includes('\u0000')) return { problem: 'This cube’s list holds a character the engine refuses: save it again in the cube builder.' };
  return { cubeDoc: { title: t, markdown } };
}

/**
 * The POST /watch body for a form, or why it cannot go. Only fields this
 * helper takes. `custom` is the picked cube's own title and document when it
 * is one of yours (cubes.ts `custom`), else null.
 */
export function watchRequest(f: WatchForm, caps: WatchCaps, custom: { title: string; doc: string } | null = null): { body: WatchBody } | { problem: string } {
  if (!caps.watch) return { problem: 'The engine on your PC doesn’t run watches. Update mtg-table and start it again.' };
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(f.cube)) return { problem: 'Pick a cube.' };
  let cubeDoc: CubeDoc | null = null;
  if (custom) {
    if (!caps.custom) return { problem: 'The engine on your PC deals only the cubes in its own folder: update mtg-table to watch one of yours.' };
    if (!CUSTOM_WATCH_CUBE.test(f.cube)) return { problem: 'This cube’s name is too long for the engine: save it under a shorter title in the cube builder.' };
    const d = cubeDocOf(custom.title, custom.doc);
    if ('problem' in d) return d;
    cubeDoc = d.cubeDoc;
  } else if (f.cube.startsWith('my-')) return { problem: 'This cube isn’t in this browser any more: pick another.' };
  for (const s of ['A', 'B'] as const) {
    if (!caps.players.some((o) => o.id === f.player[s])) return { problem: `Pick who plays side ${s}.` };
    if (!caps.drafters.some((o) => o.id === f.drafter[s])) return { problem: `Pick who drafts side ${s}.` };
    if (!caps.sendsDrafters && f.drafter[s] !== 'lab') return { problem: 'This engine drafts with the lab drafter only.' };
  }
  if (f.drafter.A !== 'lab' && f.drafter.B !== 'lab') return { problem: 'One side at most drafts with something other than the lab drafter.' };
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
  if (cubeDoc) body.cubeDoc = cubeDoc;
  return { body };
}

/** Start is on: the request is well formed (and a Claude seat's cost was accepted). */
export const canStart = (f: WatchForm, caps: WatchCaps, custom: { title: string; doc: string } | null = null): boolean => 'body' in watchRequest(f, caps, custom);

/** A seat's words, from match.json's player ("search" → Search AI). */
export function playerLabel(player: string | null | undefined): string {
  if (!player) return 'a bot';
  if (/^search(-v2)?$/i.test(player)) return 'Search AI';
  return player;
}

/** A drafter's words, from draft.json's drafter. */
export function drafterLabel(spec: string | null | undefined): string {
  if (!spec) return 'Lab drafter';
  return drafterOption(spec)?.label ?? spec;
}

/**
 * What a Claude drafter spent (match.json `cost`, D443), in words. `final`: the
 * draft is written or the watch has ended; before that it is "so far".
 */
export function costLine(cost: WatchCost, final: boolean): string {
  const who = drafterLabel(cost.drafter);
  const usd = cost.usd === null ? 'cost not reported' : cost.usd < 0.005 ? 'under $0.01 at list price' : `${money(Math.round(cost.usd * 100) / 100)} at list price`;
  const calls = `${cost.calls} call${cost.calls === 1 ? '' : 's'}${cost.callErrors ? ` (${cost.callErrors} failed)` : ''}`;
  const fell = cost.decisions ? `; ${cost.fallbacks} of ${cost.decisions} pick${cost.decisions === 1 ? '' : 's'} fell back to the lab drafter` : '';
  const done = final || !!cost.stopped;
  const head = done ? `${who} drafted side ${cost.side}` : `${who} is drafting side ${cost.side}`;
  const why = cost.why ? `: ${cost.why.replace(/[.\s]+$/, '')}.` : '.';
  const stop = cost.stopped ? ` It stopped the watch${why}` : '';
  return `${head}: ${usd}, ${calls}${fell}${done ? '' : ' so far'}.${stop}`;
}

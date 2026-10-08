/*
 * ForgeCoach — coachUse.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Coach use per game (mtg-table D414): for every game played against the AI on
 * this browser, whether the live coach advised it and how many of its answers
 * were shown. mtg-table's human test set (`tools/ml/human_collect.py`, D369)
 * reads it to tell human-only games from human-plus-Claude ones. Pure and
 * DOM-free; storage is injected.
 *
 * WHY IN THE BROWSER. The coach runs here (through the player's key or the
 * helper's /coach, neither keyed by game), the bridge's frame log cannot carry
 * it, and ForgeCoach keeps no saved log of a game against Forge. So it is kept
 * in localStorage `forgecoach.coachUse.v1` and exported from Settings → Coach
 * use; saved as `coach-usage*.json` in mtg-table's `var/ml/human/`, the
 * collector joins it into the manifest's `coach` by the game key.
 *
 * KEY. feedback.ts's `gameId|seed|startedAt` (the collector's manifest key)
 * and the seat — autoPlan.ts `gameKeyOf`'s `<key>#<seat>`.
 *
 * WHAT IS COUNTED. A game is noted when its board opens against the AI (never
 * at a table of two: a friend's game is not recorded here). An answer counts
 * once (by its answers-store key) when it ended with text on the play screen —
 * done, or stopped after writing — as `plans` (auto-coach's turn plans and
 * re-asked plans) or `asks` (the player's own questions). Errors and empty
 * answers do not count. Nothing of the advice itself, the board or the prompt
 * is kept: counts, model ids, sources and times.
 */

export const COACH_USE_KEY = 'forgecoach.coachUse.v1';
/** The export's `kind`, which the collector checks. */
export const COACH_USE_KIND = 'forgecoach.coachUse';
export const MAX_COACH_GAMES = 500;
/** Answer keys kept per game to count each answer once. */
export const MAX_ANSWER_KEYS = 300;

export interface CoachUseGame {
  /** `gameId|seed|startedAt` — the collector's manifest key. */
  key: string;
  seat: number;
  plans: number;
  asks: number;
  models: string[];
  sources: string[];
  /** The answers counted (answers-store keys), so a re-settle is not counted twice. */
  counted: string[];
  firstSeen: string;
  updatedAt: string;
}

export type AnswerKind = 'plan' | 'ask';

type Read = Pick<Storage, 'getItem'>;
type Write = Pick<Storage, 'getItem' | 'setItem'>;

const isStr = (x: unknown): x is string => typeof x === 'string';
const isCount = (x: unknown): x is number => typeof x === 'number' && Number.isInteger(x) && x >= 0;

function clean(g: unknown): CoachUseGame | null {
  if (!g || typeof g !== 'object') return null;
  const o = g as Record<string, unknown>;
  if (!isStr(o.key) || !o.key || !isCount(o.seat) || !isCount(o.plans) || !isCount(o.asks)) return null;
  if (!isStr(o.firstSeen) || !isStr(o.updatedAt)) return null;
  const strs = (x: unknown) => (Array.isArray(x) ? x.filter(isStr) : []);
  return {
    key: o.key,
    seat: o.seat,
    plans: o.plans,
    asks: o.asks,
    models: strs(o.models),
    sources: strs(o.sources),
    counted: strs(o.counted).slice(-MAX_ANSWER_KEYS),
    firstSeen: o.firstSeen,
    updatedAt: o.updatedAt,
  };
}

/** The browser's localStorage, or null where it is blocked (a private window, a test without one). */
export function coachUseStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function loadCoachUse(storage: Read | null): CoachUseGame[] {
  try {
    const raw = storage?.getItem(COACH_USE_KEY);
    if (!raw) return [];
    const v = JSON.parse(raw) as unknown;
    if (!Array.isArray(v)) return [];
    return v.map(clean).filter((g): g is CoachUseGame => g !== null);
  } catch {
    return [];
  }
}

function save(storage: Write | null, list: CoachUseGame[]): boolean {
  try {
    if (!storage) return false;
    const kept = [...list].sort((a, b) => (a.updatedAt < b.updatedAt ? -1 : a.updatedAt > b.updatedAt ? 1 : 0)).slice(-MAX_COACH_GAMES);
    storage.setItem(COACH_USE_KEY, JSON.stringify(kept));
    return true;
  } catch {
    return false;
  }
}

/** autoPlan.ts's game seat key (`gameId|seed|startedAt#seat`) as {key, seat}, or null. */
export function splitGame(game: string): { key: string; seat: number } | null {
  const i = game.lastIndexOf('#');
  if (i <= 0) return null;
  const key = game.slice(0, i);
  const seat = Number(game.slice(i + 1));
  if (!Number.isInteger(seat) || seat < 0 || key.split('|').length < 3) return null;
  return { key, seat };
}

/** A game against the AI opened on this browser: noted with no answers (once). True when it was new. */
export function noteGamePlayed(storage: Write | null, game: string, now: () => number = Date.now): boolean {
  const g = splitGame(game);
  if (!g) return false;
  const list = loadCoachUse(storage);
  if (list.some((e) => e.key === g.key && e.seat === g.seat)) return false;
  const at = new Date(now()).toISOString();
  return save(storage, [...list, { key: g.key, seat: g.seat, plans: 0, asks: 0, models: [], sources: [], counted: [], firstSeen: at, updatedAt: at }]);
}

/**
 * One coach answer shown for a noted game. Counted once per answer key; a game
 * that was never noted (a table of two, or a replay) is not recorded. True when
 * it counted.
 */
export function noteAnswerShown(
  storage: Write | null,
  game: string,
  answer: { key: string; kind: AnswerKind; model: string | null; source: string | null },
  now: () => number = Date.now,
): boolean {
  const g = splitGame(game);
  if (!g) return false;
  const list = loadCoachUse(storage);
  const e = list.find((x) => x.key === g.key && x.seat === g.seat);
  if (!e || e.counted.includes(answer.key)) return false;
  if (answer.kind === 'plan') e.plans += 1;
  else e.asks += 1;
  if (answer.model && !e.models.includes(answer.model)) e.models.push(answer.model);
  if (answer.source && !e.sources.includes(answer.source)) e.sources.push(answer.source);
  e.counted = [...e.counted, answer.key].slice(-MAX_ANSWER_KEYS);
  e.updatedAt = new Date(now()).toISOString();
  return save(storage, list);
}

/** Did an ended answer show advice? Done or stopped, with text. */
export function answerWasShown(a: { status: string; text: string } | null | undefined): boolean {
  return !!a && (a.status === 'done' || a.status === 'stopped') && a.text.trim().length > 0;
}

export interface CoachUseExport {
  kind: typeof COACH_USE_KIND;
  v: 1;
  exportedAt: string;
  about: string;
  games: Array<{ key: string; seat: number; coachUsed: boolean; answers: number; plans: number; asks: number; models: string[]; sources: string[]; firstSeen: string; updatedAt: string }>;
}

/** The export (Settings → Coach use), oldest first. */
export function exportCoachUse(list: readonly CoachUseGame[], now: () => number = Date.now): CoachUseExport {
  const sorted = [...list].sort((a, b) => (a.firstSeen < b.firstSeen ? -1 : a.firstSeen > b.firstSeen ? 1 : 0));
  return {
    kind: COACH_USE_KIND,
    v: 1,
    exportedAt: new Date(now()).toISOString(),
    about:
      'Per game against the AI on this browser: the live coach answers shown (plans + your own questions). key = gameId|seed|startedAt, the key of mtg-table var/ml/human/manifest.json (D369); save this file in var/ml/human/ as coach-usage-<date>.json and the collector labels each game (D414).',
    games: sorted.map((g) => ({
      key: g.key,
      seat: g.seat,
      coachUsed: g.plans + g.asks > 0,
      answers: g.plans + g.asks,
      plans: g.plans,
      asks: g.asks,
      models: g.models,
      sources: g.sources,
      firstSeen: g.firstSeen,
      updatedAt: g.updatedAt,
    })),
  };
}

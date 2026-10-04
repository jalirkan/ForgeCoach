/*
 * ForgeCoach — feedback.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * "Was this advice helpful?" — a thumbs up or down, and an optional one-line
 * note, on a coach answer. Pure and DOM-free; storage is injected.
 *
 * KEY. One entry per (game, decision, surface, answer source, model): the
 * game is the session header's `gameId` + `seed` + `startedAt` (the same three
 * fields mtg-table's human-games collector keys a game by, tools/ml/
 * human_collect.py `key_of`, D369), the decision is the `seq` of the state
 * frame it is about (the bridge's own frame counter, so the entry lines up
 * with `frames.jsonl` line for line; null for a whole-game answer), the
 * surface is where it was shown (play, replay, film room, review), and the
 * source/model are who answered (`helper` = Claude Code on the PC, `apiKey`).
 * Voting again on the same key replaces the vote.
 *
 * WHAT IS STORED. Only the vote, the note (one line, capped), those keys and
 * a time: never the answer's text, the prompt, or any state. The export is
 * the same list as JSON (Settings → Advice feedback).
 *
 * NOT IN THE HUMAN TEST SET. The collector copies only the bridge's own
 * frame log of the human seat; there is no field or side file it reads that
 * the browser could write, so the export is the only way out for now. Its
 * `game.key` is `gameId|seed|startedAt`, the collector's manifest key, so a
 * later reader can join the two.
 */
import type { GameLog } from './log.ts';

export type AdviceSurface = 'play' | 'replay' | 'film' | 'review' | 'engine-review' | 'practice';
export type AdviceVote = 'up' | 'down';

export interface FeedbackTarget {
  gameId: string;
  seed: number | null;
  startedAt: string | null;
  /** The decision's state frame `seq`; null for an answer about the whole game. */
  seq: number | null;
  surface: AdviceSurface;
}

export interface AdviceFeedback extends FeedbackTarget {
  v: 1;
  key: string;
  source: 'helper' | 'apiKey' | null;
  model: string | null;
  vote: AdviceVote;
  note: string | null;
  /** ISO time of the last change. */
  at: string;
}

export const FEEDBACK_KEY = 'forgecoach.feedback.v1';
export const MAX_NOTE = 140;
export const MAX_ENTRIES = 2000;

/** `gameId|seed|startedAt`: human_collect.py's manifest key. */
export function gameJoinKey(t: Pick<FeedbackTarget, 'gameId' | 'seed' | 'startedAt'>): string {
  return `${t.gameId}|${t.seed ?? 'None'}|${t.startedAt ?? 'None'}`;
}

export function feedbackKey(t: FeedbackTarget, source: string | null, model: string | null): string {
  return `${gameJoinKey(t)}#${t.seq ?? 'game'}#${t.surface}#${source ?? '-'}#${model ?? '-'}`;
}

/** The target for an answer about one decision (`frameIndex` into the log), or the whole game (null). */
export function feedbackTarget(log: GameLog | null | undefined, frameIndex: number | null, surface: AdviceSurface): FeedbackTarget | null {
  const h = log?.header;
  if (!h || typeof h.gameId !== 'string' || !h.gameId) return null;
  let seq: number | null = null;
  if (frameIndex !== null) {
    const f = log!.frames[frameIndex];
    if (!f || typeof f.seq !== 'number') return null;
    seq = f.seq;
  }
  return {
    gameId: h.gameId,
    seed: typeof h.seed === 'number' ? h.seed : null,
    startedAt: typeof h.startedAt === 'string' && h.startedAt ? h.startedAt : null,
    seq,
    surface,
  };
}

/** One line: whitespace collapsed, control characters dropped, capped. Empty → null. */
export function cleanNote(s: string | null | undefined): string | null {
  const t = (s ?? '')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_NOTE)
    .trim();
  return t || null;
}

const SURFACES: readonly AdviceSurface[] = ['play', 'replay', 'film', 'review', 'engine-review', 'practice'];

function valid(x: unknown): x is AdviceFeedback {
  if (!x || typeof x !== 'object') return false;
  const e = x as Record<string, unknown>;
  return (
    e.v === 1 &&
    typeof e.key === 'string' &&
    typeof e.gameId === 'string' &&
    (e.vote === 'up' || e.vote === 'down') &&
    SURFACES.includes(e.surface as AdviceSurface) &&
    (e.seq === null || typeof e.seq === 'number') &&
    typeof e.at === 'string'
  );
}

export function loadFeedback(storage: Pick<Storage, 'getItem'> | null): AdviceFeedback[] {
  try {
    const raw = storage?.getItem(FEEDBACK_KEY);
    if (!raw) return [];
    const j = JSON.parse(raw) as unknown;
    return Array.isArray(j) ? j.filter(valid) : [];
  } catch {
    return [];
  }
}

export function saveFeedback(storage: Pick<Storage, 'setItem' | 'removeItem'> | null, list: readonly AdviceFeedback[]): boolean {
  try {
    if (!storage) return false;
    if (list.length) storage.setItem(FEEDBACK_KEY, JSON.stringify(list));
    else storage.removeItem(FEEDBACK_KEY);
    return true;
  } catch {
    return false;
  }
}

export interface Rating {
  vote: AdviceVote | null;
  note?: string | null;
}

/**
 * Sets (or with `vote: null`, removes) the entry for this answer. A note
 * without a change of vote keeps the vote. The newest entries are kept when
 * the list is full.
 */
export function rate(
  list: readonly AdviceFeedback[],
  t: FeedbackTarget,
  who: { source: 'helper' | 'apiKey' | null; model: string | null },
  r: Rating,
  now: () => number = Date.now,
): AdviceFeedback[] {
  const key = feedbackKey(t, who.source, who.model);
  const old = list.find((e) => e.key === key);
  const rest = list.filter((e) => e.key !== key);
  if (r.vote === null) return rest;
  const entry: AdviceFeedback = {
    v: 1,
    key,
    gameId: t.gameId,
    seed: t.seed,
    startedAt: t.startedAt,
    seq: t.seq,
    surface: t.surface,
    source: who.source,
    model: who.model,
    vote: r.vote,
    note: r.note !== undefined ? cleanNote(r.note) : (old?.note ?? null),
    at: new Date(now()).toISOString(),
  };
  return [...rest, entry].slice(-MAX_ENTRIES);
}

export function ratingOf(list: readonly AdviceFeedback[], t: FeedbackTarget, source: string | null, model: string | null): AdviceFeedback | null {
  const key = feedbackKey(t, source, model);
  return list.find((e) => e.key === key) ?? null;
}

export interface FeedbackExport {
  kind: 'forgecoach-advice-feedback';
  v: 1;
  exportedAt: string;
  /** How to join with mtg-table's human test set (var/ml/human/manifest.json). */
  join: string;
  counts: { up: number; down: number; notes: number };
  entries: Array<Omit<AdviceFeedback, 'v' | 'key'> & { game: { key: string } }>;
}

/** The export (Settings → Advice feedback), oldest first. */
export function exportFeedback(list: readonly AdviceFeedback[], now: () => number = Date.now): FeedbackExport {
  const sorted = [...list].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  return {
    kind: 'forgecoach-advice-feedback',
    v: 1,
    exportedAt: new Date(now()).toISOString(),
    join: 'game.key = gameId|seed|startedAt, the key of var/ml/human/manifest.json (mtg-table D369); seq = the s2c state frame of frames.jsonl the advice was about (null: the whole game).',
    counts: { up: list.filter((e) => e.vote === 'up').length, down: list.filter((e) => e.vote === 'down').length, notes: list.filter((e) => e.note).length },
    entries: sorted.map(({ v: _v, key: _k, ...e }) => ({ ...e, game: { key: gameJoinKey(e) } })),
  };
}

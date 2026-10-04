/*
 * ForgeCoach — ui/practice/practiceData.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Where practice puzzles come from in the browser: the games in Your record
 * (history/record.ts, logs in IndexedDB), the shipped samples (one with its
 * engine review), and the film room / engine review screens, which hand over
 * their settled film or report for a game that is saved (or a sample). The
 * puzzle list itself is practice/puzzles.ts's book in localStorage.
 */
import type { GameLog } from '../../log.ts';
import { parseLog, readLogBytes } from '../../log.ts';
import { extractDecisions, type Decision } from '../../decisions.ts';
import { parseReviewReport, type ReviewReport } from '../../gameReview.ts';
import type { Film } from '../../filmRoom.ts';
import { historyKV, loadHistory, type GameRecord } from '../../history/record.ts';
import { loadBook, mergePuzzles, puzzlesFromGame, saveBook, type Puzzle, type PuzzleBook, type PuzzleGame } from '../../practice/puzzles.ts';
import { SAMPLE_REVIEWS } from '../review/samples.ts';

/** The shipped sample logs (public/samples/), titled as on the start page. */
export const PRACTICE_SAMPLES: Array<{ id: string; title: string }> = [
  { id: 'human-auto-42', title: 'Sample · Auto-play, seed 42' },
  { id: 'human-comfort-13', title: 'Sample · Comfort game, seed 13' },
];

function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export const readBook = (): PuzzleBook => loadBook(storage());
export const writeBook = (b: PuzzleBook): boolean => saveBook(storage(), b);

const listeners = new Set<() => void>();
export function onBookChange(f: () => void): () => void {
  listeners.add(f);
  return () => listeners.delete(f);
}
export function updateBook(f: (b: PuzzleBook) => PuzzleBook): PuzzleBook {
  const next = f(readBook());
  writeBook(next);
  for (const l of listeners) l();
  return next;
}

/** `<gameId>@<startedAt>`: the same as CoachPanel `gameKey` and a history record's id. */
export function gameRefOf(log: GameLog): string {
  return `${log.header.gameId}@${log.header.startedAt}`;
}

function sampleOf(log: GameLog): string | null {
  const id = log.header.gameId;
  return PRACTICE_SAMPLES.some((s) => s.id === id) ? id : null;
}

function safeDecisions(log: GameLog): Decision[] {
  try {
    return extractDecisions(log);
  } catch {
    return [];
  }
}

function recordTitle(r: GameRecord): string {
  const d = new Date(r.date);
  const when = Number.isNaN(d.getTime()) ? r.date : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return `vs ${r.aiDeck ?? 'Forge'} · ${when}`;
}

/**
 * The film room or the engine review settled a film (or opened a report) for
 * this game: keep its puzzles when the game is one of Your record's (or a
 * sample). Never throws; a game that is not saved is left alone.
 */
export async function rememberGame(log: GameLog, opts: { film?: Film | null; report?: ReviewReport | null; decisions?: readonly Decision[] }): Promise<number> {
  try {
    const ref = gameRefOf(log);
    const sample = sampleOf(log);
    let title = sample ? (PRACTICE_SAMPLES.find((s) => s.id === sample)?.title ?? sample) : null;
    if (!title) {
      const rec = await historyKV().get(ref);
      if (!rec || !rec.hasLog) return 0;
      title = recordTitle(rec);
    }
    const game: PuzzleGame = { ref, sample, title };
    const ps = puzzlesFromGame({ log, game, decisions: opts.decisions ?? safeDecisions(log), film: opts.film ?? null, report: opts.report ?? null });
    if (ps.length) updateBook((b) => mergePuzzles(b, ps));
    return ps.length;
  } catch {
    return 0;
  }
}

/** Turns the saved games not yet scanned (newest first, at most `max`) into puzzles. */
export async function scanHistory(max = 12): Promise<{ games: number; puzzles: number }> {
  const recs = (await loadHistory()).filter((r) => r.hasLog);
  const seen = new Set(readBook().scanned);
  let games = 0;
  let puzzles = 0;
  for (const r of recs) {
    if (games >= max) break;
    if (seen.has(r.id)) continue;
    games++;
    try {
      const text = await historyKV().getLog(r.id);
      if (!text) {
        updateBook((b) => mergePuzzles(b, [], r.id));
        continue;
      }
      const log = parseLog(text);
      const ps = puzzlesFromGame({ log, game: { ref: r.id, sample: null, title: recordTitle(r) }, decisions: safeDecisions(log) });
      puzzles += ps.length;
      updateBook((b) => mergePuzzles(b, ps, r.id));
    } catch {
      updateBook((b) => mergePuzzles(b, [], r.id));
    }
    // Let the page breathe between games.
    await new Promise((res) => setTimeout(res, 0));
  }
  return { games, puzzles };
}

async function fetchSampleLog(id: string): Promise<GameLog> {
  const res = await fetch(`${import.meta.env.BASE_URL}samples/${id}.jsonl.gz`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return readLogBytes(await res.arrayBuffer());
}

async function fetchSampleReport(id: string): Promise<ReviewReport | null> {
  const path = SAMPLE_REVIEWS[id];
  if (!path) return null;
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}${path}`);
    return res.ok ? parseReviewReport(await res.text()) : null;
  } catch {
    return null;
  }
}

/** Puzzles from the shipped samples (the one with an engine review gets the engine's numbers). */
export async function addSamples(): Promise<number> {
  let n = 0;
  for (const s of PRACTICE_SAMPLES) {
    const log = await fetchSampleLog(s.id);
    const report = await fetchSampleReport(s.id);
    const ps = puzzlesFromGame({ log, game: { ref: gameRefOf(log), sample: s.id, title: s.title }, decisions: safeDecisions(log), report });
    n += ps.length;
    updateBook((b) => mergePuzzles(b, ps));
  }
  return n;
}

const logCache = new Map<string, Promise<GameLog>>();

/** The log a puzzle's board comes from: the sample, or the saved game. */
export function puzzleLog(p: Puzzle): Promise<GameLog> {
  const key = p.game.sample ? `sample:${p.game.sample}` : p.game.ref;
  let hit = logCache.get(key);
  if (!hit) {
    hit = p.game.sample
      ? fetchSampleLog(p.game.sample)
      : historyKV()
          .getLog(p.game.ref)
          .then((t) => {
            if (!t) throw new Error('This game’s log is no longer stored in Your record.');
            return parseLog(t);
          });
    hit.catch(() => logCache.delete(key));
    logCache.set(key, hit);
  }
  return hit;
}

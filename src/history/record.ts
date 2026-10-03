/*
 * ForgeCoach — history/record.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * "Your record": one small record per game played against Forge in
 * ForgeCoach, saved when the game reaches its terminal `over` frame
 * (play/session.ts calls recordFinishedGame). A record holds only what the
 * seat's own stream says — the date, your deck, the AI deck's NAME (never a
 * path, hard rule 8), the AI profile, the result, turns, the game id and the
 * cube when the deck says which. The frame log is kept beside it when small
 * enough, so the review screen can open the game later.
 *
 * Storage is injected (HistoryKV): IndexedDB in the browser, memory in tests
 * and in private mode. Nothing here touches the DOM.
 */
import type { GameLog } from '../log.ts';
import { seatMatchOf, type GameStateBody } from '../protocol.ts';
import { CUBES } from '../cube/cubes.ts';

export type GameResult = 'win' | 'loss' | 'draw';

export interface GameRecord {
  v: 1;
  /** `<gameId>@<startedAt>`: a game id alone can repeat across engine restarts. */
  id: string;
  gameId: string;
  /** ISO-8601: when the game started (the log header), else when it was recorded. */
  date: string;
  yourDeck: string | null;
  /** The AI deck's name only. */
  aiDeck: string | null;
  aiProfile: string | null;
  result: GameResult;
  /** Forge's win condition, when it said one. */
  reason: string | null;
  /** Player turns (§3.1), from the last state. */
  turns: number | null;
  /** Game N of a best-of match, when the match is longer than one game. */
  gameNumber: number | null;
  gameCount: number | null;
  /** A cube from src/cube/cubes.ts the deck came from, when its name or path says so. */
  cubeId: string | null;
  /** The frame log is stored too (openable in the review screen). */
  hasLog: boolean;
}

/** Logs larger than this (as JSONL text) are not kept; the record still is. */
export const MAX_LOG_CHARS = 3_000_000;

/** The JSONL text of a log: the session header, then one frame per line (log.ts parses it back). */
export function logToText(log: GameLog): string {
  return [JSON.stringify(log.header), ...log.frames.map((f) => JSON.stringify(f))].join('\n') + '\n';
}

function lastTurn(log: GameLog): number | null {
  for (let i = log.frames.length - 1; i >= 0; i--) {
    const f = log.frames[i]!;
    if (f.type === 'state' && (f.dir ?? 's2c') === 's2c') {
      const t = (f.body as GameStateBody).turn;
      return typeof t === 'number' && t > 0 ? t : null;
    }
  }
  return null;
}

/** The cube a deck came from, if its name or path names one ("synergy", "synergy-cube-180", "Synergy Cube"). */
export function cubeOfDeck(...hints: Array<string | null | undefined>): string | null {
  const text = hints.filter(Boolean).join(' ').toLowerCase();
  if (!text) return null;
  for (const c of CUBES) {
    if (text.includes(c.file) || text.includes(c.title.toLowerCase()) || new RegExp(`(^|[^a-z])${c.id}([^a-z]|$)`).test(text)) return c.id;
  }
  return null;
}

/** The record for a finished game, or null when the log has no `over` (not finished) or no game id. */
export function recordFromLog(log: GameLog, now: () => number = Date.now): GameRecord | null {
  if (!log.over) return null;
  const gameId = log.hello?.gameId ?? log.header.gameId;
  if (!gameId) return null;
  const seat = log.hello?.you ?? log.seat;
  const winner = log.over.winner;
  const result: GameResult = winner === null ? 'draw' : winner === seat ? 'win' : 'loss';
  const opp = log.hello?.players.find((p) => p.id !== seat);
  const mine = log.hello ? seatMatchOf(log.hello, seat) : null;
  const theirs = log.hello && opp ? seatMatchOf(log.hello, opp.id) : null;
  const startedAt = typeof log.header.startedAt === 'string' && log.header.startedAt ? log.header.startedAt : new Date(now()).toISOString();
  const yourPath = log.hello?.match?.yourDeck?.path ?? null;
  const aiProfile = theirs?.aiProfile ?? (typeof log.hello?.match?.aiProfile === 'string' && log.hello.match.aiProfile ? log.hello.match.aiProfile : null);
  return {
    v: 1,
    id: `${gameId}@${startedAt}`,
    gameId,
    date: startedAt,
    yourDeck: mine?.deck ?? null,
    aiDeck: theirs?.deck ?? null,
    aiProfile,
    result,
    reason: log.over.reason ?? null,
    turns: lastTurn(log),
    gameNumber: typeof log.hello?.gameNumber === 'number' ? log.hello.gameNumber : null,
    gameCount: typeof log.hello?.gameCount === 'number' ? log.hello.gameCount : null,
    cubeId: cubeOfDeck(mine?.deck, yourPath),
    hasLog: false,
  };
}

// ---------------------------------------------------------------------------
// Storage

export interface HistoryKV {
  all(): Promise<GameRecord[]>;
  get(id: string): Promise<GameRecord | null>;
  put(rec: GameRecord): Promise<void>;
  putLog(id: string, text: string): Promise<void>;
  getLog(id: string): Promise<string | null>;
  remove(id: string): Promise<void>;
}

export function memoryKV(): HistoryKV {
  const recs = new Map<string, GameRecord>();
  const logs = new Map<string, string>();
  return {
    all: async () => [...recs.values()],
    get: async (id) => recs.get(id) ?? null,
    put: async (r) => void recs.set(r.id, r),
    putLog: async (id, t) => void logs.set(id, t),
    getLog: async (id) => logs.get(id) ?? null,
    remove: async (id) => {
      recs.delete(id);
      logs.delete(id);
    },
  };
}

const DB = 'forgecoach-history';
const RECS = 'games-v1';
const LOGS = 'logs-v1';

/** IndexedDB, or null when it is unavailable (node, private mode). */
export function indexedDbKV(idb: IDBFactory | undefined = (globalThis as { indexedDB?: IDBFactory }).indexedDB): HistoryKV | null {
  if (!idb) return null;
  let dbp: Promise<IDBDatabase | null> | null = null;
  const open = () =>
    (dbp ??= new Promise((resolve) => {
      try {
        const req = idb.open(DB, 1);
        req.onupgradeneeded = () => {
          req.result.createObjectStore(RECS);
          req.result.createObjectStore(LOGS);
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
        req.onblocked = () => resolve(null);
      } catch {
        resolve(null);
      }
    }));
  const run = <T>(store: string, mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>): Promise<T | undefined> =>
    open().then(
      (db) =>
        new Promise<T | undefined>((resolve) => {
          if (!db) return resolve(undefined);
          try {
            const req = f(db.transaction(store, mode).objectStore(store));
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => resolve(undefined);
          } catch {
            resolve(undefined);
          }
        }),
    );
  return {
    all: async () => ((await run<GameRecord[]>(RECS, 'readonly', (s) => s.getAll() as IDBRequest<GameRecord[]>)) ?? []).filter((r) => r?.v === 1),
    get: async (id) => (await run<GameRecord>(RECS, 'readonly', (s) => s.get(id) as IDBRequest<GameRecord>)) ?? null,
    put: async (r) => void (await run(RECS, 'readwrite', (s) => s.put(r, r.id))),
    putLog: async (id, t) => void (await run(LOGS, 'readwrite', (s) => s.put(t, id))),
    getLog: async (id) => (await run<string>(LOGS, 'readonly', (s) => s.get(id) as IDBRequest<string>)) ?? null,
    remove: async (id) => {
      await run(RECS, 'readwrite', (s) => s.delete(id));
      await run(LOGS, 'readwrite', (s) => s.delete(id));
    },
  };
}

let defaultKV: HistoryKV | null = null;
export function historyKV(): HistoryKV {
  return (defaultKV ??= indexedDbKV() ?? memoryKV());
}

/**
 * Saves the record of a finished game (and its log, when small enough).
 * Idempotent per game; never throws — a failed save must not disturb play.
 */
export async function recordFinishedGame(log: GameLog | null, kv: HistoryKV = historyKV(), maxLogChars = MAX_LOG_CHARS): Promise<GameRecord | null> {
  try {
    if (!log) return null;
    const rec = recordFromLog(log);
    if (!rec) return null;
    const text = logToText(log);
    if (text.length <= maxLogChars) {
      await kv.putLog(rec.id, text);
      rec.hasLog = true;
    }
    await kv.put(rec);
    return rec;
  } catch {
    return null;
  }
}

/** Every record, newest first. */
export async function loadHistory(kv: HistoryKV = historyKV()): Promise<GameRecord[]> {
  try {
    return sortNewest(await kv.all());
  } catch {
    return [];
  }
}

export function sortNewest(recs: GameRecord[]): GameRecord[] {
  return [...recs].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.id < b.id ? 1 : -1));
}

// ---------------------------------------------------------------------------
// Numbers

export interface RecordSummary {
  matches: number;
  wins: number;
  losses: number;
  draws: number;
  /** wins / (wins + losses); null with no decisive game. */
  winRate: number | null;
  /** Wins in a row up to the newest game. */
  streak: number;
  bestStreak: number;
}

/** `recs` newest first (as loadHistory returns them). */
export function summarize(recs: GameRecord[]): RecordSummary {
  const wins = recs.filter((r) => r.result === 'win').length;
  const losses = recs.filter((r) => r.result === 'loss').length;
  const draws = recs.length - wins - losses;
  let streak = 0;
  for (const r of recs) {
    if (r.result !== 'win') break;
    streak++;
  }
  let best = 0;
  let run = 0;
  for (const r of recs) {
    run = r.result === 'win' ? run + 1 : 0;
    best = Math.max(best, run);
  }
  return { matches: recs.length, wins, losses, draws, winRate: wins + losses ? wins / (wins + losses) : null, streak, bestStreak: best };
}

/** The last `n` results, oldest first (reads left to right into today). `recs` newest first. */
export function recentForm(recs: GameRecord[], n = 10): GameResult[] {
  return recs.slice(0, n).map((r) => r.result).reverse();
}

export type BreakdownKey = 'yourDeck' | 'aiProfile' | 'aiDeck';

export interface BreakdownRow {
  key: string;
  matches: number;
  wins: number;
  losses: number;
  draws: number;
  winRate: number | null;
  /** The last ten results, oldest first. */
  recent: GameResult[];
  last: string;
}

/** Results grouped by your deck, the AI's profile or the AI's deck; most played first. `recs` newest first. */
export function breakdown(recs: GameRecord[], key: BreakdownKey, unknown = 'Unknown'): BreakdownRow[] {
  const groups = new Map<string, GameRecord[]>();
  for (const r of recs) {
    const k = r[key] ?? unknown;
    const g = groups.get(k) ?? [];
    g.push(r);
    groups.set(k, g);
  }
  return [...groups.entries()]
    .map(([k, g]) => {
      const s = summarize(g);
      return { key: k, matches: s.matches, wins: s.wins, losses: s.losses, draws: s.draws, winRate: s.winRate, recent: recentForm(g, 10), last: g[0]!.date };
    })
    .sort((a, b) => b.matches - a.matches || (a.last < b.last ? 1 : -1) || a.key.localeCompare(b.key));
}

/** "Sep 27, 2026 · 2:45 PM" in the viewer's zone (`timeZone` for tests). */
export function formatWhen(iso: string, timeZone?: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const date = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone });
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone });
  return `${date} · ${time}`;
}

/*
 * ForgeCoach — ui/play/adviceStore.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The live coach's advice, kept across a page reload. Pure and DOM-free; the
 * storage is injected (sessionStorage in the browser: it lives as long as the
 * tab, survives a reload, and is read synchronously, so the board's first
 * render already has the plan and auto-coach does not ask for it again).
 *
 * What is kept, per game seat (autoPlan.ts `gameKeyOf`: feedback.ts's
 * `gameId|seed|startedAt` and the seat): the cycles whose plan was asked, and
 * the newest `MAX_ADVICE` entries — the plan, your own questions, "Earlier
 * advice" — each with its answer's text and how it ended. Only the newest
 * `MAX_STORED_GAMES` games are kept, and each answer's text is capped, so the
 * whole record stays a few tens of KB at most. No board, no prompt: an entry
 * keeps the frame it was asked at, and the board is the log's.
 *
 * A plan whose answer had not finished when the page went away (it was still
 * streaming) is kept with its text, but its cycle is not marked asked, so
 * auto-coach asks it again; a finished, stopped or failed plan is final until
 * Ask again or the next cycle.
 *
 * Plan mode (mtg-table D419) keeps the same way the moments auto-coach asked
 * (`moments`) and, per entry, its moment (question, kind, the engine question's
 * answers) and which attempt it is, so the plan's steps can be checked again
 * after a reload.
 */
import type { AnswerStatus } from '../answers.ts';
import type { PlanMoment } from './autoPlan.ts';
import type { Choice, ChoiceQuestion } from '../../livePlan/prompt.ts';

export const ADVICE_STORE_KEY = 'forgecoach.liveAdvice.v1';
/** How many games' advice is kept (the newest). */
export const MAX_STORED_GAMES = 4;
/** Entries kept per game (autoPlan.ts keeps as many in memory). */
export const MAX_STORED_ENTRIES = 12;
/** Characters of one answer's text that are kept. */
export const MAX_ANSWER_CHARS = 6000;

export interface StoredAnswer {
  /** 'done', 'stopped' or 'error'; an answer still running when saved is kept as 'stopped' with `cut`. */
  status: Extract<AnswerStatus, 'done' | 'stopped' | 'error'>;
  text: string;
  model: string | null;
  source: 'helper' | 'apiKey' | null;
  refused: boolean;
  stopReasonNote: string | null;
  error: string | null;
  /** The page went away while it was still being written. */
  cut?: true;
}

export interface StoredEntry {
  key: string;
  kind: 'plan' | 'ask';
  label: string;
  forTurn: number | null;
  /** The log frame it was asked at (its moment, and its feedback target). */
  frameIndex: number;
  /** The turn of the state at that frame: a log that is not the same one again does not get its moment back. */
  turn: number | null;
  seq: number;
  answer: StoredAnswer | null;
  /** Plan mode: the moment and the attempt. */
  moment?: PlanMoment;
  attempt?: number;
}

export interface StoredGame {
  game: string;
  /** When it was last saved (ms): the oldest games are dropped first. */
  at: number;
  /** The turns whose plan auto-coach asked for, and got an answer to. */
  plans: number[];
  /** Plan mode: the moments auto-coach asked, and got an answer to. */
  moments?: string[];
  entries: StoredEntry[];
}

type Read = Pick<Storage, 'getItem'>;
type Write = Pick<Storage, 'getItem' | 'setItem'>;

const isStr = (x: unknown): x is string => typeof x === 'string';
const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

function cleanAnswer(a: unknown): StoredAnswer | null {
  if (!a || typeof a !== 'object') return null;
  const o = a as Record<string, unknown>;
  if (o.status !== 'done' && o.status !== 'stopped' && o.status !== 'error') return null;
  if (!isStr(o.text)) return null;
  return {
    status: o.status,
    text: o.text.slice(0, MAX_ANSWER_CHARS),
    model: isStr(o.model) ? o.model : null,
    source: o.source === 'helper' || o.source === 'apiKey' ? o.source : null,
    refused: o.refused === true,
    stopReasonNote: isStr(o.stopReasonNote) ? o.stopReasonNote : null,
    error: isStr(o.error) ? o.error.slice(0, 500) : null,
    ...(o.cut === true ? { cut: true as const } : {}),
  };
}

const KINDS = new Set(['mulligan', 'play-draw', 'turn', 'response', 'blocks', 'end-step', 'question', 'now']);

function cleanChoice(c: unknown): Choice | null {
  if (!c || typeof c !== 'object') return null;
  const o = c as Record<string, unknown>;
  if (!isStr(o.label)) return null;
  return {
    label: o.label.slice(0, 300),
    ...(isNum(o.cardId) ? { cardId: o.cardId } : {}),
    ...(isNum(o.playerId) ? { playerId: o.playerId } : {}),
    ...(typeof o.value === 'boolean' ? { value: o.value } : {}),
  };
}

function cleanAsk(a: unknown): ChoiceQuestion | null {
  if (!a || typeof a !== 'object') return null;
  const o = a as Record<string, unknown>;
  if (!isStr(o.prompt) || !Array.isArray(o.choices) || !isNum(o.min) || !isNum(o.max)) return null;
  const choices = o.choices.slice(0, 60).map(cleanChoice).filter((x): x is Choice => x !== null);
  return { prompt: o.prompt.slice(0, 1000), choices, min: o.min, max: o.max, ...(isNum(o.cardId) ? { cardId: o.cardId } : {}) };
}

function cleanMoment(m: unknown): PlanMoment | null {
  if (!m || typeof m !== 'object') return null;
  const o = m as Record<string, unknown>;
  if (!isStr(o.kind) || !KINDS.has(o.kind) || !isStr(o.id) || !isStr(o.question) || !isStr(o.label)) return null;
  const ask = cleanAsk(o.ask);
  return {
    kind: o.kind as PlanMoment['kind'],
    id: o.id.slice(0, 300),
    question: o.question.slice(0, 4000),
    label: o.label.slice(0, 200),
    ...(o.atAttack === true ? { atAttack: true } : {}),
    ...(ask ? { ask } : {}),
  };
}

function cleanEntry(e: unknown): StoredEntry | null {
  if (!e || typeof e !== 'object') return null;
  const o = e as Record<string, unknown>;
  if (!isStr(o.key) || (o.kind !== 'plan' && o.kind !== 'ask') || !isStr(o.label) || !isNum(o.frameIndex) || !isNum(o.seq)) return null;
  return {
    key: o.key,
    kind: o.kind,
    label: o.label.slice(0, 200),
    forTurn: isNum(o.forTurn) ? o.forTurn : null,
    frameIndex: o.frameIndex,
    turn: isNum(o.turn) ? o.turn : null,
    seq: o.seq,
    answer: cleanAnswer(o.answer),
    ...(cleanMoment(o.moment) ? { moment: cleanMoment(o.moment)! } : {}),
    ...(isNum(o.attempt) ? { attempt: o.attempt } : {}),
  };
}

function cleanGame(g: unknown): StoredGame | null {
  if (!g || typeof g !== 'object') return null;
  const o = g as Record<string, unknown>;
  if (!isStr(o.game) || !isNum(o.at) || !Array.isArray(o.plans) || !Array.isArray(o.entries)) return null;
  return {
    game: o.game,
    at: o.at,
    plans: o.plans.filter(isNum),
    ...(Array.isArray(o.moments) ? { moments: o.moments.filter(isStr).slice(0, 400) } : {}),
    entries: o.entries.map(cleanEntry).filter((x): x is StoredEntry => x !== null).slice(0, MAX_STORED_ENTRIES),
  };
}

function readAll(storage: Read | null): StoredGame[] {
  try {
    const raw = storage?.getItem(ADVICE_STORE_KEY);
    if (!raw) return [];
    const v = JSON.parse(raw) as { v?: unknown; games?: unknown };
    if (v?.v !== 1 || !Array.isArray(v.games)) return [];
    return v.games.map(cleanGame).filter((x): x is StoredGame => x !== null);
  } catch {
    return [];
  }
}

/** The kept advice of one game seat, or null (none, unreadable storage, or a corrupt record). */
export function loadStoredAdvice(storage: Read | null, game: string): StoredGame | null {
  return readAll(storage).find((g) => g.game === game) ?? null;
}

/** Keeps one game seat's advice (replacing what was kept for it). Never throws; false when it could not be written. */
export function saveStoredAdvice(storage: Write | null, g: StoredGame): boolean {
  if (!storage) return false;
  try {
    const one: StoredGame = {
      game: g.game,
      at: g.at,
      plans: [...new Set(g.plans)].sort((a, b) => a - b),
      ...(g.moments?.length ? { moments: [...new Set(g.moments)].slice(-400) } : {}),
      entries: g.entries.slice(0, MAX_STORED_ENTRIES).map((e) => (e.answer ? { ...e, answer: { ...e.answer, text: e.answer.text.slice(0, MAX_ANSWER_CHARS) } } : e)),
    };
    const games = [one, ...readAll(storage).filter((x) => x.game !== g.game)].sort((a, b) => b.at - a.at).slice(0, MAX_STORED_GAMES);
    storage.setItem(ADVICE_STORE_KEY, JSON.stringify({ v: 1, games }));
    return true;
  } catch {
    return false;
  }
}

/** sessionStorage when the page has one (guarded: a private window may throw on access). */
export function sessionAdviceStorage(): Write | null {
  try {
    return typeof sessionStorage === 'undefined' || sessionStorage === null ? null : sessionStorage;
  } catch {
    return null;
  }
}

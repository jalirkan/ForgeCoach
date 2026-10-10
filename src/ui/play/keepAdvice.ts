/*
 * ForgeCoach — ui/play/keepAdvice.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Between the live coach's memory (autoPlan.ts's advice, answers.ts's answers)
 * and what is kept across a reload (adviceStore.ts). PlayCoach calls
 * `restoreKeptAdvice` once a game is known, before auto-coach looks at whether
 * this cycle's plan was asked, and `persistAdvice` when advice is asked and
 * when an answer ends.
 */
import type { GameLog } from '../../log.ts';
import type { GameStateBody } from '../../protocol.ts';
import { getAnswer, onAnswerSettled, restoreAnswer, type Answer } from '../answers.ts';
import { baseAnswerKey, gameAdvice, gameOfKey, knownGames, momentAnswerKey, planKey, restoreAdvice, type AdviceEntry } from './autoPlan.ts';
import { loadStoredAdvice, saveStoredAdvice, sessionAdviceStorage, type StoredAnswer, type StoredEntry } from './adviceStore.ts';
import { liveDecision } from './liveDecision.ts';
import { answerWasShown, coachUseStorage, noteAnswerShown } from '../../coachUse.ts';

type Store = Pick<Storage, 'getItem' | 'setItem'>;

const ENDED = new Set(['done', 'stopped', 'error']);

function keptAnswer(a: Answer | undefined): StoredAnswer | null {
  if (!a) return null;
  const base = { text: a.text, model: a.model, source: a.source, refused: a.refused, stopReasonNote: a.stopReasonNote ?? null, error: a.error };
  if (ENDED.has(a.status)) return { ...base, status: a.status as StoredAnswer['status'] };
  // Still on its way: what it had, marked cut (its plan is asked again after a reload).
  return a.text ? { ...base, status: 'stopped', stopReasonNote: 'reload', cut: true } : null;
}

/**
 * mtg-table D414: an answer that ended with text on the play screen counts once
 * for its game's coach use (a game noted by PlayView: against the AI only).
 */
export function countShownAnswer(key: string, storage: Store | null = coachUseStorage(), now: () => number = Date.now): boolean {
  const game = gameOfKey(key);
  const a = getAnswer(key);
  if (!game || !answerWasShown(a)) return false;
  const kind = gameAdvice(game)?.entries.find((e) => e.key === key)?.kind ?? 'ask';
  return noteAnswerShown(storage, game, { key, kind, model: a!.model, source: a!.source }, now);
}

/** Saves one game seat's advice and answers as they are now. False when there is nothing to keep or no storage. */
export function persistAdvice(game: string, storage: Store | null, log: GameLog | null, now: () => number = Date.now): boolean {
  const g = gameAdvice(game);
  if (!g || !storage) return false;
  const entries: StoredEntry[] = g.entries.map((e) => {
    const f = log?.frames[e.frameIndex];
    const turn = e.decision?.state.turn ?? (f?.type === 'state' ? ((f.body as GameStateBody).turn ?? null) : null);
    return {
      key: e.key,
      kind: e.kind,
      label: e.label,
      forTurn: e.forTurn,
      frameIndex: e.frameIndex,
      turn,
      seq: e.seq,
      answer: keptAnswer(getAnswer(e.key)),
      ...(e.moment ? { moment: e.moment } : {}),
      ...(e.attempt !== undefined ? { attempt: e.attempt } : {}),
    };
  });
  // A cycle counts as asked once its plan has an answer that ended; one cut short by the reload is asked again.
  const plans = [...g.plans].filter((t) => {
    const e = entries.find((x) => x.key === planKey(game, t));
    if (!e) return true;
    return !!e.answer && !e.answer.cut;
  });
  // Plan mode: the same for the moments (an entry's key may be a correction's, `~c<n>`).
  const moments = [...g.moments].filter((id) => {
    const e = entries.find((x) => baseAnswerKey(x.key) === momentAnswerKey(game, id));
    if (!e) return true;
    return !!e.answer && !e.answer.cut;
  });
  return saveStoredAdvice(storage, { game, at: now(), plans, moments, entries });
}

/**
 * Puts a game seat's kept advice back after a reload: the entries (each with its
 * moment, rebuilt from the log when the log has that frame), their answers, and
 * the cycles whose plan was asked. Does nothing when this page already has advice
 * for the game. Returns whether anything was restored.
 */
export function restoreKeptAdvice(game: string, storage: Pick<Storage, 'getItem'> | null, log: GameLog, seat: number): boolean {
  if (gameAdvice(game)?.entries.length) return false;
  const kept = loadStoredAdvice(storage, game);
  if (!kept || (!kept.entries.length && !kept.plans.length && !kept.moments?.length)) return false;
  const entries: AdviceEntry[] = kept.entries.map((e) => ({
    key: e.key,
    kind: e.kind,
    label: e.label,
    forTurn: e.forTurn,
    frameIndex: e.frameIndex,
    seq: e.seq,
    decision: momentAt(log, e.frameIndex, e.turn, seat),
    ...(e.moment ? { moment: e.moment } : {}),
    ...(e.attempt !== undefined ? { attempt: e.attempt } : {}),
  }));
  if (!restoreAdvice(game, entries, kept.plans, kept.moments ?? [])) return false;
  for (const e of kept.entries) if (e.answer) restoreAnswer(e.key, e.answer);
  return true;
}

function momentAt(log: GameLog, frameIndex: number, turn: number | null, seat: number) {
  const f = log.frames[frameIndex];
  if (!f || f.type !== 'state') return null;
  const state = f.body as GameStateBody;
  if (turn !== null && state.turn !== turn) return null;
  try {
    return liveDecision({ log: { ...log, frames: log.frames.slice(0, frameIndex + 1) }, state, input: null, ask: null, seat });
  } catch {
    return null;
  }
}

let installed = false;
/**
 * Keeps answers as they end, also while the coach panel is folded away (and so
 * unmounted), and what a running answer had when the page goes away. Once per page.
 */
export function keepAdviceInBrowser(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  const storage = sessionAdviceStorage();
  onAnswerSettled((key) => {
    const game = gameOfKey(key);
    if (game) persistAdvice(game, storage, null);
    countShownAnswer(key);   // mtg-table D414: coach use per game
  });
  window.addEventListener('pagehide', () => {
    for (const game of knownGames()) persistAdvice(game, storage, null);
  });
}

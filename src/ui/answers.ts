/*
 * ForgeCoach — ui/answers.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * In-memory store of coach answers, keyed per decision (and one for the
 * review). Streams keep running when the user scrubs away; the panel shows
 * whatever the store has for the selected key.
 */
import { useSyncExternalStore } from 'react';
import { askClaude, loadSettings, type AskPrompt, type CoachResult, type Settings, type StreamHandlers } from '../claude.ts';
import { askHelper, chooseSource, detectHelper, helperFresh, helperThinking, pageHelperTarget, peekHelper, type ActiveSource, type SourceNeed } from '../coachHelper.ts';

/** 'queued': the coach helper has it in line behind another question (D325). */
export type AnswerStatus = 'preparing' | 'queued' | 'streaming' | 'done' | 'stopped' | 'error';

export interface Answer {
  status: AnswerStatus;
  text: string;
  thinking: string;
  refused: boolean;
  model: string | null;
  stopReason: string | null;
  error: string | null;
  /** CoachError kind ('no_key', 'auth', …) when the error came from claude.ts. */
  errorKind: string | null;
  /** Set when a server-side fallback answered instead of the chosen model. */
  fallbackFrom: string | null;
  /** Who is answering: Claude Code on the player's PC (the coach helper) or the API key. */
  source: ActiveSource | null;
  /** While queued: how many questions are ahead of this one. */
  queuePosition: number | null;
  /** Why it stopped, when it was not the player's Stop ('superseded', 'moved_on'). */
  stopReasonNote?: string | null;
  /**
   * Claude Code on the PC is working on it and no text has come yet: the time
   * (ms) its turn began — when the request went out, or at the helper's
   * `running` line after a wait in its queue. Null once the first word arrives,
   * while queued, and for the API key (which streams its own thinking).
   */
  thinkingSince: number | null;
}

const answers = new Map<string, Answer>();
const controllers = new Map<string, AbortController>();
const listeners = new Set<() => void>();
let scheduled = false;

function notify() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    for (const l of listeners) l();
  });
}

function set(key: string, patch: Partial<Answer>) {
  const prev = answers.get(key) ?? {
    status: 'preparing' as const,
    text: '',
    thinking: '',
    refused: false,
    model: null,
    stopReason: null,
    error: null,
    errorKind: null,
    fallbackFrom: null,
    source: null,
    queuePosition: null,
    thinkingSince: null,
  };
  answers.set(key, { ...prev, ...patch });
  notify();
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** Current answer for a key (non-reactive; for tests and handlers). */
export function getAnswer(key: string): Answer | undefined {
  return answers.get(key);
}

export function useAnswer(key: string | null): Answer | undefined {
  return useSyncExternalStore(subscribe, () => (key ? answers.get(key) : undefined));
}

/** True when any answer exists for the key (for timeline dots). */
export function useAnsweredKeys(): Map<string, Answer> {
  return useSyncExternalStore(subscribe, () => answersSnapshot());
}
let snap: Map<string, Answer> = new Map();
let snapSize = -1;
let snapVersion = 0;
let lastVersion = -1;
function answersSnapshot() {
  if (snapSize !== answers.size || lastVersion !== snapVersion) {
    snap = new Map(answers);
    snapSize = answers.size;
    lastVersion = snapVersion;
  }
  return snap;
}

export function clearAnswers(): void {
  for (const c of controllers.values()) c.abort();
  controllers.clear();
  answers.clear();
  snapVersion++;
  notify();
}

export interface StartOptions {
  /**
   * A key shared by the questions that replace each other (the live coach of
   * one tab): sent to a coach helper that supports it, so a stale question still
   * waiting in its queue is dropped there too (D325).
   */
  supersedes?: string;
  /** The clock for `thinkingSince` (tests). */
  now?: () => number;
  /**
   * 'vision': the prompt carries photos (photo to pool, D362): 'auto' then
   * takes the coach helper only when its /health says it reads them.
   */
  need?: SourceNeed;
}

export async function startAnswer(key: string, makePrompt: () => Promise<AskPrompt>, opts: StartOptions = {}): Promise<void> {
  const now = opts.now ?? Date.now;
  controllers.get(key)?.abort();
  const ctrl = new AbortController();
  controllers.set(key, ctrl);
  answers.delete(key);
  snapVersion++;
  // Everything this run writes goes through `own`: once a newer startAnswer for the
  // same key has taken over (or clearAnswers dropped it), a late reply of this one
  // -- its cancellation, a queue line, a final answer -- must not land on the new one.
  const mine = () => controllers.get(key) === ctrl;
  const own = (patch: Partial<Answer>) => {
    if (mine()) set(key, patch);
  };
  const settings = safeSettings();
  // Auto: is Claude Code on the PC reachable? (Cached; at most ~800 ms when it isn't known.)
  let helper = peekHelper();
  if (settings.coachSource === 'auto' && !helperFresh()) {
    own({ status: 'preparing' });
    helper = await detectHelper();
    if (ctrl.signal.aborted || controllers.get(key) !== ctrl) return;
  }
  const source = chooseSource(settings, helper, opts.need);
  if (!source) {
    // Nothing to answer with: say so now, before building the prompt or fetching any card text.
    own({ status: 'error', error: noCoachMessage(settings, opts.need), errorKind: 'no_key' });
    controllers.delete(key);
    return;
  }
  // D346: a thinking cap goes only to a helper that lists it, so learn what it lists first.
  const wantThinking = settings.coachThinking ?? 'default';
  if (source === 'helper' && wantThinking !== 'default' && !(helper?.state === 'ok' && helperFresh())) {
    own({ status: 'preparing', source });
    helper = await detectHelper();
    if (ctrl.signal.aborted || controllers.get(key) !== ctrl) return;
  }
  const thinking = source === 'helper' ? helperThinking(helper, wantThinking) : undefined;
  own({ status: 'preparing', source });
  try {
    const prompt = await makePrompt();
    if (ctrl.signal.aborted) return;
    own({ status: 'streaming', thinkingSince: source === 'helper' ? now() : null });
    const handlers: StreamHandlers = {
      onText: (d) => own({ status: 'streaming', queuePosition: null, thinkingSince: null, text: (answers.get(key)?.text ?? '') + d }),
      onThinking: (d) => own({ status: 'streaming', queuePosition: null, thinking: (answers.get(key)?.thinking ?? '') + d }),
    };
    const supersedes = opts.supersedes && helper?.state === 'ok' && helper.supersedes ? opts.supersedes : undefined;
    const res: CoachResult =
      source === 'helper'
        ? await askHelper(prompt, handlers, {
            signal: ctrl.signal,
            model: settings.model,
            target: pageHelperTarget(),
            ...(supersedes ? { supersedes } : {}),
            ...(thinking ? { thinking } : {}),
            onQueued: (n) => {
              if (!ctrl.signal.aborted) own({ status: 'queued', queuePosition: n, thinkingSince: null });
            },
            onRunning: () => {
              if (!ctrl.signal.aborted) own({ status: 'streaming', queuePosition: null, thinkingSince: answers.get(key)?.text ? null : now() });
            },
          })
        : await askClaude(prompt, handlers, { signal: ctrl.signal, settings });
    own({
      status: 'done',
      text: res.text || answers.get(key)?.text || '',
      refused: res.refused,
      model: res.model,
      stopReason: res.stopReason,
      fallbackFrom: res.fallbackFrom ?? null,
      thinkingSince: null,
    });
  } catch (e) {
    if (answers.get(key)?.thinkingSince != null) own({ thinkingSince: null });
    if (ctrl.signal.aborted) {
      own({ status: 'stopped', queuePosition: null });
    } else {
      const kind = e && typeof e === 'object' && 'kind' in e ? String((e as { kind: unknown }).kind) : null;
      if (kind === 'aborted') own({ status: 'stopped', queuePosition: null });
      else if (kind === 'superseded') own({ status: 'stopped', queuePosition: null, stopReasonNote: 'superseded' });
      else own({ status: 'error', error: e instanceof Error ? e.message : String(e), errorKind: kind });
    }
  } finally {
    if (controllers.get(key) === ctrl) controllers.delete(key);
  }
}

function safeSettings(): Settings {
  try {
    return loadSettings();
  } catch {
    return { apiKey: '', model: 'claude-opus-5-5', coachSource: 'auto', answerFirst: false, coachThinking: 'default' };
  }
}

/** Why nothing can answer, and what to do about it. */
export function noCoachMessage(s: Pick<Settings, 'coachSource'>, need?: SourceNeed): string {
  if (need === 'vision') {
    if (s.coachSource === 'apiKey') return 'Add your Anthropic API key in Settings to read photos.';
    return 'Nothing can read photos yet. Start `./scripts/play.sh` in mtg-table (Claude Code on your PC reads them), or add an Anthropic API key in Settings.';
  }
  if (s.coachSource === 'apiKey') return 'Add your Anthropic API key to ask the coach — or copy the prompt and paste it into the Claude app.';
  return 'No coach connected. Start `./scripts/play.sh` in mtg-table to coach with Claude Code on your PC, or add an Anthropic API key in Settings — or copy the prompt and paste it into the Claude app.';
}

export function stopAnswer(key: string, note: string | null = null): void {
  const c = controllers.get(key);
  if (c) {
    c.abort();
    set(key, { status: 'stopped', queuePosition: null, thinkingSince: null, stopReasonNote: note });
  }
}

/** True while a question for `key` is being prepared, waits in a queue or streams. */
export function answerBusy(key: string): boolean {
  return controllers.has(key);
}

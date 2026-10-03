/*
 * ForgeCoach — ui/answers.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * In-memory store of coach answers, keyed per decision (and one for the
 * review). Streams keep running when the user scrubs away; the panel shows
 * whatever the store has for the selected key.
 */
import { useSyncExternalStore } from 'react';
import type { Prompt } from '../prompt.ts';
import { askClaude, loadSettings, type CoachResult, type Settings, type StreamHandlers } from '../claude.ts';
import { askHelper, chooseSource, detectHelper, helperFresh, pageHelperTarget, peekHelper, type ActiveSource } from '../coachHelper.ts';

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
}

export async function startAnswer(key: string, makePrompt: () => Promise<Prompt>, opts: StartOptions = {}): Promise<void> {
  controllers.get(key)?.abort();
  const ctrl = new AbortController();
  controllers.set(key, ctrl);
  answers.delete(key);
  snapVersion++;
  const settings = safeSettings();
  // Auto: is Claude Code on the PC reachable? (Cached; at most ~800 ms when it isn't known.)
  let helper = peekHelper();
  if (settings.coachSource === 'auto' && !helperFresh()) {
    set(key, { status: 'preparing' });
    helper = await detectHelper();
    if (ctrl.signal.aborted || controllers.get(key) !== ctrl) return;
  }
  const source = chooseSource(settings, helper);
  if (!source) {
    // Nothing to answer with: say so now, before building the prompt or fetching any card text.
    set(key, { status: 'error', error: noCoachMessage(settings), errorKind: 'no_key' });
    controllers.delete(key);
    return;
  }
  set(key, { status: 'preparing', source });
  try {
    const prompt = await makePrompt();
    if (ctrl.signal.aborted) return;
    set(key, { status: 'streaming' });
    const handlers: StreamHandlers = {
      onText: (d) => set(key, { status: 'streaming', queuePosition: null, text: (answers.get(key)?.text ?? '') + d }),
      onThinking: (d) => set(key, { status: 'streaming', queuePosition: null, thinking: (answers.get(key)?.thinking ?? '') + d }),
    };
    const supersedes = opts.supersedes && helper?.state === 'ok' && helper.supersedes ? opts.supersedes : undefined;
    const res: CoachResult =
      source === 'helper'
        ? await askHelper(prompt, handlers, {
            signal: ctrl.signal,
            model: settings.model,
            target: pageHelperTarget(),
            ...(supersedes ? { supersedes } : {}),
            onQueued: (n) => {
              if (!ctrl.signal.aborted) set(key, { status: 'queued', queuePosition: n });
            },
            onRunning: () => {
              if (!ctrl.signal.aborted) set(key, { status: 'streaming', queuePosition: null });
            },
          })
        : await askClaude(prompt, handlers, { signal: ctrl.signal, settings });
    set(key, {
      status: 'done',
      text: res.text || answers.get(key)?.text || '',
      refused: res.refused,
      model: res.model,
      stopReason: res.stopReason,
      fallbackFrom: res.fallbackFrom ?? null,
    });
  } catch (e) {
    if (ctrl.signal.aborted) {
      set(key, { status: 'stopped', queuePosition: null });
    } else {
      const kind = e && typeof e === 'object' && 'kind' in e ? String((e as { kind: unknown }).kind) : null;
      if (kind === 'aborted') set(key, { status: 'stopped', queuePosition: null });
      else if (kind === 'superseded') set(key, { status: 'stopped', queuePosition: null, stopReasonNote: 'superseded' });
      else set(key, { status: 'error', error: e instanceof Error ? e.message : String(e), errorKind: kind });
    }
  } finally {
    if (controllers.get(key) === ctrl) controllers.delete(key);
  }
}

function safeSettings(): Settings {
  try {
    return loadSettings();
  } catch {
    return { apiKey: '', model: 'claude-opus-5-5', coachSource: 'auto', answerFirst: false };
  }
}

/** Why nothing can answer, and what to do about it. */
export function noCoachMessage(s: Pick<Settings, 'coachSource'>): string {
  if (s.coachSource === 'apiKey') return 'Add your Anthropic API key to ask the coach — or copy the prompt and paste it into the Claude app.';
  return 'No coach connected. Start `./scripts/play.sh` in mtg-table to coach with Claude Code on your PC, or add an Anthropic API key in Settings — or copy the prompt and paste it into the Claude app.';
}

export function stopAnswer(key: string, note: string | null = null): void {
  const c = controllers.get(key);
  if (c) {
    c.abort();
    set(key, { status: 'stopped', queuePosition: null, stopReasonNote: note });
  }
}

/** True while a question for `key` is being prepared, waits in a queue or streams. */
export function answerBusy(key: string): boolean {
  return controllers.has(key);
}

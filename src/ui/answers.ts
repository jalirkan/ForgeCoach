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
import { askClaude, hasKey } from '../claude.ts';

export type AnswerStatus = 'preparing' | 'streaming' | 'done' | 'stopped' | 'error';

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

export async function startAnswer(key: string, makePrompt: () => Promise<Prompt>): Promise<void> {
  controllers.get(key)?.abort();
  const ctrl = new AbortController();
  controllers.set(key, ctrl);
  answers.delete(key);
  snapVersion++;
  if (!hasKey()) {
    // No key: say so now, before building the prompt or fetching any card text.
    set(key, { status: 'error', error: 'Add your Anthropic API key to ask the coach — or copy the prompt and paste it into the Claude app.', errorKind: 'no_key' });
    controllers.delete(key);
    return;
  }
  set(key, { status: 'preparing' });
  try {
    const prompt = await makePrompt();
    if (ctrl.signal.aborted) return;
    set(key, { status: 'streaming' });
    const res = await askClaude(
      prompt,
      {
        onText: (d) => set(key, { text: (answers.get(key)?.text ?? '') + d }),
        onThinking: (d) => set(key, { thinking: (answers.get(key)?.thinking ?? '') + d }),
      },
      { signal: ctrl.signal },
    );
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
      set(key, { status: 'stopped' });
    } else {
      const kind = e && typeof e === 'object' && 'kind' in e ? String((e as { kind: unknown }).kind) : null;
      if (kind === 'aborted') set(key, { status: 'stopped' });
      else set(key, { status: 'error', error: e instanceof Error ? e.message : String(e), errorKind: kind });
    }
  } finally {
    if (controllers.get(key) === ctrl) controllers.delete(key);
  }
}

export function stopAnswer(key: string): void {
  const c = controllers.get(key);
  if (c) {
    c.abort();
    set(key, { status: 'stopped' });
  }
}

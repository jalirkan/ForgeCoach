/*
 * ForgeCoach — bug/context.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * What the screen on top knows, for a bug report (mtg-table D411). A screen
 * registers a provider while it is mounted (`pushBugContext`; ui/bug's
 * `useBugContext` hook); the newest one wins, so the replay opened over a live
 * table reports the replay, and closing it gives the table back. The provider
 * is called only when a report is made, so a screen pays nothing until then.
 *
 * Also the one way to open the panel from anywhere (`openBugReport`): the top
 * bar's button, the phone menu's item, the Shift+B key.
 *
 * DOM-free.
 */
import { EMPTY_SNAPSHOT, type BugSnapshot } from './report.ts';

type Provider = () => BugSnapshot;

const stack: Array<{ id: number; get: Provider }> = [];
let next = 1;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

/** Registers `get` as the top screen's context; returns its removal. */
export function pushBugContext(get: Provider): () => void {
  const id = next++;
  stack.push({ id, get });
  notify();
  return () => {
    const i = stack.findIndex((x) => x.id === id);
    if (i >= 0) stack.splice(i, 1);
    notify();
  };
}

/** The top screen's context now (or an empty one: a report still works from any page). */
export function currentBugSnapshot(): BugSnapshot {
  const top = stack[stack.length - 1];
  if (!top) return EMPTY_SNAPSHOT;
  try {
    return top.get();
  } catch {
    return EMPTY_SNAPSHOT;
  }
}

/** Is a screen that has a bug button mounted? */
export function hasBugContext(): boolean {
  return stack.length > 0;
}

export function onBugContext(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

// ---------------------------------------------------------------------------
// Opening the panel

const openers = new Set<() => void>();

/** The panel's host registers here (ui/bug/BugReport.tsx). */
export function onOpenBugReport(l: () => void): () => void {
  openers.add(l);
  return () => openers.delete(l);
}

/** Opens the "Report a bug" panel. */
export function openBugReport(): void {
  openers.forEach((l) => l());
}

/** Test hook: forget every registration. */
export function resetBugContext(): void {
  stack.splice(0);
  listeners.clear();
  openers.clear();
}

/*
 * ForgeCoach — ui/play/coachAsk.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The decision panel's Ask now, when Claude is the coach: the Coach panel
 * (PlanCoach / the Short and Detailed styles) says here how to ask about the
 * moment on screen, or null when there is nothing to ask (the moment already
 * has advice, or no decision is open). One per page.
 */
import { useSyncExternalStore } from 'react';

let current: (() => void) | null = null;
const listeners = new Set<() => void>();

export function setClaudeAsk(fn: (() => void) | null): void {
  if (fn === current) return;
  current = fn;
  for (const l of listeners) l();
}

export function useClaudeAsk(): (() => void) | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
    () => null,
  );
}

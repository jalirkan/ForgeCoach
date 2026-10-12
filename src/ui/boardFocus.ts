/*
 * ForgeCoach — ui/boardFocus.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The cards the coach's words point at right now: hovering (or tapping) a
 * coach step lights the cards it names on the board (CardTile's
 * `is-coach-focus`). One small store, read per tile with
 * useSyncExternalStore so only the tiles whose answer changes re-render.
 */
import { useSyncExternalStore } from 'react';

let focus: ReadonlySet<number> = new Set();
const listeners = new Set<() => void>();

export function setBoardFocus(ids: Iterable<number> | null): void {
  const next = new Set(ids ?? []);
  if (next.size === focus.size && [...next].every((x) => focus.has(x))) return;
  focus = next;
  for (const l of listeners) l();
}

export function boardFocus(): ReadonlySet<number> {
  return focus;
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** Whether any of these card ids is lit. */
export function useBoardFocus(...ids: number[]): boolean {
  return useSyncExternalStore(
    subscribe,
    () => ids.some((id) => focus.has(id)),
    () => false,
  );
}

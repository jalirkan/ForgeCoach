/*
 * ForgeCoach — bug/hotkey.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The "Report a bug" key: Shift+B, on every screen. Plain B belongs to the
 * play board (ui/play/playKeys.ts: pass until just before my turn); the bug
 * panel's host takes Shift+B in the capture phase, before the board's own
 * listener can read it as a B. Never while typing, and never with Ctrl, Cmd or
 * Alt (the browser's own shortcuts).
 */
export const BUG_HOTKEY_LABEL = 'Shift+B';

export interface BugKeyLike {
  key: string;
  code?: string;
  shiftKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  isComposing?: boolean;
  repeat?: boolean;
  targetTag?: string;
  targetEditable?: boolean;
}

export function isBugHotkey(e: BugKeyLike): boolean {
  if (!e.shiftKey || e.ctrlKey || e.metaKey || e.altKey || e.isComposing || e.repeat) return false;
  if (e.targetEditable) return false;
  const tag = (e.targetTag ?? '').toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return false;
  return e.key === 'B' || e.key === 'b' || e.code === 'KeyB';
}

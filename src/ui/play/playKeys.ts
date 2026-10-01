/*
 * ForgeCoach — ui/play/playKeys.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The play keyboard as one table and one pure planner. Adapted from
 * mtg-table's web/src/keys.ts (GPL-3.0-or-later, the mtg-table authors): the
 * same bindings where Forge has one, the engine's own `enabled` flags as the
 * only gates, and no rules logic.
 */
import type { ActBody, ManaColor } from '../../protocol.ts';
import { MANA_COLORS } from '../../protocol.ts';
import type { InputView } from './inputView.ts';

export interface KeyRow {
  chord: string;
  what: string;
}

export const PLAY_KEYS: KeyRow[] = [
  { chord: 'Space / Enter', what: 'the highlighted (primary) button — usually OK / pass' },
  { chord: 'Esc', what: 'the engine’s Cancel button (End Turn, Alpha Strike, Cancel…)' },
  { chord: 'P', what: 'pass priority once' },
  { chord: 'E', what: 'pass until end of turn (Cancel stops it)' },
  { chord: 'T', what: 'pass until my next turn' },
  { chord: 'B', what: 'pass until just before my turn (opponent’s end step)' },
  { chord: 'A', what: 'attack with everything (while declaring attackers)' },
  { chord: 'Ctrl+Z', what: 'undo the last mana tap' },
  { chord: 'W U B R G C', what: 'spend one floating mana of that colour' },
  { chord: '?', what: 'show this list' },
];

export interface KeyLike {
  key: string;
  code?: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  isComposing?: boolean;
  targetTag?: string;
  targetEditable?: boolean;
}

export interface PlayKeyContext {
  view: InputView;
  askOpen: boolean;
  over: boolean;
  canUndo: boolean;
  poolColors: readonly ManaColor[];
  /** Esc should close an overlay first. */
  overlay: boolean;
}

export type PlayKeyPlan =
  | { kind: 'ok' }
  | { kind: 'cancel' }
  | { kind: 'act'; body: ActBody; label: string }
  | { kind: 'help' }
  | { kind: 'closeOverlay' }
  | { kind: 'inert'; why: string };

function isTyping(e: KeyLike): boolean {
  if (e.targetEditable) return true;
  const t = (e.targetTag ?? '').toLowerCase();
  return t === 'input' || t === 'textarea' || t === 'select';
}

/** `null`: not ours — leave the event alone. */
export function planPlayKey(e: KeyLike, ctx: PlayKeyContext): PlayKeyPlan | null {
  if (e.isComposing || e.altKey || isTyping(e)) return null;
  const ctrl = !!(e.ctrlKey || e.metaKey);
  const key = (e.key || '').toLowerCase();
  const code = (e.code || '').toLowerCase();
  const tag = (e.targetTag ?? '').toLowerCase();

  if (key === 'escape') {
    if (ctx.overlay) return { kind: 'closeOverlay' };
    if (ctx.askOpen || ctx.over) return null; // the dialog owns Esc
    return ctx.view.cancel.enabled ? { kind: 'cancel' } : { kind: 'inert', why: 'Cancel is not available right now' };
  }
  if (ctx.overlay || ctx.askOpen) return null;
  if (ctrl) {
    if (key === 'z') return ctx.canUndo ? { kind: 'act', body: { action: 'undo' }, label: 'Undo' } : { kind: 'inert', why: 'nothing to undo — undo only takes back mana taps' };
    if (key === 'a' && ctx.view.mode === 'attack') return { kind: 'act', body: { action: 'alphaStrike' }, label: 'Attack with everything' };
    return null;
  }
  if (ctx.over) return null;

  // Floating mana takes its letter while it floats.
  const upper = (e.key || '').toUpperCase();
  const fromCode = code.startsWith('key') && code.length === 4 ? code.slice(3).toUpperCase() : '';
  const color = (MANA_COLORS as readonly string[]).includes(upper) ? (upper as ManaColor) : (MANA_COLORS as readonly string[]).includes(fromCode) ? (fromCode as ManaColor) : null;
  if (color && ctx.poolColors.includes(color)) return { kind: 'act', body: { action: 'useMana', color }, label: `Spend ${color}` };

  if (key === ' ' || key === 'enter' || code === 'space') {
    // A focused button activates itself; don't press twice.
    if (tag === 'button' || tag === 'a' || tag === 'summary') return null;
    if (ctx.view.primary === 'ok') return { kind: 'ok' };
    if (ctx.view.primary === 'cancel') return { kind: 'cancel' };
    return { kind: 'inert', why: ctx.view.needClick ? 'tap a highlighted card first' : 'nothing to confirm right now' };
  }
  switch (key) {
    case 'p':
      return { kind: 'act', body: { action: 'passPriority' }, label: 'Pass priority' };
    case 'e':
      return { kind: 'act', body: { action: 'yieldTo', kind: 'endOfTurn' }, label: 'Pass to end of turn' };
    case 't':
      return { kind: 'act', body: { action: 'yieldTo', kind: 'marker', phase: 'UPKEEP', turn: 'own' }, label: 'Pass to my turn' };
    case 'b':
      return { kind: 'act', body: { action: 'yieldTo', kind: 'marker', phase: 'END_OF_TURN', turn: 'opp' }, label: 'Pass to before my turn' };
    case 'a':
      return ctx.view.mode === 'attack'
        ? { kind: 'act', body: { action: 'alphaStrike' }, label: 'Attack with everything' }
        : { kind: 'inert', why: 'A attacks with everything — only while declaring attackers' };
    case '?':
    case 'h':
      return { kind: 'help' };
  }
  return null;
}

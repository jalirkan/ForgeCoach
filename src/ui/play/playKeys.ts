/*
 * ForgeCoach — ui/play/playKeys.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The play keyboard as one table and one pure planner. Adapted from
 * mtg-table's web/src/keys.ts (GPL-3.0-or-later, the mtg-table authors): the
 * same bindings where Forge has one, the engine's own `enabled` flags as the
 * only gates, and no rules logic.
 *
 * Two scopes that never meet: the board's keys (planPlayKey, below) while no
 * question is open, and the question's own (askKeys.ts) while one is — the act
 * guard sends nothing but concede behind an ask. KEY_BINDINGS lists both, and
 * playKeys.test.ts holds that no key does two things in one scope and mode.
 */
import type { ActBody, ManaColor } from '../../protocol.ts';
import { MANA_COLORS } from '../../protocol.ts';
import type { InputMode, InputView } from './inputView.ts';
import type { YieldLit } from './decisionModel.ts';

export interface KeyRow {
  chord: string;
  what: string;
}

export const PLAY_KEYS: KeyRow[] = [
  { chord: 'Space / Enter', what: 'the highlighted (primary) button — usually OK / pass; in a question, Confirm' },
  { chord: 'Esc', what: 'the engine’s Cancel button (End Turn, Cancel…); in a question, hide or show it (never declines — “Choose how to play”: never mind)' },
  { chord: '1 – 9', what: 'in a question, the option with that number (one pick answers at once; several pick toggles)' },
  { chord: 'P', what: 'pass priority once' },
  { chord: 'E', what: 'auto-pass: until end of turn (again, while it runs, to stop it)' },
  { chord: 'B', what: 'auto-pass: until just before my turn (their end step)' },
  { chord: 'T', what: 'auto-pass: until my next turn' },
  { chord: 'Y', what: 'auto-pass: until they cast something or attack you, or this turn’s end step (again, while it runs, to stop it)' },
  { chord: 'A', what: 'alpha strike while declaring attackers; Auto pay while paying' },
  { chord: 'Ctrl+Z', what: 'undo the last mana tap' },
  { chord: 'W U B R G C', what: 'spend one floating mana of that colour (B spends black while black floats)' },
  { chord: 'L', what: 'open the game log' },
  { chord: 'Shift+B', what: 'report a bug (this screen, with your recent game log)' },
  { chord: '?', what: 'show this list' },
];

/** Where a key works: on the board (no question open) or inside an open question. */
export type KeyScope = 'board' | 'ask';

export interface KeyBinding {
  /** Event keys, lowercased (`' '`, `'enter'`, `'escape'`, `'a'`, `'ctrl+z'`, `'1'`). */
  keys: readonly string[];
  scope: KeyScope;
  /** The input modes it works in; null: every mode. */
  modes: readonly InputMode[] | null;
  what: string;
  /** Wins over a letter binding while it applies (floating mana over B). */
  precedence?: boolean;
}

/** Every binding, by scope and mode: the table playKeys.test.ts checks for overlaps and against the planners. */
export const KEY_BINDINGS: readonly KeyBinding[] = [
  { keys: [' ', 'enter'], scope: 'board', modes: null, what: 'primary button' },
  { keys: ['escape'], scope: 'board', modes: null, what: 'engine Cancel' },
  { keys: ['p'], scope: 'board', modes: null, what: 'pass priority once' },
  { keys: ['e'], scope: 'board', modes: null, what: 'auto-pass: end of turn' },
  { keys: ['b'], scope: 'board', modes: null, what: 'auto-pass: before my turn' },
  { keys: ['t'], scope: 'board', modes: null, what: 'auto-pass: my next turn' },
  { keys: ['y'], scope: 'board', modes: null, what: 'auto-pass: until they act' },
  { keys: ['a', 'ctrl+a'], scope: 'board', modes: ['attack'], what: 'alpha strike' },
  { keys: ['a'], scope: 'board', modes: ['pay'], what: 'auto pay (the engine’s OK)' },
  { keys: ['ctrl+z'], scope: 'board', modes: null, what: 'undo' },
  { keys: ['w', 'u', 'b', 'r', 'g', 'c'], scope: 'board', modes: null, what: 'spend floating mana', precedence: true },
  { keys: ['l'], scope: 'board', modes: null, what: 'game log' },
  { keys: ['?', 'h'], scope: 'board', modes: null, what: 'keyboard help' },
  { keys: ['1', '2', '3', '4', '5', '6', '7', '8', '9'], scope: 'ask', modes: null, what: 'pick option n' },
  { keys: [' ', 'enter'], scope: 'ask', modes: null, what: 'confirm' },
  { keys: ['escape'], scope: 'ask', modes: null, what: 'hide / show (ability_menu: never mind)' },
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
  /** Which auto-pass toggle is lit (decisionModel.ts yieldLit): its key then stops it. */
  yieldLit?: YieldLit;
  /**
   * Why Y ("until they act", M64) must not send now — an engine that does not
   * offer it, or the end step (decisionModel.ts theyActWhyNot); null/absent: it may.
   */
  theyActWhyNot?: string | null;
}

export type PlayKeyPlan =
  | { kind: 'ok' }
  | { kind: 'cancel' }
  | { kind: 'act'; body: ActBody; label: string }
  | { kind: 'help' }
  | { kind: 'log' }
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
    return { kind: 'inert', why: ctx.view.needClick ? `tap a highlighted ${ctx.view.clickWhat === 'player' ? 'player' : 'card'} first` : 'nothing to confirm right now' };
  }
  // An auto-pass key on its lit toggle stops the yield: the engine's Cancel (there is no cancel-yield act).
  const stop = (lit: boolean | undefined, body: ActBody, label: string): PlayKeyPlan =>
    lit ? (ctx.view.cancel.enabled ? { kind: 'cancel' } : { kind: 'inert', why: 'the engine is not offering Cancel right now' }) : { kind: 'act', body, label };
  switch (key) {
    case 'p':
      return { kind: 'act', body: { action: 'passPriority' }, label: 'Pass priority' };
    case 'e':
      return stop(ctx.yieldLit?.eot, { action: 'yieldTo', kind: 'endOfTurn' }, 'Pass to end of turn');
    case 't':
      return stop(ctx.yieldLit?.myturn, { action: 'yieldTo', kind: 'marker', phase: 'UPKEEP', turn: 'own' }, 'Pass to my turn');
    case 'y':
      if (!ctx.yieldLit?.theyAct && ctx.theyActWhyNot) return { kind: 'inert', why: ctx.theyActWhyNot };
      return stop(ctx.yieldLit?.theyAct, { action: 'yieldTo', kind: 'endStepOrOpponent' }, 'Pass until they act');
    case 'b':
      return stop(ctx.yieldLit?.before, { action: 'yieldTo', kind: 'marker', phase: 'END_OF_TURN', turn: 'opp' }, 'Pass to before my turn');
    case 'a':
      if (ctx.view.mode === 'attack') return { kind: 'act', body: { action: 'alphaStrike' }, label: 'Attack with everything' };
      // Paying: A is the engine's OK, which Forge labels "Auto" (Auto pay).
      if (ctx.view.mode === 'pay') return ctx.view.ok.enabled ? { kind: 'ok' } : { kind: 'inert', why: 'Auto pay is not available right now' };
      return { kind: 'inert', why: 'A attacks with everything while declaring attackers, and auto-pays while paying' };
    case '?':
    case 'h':
      return { kind: 'help' };
    case 'l':
      return { kind: 'log' };
  }
  return null;
}

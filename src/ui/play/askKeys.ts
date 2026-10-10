/*
 * ForgeCoach — ui/play/askKeys.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The keyboard inside an engine question (an `ask`, or the opening keep /
 * play-draw dialog): one pure planner, tested in node (askKeys.test.ts).
 *
 *   1–9          the option with that number printed on it — a single pick
 *                answers at once (like a click on Endstep's `Keep 7 [1]`), a
 *                multiple pick toggles it
 *   Space/Enter  confirm, when the answer is valid (the same button a click
 *                would press); Space on a focused option is that option's own
 *   Esc          hide / show the question — it never declines. The one
 *                exception is "Choose how to play" (ability_menu), whose Esc
 *                is its safe "never mind" (nothing is played or paid).
 *
 * While a question is open the board's keys (playKeys.ts) are off — the act
 * guard sends nothing but concede behind an ask — so the two key sets never
 * meet (playKeys.test.ts holds that).
 */
import type { AskBody } from '../../protocol.ts';
import { choiceBounds, groupOptions, isCardList, isColorList, isNumberList } from './askModel.ts';

export interface AskKeyEvent {
  key: string;
  code?: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  isComposing?: boolean;
  repeat?: boolean;
  targetTag?: string;
  targetEditable?: boolean;
  /** The event's target is inside the question's box. */
  inAsk?: boolean;
  /** The target is one of the question's option buttons (`.ask-opt`). */
  onOption?: boolean;
  /** The target is inside another sheet (a card's details over the question): it owns its keys. */
  inSheet?: boolean;
}

export interface AskKeyContext {
  /** 'modal': the centred dialog; 'slot': inside the board's decision slot (no scrim, no trap). */
  placement: 'modal' | 'slot';
  /** The question is folded to its one-line peek. */
  minimized: boolean;
  /** Space / Enter has something to press. */
  canConfirm: boolean;
  /** How many options carry a printed digit (0–9). */
  digits: number;
  /** Esc is the question's safe way out (ability_menu's "never mind"). */
  escSkips: boolean;
}

export type AskKeyPlan = { kind: 'hide' } | { kind: 'skip' } | { kind: 'confirm' } | { kind: 'digit'; index: number };

const TYPING = new Set(['input', 'textarea', 'select']);
const NATIVE = new Set(['button', 'a', 'summary']);

/** 1..9 from the key or the code (Digit1 / Numpad1), else 0. */
export function digitOf(key: string, code = ''): number {
  if (/^[1-9]$/.test(key)) return Number(key);
  const m = /^(?:Digit|Numpad)([1-9])$/.exec(code);
  return m ? Number(m[1]) : 0;
}

/** `null`: not the question's key — leave it alone. */
export function planAskKey(e: AskKeyEvent, ctx: AskKeyContext): AskKeyPlan | null {
  if (e.inSheet) return null;
  const key = e.key;
  const tag = (e.targetTag ?? '').toLowerCase();
  if (key === 'Escape') return ctx.escSkips && !ctx.minimized ? { kind: 'skip' } : { kind: 'hide' };
  if (ctx.minimized) return null;
  if (e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return null;
  const typing = !!e.targetEditable || TYPING.has(tag);
  const enter = key === 'Enter';
  const space = key === ' ' || e.code === 'Space';
  if (enter || space) {
    if (e.repeat || tag === 'textarea') return null;
    // A text answer: Enter sends it, Space is a space.
    if (typing) return enter && ctx.canConfirm ? { kind: 'confirm' } : null;
    if (NATIVE.has(tag)) {
      // A focused option confirms on Enter (Space toggles it natively); any other button keeps its own keys.
      if (!(e.inAsk && e.onOption && enter)) return null;
    } else if (!e.inAsk && ctx.placement === 'modal' && tag !== 'body') {
      return null;
    }
    return ctx.canConfirm ? { kind: 'confirm' } : null;
  }
  if (typing || e.repeat) return null;
  const d = digitOf(key, e.code);
  if (d > 0 && d <= ctx.digits) return { kind: 'digit', index: d - 1 };
  return null;
}

/**
 * The options a digit picks, in the order the dialog draws (and numbers) them:
 * one id per row or chip, or a group of identical cards' ids where the card
 * grid collapses copies. At most nine. Empty for kinds without a digit
 * (text, order, manipulate_list, sideboard, assign_*, a reveal; confirm and
 * the opening dialog number their own two buttons).
 */
export function digitSlots(ask: AskBody): number[][] {
  let slots: number[][] = [];
  switch (ask.kind) {
    case 'ability_menu':
    case 'options':
      slots = ask.options.map((o) => [o.id]);
      break;
    case 'choose_list':
    case 'choose_entities':
      if (ask.kind === 'choose_list' && ask.reveal) break;
      // The same dispatch as AskDialog's ListPicker: chips, then cards (grouped), then rows.
      if (isNumberList(ask.options) || isColorList(ask.options) || !isCardList(ask.options)) slots = ask.options.map((o) => [o.id]);
      else slots = groupOptions(ask.options).map((g) => [...g.ids]);
      break;
    default:
      break;
  }
  return slots.slice(0, 9);
}

/** What a digit does: answer at once (one pick) or toggle (several). */
export function digitMode(ask: AskBody): 'send' | 'toggle' | null {
  switch (ask.kind) {
    case 'ability_menu':
    case 'options':
      return 'send';
    case 'choose_list':
    case 'choose_entities': {
      if (ask.kind === 'choose_list' && ask.reveal) return null;
      return choiceBounds(ask).hi === 1 ? 'send' : 'toggle';
    }
    default:
      return null;
  }
}

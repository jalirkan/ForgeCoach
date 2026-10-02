/*
 * ForgeCoach — ui/play/actionWords.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * What the action bar's big button says and which engine button it presses,
 * plus the pass-ahead targets. Pure, tested in node. The engine's own label
 * (`OK`, `Auto`, `End Turn`…) always rides along as the sub-line.
 */
import type { ActBody } from '../../protocol.ts';
import { yieldTo } from '../../play/acts.ts';
import type { ButtonView, InputView } from './inputView.ts';

export interface PrimaryView {
  /** Which engine button the big button presses, or null (nothing to press: a disabled placeholder). */
  which: 'ok' | 'cancel' | null;
  /** Plain words on the button. */
  words: string;
  /** The engine's own label, when it differs from the words. */
  engine: string | null;
  enabled: boolean;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Plain words for one engine button in this mode. */
export function buttonWords(view: InputView, b: ButtonView): string {
  if (view.mode === 'priority' && b === view.ok) return 'Pass priority';
  if (b.meaning) return cap(b.meaning === 'pass' ? 'pass priority' : b.meaning);
  return b.label;
}

export function primaryView(view: InputView): PrimaryView {
  let which = view.primary;
  // A running yield: the way out is the engine's Cancel.
  if (!which && view.mode === 'yield' && view.cancel.enabled) which = 'cancel';
  if (!which) {
    // Prompted, but OK is off until a card is tapped: show the OK, disabled.
    if (view.needClick && view.ok.label) return { which: 'ok', words: buttonWords(view, view.ok), engine: view.ok.label, enabled: false };
    if (view.mode === 'waiting') return { which: null, words: view.title, engine: null, enabled: false };
    return { which: null, words: view.mode === 'over' ? 'Game over' : view.mode === 'ask' ? 'Answer the question' : 'Waiting', engine: null, enabled: false };
  }
  const b = which === 'ok' ? view.ok : view.cancel;
  const words = buttonWords(view, b);
  return { which, words, engine: b.label && b.label.toLowerCase() !== words.toLowerCase() ? b.label : null, enabled: b.enabled };
}

/** Pass-ahead is offered while you hold priority with nothing else asked of you. */
export function canPassAhead(view: InputView): boolean {
  return view.mode === 'main' || view.mode === 'priority' || view.mode === 'stack';
}

export interface PassTarget {
  id: string;
  label: string;
  key: string;
  body: ActBody;
}

/** "To EOT" — the secondary button. */
export const PASS_EOT: PassTarget = { id: 'eot', label: 'Pass until end of turn', key: 'E', body: yieldTo('endOfTurn') };

/** The ▲ menu: every other pass-ahead `yieldTo` the protocol has (M37), plus a single pass. */
export function passMenu(view: InputView): PassTarget[] {
  const out: PassTarget[] = [
    { id: 'once', label: 'Pass priority once', key: 'P', body: { action: 'passPriority' } },
  ];
  if (view.mode === 'stack') out.push({ id: 'stack', label: 'Pass until the stack resolves', key: '', body: yieldTo('stack') });
  out.push(
    PASS_EOT,
    { id: 'myturn', label: 'Pass until my next turn', key: 'T', body: yieldTo('marker', 'UPKEEP', 'own') },
    { id: 'before', label: 'Pass until just before my turn', key: 'B', body: yieldTo('marker', 'END_OF_TURN', 'opp') },
  );
  return out;
}

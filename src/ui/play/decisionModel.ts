/*
 * ForgeCoach — ui/play/decisionModel.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The decision slot's model (endstep-style): one fixed panel for every engine
 * question, and the signals that make "the game is waiting on YOU" impossible
 * to miss. Pure, tested in node (decisionModel.test.ts).
 *
 * Every fact here is the engine's: an open `ask`, an `input` with an enabled
 * button or a selectable set, `state.priority`, `state.yield`, the engine's
 * own buttons and prompt text. Nothing judges a move: the slot's buttons are
 * the engine's OK / Cancel (and the protocol's `undo` while `state.undo.can`),
 * and the auto-pass toggles are the protocol's `yieldTo` targets, lit from
 * `state.yield` and switched off with the engine's Cancel (protocol §2.2:
 * there is no cancel-yield act).
 */
import type { ActBody, AskBody, GameStateBody, InputBody, YieldState } from '../../protocol.ts';
import { chosenOf, selectablePlayersOf } from '../../protocol.ts';
import { cancel, yieldTo } from '../../play/acts.ts';
import type { ButtonView, InputView } from './inputView.ts';
import { buttonWords, canPassAhead, primaryView } from './actionWords.ts';
import type { SelectionSummary } from './selection.ts';

// ---------------------------------------------------------------------------
// Whose move is it?

/**
 * `pending`: the engine waits on this seat (an ask, or an input it can act on).
 * `opponent`: the other seat holds priority or Forge says it is waiting for them.
 * `idle`: nothing to say (not connected, game over, a yield running, the engine busy).
 */
export type Attention = 'pending' | 'opponent' | 'idle';

export interface AttentionView {
  attention: Attention;
  /** The waiting line ("Waiting for Forge AI…"), only while it is the opponent's move. */
  line: string | null;
  /** Names the pending decision (a new one restarts the arrival pulse and the nudge clock); null when none. */
  key: string | null;
}

/** Modes that never wait on this seat, whatever the buttons say. */
const QUIET = new Set<InputView['mode']>(['waiting', 'yield', 'over', 'ask']);

/**
 * Does this input wait on the seat? Only by the engine's own word: an enabled
 * button, a selectable set (cards or players), or a prompt whose OK is off
 * until something is clicked (§4.2).
 */
export function inputPending(input: InputBody | null, view: InputView): boolean {
  if (!input || QUIET.has(view.mode)) return false;
  const sel = input.selectable;
  // M66: a player-only choice reads `mode: "none"`; `playerIds` says the portraits take the click.
  const selecting = sel.mode === 'players' || (sel.mode === 'cards' && sel.cardIds.length > 0) || (selectablePlayersOf(input)?.length ?? 0) > 0;
  return view.ok.enabled || view.cancel.enabled || selecting || view.needClick;
}

export function attentionOf(p: {
  connected: boolean;
  over: boolean;
  ask: AskBody | null;
  input: InputBody | null;
  view: InputView;
  state: GameStateBody | null;
  seat: number | null;
  /** What the board calls the other seat ("Forge AI", the picker's name, a friend's name). */
  oppName: string;
  /** The session's input counter (`data-input-seq`), to tell one input from the next. */
  inputSeq?: number | null;
}): AttentionView {
  const idle: AttentionView = { attention: 'idle', line: null, key: null };
  if (!p.connected || p.over) return idle;
  if (p.ask) return { attention: 'pending', line: null, key: `ask:${p.ask.askId}` };
  if (inputPending(p.input, p.view)) return { attention: 'pending', line: null, key: `input:${p.inputSeq ?? p.input!.prompt}` };
  if (p.view.mode === 'yield') return idle;
  const prio = p.state?.priority ?? null;
  if (prio !== null && p.seat !== null && prio !== p.seat) return { attention: 'opponent', line: `Waiting for ${p.oppName}…`, key: null };
  // Forge's own "Waiting for Forge AI…" while the other seat acts.
  if (p.view.mode === 'waiting' && p.input && /^Waiting for/i.test(p.input.prompt)) {
    return { attention: 'opponent', line: p.oppName ? `Waiting for ${p.oppName}…` : 'Opponent is deciding…', key: null };
  }
  return idle;
}

// ---------------------------------------------------------------------------
// The second nudge: a decision left pending for a while

export const NUDGE_MS = 20_000;
/** The slot title's prefix once the nudge is due. */
export const NUDGE_PREFIX = 'Your move — ';
/** The tab title's leading mark, for a player who has alt-tabbed away. */
export const TITLE_MARK = '● ';

/**
 * Milliseconds until the nudge is due (0: due now), or null when there is no
 * pending decision. The clock starts at the later of the decision's arrival
 * and the player's last act (a click on a card is progress, not a stall).
 */
export function nudgeDelay(p: { pendingSince: number | null; lastAct: number | null; now: number }): number | null {
  if (p.pendingSince === null) return null;
  const from = Math.max(p.pendingSince, p.lastAct ?? -Infinity);
  return Math.max(0, from + NUDGE_MS - p.now);
}

/** The slot's title, with "Your move — " once nudged. */
export function slotTitle(title: string, nudged: boolean): string {
  return nudged && !title.startsWith(NUDGE_PREFIX) ? `${NUDGE_PREFIX}${title}` : title;
}

/** The document title with (on) or without (off) the leading "● " — never twice. */
export function markedTitle(title: string, on: boolean): string {
  const bare = title.startsWith(TITLE_MARK) ? title.slice(TITLE_MARK.length) : title;
  return on ? `${TITLE_MARK}${bare}` : bare;
}

// ---------------------------------------------------------------------------
// The counter line: "0/1 · need 1 more"

/** `chosen` of [lo, hi] as a counter line, or null when there is nothing to count. */
export function choiceCounter(chosen: number, lo: number, hi: number): string | null {
  if (hi <= 0) return null;
  const need = Math.max(0, lo - chosen);
  const room = Math.max(0, hi - chosen);
  const tail = need > 0 ? ` · need ${need} more` : room > 0 && chosen > 0 ? ` · up to ${room} more` : '';
  return `${chosen}/${hi}${tail}`;
}

/** The modes whose input states a count the slot can show (a target, a discard). */
const COUNTED = new Set<InputView['mode']>(['target', 'discard']);

/**
 * The counter for a choice: "1/2 · up to 1 more" where the input states a
 * count (`selectable.max`), "2 chosen" where it does not.
 *
 * The count is the engine's own (M65 `selectable.chosen`: the cards and players
 * picked so far) when the frame carries it. Without it — an engine before M65,
 * or a frame that does not say — only a targeting input is counted, from
 * Forge's prompt: InputSelectTargets lists what is targeted under a
 * "Targeted:" line. Null when there is nothing to count.
 */
export function inputCounter(input: InputBody | null, view: InputView): string | null {
  if (!input) return null;
  const { min, max } = input.selectable;
  const chosen = chosenOf(input);
  if (chosen && COUNTED.has(view.mode)) {
    const n = chosen.cardIds.length + chosen.playerIds.length;
    if (max > 0) return choiceCounter(n, Math.max(0, min), max);
    return n > 0 ? `${n} chosen` : null;
  }
  if (view.mode !== 'target' || max <= 0) return null;
  const lines = input.prompt
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const at = lines.findIndex((l) => /^Targeted:/i.test(l));
  let n = 0;
  if (at >= 0) {
    for (const l of lines.slice(at + 1)) {
      if (/^\(\d+ more can be targeted\)$/i.test(l)) break;
      n++;
    }
  }
  return choiceCounter(n, Math.max(0, min), max);
}

// ---------------------------------------------------------------------------
// The slot's buttons, with the keys printed on them

export interface SlotButton {
  id: 'primary' | 'other' | 'undo';
  /** The engine button it presses, or null (Undo, a disabled placeholder). */
  which: 'ok' | 'cancel' | null;
  words: string;
  /** The engine's own label when it differs from the words. */
  engine: string | null;
  /** The key printed on it. */
  kbd: string | null;
  enabled: boolean;
}

const ALPHA = /alpha/i;

/**
 * Primary (the engine's focused button, in the moment's words), the engine's
 * other button, and Undo — each with the key that presses it:
 *   Space for the primary ("Pass priority [Space]"), A for Auto pay while
 *   paying, Esc for the engine's Cancel, A for Alpha Strike while declaring
 *   attackers, Ctrl+Z for Undo.
 */
export function slotButtons(
  view: InputView,
  selection: SelectionSummary | undefined,
  opts: { canUndo: boolean; undoDepth: number; wide: boolean; passAhead?: boolean },
): SlotButton[] {
  const base = primaryView(view);
  const primary =
    selection?.confirm && base.which === 'ok'
      ? { ...base, words: selection.confirm, engine: base.engine ?? view.ok.label }
      : selection?.active && base.which === null && view.ok.label && (view.mode === 'attack' || view.mode === 'block')
        ? { which: 'ok' as const, words: view.mode === 'attack' ? 'Attack' : 'Confirm blocks', engine: view.ok.label, enabled: false }
        : base;
  const out: SlotButton[] = [];
  const keyOf = (which: 'ok' | 'cancel' | null, b: ButtonView | null): string | null => {
    if (!which) return null;
    if (view.mode === 'pay' && which === 'ok') return 'A';
    if (view.mode === 'attack' && which === 'cancel' && b && ALPHA.test(b.label)) return 'A';
    return which === 'cancel' ? 'Esc' : null;
  };
  out.push({
    id: 'primary',
    which: primary.which,
    words: primary.words,
    engine: primary.engine,
    kbd: primary.which ? (view.mode === 'pay' && primary.which === 'ok' ? 'A' : 'Space') : null,
    enabled: primary.enabled,
  });
  const other: { b: ButtonView; which: 'ok' | 'cancel' } | null =
    primary.which === 'ok'
      ? { b: view.cancel, which: 'cancel' }
      : primary.which === 'cancel'
        ? { b: view.ok, which: 'ok' }
        : view.cancel.enabled
          ? { b: view.cancel, which: 'cancel' }
          : null;
  // Forge's "End Turn" says what the END OF TURN toggle already says: phones keep the one button.
  const duplicateEot = !opts.wide && (opts.passAhead ?? canPassAhead(view)) && !!other && /end turn/i.test(other.b.label);
  if (other && other.b.label && (other.b.enabled || other.which === 'ok') && !duplicateEot) {
    const words = view.mode === 'attack' && other.which === 'cancel' && ALPHA.test(other.b.label) ? 'Alpha strike' : buttonWords(view, other.b);
    out.push({
      id: 'other',
      which: other.which,
      words,
      engine: words.toLowerCase() !== other.b.label.toLowerCase() ? other.b.label : null,
      kbd: keyOf(other.which, other.b),
      enabled: other.b.enabled,
    });
  }
  if (opts.canUndo) out.push({ id: 'undo', which: null, words: opts.undoDepth > 1 ? `Undo (${opts.undoDepth})` : 'Undo', engine: null, kbd: 'Ctrl+Z', enabled: true });
  return out;
}

// ---------------------------------------------------------------------------
// Auto-pass toggles, lit from state.yield

export type PassToggleId = 'eot' | 'before' | 'myturn' | 'theyAct' | 'stack';

export type YieldLit = Record<PassToggleId, boolean>;

/** Which pass-ahead target the running yield is (Forge runs one at a time). */
export function yieldLit(y: YieldState | null | undefined, seat: number | null): YieldLit {
  const lit: YieldLit = { eot: false, before: false, myturn: false, theyAct: false, stack: false };
  if (!y) return lit;
  if (y.kind === 'endOfTurn') lit.eot = true;
  else if (y.kind === 'endStepOrOpponent') lit.theyAct = true;
  else if (y.kind === 'stack') lit.stack = true;
  else if (y.kind === 'marker') {
    if (y.phase === 'END_OF_TURN' && y.playerId !== null && y.playerId !== seat) lit.before = true;
    else if (y.phase === 'UPKEEP' && (y.playerId === seat || y.playerId === null)) lit.myturn = true;
  }
  return lit;
}

export interface PassToggle {
  id: PassToggleId;
  label: string;
  kbd: string | null;
  lit: boolean;
  enabled: boolean;
  /** What pressing it sends: the yield, or (lit) the engine's Cancel. */
  body: ActBody;
  title: string;
}

const TOGGLES: { id: PassToggleId; label: string; kbd: string | null; body: ActBody; what: string }[] = [
  { id: 'eot', label: 'End of turn', kbd: 'E', body: yieldTo('endOfTurn'), what: 'Pass until the end of this turn' },
  { id: 'before', label: 'Before my turn', kbd: 'B', body: yieldTo('marker', 'END_OF_TURN', 'opp'), what: 'Pass until their end step, just before your turn' },
  { id: 'myturn', label: 'My next turn', kbd: 'T', body: yieldTo('marker', 'UPKEEP', 'own'), what: 'Pass until your next upkeep' },
  {
    id: 'theyAct',
    label: 'Until they act',
    kbd: 'Y',
    body: yieldTo('endStepOrOpponent'),
    what: 'Pass until they cast something or attack you, or this turn’s end step begins',
  },
  { id: 'stack', label: 'Stack resolves', kbd: null, body: yieldTo('stack'), what: 'Pass until the stack resolves' },
];

/** The steps in which the engine refuses "until they act" (M64): this turn's end step has already begun. */
const THEY_ACT_REFUSED = new Set(['END_OF_TURN', 'CLEANUP']);

/** Why "until they act" is off in this step, or null. */
export const THEY_ACT_END_STEP = 'Off in the end step and cleanup: this turn’s end step has already begun';

/**
 * Whether the engine offers "until they act" (M64). The protocol has no
 * capability list, so the sign is its sibling amendments: M64–M66 shipped in
 * one bridge release, and since M65/M66 every `input` carries
 * `selectable.chosen` and `selectable.playerIds` (null or not — the KEY is the
 * sign). A running `endStepOrOpponent` yield says so too. An engine before
 * them would refuse the kind with a notice.
 */
export function offersTheyAct(input: InputBody | null | undefined, y: YieldState | null | undefined): boolean {
  if (y?.kind === 'endStepOrOpponent') return true;
  const sel = input?.selectable as object | undefined;
  return !!sel && ('playerIds' in sel || 'chosen' in sel);
}

/** Why the Y key does nothing now (no M64 engine; the end step), or null when it may send. */
export function theyActWhyNot(p: { offered: boolean; phase: string | null | undefined; lit: boolean }): string | null {
  if (p.lit) return null;
  if (!p.offered) return 'The engine on your PC doesn’t offer “until they act” yet: update it';
  if (p.phase && THEY_ACT_REFUSED.has(p.phase)) return THEY_ACT_END_STEP;
  return null;
}

/**
 * The toggles under the slot. Unlit: the yield, while you could pass ahead
 * (your priority, nothing else asked). Lit: the engine's Cancel, only while it
 * is enabled. Never while the board may not act (an ask open, the game over).
 * "Stack resolves" only shows while something is on the stack or it runs.
 * "Until they act" (M64) only shows on an engine that offers it
 * (`offersTheyAct`), and is off in the end step and cleanup, where the engine
 * refuses it.
 */
export function passToggles(p: {
  yielding: YieldState | null | undefined;
  seat: number | null;
  view: InputView;
  canAct: boolean;
  /** The engine offers `endStepOrOpponent` (offersTheyAct). Absent: not offered. */
  theyAct?: boolean;
  /** `state.phase`, for the step in which the engine refuses "until they act". */
  phase?: string | null;
}): PassToggle[] {
  const lit = yieldLit(p.yielding, p.seat);
  const ahead = canPassAhead(p.view);
  return TOGGLES.filter((t) => (t.id !== 'stack' || p.view.mode === 'stack' || lit.stack) && (t.id !== 'theyAct' || p.theyAct || lit.theyAct)).map((t) => {
    const on = lit[t.id];
    const refused = t.id === 'theyAct' && !on && !!p.phase && THEY_ACT_REFUSED.has(p.phase);
    const enabled = p.canAct && !refused && (on ? p.view.cancel.enabled : ahead);
    return {
      id: t.id,
      label: t.label,
      kbd: t.kbd,
      lit: on,
      enabled,
      body: on ? cancel() : t.body,
      title: refused
        ? `${THEY_ACT_END_STEP}.`
        : on
          ? `${t.what} — on. Press to stop (the engine’s Cancel)${t.kbd ? ` (${t.kbd})` : ''}`
          : `${t.what}${t.kbd ? ` (${t.kbd})` : ''}`,
    };
  });
}

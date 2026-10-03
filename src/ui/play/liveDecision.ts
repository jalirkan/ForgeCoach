/*
 * ForgeCoach — ui/play/liveDecision.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The moment you are playing, as a `Decision`, so the replay coach's prompt
 * (buildCoachPrompt) works unchanged on a live game. Pure.
 */
import type { AskBody, GameStateBody, InputBody } from '../../protocol.ts';
import type { GameLog } from '../../log.ts';
import { isPlayDrawInput, isTargetInput, phaseLabel, type Decision, type DecisionKind } from '../../decisions.ts';
import { chosenColors, instantSpeedOptions } from '../../state.ts';
import type { CardInfo } from '../../cards.ts';

export interface LiveMoment {
  log: GameLog;
  state: GameStateBody | null;
  input: InputBody | null;
  ask: AskBody | null;
  seat: number | null;
}

export function liveKind(state: GameStateBody, input: InputBody | null, ask: AskBody | null, seat: number): DecisionKind {
  if (ask) return 'choice';
  const p = input?.prompt ?? '';
  if (/^Select creatures to attack/i.test(p)) return 'attack';
  if (/^Select creatures to block/i.test(p)) return 'block';
  if (!state.phase || !state.turn) return 'choice';
  if (/keep (your|this) hand|mulligan/i.test(p)) return 'choice';
  // Picking a target (a spell you are casting in your main phase, a trigger): its own question, not "what should I do this turn?".
  if (isTargetInput(input)) return 'choice';
  const mine = state.activePlayer === seat;
  if (mine && (state.phase === 'MAIN1' || state.phase === 'MAIN2') && state.stack.length === 0) return 'main';
  if (input && input.selectable.mode !== 'none') return 'choice';
  return 'priority';
}

function label(state: GameStateBody, seat: number, kind: DecisionKind, input: InputBody | null): string {
  if (!state.phase || !state.turn) return isPlayDrawInput(input, state) ? 'Pre-game · play or draw' : 'Pre-game · keep or mulligan';
  const round = state.round || Math.ceil((state.turn || 0) / 2);
  if (kind === 'attack') return `R${round} · Your attacks`;
  if (kind === 'block') return `R${round} · Your blocks`;
  const whose = state.activePlayer === seat ? 'Your' : "Opponent's";
  return `R${round} · ${whose} ${phaseLabel(state.phase)}`;
}

/** Index into `log.frames` of the newest state frame (the one on screen). */
export function lastStateFrame(log: GameLog): number {
  for (let i = log.frames.length - 1; i >= 0; i--) if (log.frames[i]!.type === 'state') return i;
  return -1;
}

/**
 * The current moment as a Decision, or null when there is nothing to coach
 * (no state yet, or no seat). `actions` is empty: the player hasn't acted yet.
 */
export function liveDecision(m: LiveMoment, cards?: Map<string, CardInfo>): Decision | null {
  const { log, state, input, ask } = m;
  const seat = m.seat ?? log.seat;
  if (!state || seat === null || seat === undefined) return null;
  const frameIndex = lastStateFrame(log);
  if (frameIndex < 0) return null;
  const kind = liveKind(state, input, ask, seat);
  const d: Decision = {
    index: 0,
    kind,
    frameIndex,
    state,
    input,
    ask,
    label: label(state, seat, kind, input),
    actions: [],
    endFrameIndex: log.frames.length - 1,
  };
  if (kind === 'priority' && state.phase) {
    try {
      const opts = instantSpeedOptions(state, seat, cards, chosenColors(log, frameIndex, seat, cards));
      if (opts.length) d.options = opts;
    } catch {
      /* heuristic only */
    }
  }
  return d;
}

/**
 * A stable key for "this decision point": the same while you are thinking
 * about one moment (taps of a land or a selection don't make a new one), new
 * when the turn, step, stack or question changes.
 */
export function momentKey(m: LiveMoment): string | null {
  const s = m.state;
  if (!s || !m.log.header) return null;
  const seat = m.seat ?? m.log.seat;
  const kind = liveKind(s, m.input, m.ask, seat);
  const stackTop = s.stack[s.stack.length - 1]?.id ?? 0;
  return `${m.log.header.gameId}@${m.log.header.startedAt}:live:t${s.turn}:${s.phase ?? 'pre'}:${kind}:s${stackTop}${m.ask ? `:a${m.ask.askId}` : ''}`;
}

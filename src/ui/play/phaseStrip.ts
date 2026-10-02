/*
 * ForgeCoach — ui/play/phaseStrip.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The phase strip as data: one cell per step, which one is current, whose turn
 * it is, and where this seat has phase stops. Pure, so it is tested in node.
 *
 * Adapted from mtg-table web/src/render/PhaseStrip.tsx and render/labels.ts,
 * Copyright (C) 2026 the mtg-table authors, GPL-3.0-or-later. The same rules:
 * the stops render from `players[].phaseStops` and nothing else (the client
 * keeps no stop state of its own beyond "a toggle is on its way"), a stream
 * without them shows Forge's defaults read-only, and UNTAP has no stop
 * preference in Forge at all.
 */
import type { GameStateBody, PhaseStops, SetPhaseStopAct, YieldState } from '../../protocol.ts';
import { phaseStopsOf, yieldOf } from '../../protocol.ts';
import { setPhaseStop } from '../../play/acts.ts';

export type StopTurn = 'own' | 'opp';

export interface PhaseDef {
  phase: string;
  /** Two letters, for the phone strip (Forge's own PhaseIndicator captions). */
  short: string;
  /** One or two words, for the desktop column. */
  label: string;
  /** Words for the tooltip / hint ("declare-blockers step"). */
  words: string;
  combat: boolean;
}

export const PHASES: readonly PhaseDef[] = [
  { phase: 'UNTAP', short: 'UT', label: 'Untap', words: 'untap step', combat: false },
  { phase: 'UPKEEP', short: 'UP', label: 'Upkeep', words: 'upkeep', combat: false },
  { phase: 'DRAW', short: 'DR', label: 'Draw', words: 'draw step', combat: false },
  { phase: 'MAIN1', short: 'M1', label: 'Main 1', words: 'first main phase', combat: false },
  { phase: 'COMBAT_BEGIN', short: 'BC', label: 'Beginning', words: 'beginning of combat', combat: true },
  { phase: 'COMBAT_DECLARE_ATTACKERS', short: 'DA', label: 'Attackers', words: 'declare-attackers step', combat: true },
  { phase: 'COMBAT_DECLARE_BLOCKERS', short: 'DB', label: 'Blockers', words: 'declare-blockers step', combat: true },
  { phase: 'COMBAT_FIRST_STRIKE_DAMAGE', short: 'FS', label: 'First strike', words: 'first-strike damage step', combat: true },
  { phase: 'COMBAT_DAMAGE', short: 'CD', label: 'Damage', words: 'combat damage step', combat: true },
  { phase: 'COMBAT_END', short: 'EC', label: 'End combat', words: 'end of combat', combat: true },
  { phase: 'MAIN2', short: 'M2', label: 'Main 2', words: 'second main phase', combat: false },
  { phase: 'END_OF_TURN', short: 'ET', label: 'End', words: 'end step', combat: false },
  { phase: 'CLEANUP', short: 'CL', label: 'Cleanup', words: 'cleanup step', combat: false },
];

/** Forge has no stop preference for UNTAP (`CMatchUI.actuateMatchPreferences` loops 1…12). */
export const PHASE_WITHOUT_STOP = 'UNTAP';

/** `FPref.PHASES_HUMAN` / `PHASES_AI` defaults — shown, read-only, when the stream carries no stops. */
export const FORGE_DEFAULT_STOPS: PhaseStops = {
  own: ['MAIN1', 'COMBAT_DECLARE_BLOCKERS', 'MAIN2'],
  opp: ['COMBAT_BEGIN', 'COMBAT_DECLARE_ATTACKERS', 'COMBAT_DECLARE_BLOCKERS', 'END_OF_TURN'],
};

/** A toggle sent but not yet confirmed by a state: `${phase}:${turn}` → the value sent. */
export type PendingStops = ReadonlyMap<string, boolean>;

export const stopKey = (phase: string, turn: StopTurn): string => `${phase}:${turn}`;

export interface PhaseCell extends PhaseDef {
  current: boolean;
  /** Before the current step this turn. */
  past: boolean;
  /** Stops here on your turn / on the opponent's (pending toggles applied). */
  stopOwn: boolean;
  stopOpp: boolean;
  /** Either bit is a toggle still on its way. */
  pending: boolean;
  /** Whether the stops can be changed here. */
  toggleable: boolean;
  /** A pass-to marker sits on this step. */
  marker: 'own' | 'opp' | 'any' | null;
}

export interface StripModel {
  cells: PhaseCell[];
  /** `null` before the game. */
  yourTurn: boolean | null;
  activeName: string | null;
  turn: number;
  round: number;
  /** Who holds priority: 'you', 'opp' or null. */
  priority: 'you' | 'opp' | null;
  /** The stream carries this seat's stops (else the cells show Forge's defaults). */
  live: boolean;
  /** Stops can be toggled right now. */
  canToggle: boolean;
  yielding: YieldState | null;
}

/**
 * The strip for one state. `interactive` is the caller's "this is a live seat
 * with no question open and the game not over"; stops are toggleable only when
 * that holds **and** the stream carries `phaseStops` (M32/M33).
 */
export function stripModel(state: GameStateBody | null, seat: number | null, opts: { interactive?: boolean; pending?: PendingStops } = {}): StripModel {
  const me = state?.players.find((p) => p.id === seat) ?? null;
  const stops = phaseStopsOf(me);
  const live = stops !== null;
  const canToggle = live && !!opts.interactive;
  const shown = stops ?? FORGE_DEFAULT_STOPS;
  const pending = opts.pending ?? new Map<string, boolean>();
  const phase = state?.phase ?? null;
  const at = PHASES.findIndex((p) => p.phase === phase);
  const yourTurn = !state || state.activePlayer === null || seat === null ? null : state.activePlayer === seat;
  const yielding = yieldOf(state);
  const markerPhase = yielding?.kind === 'marker' ? yielding.phase : null;
  const markerWho: PhaseCell['marker'] = yielding?.playerId == null ? 'any' : yielding.playerId === seat ? 'own' : 'opp';
  const cells = PHASES.map((d, i): PhaseCell => {
    const noStop = d.phase === PHASE_WITHOUT_STOP;
    const pOwn = pending.get(stopKey(d.phase, 'own'));
    const pOpp = pending.get(stopKey(d.phase, 'opp'));
    return {
      ...d,
      current: i === at,
      past: at >= 0 && i < at,
      stopOwn: !noStop && (pOwn ?? shown.own.includes(d.phase)),
      stopOpp: !noStop && (pOpp ?? shown.opp.includes(d.phase)),
      pending: pOwn !== undefined || pOpp !== undefined,
      toggleable: canToggle && !noStop,
      marker: markerPhase === d.phase ? markerWho : null,
    };
  });
  const active = state?.players.find((p) => p.id === state.activePlayer) ?? null;
  return {
    cells,
    yourTurn,
    activeName: active?.name ?? null,
    turn: state?.turn ?? 0,
    round: state?.round ?? 0,
    priority: !state || state.priority === null || seat === null ? null : state.priority === seat ? 'you' : 'opp',
    live,
    canToggle,
    yielding,
  };
}

/**
 * The act that flips one stop, or `null` when it cannot be flipped (no stops
 * on this stream, not interactive, or UNTAP). `current` is what the strip
 * shows now (pending toggles included), so a second tap undoes the first.
 */
export function toggleStopAct(model: StripModel, phase: string, turn: StopTurn): SetPhaseStopAct | null {
  const cell = model.cells.find((c) => c.phase === phase);
  if (!cell || !cell.toggleable) return null;
  const on = turn === 'own' ? cell.stopOwn : cell.stopOpp;
  return setPhaseStop(phase, turn, !on);
}

/** Drop pending toggles the latest state has confirmed (or that it contradicts after a while — the caller times those out). */
export function settlePending(pending: PendingStops, state: GameStateBody | null, seat: number | null): Map<string, boolean> {
  const stops = phaseStopsOf(state?.players.find((p) => p.id === seat) ?? null);
  const out = new Map(pending);
  if (!stops) return out;
  for (const [k, v] of pending) {
    const [phase, turn] = k.split(':') as [string, StopTurn];
    if (stops[turn].includes(phase) === v) out.delete(k);
  }
  return out;
}

/** Plain words for a stop, for tooltips and the hint line. */
export function stopWords(cell: PhaseDef, turn: StopTurn, on: boolean): string {
  return `${on ? 'Stops' : 'Skips'} at the ${cell.words} on ${turn === 'own' ? 'your' : 'the opponent’s'} turn`;
}

/** The running pass-to in words, or null. */
export function yieldWords(y: YieldState | null, seat: number | null): string | null {
  if (!y) return null;
  if (y.kind === 'endOfTurn') return 'Passing to end of turn';
  if (y.kind === 'stack') return 'Passing until the stack resolves';
  const d = PHASES.find((p) => p.phase === y.phase);
  const whose = y.playerId === null ? '' : y.playerId === seat ? 'your ' : 'their ';
  return `Passing to ${whose}${d?.words ?? 'the marked step'}`;
}

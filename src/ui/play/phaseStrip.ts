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
import type { GameLog } from '../../log.ts';

export type StopTurn = 'own' | 'opp';

export interface PhaseDef {
  phase: string;
  /** Two letters, for the phone strip (Forge's own PhaseIndicator captions). */
  short: string;
  /** One or two words, for the desktop column. */
  label: string;
  /** The vertical strip's cell caption (short, upper-cased by CSS): BEG., ATK, BLK, 1ST … */
  tag: string;
  /** Words for the tooltip / hint ("declare-blockers step"). */
  words: string;
  combat: boolean;
}

export const PHASES: readonly PhaseDef[] = [
  { phase: 'UNTAP', short: 'UT', label: 'Untap', tag: 'Untap', words: 'untap step', combat: false },
  { phase: 'UPKEEP', short: 'UP', label: 'Upkeep', tag: 'Upkeep', words: 'upkeep', combat: false },
  { phase: 'DRAW', short: 'DR', label: 'Draw', tag: 'Draw', words: 'draw step', combat: false },
  { phase: 'MAIN1', short: 'M1', label: 'Main 1', tag: 'Main 1', words: 'first main phase', combat: false },
  { phase: 'COMBAT_BEGIN', short: 'BC', label: 'Beginning', tag: 'Beg.', words: 'beginning of combat', combat: true },
  { phase: 'COMBAT_DECLARE_ATTACKERS', short: 'DA', label: 'Attackers', tag: 'Atk', words: 'declare-attackers step', combat: true },
  { phase: 'COMBAT_DECLARE_BLOCKERS', short: 'DB', label: 'Blockers', tag: 'Blk', words: 'declare-blockers step', combat: true },
  { phase: 'COMBAT_FIRST_STRIKE_DAMAGE', short: 'FS', label: 'First strike', tag: '1st', words: 'first-strike damage step', combat: true },
  { phase: 'COMBAT_DAMAGE', short: 'CD', label: 'Damage', tag: 'Dmg', words: 'combat damage step', combat: true },
  { phase: 'COMBAT_END', short: 'EC', label: 'End combat', tag: 'End c.', words: 'end of combat', combat: true },
  { phase: 'MAIN2', short: 'M2', label: 'Main 2', tag: 'Main 2', words: 'second main phase', combat: false },
  { phase: 'END_OF_TURN', short: 'ET', label: 'End', tag: 'End', words: 'end step', combat: false },
  { phase: 'CLEANUP', short: 'CL', label: 'Cleanup', tag: 'Clean', words: 'cleanup step', combat: false },
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

/* ------------------------------------------------------------------ */
/* The vertical strip: groups, halves, the current step's words, who is on the play */

/** The two halves of a vertical cell and the stop each one is: YOU = a stop on my turn (`own`), OPP = on theirs. */
export const HALVES = [
  { half: 'you', turn: 'own' },
  { half: 'opp', turn: 'opp' },
] as const;
export type Half = (typeof HALVES)[number]['half'];

export const halfTurn = (half: Half): StopTurn => (half === 'you' ? 'own' : 'opp');

/** Whether a half of this cell is filled (a stop is set for that player here). */
export const halfOn = (cell: Pick<PhaseCell, 'stopOwn' | 'stopOpp'>, half: Half): boolean => (half === 'you' ? cell.stopOwn : cell.stopOpp);

/** What tapping a half sends, or `null` when it cannot be tapped (UNTAP, no stops on the stream, not interactive). */
export const halfAct = (model: StripModel, phase: string, half: Half): SetPhaseStopAct | null => toggleStopAct(model, phase, halfTurn(half));

/** Words for a half's button (its accessible name): what it is now and what a tap does. */
export function halfWords(cell: PhaseCell, half: Half): string {
  const on = halfOn(cell, half);
  const whose = half === 'you' ? 'your' : 'the opponent’s';
  if (!cell.toggleable) return `${on ? 'Stops' : 'Skips'} at the ${cell.words} on ${whose} turn`;
  return `${on ? 'Stop' : 'No stop'} at the ${cell.words} on ${whose} turn — ${on ? 'turn off' : 'turn on'}`;
}

export interface StripGroup {
  /** The small italic label above the group, or `null` for the opening steps. */
  label: string | null;
  cells: PhaseCell[];
}

/**
 * The vertical column's grouping, as the Endstep board draws it: the opening
 * steps and Main 1 unlabelled, then "combat", "main" (Main 2) and "ending".
 */
export function stripGroups(cells: readonly PhaseCell[]): StripGroup[] {
  const label = (phase: string): string | null =>
    phase === 'COMBAT_BEGIN' ? 'combat' : phase === 'MAIN2' ? 'main' : phase === 'END_OF_TURN' ? 'ending' : null;
  const out: StripGroup[] = [];
  for (const c of cells) {
    const l = label(c.phase);
    if (!out.length || l !== null) out.push({ label: l, cells: [] });
    out[out.length - 1]!.cells.push(c);
  }
  return out;
}

const STEP_COPY: Record<string, { title: string; line: string }> = {
  UNTAP: { title: 'Untap', line: 'Permanents untap.' },
  UPKEEP: { title: 'Upkeep', line: 'Upkeep triggers.' },
  DRAW: { title: 'Draw', line: 'Draw a card.' },
  MAIN1: { title: 'Main 1', line: 'Cast or pass.' },
  COMBAT_BEGIN: { title: 'Beg.', line: 'Beginning of combat.' },
  COMBAT_DECLARE_ATTACKERS: { title: 'Atk', line: 'Declare attackers' },
  COMBAT_DECLARE_BLOCKERS: { title: 'Blk', line: 'Declare blockers' },
  COMBAT_FIRST_STRIKE_DAMAGE: { title: '1st', line: 'First-strike damage' },
  COMBAT_DAMAGE: { title: 'Dmg', line: 'Combat damage' },
  COMBAT_END: { title: 'End c.', line: 'End of combat' },
  MAIN2: { title: 'Main 2', line: 'Cast or pass.' },
  END_OF_TURN: { title: 'End', line: 'End-of-turn triggers' },
  CLEANUP: { title: 'Clean', line: 'Discard to hand size.' },
};

/** Static copy for a step: a short title and one line of what the step is. No rules logic, no card text. */
export function stepCopy(phase: string): { title: string; line: string } | null {
  return STEP_COPY[phase] ?? null;
}

/** "Main 1 — Cast or pass." — one line for the current step; `null` for a phase the client does not know. */
export function stepInstruction(phase: string): string | null {
  const c = stepCopy(phase);
  return c ? `${c.title} — ${c.line}` : null;
}

/**
 * Who was on the play: the player of the first `turn` event whose turn is 1, read from the log's own
 * events (never from turn parity). `null` when the log has no such event (a game joined mid-way).
 */
export function onThePlay(log: Pick<GameLog, 'frames'> | null): number | null {
  if (!log) return null;
  for (const f of log.frames) {
    if (f.type !== 'state') continue;
    for (const e of (f.body as GameStateBody).events ?? []) {
      if (e.kind === 'turn' && e.turn === 1) return e.player;
    }
  }
  return null;
}

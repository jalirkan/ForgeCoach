/*
 * ForgeCoach — decisions.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Turns a frame log into the list of moments a coach talks about: each place
 * the viewing seat had to decide something, with the exact state at that
 * moment and what the player actually did there.
 *
 * A human-seat recording (one with c2s frames) yields one decision per act or
 * answer the player sent while the engine was asking for priority, attackers,
 * blockers, or a blocking question. Mana-payment clicks are folded into the
 * decision that started the spell. An AI-vs-AI recording has no acts, so it
 * yields one decision per (turn, phase) the viewer could have acted in.
 */
import type { AnyCard, AskBody, GameStateBody, InputBody } from './protocol.ts';
import { isHidden } from './protocol.ts';
import type { GameLog, LoggedFrame } from './log.ts';

export type DecisionKind = 'main' | 'attack' | 'block' | 'priority' | 'choice';

export interface Decision {
  /** Position in the decision list. */
  index: number;
  kind: DecisionKind;
  /** Index into `log.frames` of the state frame this decision is about. */
  frameIndex: number;
  state: GameStateBody;
  /** The engine's prompt at the moment, when the recording has one. */
  input: InputBody | null;
  /** The blocking question, when the decision is an ask. */
  ask: AskBody | null;
  /** Short human label: "R3 · Your main 1". */
  label: string;
  /** What the player actually did, in order, in plain words. Empty for AI-vs-AI logs. */
  actions: string[];
}

const COACHABLE_PHASES = new Set([
  'UPKEEP',
  'DRAW',
  'MAIN1',
  'COMBAT_BEGIN',
  'COMBAT_DECLARE_ATTACKERS',
  'COMBAT_DECLARE_BLOCKERS',
  'MAIN2',
  'END_OF_TURN',
]);

const PHASE_LABEL: Record<string, string> = {
  UNTAP: 'untap',
  UPKEEP: 'upkeep',
  DRAW: 'draw',
  MAIN1: 'main 1',
  COMBAT_BEGIN: 'beginning of combat',
  COMBAT_DECLARE_ATTACKERS: 'declare attackers',
  COMBAT_DECLARE_BLOCKERS: 'declare blockers',
  COMBAT_FIRST_STRIKE_DAMAGE: 'first-strike damage',
  COMBAT_DAMAGE: 'combat damage',
  COMBAT_END: 'end of combat',
  MAIN2: 'main 2',
  END_OF_TURN: 'end step',
  CLEANUP: 'cleanup',
};

export function phaseLabel(phase: string | null): string {
  if (!phase) return 'pre-game';
  return PHASE_LABEL[phase] ?? phase.toLowerCase().replace(/_/g, ' ');
}

/** Every card the viewer can see in this state, by id (stack cards included). */
export function cardIndex(state: GameStateBody): Map<number, AnyCard> {
  const m = new Map<number, AnyCard>();
  for (const p of state.players) {
    for (const z of Object.values(p.zones)) for (const c of z.cards) m.set(c.id, c);
  }
  for (const c of state.stackCards ?? []) m.set(c.id, c);
  return m;
}

export function cardName(card: AnyCard | undefined): string {
  if (!card) return 'a card';
  if (isHidden(card)) return 'a hidden card';
  return card.name || 'a face-down card';
}

function labelFor(state: GameStateBody, seat: number, kind: DecisionKind): string {
  const round = state.round || Math.ceil((state.turn || 0) / 2);
  const whose = state.activePlayer === seat ? 'Your' : "Opponent's";
  const phase = phaseLabel(state.phase);
  const tag = kind === 'attack' ? 'attacks' : kind === 'block' ? 'blocks' : phase;
  return `R${round} · ${whose} ${tag}`;
}

function kindOf(input: InputBody | null, ask: AskBody | null, state: GameStateBody, seat: number): DecisionKind | null {
  if (ask) return 'choice';
  if (!input) return null;
  const p = input.prompt;
  if (/^Select creatures to attack/i.test(p)) return 'attack';
  if (/^Select creatures to block/i.test(p)) return 'block';
  if (/^Priority:/i.test(p)) {
    if (state.activePlayer === seat && (state.phase === 'MAIN1' || state.phase === 'MAIN2') && state.stack.length === 0) {
      return 'main';
    }
    return 'priority';
  }
  // "Pay Mana Cost", targeting and the like belong to the decision already open.
  return null;
}

function describeAct(f: LoggedFrame, state: GameStateBody | null, input: InputBody | null): string | null {
  const cards = state ? cardIndex(state) : new Map<number, AnyCard>();
  if (f.type === 'act') {
    const b = f.body as { action: string; cardId?: number; playerId?: number };
    switch (b.action) {
      case 'clickCard':
        return `clicked ${cardName(cards.get(b.cardId!))}`;
      case 'clickPlayer': {
        const p = state?.players.find((x) => x.id === b.playerId);
        return `chose ${p ? p.name : 'a player'}`;
      }
      case 'buttonOk':
        return `pressed ${input?.buttons.ok.label ?? 'OK'}`;
      case 'buttonCancel':
        return `pressed ${input?.buttons.cancel.label ?? 'Cancel'}`;
      case 'passPriority':
        return 'passed priority';
      case 'alphaStrike':
        return 'attacked with everything';
      case 'concede':
        return 'conceded';
      case 'undo':
        return 'undid a mana tap';
      case 'useMana':
        return 'tapped mana';
      default:
        return null; // phase stops, yields and the like are settings, not plays
    }
  }
  if (f.type === 'answer') return 'answered the prompt';
  return null;
}

export function extractDecisions(log: GameLog): Decision[] {
  const seat = log.seat;
  const hasActs = log.frames.some((f) => f.dir === 'c2s' || f.type === 'act');
  return hasActs ? fromActs(log, seat) : fromPhases(log, seat);
}

function fromActs(log: GameLog, seat: number): Decision[] {
  const out: Decision[] = [];
  let state: GameStateBody | null = null;
  let stateIdx = -1;
  let input: InputBody | null = null;
  let ask: AskBody | null = null;
  let open: Decision | null = null;

  log.frames.forEach((f, i) => {
    if (f.type === 'state') {
      state = f.body as GameStateBody;
      stateIdx = i;
      return;
    }
    if (f.type === 'input') {
      input = f.body as InputBody;
      return;
    }
    if (f.type === 'ask') {
      ask = f.body as AskBody;
      return;
    }
    if ((f.type === 'act' || f.type === 'answer') && state) {
      const s: GameStateBody = state;
      const kind = kindOf(f.type === 'answer' ? null : input, f.type === 'answer' ? ask : null, s, seat);
      const words = describeAct(f, s, input);
      if (f.type === 'answer') ask = null;
      if (!words) return;
      const sameMoment =
        open !== null && open.state.turn === s.turn && open.state.phase === s.phase && kind === null;
      if (kind === null && open && sameMoment) {
        open.actions.push(words);
        return;
      }
      if (kind === null && !open) return;
      if (kind === null && open) {
        open.actions.push(words);
        return;
      }
      open = {
        index: out.length,
        kind: kind!,
        frameIndex: stateIdx,
        state: s,
        input: f.type === 'answer' ? null : input,
        ask: f.type === 'answer' ? (log.frames.slice(0, i).reverse().find((x) => x.type === 'ask')?.body as AskBody) ?? null : null,
        label: labelFor(s, seat, kind!),
        actions: [words],
      };
      out.push(open);
    }
  });
  return out;
}

function fromPhases(log: GameLog, seat: number): Decision[] {
  const out: Decision[] = [];
  let lastKey = '';
  log.frames.forEach((f, i) => {
    if (f.type !== 'state') return;
    const s = f.body as GameStateBody;
    if (!s.phase || !COACHABLE_PHASES.has(s.phase)) return;
    const key = `${s.turn}:${s.phase}`;
    if (key === lastKey) return;
    lastKey = key;
    const mine = s.activePlayer === seat;
    let kind: DecisionKind;
    if (mine && (s.phase === 'MAIN1' || s.phase === 'MAIN2')) kind = 'main';
    else if (mine && s.phase === 'COMBAT_DECLARE_ATTACKERS') kind = 'attack';
    else if (!mine && s.phase === 'COMBAT_DECLARE_BLOCKERS') kind = 'block';
    else return;
    out.push({ index: out.length, kind, frameIndex: i, state: s, input: null, ask: null, label: labelFor(s, seat, kind), actions: [] });
  });
  return out;
}

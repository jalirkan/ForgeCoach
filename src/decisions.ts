/*
 * ForgeCoach — decisions.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Turns a frame log into the list of moments a coach talks about: each place
 * the viewing seat had to decide something, with the exact state at that
 * moment and what the player actually did there.
 *
 * A human-seat recording (one with c2s frames) is read like this:
 *
 * - **One `main` decision per (turn, main phase)** of the viewing seat. Every
 *   act inside it is merged, and the actions are read from what the *engine*
 *   did afterwards (the `land` / `cast` / `zone` events of the following state
 *   frames), not from the clicks: "played Island", "cast Web Up targeting …".
 *   Clicks that led nowhere — a spell clicked and then cancelled at "Pay Mana
 *   Cost", a land clicked after the land drop — leave no events and so leave
 *   no words. (Forge does emit a `zone hand→stack` event for an aborted cast
 *   with no matching return; only `cast` events count as casts.)
 * - **`attack` / `block`** for the declare-attackers / declare-blockers
 *   prompts, rendered from the `attackers` / `blockers` events. Priority
 *   stops later in that combat fold into it.
 * - **`priority`** for any other priority stop, kept only when the player
 *   cast or activated something there, answered a question there, or had an
 *   instant-speed option (see `instantSpeedOptions` in state.ts).
 * - **Asks** fold into the decision that is open on the same turn, as
 *   "<question> → chose <answer>"; an ask with nothing open becomes its own
 *   `choice` decision. Answers given for a cast that was then abandoned are
 *   dropped with it.
 * - The pre-game keep / mulligan prompts become one `choice` decision.
 *
 * `state` is the state in force when the player first acted in the decision.
 *
 * An AI-vs-AI recording has no acts, so it yields one decision per (turn,
 * phase) the viewer could have acted in, with the viewer's plays read from
 * the events the same way.
 */
import type { AnyCard, AskBody, GameEvent, GameStateBody, InputBody, StackItem } from './protocol.ts';
import { isHidden } from './protocol.ts';
import type { GameLog, LoggedFrame } from './log.ts';
import type { CardInfo } from './cards.ts';
import { castIsAbility, instantSpeedOptions, isTriggerText, type InstantOption } from './state.ts';

export type DecisionKind = 'main' | 'attack' | 'block' | 'priority' | 'choice';

export interface Decision {
  /** Position in the decision list. */
  index: number;
  kind: DecisionKind;
  /** Index into `log.frames` of the state frame this decision is about (the state before the player acted). */
  frameIndex: number;
  state: GameStateBody;
  /** The engine's prompt at the moment, when the recording has one. */
  input: InputBody | null;
  /** The blocking question, when the decision is (or contains) an ask: the first one. */
  ask: AskBody | null;
  /** Short human label: "R3 · Your main 1". */
  label: string;
  /** What the player actually did, in order, in plain words. */
  actions: string[];
  /** Index into `log.frames` of the last frame that belongs to this decision. */
  endFrameIndex: number;
  /** For `priority` decisions: what the player could have done at instant speed when the stop began. */
  options?: InstantOption[];
}

export interface ExtractOptions {
  /** Scryfall text by Forge card name; improves the instant-speed check (flash, activated abilities, mana). */
  cards?: Map<string, CardInfo>;
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

const isCombat = (phase: string | null | undefined) => !!phase && phase.startsWith('COMBAT_');
const isMain = (phase: string | null | undefined) => phase === 'MAIN1' || phase === 'MAIN2';

function labelFor(state: GameStateBody, seat: number, kind: DecisionKind): string {
  if (!state.phase || !state.turn) return 'Pre-game · keep or mulligan';
  const round = state.round || Math.ceil((state.turn || 0) / 2);
  if (kind === 'attack') return `R${round} · Your attacks`;
  if (kind === 'block') return `R${round} · Your blocks`;
  const whose = state.activePlayer === seat ? 'Your' : "Opponent's";
  return `R${round} · ${whose} ${phaseLabel(state.phase)}`;
}

export function extractDecisions(log: GameLog, opts: ExtractOptions = {}): Decision[] {
  const seat = log.seat;
  const hasActs = log.frames.some((f) => f.dir === 'c2s' || f.type === 'act');
  return hasActs ? fromActs(log, seat, opts) : fromPhases(log, seat);
}

// ---------------------------------------------------------------------------
// Reading what happened from events

/** Card names seen so far, so a card that has since gone to a hidden zone still has one. */
class Names {
  private m = new Map<number, string>();
  private players = new Map<number, string>();
  see(s: GameStateBody) {
    for (const p of s.players) {
      this.players.set(p.id, p.name);
      for (const z of Object.values(p.zones)) for (const c of z.cards) if (!isHidden(c) && c.name) this.m.set(c.id, c.name);
    }
    for (const c of s.stackCards ?? []) if (!isHidden(c) && c.name) this.m.set(c.id, c.name);
  }
  card(id: number): string {
    return this.m.get(id) ?? 'a hidden card';
  }
  player(id: number): string {
    return this.players.get(id) ?? `player ${id}`;
  }
}

/** Which (turn, phase) an event happened in; a decision only collects events inside its scope. */
interface Scope {
  turn: number;
  /** null = any phase of that turn. */
  phases: Set<string> | null;
  combat: boolean;
}
function inScope(scope: Scope, turn: number, phase: string | null): boolean {
  if (turn !== scope.turn) return false;
  if (scope.phases === null) return true;
  if (scope.combat && isCombat(phase)) return true;
  return phase !== null && scope.phases.has(phase);
}

function controllerOf(state: GameStateBody, cardId: number): number | null {
  for (const p of state.players) {
    for (const z of Object.values(p.zones)) {
      const c = (z.cards as AnyCard[]).find((x) => x.id === cardId);
      if (c) return c.controller ?? p.id;
    }
  }
  return null;
}

function targetsText(item: StackItem | undefined, state: GameStateBody, seat: number, names: Names): string {
  if (!item) return '';
  const parts: string[] = [];
  for (const id of item.targetCardIds) {
    const ctl = controllerOf(state, id);
    const whose = ctl === null ? '' : ctl === seat ? 'your ' : "opponent's ";
    parts.push(`${whose}${names.card(id)}`);
  }
  for (const id of item.targetPlayerIds) parts.push(id === seat ? 'yourself' : names.player(id));
  return parts.length ? ` targeting ${parts.join(' and ')}` : '';
}

/** "Helicarrier (69) - Helicarrier (69) becomes …" → "becomes …"; ids stripped. */
function abilityText(text: string, name: string): string {
  let t = text.replace(/\s*\(Targeting:.*\)\s*$/, '');
  const prefix = new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\(\\d+\\) -\\s*`);
  t = t.replace(prefix, '');
  t = t.replace(/ \(\d+\)/g, '').replace(/\s+/g, ' ').trim();
  return t.length > 90 ? `${t.slice(0, 87)}…` : t;
}

interface EventWords {
  lines: string[];
  /** The player cast a spell or activated an ability here (a "real" play). */
  played: boolean;
  /** Anything happened that makes pending ask answers stick (rather than an abandoned attempt). */
  meaningful: boolean;
}

/**
 * Render the viewing seat's own plays among `state.events`, keeping only those
 * whose (turn, phase) falls in `scope`. The (turn, phase) cursor starts at the
 * previous snapshot and follows the batch's own `turn` / `phase` events,
 * because one batch can span several steps.
 */
function eventWords(
  state: GameStateBody,
  prev: GameStateBody | null,
  scope: Scope,
  seat: number,
  names: Names,
): EventWords {
  const out: EventWords = { lines: [], played: false, meaningful: false };
  let turn = prev?.turn ?? state.turn;
  let phase = prev?.phase ?? state.phase;
  const castIds = new Set<number>();
  for (const e of state.events as GameEvent[]) {
    if (e.kind === 'turn') {
      turn = e.turn;
      continue;
    }
    if (e.kind === 'phase') {
      phase = e.phase;
      continue;
    }
    if (!inScope(scope, turn, phase)) continue;
    switch (e.kind) {
      case 'land':
        if (e.player === seat) {
          out.lines.push(`played ${names.card(e.cardId)}`);
          out.played = out.meaningful = true;
        }
        break;
      case 'cast': {
        if (e.controller !== seat) break;
        const item = state.stack.find((s) => s.id === e.stackId);
        const name = names.card(e.cardId);
        const targets = targetsText(item, state, seat, names);
        out.meaningful = true;
        if (!castIsAbility(e, state, prev)) {
          out.lines.push(`cast ${name}${targets}`);
          castIds.add(e.cardId);
          out.played = true;
        } else if (!isTriggerText(e.text)) {
          out.lines.push(`activated ${name}: ${abilityText(e.text, name)}${targets}`);
          out.played = true;
        } else if (targets) {
          // A trigger is automatic, but its target was the player's choice.
          out.lines.push(`${name}'s trigger${targets}`);
        }
        break;
      }
      case 'attackers':
        if (e.player !== seat) break;
        out.meaningful = true;
        if (e.bands.every((b) => b.attackerIds.length === 0)) out.lines.push('declared no attackers');
        for (const b of e.bands) {
          if (!b.attackerIds.length) continue;
          const who = b.defender
            ? b.defender.kind === 'player'
              ? names.player(b.defender.id)
              : names.card(b.defender.id)
            : 'the opponent';
          out.lines.push(`attacked ${who} with ${b.attackerIds.map((id) => names.card(id)).join(', ')}`);
        }
        break;
      case 'blockers': {
        if (e.defendingPlayer !== seat) break;
        out.meaningful = true;
        // The bridge lists an unblocked attacker as blocking itself (blockerIds: [attackerId]); drop that.
        const real = e.blocks
          .map((b) => ({ a: b.attackerId, bs: b.blockerIds.filter((x) => x !== b.attackerId) }))
          .filter((b) => b.bs.length > 0);
        if (real.length === 0) out.lines.push('declared no blockers');
        for (const b of real) out.lines.push(`blocked ${names.card(b.a)} with ${b.bs.map((id) => names.card(id)).join(', ')}`);
        break;
      }
      case 'sacrificed':
        if (controllerOf(prev ?? state, e.cardId) === seat) {
          out.lines.push(`sacrificed ${names.card(e.cardId)}`);
          out.meaningful = true;
        }
        break;
      case 'zone': {
        const from = e.from;
        const to = e.to;
        if (from?.zone === 'hand' && from.player === seat && to?.zone === 'graveyard' && !castIds.has(e.cardId)) {
          out.lines.push(`discarded ${names.card(e.cardId)}${phase === 'CLEANUP' ? ' to hand size' : ''}`);
          out.meaningful = true;
        } else if (!(from?.zone === 'hand' && to?.zone === 'stack')) {
          out.meaningful = true;
        }
        break;
      }
      case 'resolved':
      case 'damage':
      case 'scry':
      case 'surveil':
      case 'counters':
      case 'attach':
      case 'life':
        out.meaningful = true;
        break;
      default:
        break;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Asks

function optionLabel(ask: AskBody, idx: number): string {
  const opts = (ask as { options?: { id: number; label: string }[] }).options ?? [];
  const o = opts.find((x) => x.id === idx) ?? opts[idx];
  return o ? cleanLabel(o.label) : `option ${idx}`;
}
function cleanLabel(s: string): string {
  return s.replace(/ \(\d+\)/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * "<question> → chose <answer>", or null for an answer that says nothing a
 * coach cares about (the ability menu — the cast says it; a declined optional
 * cost; the order of replacement effects).
 */
export function describeAnswer(ask: AskBody, value: unknown): string | null {
  const prompt = cleanLabel(('prompt' in ask && typeof ask.prompt === 'string' ? ask.prompt : '') || '');
  const q = (fallback: string) => prompt || fallback;
  switch (ask.kind) {
    case 'ability_menu':
      return null;
    case 'confirm': {
      if (value === null || value === undefined) return null;
      return `${q('Confirm')} → ${value ? ask.yesLabel || 'yes' : ask.noLabel || 'no'}`;
    }
    case 'options':
      if (typeof value !== 'number') return null;
      return `${q('Choose')} → chose ${optionLabel(ask, value)}`;
    case 'text':
      return value === null || value === undefined ? null : `${q('Enter a value')} → ${String(value)}`;
    case 'choose_list':
    case 'choose_entities': {
      if (!Array.isArray(value)) return null;
      if ('reveal' in ask && ask.reveal) return null;
      if (value.length === 0) return /optional cost/i.test(prompt) ? null : `${q('Choose')} → chose nothing`;
      return `${q('Choose')} → chose ${value.map((v) => optionLabel(ask, v as number)).join(', ')}`;
    }
    case 'order': {
      if (/replacement effect/i.test(prompt)) return null;
      const v = value as { ordered?: number[] } | null;
      const all = [...ask.dest, ...ask.source];
      const names = (v?.ordered ?? []).map((i) => cleanLabel(all[i]?.label ?? `#${i}`));
      return names.length ? `${q('Order')} → ${names.join(', ')}` : null;
    }
    case 'assign_damage':
    case 'assign_amount': {
      const v = (value ?? {}) as Record<string, number>;
      const parts = Object.entries(v)
        .filter(([, n]) => n > 0)
        .map(([i, n]) => `${n} to ${cleanLabel(ask.targets[Number(i)]?.label ?? `#${i}`)}`);
      const what = ask.kind === 'assign_damage' ? 'assigned combat damage' : `assigned ${ask.label || 'amounts'}`;
      return parts.length ? `${what}: ${parts.join(', ')}` : null;
    }
    case 'manipulate_list':
      return `${q('Arrange cards')} → arranged`;
    case 'sideboard':
      return 'sideboarded';
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Human-seat recordings

interface Draft {
  d: Decision;
  key: string;
  scope: Scope;
  /** Answers waiting for the play they belong to. */
  pending: string[];
  played: boolean;
  answered: boolean;
  /** Pre-game only: the seat's mulligans. */
  mulligans: number;
  sawKeepPrompt: boolean;
}

function classify(
  input: InputBody | null,
  s: GameStateBody,
  seat: number,
): { kind: DecisionKind; key: string; scope: Scope } | 'continue' {
  if (!s.phase || !s.turn) return { kind: 'choice', key: 'pregame', scope: { turn: s.turn, phases: null, combat: false } };
  const p = input?.prompt ?? '';
  if (/^Select creatures to attack/i.test(p)) {
    return { kind: 'attack', key: `attack:${s.turn}`, scope: { turn: s.turn, phases: new Set(), combat: true } };
  }
  if (/^Select creatures to block/i.test(p)) {
    return { kind: 'block', key: `block:${s.turn}`, scope: { turn: s.turn, phases: new Set(), combat: true } };
  }
  if (s.activePlayer === seat && isMain(s.phase)) {
    return { kind: 'main', key: `main:${s.turn}:${s.phase}`, scope: { turn: s.turn, phases: new Set([s.phase]), combat: false } };
  }
  if (/^Priority:/i.test(p) || !input) {
    return { kind: 'priority', key: `prio:${s.turn}:${s.phase}`, scope: { turn: s.turn, phases: new Set([s.phase]), combat: false } };
  }
  // "Pay Mana Cost", "Select target", "Discard …", a yield banner: part of whatever is open.
  return 'continue';
}

function fromActs(log: GameLog, seat: number, opts: ExtractOptions): Decision[] {
  const drafts: Draft[] = [];
  const byKey = new Map<string, Draft>();
  const names = new Names();
  let state: GameStateBody | null = null;
  let prev: GameStateBody | null = null;
  let stateIdx = -1;
  let input: InputBody | null = null;
  let lastAsk: AskBody | null = null;
  let open: Draft | null = null;

  const openDraft = (kind: DecisionKind, key: string, scope: Scope, s: GameStateBody, i: number): Draft => {
    const existing = byKey.get(key);
    if (existing) return existing;
    const d: Decision = {
      index: -1,
      kind,
      frameIndex: stateIdx,
      state: s,
      input,
      ask: null,
      label: labelFor(s, seat, kind),
      actions: [],
      endFrameIndex: i,
    };
    if (kind === 'priority') d.options = instantSpeedOptions(s, seat, opts.cards);
    const draft: Draft = { d, key, scope, pending: [], played: false, answered: false, mulligans: 0, sawKeepPrompt: false };
    drafts.push(draft);
    byKey.set(key, draft);
    return draft;
  };

  log.frames.forEach((f: LoggedFrame, i: number) => {
    if (f.type === 'state') {
      prev = state;
      state = f.body as GameStateBody;
      stateIdx = i;
      names.see(state);
      if (open) {
        if (open.key === 'pregame') {
          for (const e of state.events) if (e.kind === 'mulligan' && e.player === seat) open.mulligans++;
        }
        const w = eventWords(state, prev, open.scope, seat, names);
        open.d.actions.push(...w.lines);
        if (w.played) open.played = true;
        if (w.meaningful && open.pending.length) {
          open.d.actions.push(...open.pending);
          open.answered = true;
          open.pending = [];
        }
        if (w.lines.length || w.meaningful) open.d.endFrameIndex = i;
      }
      return;
    }
    if (f.type === 'input') {
      input = f.body as InputBody;
      return;
    }
    if (f.type === 'ask') {
      lastAsk = f.body as AskBody;
      return;
    }
    if (!state || (f.type !== 'act' && f.type !== 'answer')) return;
    const s: GameStateBody = state;

    if (f.type === 'answer') {
      const ans = f.body as { askId: string; value: unknown };
      const ask: AskBody | null = lastAsk; // the bridge has one ask outstanding at a time (§5)
      if (!ask) return;
      if (!open || open.scope.turn !== s.turn) {
        open = openDraft('choice', `choice:${s.turn}:${s.phase}:${ans.askId}`, { turn: s.turn, phases: null, combat: false }, s, i);
      }
      if (!open.d.ask) open.d.ask = ask;
      const words = describeAnswer(ask, ans.value);
      if (words) open.pending.push(words);
      // A choice decision has no play to wait for: its answer stands on its own.
      if (open.d.kind === 'choice' && open.key !== 'pregame' && open.pending.length) {
        open.d.actions.push(...open.pending);
        open.answered = true;
        open.pending = [];
      }
      open.d.endFrameIndex = i;
      return;
    }

    // An act.
    const b = f.body as { action: string };
    if (!['clickCard', 'clickPlayer', 'buttonOk', 'buttonCancel', 'passPriority', 'alphaStrike', 'concede', 'useMana', 'yieldTo'].includes(b.action)) {
      return; // phase stops, yield settings, undo and the like are settings, not plays
    }
    const c = classify(input, s, seat);
    let target: Draft | null;
    if (c === 'continue') {
      target = open && open.scope.turn === s.turn ? open : null;
      if (target && target.scope.phases && s.phase && !target.scope.phases.has(s.phase)) target.scope.phases.add(s.phase);
      if (!target) {
        target = openDraft('priority', `prio:${s.turn}:${s.phase}`, { turn: s.turn, phases: new Set([s.phase ?? '']), combat: false }, s, i);
      }
    } else if (
      c.kind === 'priority' &&
      open &&
      (open.d.kind === 'attack' || open.d.kind === 'block') &&
      open.scope.turn === s.turn &&
      isCombat(s.phase)
    ) {
      target = open; // priority later in the same combat
    } else {
      target = openDraft(c.kind, c.key, c.scope, s, i);
    }
    if (target !== open) {
      if (open) open.pending = [];
      open = target;
    }
    const prompt = input?.prompt ?? '';
    if (open.key === 'pregame') {
      if (/keep your hand/i.test(prompt)) open.sawKeepPrompt = true;
      else if (/play or draw/i.test(prompt) && (b.action === 'buttonOk' || b.action === 'buttonCancel')) {
        const label = b.action === 'buttonOk' ? input?.buttons.ok.label : input?.buttons.cancel.label;
        if (label && !open.d.actions.some((a) => a.startsWith('chose to'))) open.d.actions.push(`chose to ${label.toLowerCase()}`);
      }
    }
    // A fresh click at a priority prompt, or a cancel, abandons whatever was half-done.
    if (b.action === 'buttonCancel' || (b.action === 'clickCard' && /^Priority:/i.test(prompt))) open.pending = [];
    if (b.action === 'concede') open.d.actions.push('conceded');
    open.d.endFrameIndex = i;
  });

  const out: Decision[] = [];
  for (const dr of drafts) {
    const d = dr.d;
    if (dr.key === 'pregame') {
      if (dr.sawKeepPrompt || dr.mulligans) {
        d.actions.push(dr.mulligans ? `mulliganed ${dr.mulligans} time${dr.mulligans > 1 ? 's' : ''}, then kept` : 'kept the opening hand');
      }
      if (!d.actions.length) continue;
    } else if (d.kind === 'priority') {
      if (!dr.played && !dr.answered && !(d.options && d.options.length)) continue;
      if (!d.actions.length) d.actions.push('passed');
    } else if (d.kind === 'main') {
      if (!d.actions.length) d.actions.push('passed without playing anything');
    } else if (d.kind === 'attack') {
      if (!d.actions.some((a) => a.startsWith('attacked') || a.startsWith('declared no'))) d.actions.unshift('declared no attackers');
    } else if (d.kind === 'block') {
      if (!d.actions.some((a) => a.startsWith('blocked') || a.startsWith('declared no'))) d.actions.unshift('declared no blockers');
    } else if (d.kind === 'choice' && !d.actions.length) {
      continue;
    }
    d.index = out.length;
    out.push(d);
  }
  return out;
}

// ---------------------------------------------------------------------------
// AI-vs-AI recordings

function fromPhases(log: GameLog, seat: number): Decision[] {
  const out: Decision[] = [];
  const names = new Names();
  let lastKey = '';
  let prev: GameStateBody | null = null;
  let current: { d: Decision; scope: Scope } | null = null;
  log.frames.forEach((f, i) => {
    if (f.type !== 'state') return;
    const s = f.body as GameStateBody;
    names.see(s);
    // The viewer's plays land in the decision that is open for that (turn, phase).
    if (current) {
      const w = eventWords(s, prev, current.scope, seat, names);
      current.d.actions.push(...w.lines);
      if (w.lines.length) current.d.endFrameIndex = i;
    }
    const before = prev;
    prev = s;
    if (!s.phase || !COACHABLE_PHASES.has(s.phase)) return;
    const key = `${s.turn}:${s.phase}`;
    if (key === lastKey) return;
    lastKey = key;
    const mine = s.activePlayer === seat;
    let kind: DecisionKind;
    if (mine && isMain(s.phase)) kind = 'main';
    else if (mine && s.phase === 'COMBAT_DECLARE_ATTACKERS') kind = 'attack';
    else if (!mine && s.phase === 'COMBAT_DECLARE_BLOCKERS') kind = 'block';
    else return;
    const d: Decision = {
      index: out.length,
      kind,
      frameIndex: i,
      state: s,
      input: null,
      ask: null,
      label: labelFor(s, seat, kind),
      actions: [],
      endFrameIndex: i,
    };
    out.push(d);
    current = {
      d,
      scope: { turn: s.turn, phases: new Set([s.phase]), combat: kind !== 'main' },
    };
    // The batch that brought us into this step may already hold its plays (declared attackers, say).
    const w = eventWords(s, before, current.scope, seat, names);
    d.actions.push(...w.lines);
  });
  return out;
}

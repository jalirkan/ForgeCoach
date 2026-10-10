/*
 * ForgeCoach — livePlan/moments.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * WHEN auto-coach asks, ported from the seat's moments (mtg-table tools/llm-seat
 * lib/plan-core.mjs, D419; one fresh call per moment):
 *
 *   mulligan    the opening hand (again after each mulligan); play-draw when
 *               the engine asks it
 *   turn        the player's first decision of their own turn that is not
 *               forced, after the draw: their first main phase when something
 *               there can be played or paid for, else the attack declaration
 *               when a creature can attack — "It is your turn N. What do you do?"
 *   response    the opponent's spell or ability on top of the stack, once per
 *               stack item, when the player could respond (something listed
 *               that the untapped mana can pay for)
 *   blocks      the block declaration, once a turn, when a block is possible
 *   end-step    the opponent's end step, once a turn, when the player could
 *               cast or activate something there
 *   question    an engine question with more than one answer (a target, a
 *               choice, a yes/no, scry …) that the newest plan does not answer
 *
 * Each moment has an id (`turn:7`, `response:8:412`, `q:<askId>` …) and is
 * asked once: the caller keeps the asked ids (autoPlan.ts, kept across a reload
 * by adviceStore.ts). Paying mana and the engine's own forced moves are never a
 * moment. Pure and DOM-free.
 */
import type { AskBody, GameStateBody, InputBody } from '../protocol.ts';
import type { LoggedFrame } from '../log.ts';
import { isPlayDrawInput } from '../decisions.ts';
import { cardsById, nameOf, playersOf, zoneCards } from './board.ts';
import { activationProblem, payProblem } from './mana.ts';
import { atPriority, offersOf, type Offers } from './offers.ts';
import type { Oracle } from './oracle.ts';
import { matchRef, normName, parseRef, splitNames, type Candidate, type Step } from './parse.ts';
import {
  Namer,
  PLAY_DRAW_QUESTION,
  attackCandidates,
  blockPairs,
  blocksQuestion,
  endStepQuestion,
  mulliganQuestion,
  nowQuestion,
  planProgressText,
  questionText,
  responseQuestion,
  stackItemWords,
  turnQuestion,
  type Choice,
  type ChoiceQuestion,
} from './prompt.ts';

export type MomentKind = 'mulligan' | 'play-draw' | 'turn' | 'response' | 'blocks' | 'end-step' | 'question' | 'now';

export interface Moment {
  kind: MomentKind;
  /** Asked once per game seat. */
  id: string;
  /** The question at the top and the bottom of the prompt. */
  question: string;
  /** What the advice is for, in words ("Your turn 7"). */
  label: string;
  /** turn: asked at the attack declaration (the main phase had nothing to play). */
  atAttack?: boolean;
  /** question: the engine's question and its answers (check.ts matches target / choose against them). */
  ask?: ChoiceQuestion | null;
}

export interface PlanSoFar {
  steps: readonly Step[];
  done: readonly boolean[];
}

export interface MomentInput {
  /** The log's frames up to now. */
  frames: readonly LoggedFrame[];
  state: GameStateBody | null;
  input: InputBody | null;
  ask: AskBody | null;
  me: number;
  oracle: Oracle | null;
  /** The newest plan of this turn and its progress (a question it answers is not asked). */
  plan?: PlanSoFar | null;
}

const firstLine = (s: string) => String(s ?? '').split('\n')[0]!.trim().slice(0, 80);

/** Lands the seat played this turn (from the events since the turn began). */
export function landsPlayedThisTurn(frames: readonly LoggedFrame[], me: number): number {
  let n = 0;
  for (const f of frames) {
    if (f.dir === 'c2s' || f.type !== 'state') continue;
    for (const e of (f.body as GameStateBody).events ?? []) {
      if (e.kind === 'turn') n = 0;
      else if (e.kind === 'land' && e.player === me) n += 1;
    }
  }
  return n;
}

function mulligansSoFar(frames: readonly LoggedFrame[], me: number): number {
  let n = 0;
  for (const f of frames) {
    if (f.dir === 'c2s' || f.type !== 'state') continue;
    for (const e of (f.body as GameStateBody).events ?? []) if (e.kind === 'mulligan' && e.player === me) n += 1;
  }
  return n;
}

/**
 * Is there anything at this priority the player could do: a land, an ability,
 * or a spell the untapped mana can pay for? (state.playable does not predict
 * mana, M61: without this a hand of unaffordable instants would ask about every
 * spell the opponent casts.)
 */
export function canAct(state: GameStateBody, me: number, offers: Offers, oracle: Oracle | null): boolean {
  const cards = cardsById(state);
  return offers.some(
    (o) =>
      o.verb === 'land' ||
      (o.verb === 'activate' && !(o.engine && activationProblem(o.abilityLabel ?? '', cards.get(o.cardId), state, me, oracle))) ||
      (o.verb === 'cast' && !(o.zone === 'hand' && payProblem(cards.get(o.cardId), state, me, oracle))),
  );
}

const PAYING = /^(Delve how many cards\?|Exile which card\s*\(\d+\s*\/\s*\d+\)\?)/i;

/** The engine's open question (an ask) as choices, or null when it is not one to coach (paying, ordering triggers, damage). */
export function askChoices(ask: AskBody, state: GameStateBody): ChoiceQuestion | null {
  const cards = cardsById(state);
  const label = (o: { label: string; cardId?: number; card?: unknown; kind?: string; playerId?: number }) => {
    if (o.kind === 'ability' && o.label) return String(o.label);
    const c = (o.card as { name?: string } | undefined) ?? (typeof o.cardId === 'number' ? cards.get(o.cardId) : undefined);
    const n = c && (c as { hidden?: boolean }).hidden !== true ? (c as { name?: string }).name : null;
    return n || String(o.label ?? '');
  };
  const opt = (o: { id: number; label: string; cardId?: number; playerId?: number; kind?: string; card?: unknown }): Choice => ({
    label: label(o),
    ...(typeof o.cardId === 'number' ? { cardId: o.cardId } : {}),
    ...(typeof o.playerId === 'number' ? { playerId: o.playerId } : {}),
  });
  switch (ask.kind) {
    case 'ability_menu': {
      const playable = ask.options.some((o) => o.canPlay) ? ask.options.filter((o) => o.canPlay) : ask.options;
      if (playable.length < 2) return null;
      return { prompt: `Choose an ability of ${nameOf(cards.get(ask.cardId)) ?? 'the card'}`, choices: playable.map((o) => ({ label: String(o.label) })), min: 1, max: 1, cardId: ask.cardId };
    }
    case 'confirm':
      return {
        prompt: [ask.title, ask.prompt].filter(Boolean).join(': ') || 'Confirm',
        choices: [
          { label: ask.yesLabel || 'Yes', value: true },
          { label: ask.noLabel || 'No', value: false },
        ],
        min: 1,
        max: 1,
        cardId: (ask.card as { id?: number } | null)?.id ?? null,
      };
    case 'options':
      if (ask.options.length < 2) return null;
      return { prompt: ask.prompt || ask.title, choices: ask.options.map(opt), min: 1, max: 1, cardId: (ask.card as { id?: number } | null)?.id ?? null };
    case 'choose_list':
    case 'choose_entities': {
      if (PAYING.test(String(ask.prompt ?? ''))) return null;
      if (ask.options.length < 2 && !(ask.options.length === 1 && ask.min === 0)) return null;
      if (ask.min === ask.options.length && ask.max === ask.min) return null;
      return { prompt: ask.prompt, choices: ask.options.map(opt), min: Math.max(0, ask.min), max: Math.max(1, ask.max) };
    }
    case 'manipulate_list':
      if (ask.cards.length < 2 && !(ask.toTop && ask.toBottom && ask.cards.length === 1)) return null;
      return { prompt: ask.prompt, choices: ask.cards.map(opt), min: 0, max: ask.cards.length };
    case 'order': {
      // "Select cards to be put on the bottom of your library" (scry-like): which go to `destLabel`
      const total = ask.source.length + ask.dest.length;
      const lo = ask.max >= 0 ? Math.max(0, total - ask.max) : 0;
      const hi = ask.min >= 0 ? Math.min(total, total - ask.min) : total;
      if (ask.source.length === 0 || hi <= lo && lo === ask.dest.length) return null;
      return { prompt: ask.prompt || ask.destLabel, choices: ask.source.map(opt), min: lo, max: Math.max(1, hi) };
    }
    default:
      return null;
  }
}

/** A selection input (a target, cards to choose) as choices, or null. Ported from decision.mjs 'select'. */
export function selectChoices(input: InputBody, state: GameStateBody, me: number): ChoiceQuestion | null {
  const prompt = String(input.prompt ?? '');
  const sel = input.selectable;
  const ids = (sel?.cardIds ?? []).filter((x) => typeof x === 'number');
  const bottom = /^Return (\d+) card\(s\) to the bottom of your library/i.exec(prompt);
  if (bottom) {
    const hand = zoneCards(playersOf(state, me).mine, 'hand').filter((c) => c.hidden !== true);
    const k = Number(bottom[1]);
    if (hand.length <= k) return null;
    return { prompt, choices: hand.map((c) => ({ label: nameOf(c) ?? `card ${c.id}`, cardId: c.id })), min: k, max: k };
  }
  if (!((sel?.mode === 'cards' && ids.length > 0) || sel?.mode === 'players')) return null;
  const cards = cardsById(state);
  const choices: Choice[] = [];
  const playerWords = /any target|target player|target opponent|player or planeswalker|creature or player|player, planeswalker|each opponent|any player/i;
  if (sel.mode === 'players' || (/\bSelect\b[^\n]*\btarget\b/i.test(prompt) && playerWords.test(prompt))) {
    for (const p of state.players ?? []) choices.push({ label: p.id === me ? 'me' : 'opponent', playerId: p.id });
  }
  for (const id of ids) {
    const c = cards.get(id) ?? (input.focusCard?.id === id ? (input.focusCard as never) : null);
    choices.push({ label: nameOf(c) ?? `card ${id}`, cardId: id });
  }
  const selMin = typeof sel.min === 'number' ? sel.min : 0;
  const selMax = typeof sel.max === 'number' && sel.max > 0 ? sel.max : ids.length;
  if (selMax <= 1) {
    if (input.buttons?.ok?.enabled && selMin === 0) choices.push({ label: `${input.buttons.ok.label} (choose nothing)` });
    if (input.buttons?.cancel?.enabled) choices.push({ label: `${input.buttons.cancel.label}` });
    const real = choices.filter((c) => c.cardId !== undefined || c.playerId !== undefined);
    if (choices.length <= 1) return null;
    if (real.length === 1 && selMin >= 1 && choices.every((c) => c === real[0] || /cancel/i.test(c.label))) return null;
    return { prompt, choices, min: 1, max: 1 };
  }
  if (selMin >= choices.length && selMax === selMin) return null;
  return { prompt, choices, min: Math.max(0, selMin), max: Math.min(selMax, choices.length) };
}

/** Two buttons that are a question ("Do you want to pay …?"), not priority or paying. */
function buttonChoices(input: InputBody): ChoiceQuestion | null {
  const ok = input.buttons?.ok;
  const cancel = input.buttons?.cancel;
  if (!ok?.enabled || !cancel?.enabled) return null;
  return { prompt: input.prompt, choices: [{ label: ok.label }, { label: cancel.label }], min: 1, max: 1 };
}

/** The candidates a target / choose step is matched against (check.ts uses them too). */
export function choiceCandidates(q: ChoiceQuestion, state: GameStateBody, me: number): Candidate<Choice>[] {
  const cards = cardsById(state);
  return q.choices.map((o, i) => {
    const aliases = [normName(o.label)];
    let name = o.label;
    let group = 'option';
    if (typeof o.cardId === 'number') {
      const c = cards.get(o.cardId);
      name = nameOf(c) ?? o.label;
      group = c ? `${c.zone}:${c.controller}` : 'search';
    } else if (typeof o.playerId === 'number') {
      const p = (state.players ?? []).find((x) => x.id === o.playerId);
      name = p?.name ?? o.label;
      aliases.push(...(o.playerId === me ? ['me', 'myself', 'my face', 'yourself', 'you'] : ['opponent', 'opp', 'the opponent', 'opponent s face']));
      group = `player:${o.playerId}`;
    }
    if (o.value === true) aliases.push('yes', 'pay', 'pay it', 'accept', 'do it', 'ok');
    if (o.value === false) aliases.push('no', 'dont pay', 'do not pay', 'decline', 'skip', 'dont', 'do not', 'pass');
    if (/\(choose nothing\)/.test(o.label)) aliases.push('none', 'nothing', normName(o.label.replace(/\s*\(.*\)$/, '')));
    return { id: typeof o.cardId === 'number' ? o.cardId : `option ${i}`, name, group, aliases, data: o };
  });
}

/** Does `text` (a target / choose step's names) name one of the question's answers? */
export function namesAChoice(text: string, q: ChoiceQuestion, state: GameStateBody, me: number): boolean {
  const cands = choiceCandidates(q, state, me);
  return splitNames(text, cands.map((c) => c.name)).some((n) => {
    const raw = normName(n);
    if (cands.some((c) => normName(c.data!.label) === raw || (raw.length >= 3 && normName(c.data!.label).includes(raw)))) return true;
    return matchRef(parseRef(n), cands).ok;
  });
}

/** Does the newest plan already answer this question (a target or choice it names, the ability of a card it plays)? */
export function planAnswers(plan: PlanSoFar | null | undefined, q: ChoiceQuestion, state: GameStateBody, me: number): boolean {
  if (!plan) return false;
  return plan.steps.some((s, i) => {
    if (plan.done[i] && s.verb !== 'cast' && s.verb !== 'activate') return false;
    if ((s.verb === 'target' || s.verb === 'choose') && s.names) return namesAChoice(s.names, q, state, me);
    if ((s.verb === 'cast' || s.verb === 'activate') && s.name) {
      if (s.targets && namesAChoice(s.targets, q, state, me)) return true;
      // an ability menu, or a yes/no about the card the plan plays (its own cost): the plan chose the play
      if (typeof q.cardId === 'number') {
        const c = cardsById(state).get(q.cardId);
        const want = parseRef(String(s.name).split(':')[0]).name;
        if (c && nameOf(c) && normName(nameOf(c)) === want) return true;
      }
    }
    return false;
  });
}

function stackTop(state: GameStateBody) {
  return Array.isArray(state.stack) && state.stack.length ? state.stack[state.stack.length - 1]! : null;
}

function questionMoment(i: MomentInput, state: GameStateBody, q: ChoiceQuestion, id: string): Moment {
  return {
    kind: 'question',
    id,
    question: questionText(q, state, i.me, { plan: i.plan ? planProgressText(i.plan.steps, i.plan.done) : null }),
    label: `Question, turn ${state.turn || 0}: ${firstLine(q.prompt).replace(/\s*\[.*$/, '').slice(0, 60) || 'a choice'}`,
    ask: q,
  };
}

/**
 * The moment the player is at, whether or not it is worth asking on its own
 * (`force`: Ask about this), or null when nothing is theirs to decide.
 * Without `force`, null also for a moment auto-coach does not ask (nothing
 * playable, a question the plan answers, paying mana).
 */
export function momentAt(i: MomentInput, { force = false }: { force?: boolean } = {}): Moment | null {
  const state = i.state;
  if (!state) return null;
  const me = i.me;
  const input = i.input;
  const turn = state.turn || 0;
  const prompt = String(input?.prompt ?? '');
  const pregame = !state.phase || !state.turn;

  if (i.ask) {
    const q = askChoices(i.ask, state);
    if (q && (force || !planAnswers(i.plan, q, state, me))) return questionMoment(i, state, q, `q:${i.ask.askId}`);
    return force ? { kind: 'now', id: `now:${i.ask.askId}`, question: nowQuestion(state, me), label: `Now, turn ${turn}` } : null;
  }
  if (input) {
    if (/^Waiting for\b|^Yielding\b/.test(prompt)) return null;
    if (/Pay Mana Cost/.test(prompt) || input.buttons?.ok?.label === 'Auto') return null;
    if (isPlayDrawInput(input, state)) return { kind: 'play-draw', id: 'play-draw', question: PLAY_DRAW_QUESTION, label: 'Play or draw' };
    if (pregame && /\bkeep\b/i.test(prompt) && input.buttons?.ok?.enabled && input.buttons?.cancel?.enabled && !prompt.startsWith('Priority')) {
      const n = mulligansSoFar(i.frames, me);
      return { kind: 'mulligan', id: `mulligan:${n}`, question: mulliganQuestion(state, me), label: n ? `Keep or mulligan (after ${n} mulligan${n === 1 ? '' : 's'})` : 'Keep or mulligan' };
    }
    if (prompt.startsWith('Select creatures to attack')) {
      if (!force && attackCandidates(state, me).length === 0) return null;
      return { kind: 'turn', id: `turn:${turn}`, question: turnQuestion(state, true), label: `Your turn ${turn}`, atAttack: true };
    }
    if (prompt.startsWith('Select creatures to block')) {
      const { attackers, blockers } = blockPairs(state, me);
      if (!force && (attackers.length === 0 || blockers.length === 0)) return null;
      return { kind: 'blocks', id: `blocks:${turn}`, question: blocksQuestion(state, me), label: `Your blocks, turn ${turn}` };
    }
    if (!/^Priority:/.test(prompt)) {
      const q = selectChoices(input, state, me) ?? (input.selectable?.mode === 'none' || !input.selectable ? buttonChoices(input) : null);
      if (q && (force || !planAnswers(i.plan, q, state, me))) {
        const ids = q.choices.map((c) => c.cardId ?? c.playerId ?? c.label).join(',');
        return questionMoment(i, state, q, `q:${turn}:${state.phase ?? 'pre'}:${normName(firstLine(prompt))}:${ids}`);
      }
      return force ? { kind: 'now', id: `now:${turn}:${state.phase}`, question: nowQuestion(state, me), label: `Now, turn ${turn}` } : null;
    }
  }
  if (!atPriority(state, me, input, i.ask)) return null;
  const offers = offersOf(state, me, i.oracle);
  const able = canAct(state, me, offers, i.oracle);
  const top = stackTop(state);
  if (top && top.controller !== me) {
    if (!able && !force) return null;
    const namer = new Namer(state);
    const src = top.sourceCardId != null ? namer.byId(top.sourceCardId) : 'something';
    return {
      kind: 'response',
      id: `response:${turn}:${top.id}`,
      question: responseQuestion(top, state, me, i.plan ? planProgressText(i.plan.steps, i.plan.done) : null),
      label: `Their ${src}${top.isAbility ? ' (ability)' : ''}, turn ${turn}`,
    };
  }
  if (top) return force ? { kind: 'now', id: `now:${turn}:${state.phase}:${top.id}`, question: nowQuestion(state, me), label: `Now, turn ${turn}` } : null;
  const own = state.activePlayer === me;
  const main = state.phase === 'MAIN1' || state.phase === 'MAIN2';
  if (own && main && (able || force)) return { kind: 'turn', id: `turn:${turn}`, question: turnQuestion(state), label: `Your turn ${turn}` };
  if (!own && state.phase === 'END_OF_TURN' && (able || force)) return { kind: 'end-step', id: `end:${turn}`, question: endStepQuestion(state, me, i.oracle), label: `Their end step, turn ${turn}` };
  return force ? { kind: 'now', id: `now:${turn}:${state.phase}`, question: nowQuestion(state, me), label: `Now, turn ${turn}` } : null;
}

/** The moment auto-coach asks now, or null (nothing due, or already asked). */
export function dueMoment(i: MomentInput, asked: ReadonlySet<string>): Moment | null {
  const m = momentAt(i);
  if (!m || asked.has(m.id)) return null;
  // the turn's plan is asked once: at the main phase, or at the attack when the main phase had nothing
  return m;
}

/** "the opponent's Lightning Bolt (targets you)" — for a response moment's words elsewhere. */
export function stackWords(state: GameStateBody, me: number): string | null {
  const top = stackTop(state);
  return top ? stackItemWords(top, state, me) : null;
}

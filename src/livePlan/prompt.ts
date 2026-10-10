/*
 * ForgeCoach — livePlan/prompt.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The live coach's words in plan mode, ported from mtg-table tools/llm-seat
 * (lib/plan-prompt.mjs and the questions of lib/plan-core.mjs, D419), where
 * Sonnet played ~60 real games against Forge in exactly this format (about one
 * failed step a game; it beat plain Forge 9 of 10).
 *
 * The system prompt's REPLY FORMAT section and its step verbs are the tested
 * ones, byte for byte; only "THE GAME" says coaching: a program checks each
 * step against what the engine allows (check.ts) and sends a step that cannot
 * be done back with the reason, and the player — not a program — carries the
 * steps out. The user message is planFullPrompt's: the question, GAME SO FAR,
 * NOW (the board in plain words), WHAT THE ENGINE LETS YOU DO NOW (mana
 * checked), CARD TEXT, the player's play guide when one is chosen, the
 * question again and the reminder of the format. Only the seat's redacted view
 * (the opponent's hand is a count). Deterministic: the same input gives the
 * same bytes.
 */
import type { GameStateBody, StackItem } from '../protocol.ts';
import type { LoggedFrame } from '../log.ts';
import { cardsById, hasKeyword, isCreature, isLand, nameOf, playersOf, zoneCards, type LooseCard } from './board.ts';
import { cardTextBlock, historyOf, visibleNames } from './history.ts';
import { activationProblem, availableMana, manaWords, payProblem, zoneCost } from './mana.ts';
import type { Offers } from './offers.ts';
import type { Oracle } from './oracle.ts';
import { duplicateNames, showName, type Step } from './parse.ts';

/** The REPLY FORMAT section: the tested words, unchanged (mtg-table plan-prompt.mjs PLAN_SYSTEM). */
export const REPLY_FORMAT = [
  'REPLY FORMAT. Every reply you write must have exactly this shape:',
  '',
  'PLAN: <one or two sentences, plain words>',
  'STEPS:',
  '1. <step>',
  '2. <step>',
  'END',
  '',
  'A program reads your reply, not a person. A reply not in this shape cannot be read: it is sent back to you as invalid, and that costs a turn of conversation. You may write a few lines of reasoning before the PLAN: line. Nothing may come after END.',
  '',
  'Each step is one of these, using card names exactly as the game shows them:',
  '  play land <card>',
  '  cast <card>                      or  cast <card> -> <target>',
  '  activate <card>                  or  activate <card> -> <target>',
  '  activate <card>: <ability>       (a permanent with several: its cost, as in "+2", or words of it)',
  '  attack with <creature>, <creature>, ...      or  attack with none',
  '  block <attacker> with <your creature>        (one line per block)',
  '  target <card or player>          (answers a question that asks for a target)',
  '  choose <option>                  (answers any other question, in the words shown)',
  '  keep   or   mulligan             (your opening hand)',
  '  pass                             (do nothing now: no response, no blocks; last step)',
  '  hold                             (do nothing more this turn; last step)',
  'The players are "opponent" and "me". When two cards share a name, add the number shown after it, as in "Island #12".',
  '',
  'Example:',
  'Their only creature is a 2/1, so I develop first and keep my Shock for it.',
  'PLAN: Play a Forest, cast Grizzly Bears, then attack with Llanowar Elves.',
  'STEPS:',
  '1. play land Forest',
  '2. cast Grizzly Bears',
  '3. attack with Llanowar Elves',
  'END',
].join('\n');

/**
 * THE GAME, for coaching. Contains "against the Forge AI" once, so opponent.ts
 * `systemFor` words it for a game against a friend.
 */
export const THE_GAME =
  'THE GAME. You are coaching a player through a live two-player game of Magic: The Gathering against the Forge AI. The game below is told from their seat ("you"), and you see only what that seat may see. A program checks each step you write against what the engine allows now (its lists of what can be played and activated, the untapped mana and its colours, the land drop, which creatures can attack or block) and sends back any step that cannot be done, with the reason, for you to correct. The player then carries out your steps in order: steps before an attack in the first main phase, the attack at declare attackers, steps after it in the second main phase, mana paid from the untapped mana. You are asked again when the player needs you: when the opponent casts or activates something they could respond to, when they must declare blockers, when a card asks them to choose, and at the end of the opponent\'s turn if they could cast something then.';

export const PLAN_SYSTEM = [REPLY_FORMAT, '', THE_GAME, '', 'Play to win.'].join('\n');

/** The reply reminder every question ends with. */
export const REPLY_REMINDER = 'Reply with PLAN:, STEPS: and END, as the system prompt shows.';

/** Corrections per moment before the last plan is shown as it is (plan-core.mjs). */
export const MAX_CORRECTIONS = 2;

const PHASE_WORDS: Record<string, string> = {
  UPKEEP: 'upkeep',
  DRAW: 'draw step',
  MAIN1: 'first main phase',
  COMBAT_BEGIN: 'beginning of combat',
  COMBAT_DECLARE_ATTACKERS: 'declare attackers step',
  COMBAT_DECLARE_BLOCKERS: 'declare blockers step',
  COMBAT_FIRST_STRIKE_DAMAGE: 'first-strike damage step',
  COMBAT_DAMAGE: 'combat damage step',
  COMBAT_END: 'end of combat',
  MAIN2: 'second main phase',
  END_OF_TURN: 'end step',
  CLEANUP: 'cleanup step',
};
export const phaseWords = (p: string | null | undefined): string => PHASE_WORDS[p ?? ''] ?? String(p ?? '-').toLowerCase();

const pt = (c: LooseCard) => (c.power != null && c.toughness != null ? ` ${c.power}/${c.toughness}` : '');

function flags(c: LooseCard): string[] {
  const f: string[] = [];
  if (c.tapped) f.push('tapped');
  if (c.sick && isCreature(c) && !hasKeyword(c, 'HASTE')) f.push('summoning sick');
  if (c.attacking) f.push('attacking');
  if (c.blocking) f.push('blocking');
  if (c.damage) f.push(`${c.damage} damage`);
  if (c.loyalty != null) f.push(`loyalty ${c.loyalty}`);
  for (const [k, v] of Object.entries(c.counters ?? {})) f.push(`${k} counter${v > 1 ? ` x${v}` : ''}`);
  if (Array.isArray(c.keywords) && c.keywords.length) f.push(c.keywords.map((k) => k.toLowerCase().replace(/_/g, ' ')).join(', '));
  if (c.token) f.push('token');
  return f;
}

/** The plain-words view of every card the seat can see, sharing one duplicate-name table. */
export class Namer {
  readonly cards: Map<number, LooseCard>;
  readonly dupes: Set<string>;
  constructor(state: GameStateBody) {
    this.cards = cardsById(state);
    this.dupes = duplicateNames([...this.cards.values()].map((c) => ({ name: nameOf(c) ?? undefined, hidden: c.hidden })));
  }

  name(c: LooseCard | null | undefined): string {
    if (!c) return 'an unknown card';
    if (c.hidden === true) return 'a hidden card';
    const n = nameOf(c);
    if (!n) return c.faceDown ? `a face-down card #${c.id}` : `card #${c.id}`;
    return showName({ id: c.id, name: n }, this.dupes);
  }

  byId(id: number): string {
    return this.name(this.cards.get(id));
  }

  /** A permanent: name, P/T, its state. */
  permanent(c: LooseCard): string {
    const f = flags(c);
    const att = c.attachedToId != null ? ` attached to ${this.byId(c.attachedToId)}` : '';
    return `${this.name(c)}${pt(c)}${att}${f.length ? ` (${f.join('; ')})` : ''}`;
  }

  /** A card in hand: name, cost, type, P/T. */
  inHand(c: LooseCard): string {
    if (c.hidden === true) return 'a hidden card';
    const type = String(c.types ?? '').replace(/^Basic /, '');
    return `${this.name(c)}${c.manaCost ? ` ${c.manaCost}` : ''}${type ? ` (${type}${pt(c)})` : ''}`;
  }
}

const list = (xs: string[]) => (xs.length ? xs.join('; ') : 'none');

function landLine(namer: Namer, lands: LooseCard[]): string {
  if (lands.length === 0) return 'none';
  const untapped = lands.filter((c) => !c.tapped).length;
  return `${lands.map((c) => `${namer.name(c)}${c.tapped ? ' (tapped)' : ''}`).join(', ')} -- ${untapped} untapped`;
}

/** The state in plain words. `landsPlayed` = lands the seat played this turn (from the events). */
export function planView(state: GameStateBody | null, me: number, { oracle = null, landsPlayed = null }: { oracle?: Oracle | null; landsPlayed?: number | null } = {}): string {
  if (!state) return '(no state yet)';
  const { mine, opp } = playersOf(state, me);
  const namer = new Namer(state);
  const out: string[] = [];
  const whose = state.activePlayer === me ? 'your turn' : "the opponent's turn";
  const prio = state.priority === me ? 'You have priority.' : state.priority === null || state.priority === undefined ? '' : 'The opponent has priority.';
  out.push(state.turn ? `Turn ${state.turn}, ${whose}, ${phaseWords(state.phase)}. ${prio}`.trim() : 'Before the first turn.');
  for (const [who, p] of [
    ['YOU', mine],
    ['OPPONENT', opp],
  ] as const) {
    if (!p) continue;
    const z = p.zones;
    const bf = zoneCards(p, 'battlefield').filter((c) => c.hidden !== true);
    const lands = bf.filter((c) => isLand(c) && !isCreature(c));
    const perms = bf.filter((c) => !lands.includes(c));
    const counts = `life ${p.life}${p.poison ? `, poison ${p.poison}` : ''}, hand ${z?.hand?.count ?? 0}${p.id === me ? '' : ' (hidden)'}, library ${z?.library?.count ?? '?'}, graveyard ${z?.graveyard?.count ?? 0}, exile ${z?.exile?.count ?? 0}`;
    out.push('');
    out.push(`${who} (${p.name}): ${counts}`);
    if (p.id === me) {
      out.push(`  Hand: ${list(zoneCards(p, 'hand').map((c) => namer.inHand(c)))}`);
      const avail = availableMana(state, me, oracle);
      const w = manaWords(avail);
      const pool = `${w.filters ? `; ${w.filters}` : ''}${w.pool ? `; in your mana pool: ${w.pool}` : ''}`;
      out.push(
        `  Untapped mana: ${avail.total}${avail.sources.length ? ` (${avail.sources.map((s) => s.name).join(', ')}: ${w.sources})` : ''}${pool}.${landsPlayed === null ? '' : ` Land played this turn: ${landsPlayed > 0 ? 'yes' : 'no'}.`}`,
      );
    } else {
      const shown = zoneCards(p, 'hand').filter((c) => c.hidden !== true);
      if (shown.length) out.push(`  Hand (revealed): ${list(shown.map((c) => namer.inHand(c)))}`);
    }
    out.push(`  Lands: ${landLine(namer, lands)}`);
    out.push(`  Creatures and other permanents: ${list(perms.map((c) => namer.permanent(c)))}`);
    const gy = zoneCards(p, 'graveyard');
    const ex = zoneCards(p, 'exile');
    const cmd = zoneCards(p, 'command');
    const lib = zoneCards(p, 'library');
    if (gy.length) out.push(`  Graveyard: ${list(gy.map((c) => namer.name(c)))}`);
    if (ex.length) out.push(`  Exile: ${list(ex.map((c) => namer.name(c)))}`);
    if (cmd.length) out.push(`  Command zone: ${list(cmd.map((c) => namer.name(c)))}`);
    if (lib.length) out.push(`  Library, cards you may see: ${list(lib.map((c) => namer.name(c)))}`);
  }
  out.push('');
  out.push(stackLine(state, me, namer));
  const combat = combatLine(state, me, namer);
  if (combat) out.push(combat);
  return out.join('\n');
}

/** One stack item in words: "the opponent's Shock (targets Grizzly Bears)". */
export function stackItemWords(it: StackItem, state: GameStateBody, me: number, namer: Namer = new Namer(state)): string {
  const src = it.sourceCardId != null ? namer.cards.get(it.sourceCardId) : null;
  const who = it.controller === me ? 'your' : "the opponent's";
  const what = src ? namer.name(src) : 'something';
  const kind = it.isAbility ? ' (an ability)' : '';
  const text = it.text && src && !String(it.text).startsWith(nameOf(src) ?? '\u0000') ? ` -- ${it.text}` : it.text && !src ? ` -- ${it.text}` : '';
  const tg = [...(it.targetCardIds ?? []).map((id) => namer.byId(id)), ...(it.targetPlayerIds ?? []).map((p) => (p === me ? 'you' : 'the opponent'))];
  return `${who} ${what}${kind}${text}${tg.length ? ` (targets ${tg.join(', ')})` : ''}`;
}

function stackLine(state: GameStateBody, me: number, namer: Namer): string {
  const stack = Array.isArray(state.stack) ? state.stack : [];
  if (!stack.length) return 'STACK: empty';
  return `STACK (top first): ${[...stack]
    .reverse()
    .map((it) => stackItemWords(it, state, me, namer))
    .join('; ')}`;
}

function combatLine(state: GameStateBody, me: number, namer: Namer): string | null {
  const bands = state.combat?.bands ?? [];
  if (!bands.length) return null;
  const parts = bands.map((b) => {
    const def = b.defender ? (b.defender.kind === 'player' ? (b.defender.id === me ? 'you' : 'the opponent') : namer.byId(b.defender.id)) : 'a player';
    const att = (b.attackerIds ?? []).map((id) => namer.byId(id)).join(', ');
    const bl = (b.blockerIds ?? []).map((id) => namer.byId(id));
    return `${att} attacking ${def}${bl.length ? `, blocked by ${bl.join(', ')}` : ''}`;
  });
  return `COMBAT: ${parts.join('; ')}`;
}

/** The player's creatures that can attack now: untapped, not summoning sick unless they have haste. */
export function attackCandidates(state: GameStateBody, me: number): LooseCard[] {
  return zoneCards(playersOf(state, me).mine, 'battlefield').filter(
    (c) => c.hidden !== true && c.controller === me && isCreature(c) && !c.tapped && (!c.sick || hasKeyword(c, 'HASTE')),
  );
}

/**
 * What the engine lets the seat do now, in words (no menu): the lands it may
 * play, the spells it can and cannot pay for, the permanents with abilities,
 * the creatures that can attack.
 */
export function offersText(state: GameStateBody, me: number, offers: Offers | null, { oracle = null, attackers = null }: { oracle?: Oracle | null; attackers?: LooseCard[] | null } = {}): string {
  const out: string[] = [];
  const namer = new Namer(state);
  if (offers) {
    const lands = offers.filter((o) => o.verb === 'land').map((o) => namer.byId(o.cardId));
    const cast: string[] = [];
    const cannot: string[] = [];
    for (const o of offers.filter((x) => x.verb === 'cast')) {
      const c = namer.cards.get(o.cardId);
      const where = o.zone && o.zone !== 'hand' ? ` from your ${o.zone}` : '';
      const alt = o.zone && o.zone !== 'hand' ? zoneCost(c, o.zone, oracle) : null;
      const problem = o.zone === 'hand' ? payProblem(c, state, me, oracle) : alt ? payProblem({ ...c!, manaCost: alt.cost }, state, me, oracle) : null;
      const cost = alt ? ` (${alt.how} ${alt.cost})` : o.zone && o.zone !== 'hand' ? '' : c?.manaCost ? ` ${c.manaCost}` : '';
      const label = `${namer.name(c)}${cost}${where}`;
      if (problem) cannot.push(label);
      else cast.push(label);
    }
    const actOffers = offers.filter((o) => o.verb === 'activate');
    const engineList = actOffers.some((o) => o.engine);
    const act = [...new Set(actOffers.filter((o) => !o.engine).map((o) => `${namer.byId(o.cardId)}${o.zone && o.zone !== 'battlefield' ? ` (from your ${o.zone})` : ''}`))];
    if (lands.length) out.push(`  play a land: ${[...new Set(lands)].join(', ')}`);
    if (cast.length) out.push(`  cast: ${[...new Set(cast)].join('; ')}`);
    if (cannot.length) out.push(`  in your hand, but your untapped mana (${availableMana(state, me, oracle).total}) cannot pay for it now: ${[...new Set(cannot)].join('; ')}`);
    if (act.length) out.push(`  activate: ${act.join('; ')}`);
    if (engineList) {
      out.push('  activate on the battlefield (the engine\'s list; for a permanent with more than one, write "activate <card>: <cost or words of the ability>"):');
      for (const o of actOffers.filter((x) => x.engine)) {
        const label = String(o.abilityLabel ?? '').replace(/\s+/g, ' ').trim();
        const short = label.length > 160 ? `${label.slice(0, 157)}...` : label;
        const problem = activationProblem(label, namer.cards.get(o.cardId), state, me, oracle);
        out.push(`    ${namer.byId(o.cardId)}: ${short}${problem ? ' (your untapped mana cannot pay for it now)' : ''}`);
      }
    }
    if (offers.legacy) out.push('  (this engine does not list what is playable: the cards above are your hand, and the engine refuses what you cannot play)');
  }
  if (attackers && attackers.length) out.push(`  can attack this turn: ${attackers.map((c) => `${namer.name(c)}${pt(c)}`).join('; ')}`);
  if (!out.length) return '';
  return ['WHAT THE ENGINE LETS YOU DO NOW (mana checked against your untapped mana)', ...out].join('\n');
}

export interface PlanPromptInput {
  /** The question for the moment (or the correction's). */
  question: string;
  /** The log's frames up to the moment (GAME SO FAR). */
  frames: readonly LoggedFrame[];
  state: GameStateBody;
  me: number;
  oracle: Oracle;
  /** The engine's options at the player's priority, or null (not at priority). */
  offers: Offers | null;
  /** The creatures that can attack (own turn, before or at the attack), or null. */
  attackers: LooseCard[] | null;
  landsPlayed: number | null;
  /** The player's play guide for the deck (guide.ts), when one is chosen. */
  guide?: string | null;
}

/** The full message: the question, the game so far, the state, what you can do, the card text, the question again. */
export function planFullPrompt(i: PlanPromptInput): string {
  const t = offersText(i.state, i.me, i.offers, { oracle: i.oracle, attackers: i.attackers });
  const guide = i.guide && i.guide.trim() ? ['', "THE PLAYER'S PLAY GUIDE FOR THIS DECK (their own notes)", i.guide.trim()] : [];
  return [
    i.question,
    '',
    'GAME SO FAR ("you" is you, "opp" the opponent; [n] is a card\'s number)',
    historyOf(i.frames, i.me).logText(),
    '',
    'NOW',
    planView(i.state, i.me, { oracle: i.oracle, landsPlayed: i.landsPlayed }),
    ...(t ? ['', t] : []),
    '',
    'CARD TEXT',
    cardTextBlock(visibleNames(i.state), i.oracle),
    ...guide,
    '',
    i.question,
    REPLY_REMINDER,
  ].join('\n');
}

// ---------------------------------------------------------------------------
// The questions, in words (plan-core.mjs)

export function turnQuestion(state: GameStateBody, atAttack = false): string {
  return atAttack
    ? `It is your turn ${state.turn}. You are at the declaration of attackers (your first main phase had nothing you could play). What do you do this turn?`
    : `It is your turn ${state.turn}. What do you do this turn?`;
}

export function mulliganQuestion(state: GameStateBody, me: number): string {
  const n = playersOf(state, me).mine?.zones?.hand?.count ?? 0;
  return `The game is starting. Your opening hand is shown below (${n} cards). Do you keep it? Reply with the single step "keep" or "mulligan".`;
}

export const PLAY_DRAW_QUESTION = 'You won the coin toss. Do you play first or draw first? Reply with the single step "choose play" or "choose draw".';

/** "1. play land Island (done); 2. cast Shock" — a plan with its progress. */
export function planProgressText(steps: readonly Step[], done: readonly boolean[] = []): string {
  if (!steps.length) return 'none';
  return steps.map((s, i) => `${s.n}. ${s.raw}${done[i] ? ' (done)' : ''}`).join('; ');
}

export function responseQuestion(item: StackItem, state: GameStateBody, me: number, plan: string | null): string {
  const verb = item.isAbility ? 'put an ability on the stack:' : 'cast';
  return [
    `This just happened: the opponent ${verb} ${stackItemWords(item, state, me).replace(/^the opponent's /, '')}. It is on the stack now.`,
    `Your plan was: ${plan ?? 'none'}.`,
    'What do you do now? To let it resolve, reply with the single step "pass".',
  ].join('\n');
}

/** The opponent's attackers (at the player or their planeswalkers) and the player's untapped creatures. */
export function blockPairs(state: GameStateBody, me: number): { attackers: LooseCard[]; blockers: LooseCard[] } {
  const cards = cardsById(state);
  const attackers: LooseCard[] = [];
  for (const band of state.combat?.bands ?? []) {
    const def = band.defender;
    const atMe = !def || (def.kind === 'player' ? def.id === me : cards.get(def.id)?.controller === me);
    if (!atMe) continue;
    for (const id of band.attackerIds ?? []) {
      const c = cards.get(id);
      if (c && c.controller !== me) attackers.push(c);
    }
  }
  const blockers = zoneCards(playersOf(state, me).mine, 'battlefield').filter((c) => c.hidden !== true && c.controller === me && isCreature(c) && !c.tapped);
  return { attackers, blockers };
}

export function blocksQuestion(state: GameStateBody, me: number): string {
  const namer = new Namer(state);
  const { attackers, blockers } = blockPairs(state, me);
  return [
    `The opponent attacks with: ${attackers.map((c) => namer.permanent(c)).join('; ')}.`,
    `Your untapped creatures: ${blockers.map((c) => namer.permanent(c)).join('; ')}.`,
    'Declare your blockers: one step "block <attacker> with <your creature>" per block, or the single step "pass" for no blocks. Steps after the blocks (a spell or an ability) are carried out once the blocks are declared.',
  ].join('\n');
}

export function endStepQuestion(state: GameStateBody, me: number, oracle: Oracle | null): string {
  return `It is the opponent's end step (turn ${state.turn}). You have ${availableMana(state, me, oracle).total} untapped mana. Do you cast or activate anything before your turn? If not, reply with the single step "pass".`;
}

/** Any other moment the player asks about (Ask about this): where the game is, and what to do now. */
export function nowQuestion(state: GameStateBody, me: number): string {
  if (!state.turn) return 'The game is starting. What do you do?';
  const whose = state.activePlayer === me ? 'your' : "the opponent's";
  return `It is ${whose} ${phaseWords(state.phase)} (turn ${state.turn}). What do you do now? If nothing, reply with the single step "pass".`;
}

/** One answer of an engine question, for the words and the matcher. */
export interface Choice {
  label: string;
  cardId?: number;
  playerId?: number;
  /** A yes / no answer. */
  value?: boolean;
}

export interface ChoiceQuestion {
  prompt: string;
  choices: Choice[];
  min: number;
  max: number;
  /** The card the question is about (an ability menu's, a confirm's). */
  cardId?: number | null;
}

/** The engine's question and its legal answers in words. */
export function choicesWords(q: ChoiceQuestion, state: GameStateBody, me: number): { prompt: string; choices: string } {
  const namer = new Namer(state);
  const words = q.choices.map((o) => {
    if (typeof o.cardId === 'number' && namer.cards.has(o.cardId)) {
      const c = namer.cards.get(o.cardId)!;
      const whose = c.controller === undefined || c.controller === null ? '' : c.zone === 'hand' ? '' : c.controller === me ? ' (yours)' : " (the opponent's)";
      return `${namer.name(c)}${whose}`;
    }
    if (typeof o.playerId === 'number') return o.playerId === me ? 'me' : 'opponent';
    return String(o.label);
  });
  const multi = q.max > 1;
  const many = multi ? ` (choose ${q.min === q.max ? q.min : `${q.min} to ${q.max}`}${q.min === 0 ? '; "choose none" for none' : ''})` : '';
  return { prompt: String(q.prompt ?? '').replace(/\s*\n+\s*/g, ' / ').trim(), choices: `${words.join('; ')}${many}` };
}

export function questionText(q: ChoiceQuestion, state: GameStateBody, me: number, { plan = null, about = null }: { plan?: string | null; about?: string | null } = {}): string {
  const { prompt, choices } = choicesWords(q, state, me);
  const head = about && /target/i.test(prompt) ? `${about} needs a target: which?` : `The engine asks you: ${prompt || '(no words)'}`;
  return [
    head,
    `${/target/i.test(prompt) ? 'Legal targets' : 'Choices'}: ${choices}.`,
    ...(plan ? [`Your plan was: ${plan}.`] : []),
    'Answer with step 1 "target <name>" or "choose <option>", in the words shown. Add more steps only to change the rest of your plan: they replace it.',
  ].join('\n');
}

/**
 * A step the check refused (plan-core.mjs correctionQuestion, worded for a
 * coach: nothing of the plan has been done, so the whole plan is asked again).
 */
export function correctionQuestion({ step, why, steps, n, question, engineAsks = null }: { step: Step; why: string; steps: readonly Step[]; n: number; question: string; engineAsks?: string | null }): string {
  const st = `step ${step.n} '${step.raw}'`;
  return [
    `${st[0]!.toUpperCase()}${st.slice(1)} cannot be done: ${why}.`,
    `Your plan was: ${planProgressText(steps)}.`,
    ...(engineAsks ? [engineAsks] : []),
    `Give corrected steps for this moment; the player has not done any of them yet. (Correction ${n} of ${MAX_CORRECTIONS}.)`,
    '',
    question,
  ].join('\n');
}

export function invalidQuestion({ error, reply, question, n }: { error: string; reply: string; question: string; n: number }): string {
  return [
    `Your last reply could not be read by the program: ${error}.`,
    'Your reply was:',
    String(reply ?? '').slice(0, 600),
    '',
    `Reply again in the format of the system prompt (PLAN:, STEPS:, END). (Correction ${n} of ${MAX_CORRECTIONS}.)`,
    '',
    question,
  ].join('\n');
}

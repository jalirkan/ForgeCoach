/*
 * ForgeCoach — ui/play/inputView.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * What the engine is asking for right now, in plain words, and which cards a
 * click should go to. Pure (no React, no DOM) so it is testable in node.
 *
 * The engine stays the judge (mtg-table protocol §4.1): we never decide what is
 * legal. The button labels are the engine's own (`OK`, `Auto`, `End Turn`,
 * `Alpha Strike`…) and the acts are `buttonOk` / `buttonCancel`; this module
 * only adds a plain-words title, a one-line "what the button does", and the
 * set of cards worth outlining. A click on anything else still reaches Forge
 * when it plausibly means something (your own cards while you are prompted),
 * and Forge answers a click it will not take with a "Not selectable" notice.
 */
import type { AnyCard, AskBody, Card, GameStateBody, InputBody, InputButton } from '../../protocol.ts';
import { isHidden, keywordsOf } from '../../protocol.ts';
import { cardIndex, cardName } from '../../decisions.ts';

export type InputMode =
  /** No prompt for this seat (the AI is acting, or nothing has arrived yet). */
  | 'waiting'
  | 'mulligan'
  /** Your own main phase, empty stack: the "play your turn" moment. */
  | 'main'
  /** Something is on the stack and you may respond. */
  | 'stack'
  /** Priority anywhere else (upkeep, the opponent's steps…). */
  | 'priority'
  | 'pay'
  | 'attack'
  | 'block'
  | 'discard'
  /** An explicit choice: targets, a card to pick — the cards are the control. */
  | 'target'
  /** A yield is running ("Yielding until end of turn"). */
  | 'yield'
  | 'over'
  | 'ask'
  | 'other';

export interface ButtonView extends InputButton {
  /** One or two words on what pressing it does, or null when the label says it. */
  meaning: string | null;
}

export interface InputView {
  mode: InputMode;
  /** Short plain-words headline. */
  title: string;
  /** One sentence of how to do it. */
  detail: string | null;
  /** The engine's own prompt, verbatim (shown small, never rewritten). */
  engineText: string;
  ok: ButtonView;
  cancel: ButtonView;
  /** The button Space presses and the bar draws as primary. */
  primary: 'ok' | 'cancel' | null;
  /** Mana payment: the cost text ("{2}{W}") and what it is for. */
  payCost: string | null;
  payFor: string | null;
  /** OK is disabled and something must be clicked (§4.2). */
  needClick: boolean;
  /** The attacker named by a block prompt ("Select creatures to block X (12)"). */
  blockingAttackerId: number | null;
}

const MAIN = new Set(['MAIN1', 'MAIN2']);

const STEP_WORDS: Record<string, string> = {
  UNTAP: 'untap step',
  UPKEEP: 'upkeep',
  DRAW: 'draw step',
  MAIN1: 'first main phase',
  COMBAT_BEGIN: 'beginning of combat',
  COMBAT_DECLARE_ATTACKERS: 'declare-attackers step',
  COMBAT_DECLARE_BLOCKERS: 'declare-blockers step',
  COMBAT_FIRST_STRIKE_DAMAGE: 'first-strike damage step',
  COMBAT_DAMAGE: 'combat damage step',
  COMBAT_END: 'end of combat',
  MAIN2: 'second main phase',
  END_OF_TURN: 'end step',
  CLEANUP: 'cleanup step',
};

export function stepWords(phase: string | null): string {
  if (!phase) return 'pre-game';
  return STEP_WORDS[phase] ?? phase.toLowerCase().replace(/_/g, ' ');
}

function playerName(state: GameStateBody | null, id: number | null, seat: number | null): string {
  if (id === null) return 'Someone';
  if (id === seat) return 'You';
  return state?.players.find((p) => p.id === id)?.name ?? 'Opponent';
}

const NO_BUTTON: InputButton = { label: '', enabled: false };

function btn(b: InputButton | undefined, meaning: string | null = null): ButtonView {
  return { ...(b ?? NO_BUTTON), meaning };
}

/** "Quake, Agent of S.H.I.E.L.D. - Creature 2 / 2\n\nPay Mana Cost: {1}{W}" → cost + name. */
export function parsePay(prompt: string): { cost: string; forName: string | null } | null {
  const m = /Pay Mana Cost:\s*(.+?)\s*$/m.exec(prompt);
  if (!m) return null;
  const first = prompt.split('\n')[0]?.trim() ?? '';
  const forName = first && !/^Pay Mana Cost/.test(first) ? first.replace(/\s+-\s+(Legendary\s+)?(Creature|Artifact|Enchantment|Instant|Sorcery|Planeswalker|Land|Battle|Tribal|Kindred).*$/i, '').replace(/\s*\(\d+\)\s*$/, '') : null;
  return { cost: m[1]!.trim(), forName };
}

/** The stack's top item as words: "Forge AI cast Lightning Bolt". */
export function topOfStack(state: GameStateBody, seat: number | null): { who: string; what: string; mine: boolean } | null {
  const top = state.stack[state.stack.length - 1];
  if (!top) return null;
  const idx = cardIndex(state);
  const src = top.sourceCardId !== null ? idx.get(top.sourceCardId) : undefined;
  const name = src ? cardName(src) : 'something';
  return { who: playerName(state, top.controller, seat), what: name, mine: top.controller === seat };
}

function firstLine(s: string): string {
  return (s.split('\n').find((l) => l.trim()) ?? '').trim();
}

/** The whole prompt as one line, for the engine-text row. */
/**
 * A notice for the action bar, with the engine's internal card ids ("card 31
 * cannot be selected now") read as the card's name from the visible state.
 * An id the state doesn't show, or a hidden card, stays as it was: the notice
 * never names more than the board does.
 */
export function noticeLine(title: string, text: string | null | undefined, state: GameStateBody | null): string {
  const cards = state ? cardIndex(state) : null;
  const named = (text ?? '').replace(/\bcard (\d+)\b/g, (whole, id: string) => {
    const c = cards?.get(Number(id));
    return c && !isHidden(c) && c.name ? cardName(c) : whole;
  });
  return named ? `${title} — ${named}` : title;
}

export function oneLine(s: string): string {
  return s
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .join(' · ');
}

export function describeInput(
  input: InputBody | null,
  state: GameStateBody | null,
  seat: number | null,
  opts: { ask?: AskBody | null; over?: boolean } = {},
): InputView {
  const base = (mode: InputMode, title: string, detail: string | null = null): InputView => ({
    mode,
    title,
    detail,
    engineText: input?.prompt ?? '',
    ok: btn(input?.buttons.ok),
    cancel: btn(input?.buttons.cancel),
    primary: null,
    payCost: null,
    payFor: null,
    needClick: false,
    blockingAttackerId: null,
  });
  const quiet = (v: InputView): InputView => ({ ...v, ok: btn(undefined), cancel: btn(undefined) });
  if (opts.over) return quiet(base('over', 'Game over'));
  if (opts.ask) return quiet(base('ask', 'Forge has a question for you', 'Answer it in the dialog.'));
  if (!input) {
    const who = state ? playerName(state, state.priority ?? state.activePlayer, seat) : 'Forge';
    return base('waiting', state?.phase ? `${who === 'You' ? 'Forge' : who} is thinking…` : 'Setting up the game…');
  }
  const p = input.prompt ?? '';
  const ok = input.buttons.ok;
  const cancel = input.buttons.cancel;
  const focus = input.buttons.focus ?? null;
  const selecting = input.selectable.mode !== 'none' && (input.selectable.cardIds.length > 0 || input.selectable.mode === 'players');
  const v = base('other', firstLine(p) || 'Your move');
  const primaryDefault = (): 'ok' | 'cancel' | null => (focus === 'cancel' && cancel.enabled ? 'cancel' : ok.enabled ? 'ok' : cancel.enabled && focus === 'cancel' ? 'cancel' : null);
  v.primary = primaryDefault();

  // Forge's own "Waiting for Forge AI…" while the other seat acts.
  if (/^Waiting for/i.test(p) && !selecting) {
    return { ...v, mode: 'waiting', title: firstLine(p).replace(/\.\.\.$/, '…'), primary: null };
  }

  // A running yield: the only way out is the engine's Cancel.
  if (/^Yielding/i.test(p)) {
    return {
      ...v,
      mode: 'yield',
      title: 'Skipping ahead…',
      detail: firstLine(p).replace(/\.$/, '') + '. Cancel to stop and act.',
      cancel: btn(cancel, 'stop skipping'),
      primary: ok.enabled ? 'ok' : null,
    };
  }

  // Play or draw (the coin-toss winner, or the loser of the last game).
  if (/play or draw/i.test(p)) {
    return {
      ...v,
      mode: 'mulligan',
      title: /won the coin toss/i.test(p) ? 'You won the coin toss' : 'Play or draw?',
      detail: 'Going first (play) is usually right; drawing gives you an extra card.',
      primary: ok.enabled ? 'ok' : null,
    };
  }

  // Keep / mulligan.
  if (/keep (your|this) hand|do you want to keep|mulligan/i.test(p) || /^keep$/i.test(ok.label)) {
    const order = p.split('\n').filter((l) => /going (first|\d|second)/i.test(l));
    return {
      ...v,
      mode: 'mulligan',
      title: 'Keep this hand?',
      detail: order.length ? order.map((l) => l.replace(/^Human,\s*/i, '').replace(/^you are/i, 'You are')).join(' ') : 'Look at your opening hand below.',
      ok: btn(ok, null),
      cancel: btn(cancel, null),
      primary: ok.enabled ? 'ok' : null,
    };
  }

  const pay = parsePay(p);
  if (pay) {
    return {
      ...v,
      mode: 'pay',
      title: pay.forName ? `Pay for ${pay.forName}` : 'Pay the mana cost',
      detail: 'Tap your lands (they glow) to pay' + (ok.enabled ? ', or Auto pay to let Forge pick them.' : '.'),
      payCost: pay.cost,
      payFor: pay.forName,
      ok: btn(ok, ok.enabled ? 'auto pay' : null),
      cancel: btn(cancel, 'cancel'),
      primary: ok.enabled ? 'ok' : null,
      needClick: !ok.enabled,
    };
  }

  if (/^Select creatures to attack/i.test(p)) {
    const callBack = /call back/i.test(cancel.label);
    return {
      ...v,
      mode: 'attack',
      title: 'Declare attackers',
      detail: 'Tap creatures to send them in (tap again to hold one back), then confirm.',
      ok: btn(ok, 'confirm attacks'),
      cancel: btn(cancel, callBack ? 'clear attackers' : /alpha/i.test(cancel.label) ? 'attack with everything' : null),
      primary: ok.enabled ? 'ok' : null,
    };
  }

  if (/^Select creatures to block/i.test(p)) {
    const m = /^Select creatures to block (.+?) \((\d+)\)/i.exec(p);
    return {
      ...v,
      mode: 'block',
      title: 'Declare blockers',
      detail: m
        ? `Now blocking ${m[1]} (outlined). Click your creature to block it — or click another attacker first to block that one. Then confirm.`
        : 'Click an attacker, then click your creature that blocks it. Then confirm.',
      ok: btn(ok, 'confirm blocks'),
      cancel: btn(cancel, null),
      primary: ok.enabled ? 'ok' : null,
      blockingAttackerId: m ? Number(m[2]) : null,
    };
  }

  if (/to discard|^Discard \d+ card/im.test(p)) {
    const n = /(?:Select|Discard) (\d+) card/i.exec(p)?.[1];
    return {
      ...v,
      mode: 'discard',
      title: n ? `Discard ${n} card${n === '1' ? '' : 's'}` : 'Discard',
      detail: (/cleanup/i.test(p) ? 'Your hand is over the limit. ' : '') + 'Tap the card' + (n === '1' ? '' : 's') + ' to discard.',
      primary: ok.enabled ? 'ok' : null,
      needClick: !ok.enabled,
    };
  }

  if (/^Priority:/i.test(p) && state) {
    const mine = state.activePlayer === seat;
    const top = topOfStack(state, seat);
    if (top) {
      return {
        ...v,
        mode: 'stack',
        title: top.mine ? `Your ${top.what} is on the stack` : `${top.who} cast ${top.what}`,
        detail: top.mine ? 'Pass to let it resolve (the opponent may respond).' : 'Respond with an instant or ability — or pass and let it resolve.',
        ok: btn(ok, 'let it resolve'),
        cancel: btn(cancel, /end turn/i.test(cancel.label) ? 'skip to end of turn' : null),
      };
    }
    if (mine && state.phase && MAIN.has(state.phase)) {
      const first = state.phase === 'MAIN1';
      return {
        ...v,
        mode: 'main',
        title: first ? 'Your turn — main phase' : 'Your turn — second main phase',
        detail: first
          ? 'Play a land and cast spells by tapping cards in your hand. Pass when you’re ready for combat.'
          : 'Combat is done. Play anything else you want, then pass to end your turn.',
        ok: btn(ok, first ? 'go to combat' : 'end turn'),
        cancel: btn(cancel, /end turn/i.test(cancel.label) ? 'skip to opponent’s turn' : null),
      };
    }
    const who = mine ? 'Your' : `${playerName(state, state.activePlayer, seat)}’s`;
    return {
      ...v,
      mode: 'priority',
      title: `${who} ${stepWords(state.phase)}`,
      detail: mine ? 'Nothing to do here usually — pass to move on.' : 'You can cast an instant or use an ability now, or pass.',
      ok: btn(ok, 'pass'),
      cancel: btn(cancel, /end turn/i.test(cancel.label) ? 'skip to end of turn' : null),
    };
  }

  if (selecting || !ok.enabled) {
    const n = input.selectable.max;
    const what = input.selectable.mode === 'players' ? 'a player' : n > 1 ? `up to ${n}` : 'one';
    // "Source (12)\nWhat to do": headline the instruction, name the source.
    // InputSelectTargets: "Host - Select up to two target …\nTargeted:\n<names>\n(1 more can be targeted)".
    const all = p.split('\n').map((l) => l.trim()).filter(Boolean);
    const cut = all.findIndex((l) => /^Targeted:/i.test(l));
    const lines = (cut >= 0 ? all.slice(0, cut) : all).filter((l) => !/^\(\d+ more can be targeted\)$/i.test(l));
    const dash = lines.length === 1 ? /^(.+?) - (.+)$/.exec(lines[0]!) : null;
    const source = dash ? dash[1]!.replace(/\s*\(\d+\)\s*$/, '') : lines.length > 1 ? lines[0]!.replace(/\s*\(\d+\)\s*$/, '') : null;
    const ask = dash ? dash[2]! : lines.length > 1 ? lines[lines.length - 1]! : lines[0] ?? 'Make a choice';
    const how = selecting ? `Tap ${what} of the highlighted ${input.selectable.mode === 'players' ? 'players' : 'cards'}.` : 'Tap a card or player to choose it.';
    return {
      ...v,
      mode: 'target',
      title: ask,
      detail: source ? `${source} — ${how.charAt(0).toLowerCase()}${how.slice(1)}` : how,
      needClick: !ok.enabled,
      primary: v.primary,
    };
  }
  return v;
}

// ---------------------------------------------------------------------------
// Clicks

/** How a card reacts to a click: outline-and-click, click, or open its details. */
export type CardRole = 'select' | 'act' | null;

export interface ClickContext {
  view: InputView;
  input: InputBody | null;
  state: GameStateBody | null;
  seat: number | null;
}

function isCreature(c: Card): boolean {
  return /creature/i.test(c.types ?? '');
}

/**
 * Which cards a click should be sent for. `select` is the engine's own
 * selection set (strong outline); `act` is a card that a click plausibly
 * drives right now (subtle outline): your hand at priority, your lands while
 * paying, your creatures while attacking. Anything else opens the detail sheet.
 */
export function cardRole(card: AnyCard, ctx: ClickContext): CardRole {
  const { view, input, state, seat } = ctx;
  if (!input || !state || view.mode === 'ask' || view.mode === 'over' || view.mode === 'waiting' || view.mode === 'yield') return null;
  if (input.selectable.mode === 'cards' && input.selectable.cardIds.includes(card.id)) return 'select';
  if (isHidden(card)) return null;
  const c = card as Card;
  const mine = c.controller === seat;
  const zone = c.zone;
  switch (view.mode) {
    case 'main':
      if (mine && (zone === 'hand' || zone === 'battlefield')) return 'act';
      return null;
    case 'priority':
    case 'stack':
      // Outside your main phase only instant-speed cards are worth outlining
      // (a hint: right-click still reads any card, and Forge judges the click).
      if (mine && zone === 'hand') return /instant/i.test(c.types ?? '') || keywordsOf(c).includes('FLASH') ? 'act' : null;
      if (mine && zone === 'battlefield') return 'act';
      return null;
    case 'pay':
      if (mine && zone === 'battlefield' && !c.tapped) return 'act';
      return null;
    case 'attack':
      if (mine && zone === 'battlefield' && isCreature(c) && (!c.tapped || c.attacking)) return 'act';
      // Choosing a defender: an opposing planeswalker or battle.
      if (!mine && zone === 'battlefield' && /planeswalker|battle/i.test(c.types ?? '')) return 'act';
      return null;
    case 'block':
      if (mine && zone === 'battlefield' && isCreature(c) && (!c.tapped || c.blocking)) return 'act';
      if (!mine && zone === 'battlefield' && c.attacking) return 'act';
      return null;
    case 'discard':
      return mine && zone === 'hand' ? 'act' : null;
    case 'mulligan':
      return null;
    case 'target':
    case 'other':
      // No explicit set: let any visible card on the battlefield (or in your
      // hand) be clicked, and Forge judge.
      if (input.selectable.mode === 'cards' && input.selectable.cardIds.length > 0) return null;
      if (zone === 'battlefield' || (mine && zone === 'hand')) return view.needClick ? 'act' : mine ? 'act' : null;
      return null;
  }
  return null;
}

/**
 * Whether a phone should open the folded hand: at your main phase, a discard,
 * or any prompt whose selection is a card in your hand (a hand target, the
 * London mulligan's "put N on the bottom", a choose-from-hand), whether the
 * engine lists the cards or only says so in the prompt. Combat and paying
 * need the board instead.
 */
export function handNeeded(ctx: ClickContext): boolean {
  const { view, state, seat } = ctx;
  if (view.mode === 'main' || view.mode === 'discard') return true;
  if (view.mode === 'attack' || view.mode === 'block' || view.mode === 'pay') return false;
  const hand = state?.players.find((p) => p.id === seat)?.zones.hand.cards ?? [];
  if (hand.some((c) => cardRole(c, ctx) === 'select')) return true;
  // No explicit set (Forge often sends none): the prompt says where the pick is.
  const open = ctx.input?.selectable.mode !== 'cards' || ctx.input.selectable.cardIds.length === 0;
  return open && hand.length > 0 && HAND_PROMPT.test(ctx.input?.prompt ?? '');
}

/** A prompt whose cards come from your hand ("Return 1 card(s) to the bottom of your library", "Discard a card", "from your hand"). */
const HAND_PROMPT = /\b(bottom of your library|from your hand|in your hand|discard)\b/i;

/** Whether a player avatar should be outlined and send `clickPlayer`. */
export function playerClickable(ctx: ClickContext): boolean {
  const { view, input } = ctx;
  if (!input) return false;
  if (input.selectable.mode === 'players') return true;
  return view.mode === 'target' && view.needClick && input.selectable.cardIds.length === 0;
}

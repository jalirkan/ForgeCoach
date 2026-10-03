/*
 * ForgeCoach — ui/play/inputView.test.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { describe, expect, it } from 'vitest';
import type { Card, GameStateBody, InputBody } from '../../protocol.ts';
import { cardRole, describeInput, handNeeded, noticeLine, parsePay, playerClickable } from './inputView.ts';
import { planPlayKey, type PlayKeyContext } from './playKeys.ts';
import { liveDecision, liveKind, momentKey } from './liveDecision.ts';
import { canPassAhead, PASS_EOT, passMenu, primaryView } from './actionWords.ts';
import type { GameLog } from '../../log.ts';

const ME = 0;
const OPP = 1;

function input(prompt: string, over: Partial<InputBody> = {}): InputBody {
  return {
    prompt,
    focusCardId: null,
    focusCard: null,
    buttons: { ok: { label: 'OK', enabled: true }, cancel: { label: 'End Turn', enabled: true }, focus: 'ok' },
    selectable: { cardIds: [], min: 0, max: 0, mode: 'none' },
    highlighted: [],
    weak: [],
    openZones: [],
    ...over,
  };
}

function card(id: number, controller: number, zone: Card['zone'], types: string, extra: Partial<Card> = {}): Card {
  return {
    id,
    name: `Card ${id}`,
    manaCost: '{1}{W}',
    types,
    power: /Creature/.test(types) ? '2' : null,
    toughness: /Creature/.test(types) ? '2' : null,
    loyalty: null,
    tapped: false,
    sick: false,
    attacking: false,
    blocking: false,
    damage: 0,
    counters: {},
    token: false,
    faceDown: false,
    attachedToId: null,
    attachmentIds: [],
    controller,
    owner: controller,
    zone,
    abilities: [],
    keywords: [],
    ...extra,
  } as unknown as Card;
}

function state(over: Partial<GameStateBody> = {}): GameStateBody {
  const zone = (cards: Card[] = []) => ({ count: cards.length, cards });
  return {
    gameId: 'g',
    turn: 3,
    round: 2,
    phase: 'MAIN1',
    activePlayer: ME,
    priority: ME,
    gameOver: null,
    players: [
      {
        id: ME,
        name: 'Human',
        isAi: false,
        life: 20,
        poison: 0,
        counters: {},
        manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
        zones: {
          hand: zone([card(1, ME, 'hand', 'Creature - Human'), card(2, ME, 'hand', 'Instant')]),
          battlefield: zone([card(3, ME, 'battlefield', 'Basic Land - Plains'), card(4, ME, 'battlefield', 'Creature - Spy')]),
          graveyard: zone(),
          exile: zone(),
          command: zone(),
          library: { count: 30, cards: [] },
        },
      },
      {
        id: OPP,
        name: 'Forge AI',
        isAi: true,
        life: 20,
        poison: 0,
        counters: {},
        manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
        zones: {
          hand: zone(),
          battlefield: zone([card(5, OPP, 'battlefield', 'Creature - Robot', { attacking: true })]),
          graveyard: zone(),
          exile: zone(),
          command: zone(),
          library: { count: 30, cards: [] },
        },
      },
    ],
    stack: [],
    stackCards: [],
    combat: null,
    events: [],
    ...over,
  } as unknown as GameStateBody;
}

const PRIORITY = 'Priority: Human\nTurn: 3 (Human)\nPhase: Main phase, precombat\nStack: Empty';

describe('describeInput', () => {
  it('your main phase: plain words, the engine labels, OK primary', () => {
    const v = describeInput(input(PRIORITY), state(), ME);
    expect(v.mode).toBe('main');
    expect(v.title).toMatch(/Your turn/);
    expect(v.ok.label).toBe('OK');
    expect(v.ok.meaning).toBe('go to combat');
    expect(v.cancel.label).toBe('End Turn');
    expect(v.primary).toBe('ok');
  });

  it('mana payment: cost and card, Auto is the engine OK', () => {
    const i = input('Quake, Agent of S.H.I.E.L.D. - Creature 2 / 2\n\nPay Mana Cost: {1}{W}', {
      buttons: { ok: { label: 'Auto', enabled: true }, cancel: { label: 'Cancel', enabled: true }, focus: 'ok' },
    });
    const v = describeInput(i, state(), ME);
    expect(v.mode).toBe('pay');
    expect(v.payCost).toBe('{1}{W}');
    expect(v.payFor).toBe('Quake, Agent of S.H.I.E.L.D.');
    expect(v.ok.label).toBe('Auto');
  });

  it('parsePay ignores prompts that are not payments', () => {
    expect(parsePay(PRIORITY)).toBeNull();
  });

  it('attack and block prompts', () => {
    const a = describeInput(input('Select creatures to attack Forge AI or select player/card you wish to attack.', { buttons: { ok: { label: 'OK', enabled: true }, cancel: { label: 'Alpha Strike', enabled: true } } }), state({ phase: 'COMBAT_DECLARE_ATTACKERS' }), ME);
    expect(a.mode).toBe('attack');
    expect(a.cancel.meaning).toBe('attack with everything');
    const b = describeInput(input('Select creatures to block Aerial Doombot (56) or select another attacker to declare blockers for.'), state({ activePlayer: OPP }), ME);
    expect(b.mode).toBe('block');
    expect(b.title).toBe('Block Aerial Doombot?');
    expect(b.blockingAttackerId).toBe(56);
  });

  it('disabled OK with a selection means "click a card" (§4.2)', () => {
    const i = input('A.I.M. Scientists (2)\nDiscard 1 card(s)', {
      buttons: { ok: { label: 'OK', enabled: false }, cancel: { label: 'Cancel', enabled: false } },
      selectable: { cardIds: [1, 2], min: 1, max: 1, mode: 'cards' },
    });
    const v = describeInput(i, state(), ME);
    expect(v.mode).toBe('discard');
    expect(v.needClick).toBe(true);
    expect(v.primary).toBeNull();
  });

  it('a multi-line targeting prompt headlines the instruction', () => {
    const i = input('Depower (8)\nSelect target creature', {
      buttons: { ok: { label: 'OK', enabled: false }, cancel: { label: 'Cancel', enabled: true } },
      selectable: { cardIds: [5], min: 1, max: 1, mode: 'cards' },
    });
    const v = describeInput(i, state(), ME);
    expect(v.mode).toBe('target');
    expect(v.title).toBe('Select target creature');
    expect(v.detail).toMatch(/^Depower — tap one/);
  });

  it('an open ask or a finished game hides the engine buttons', () => {
    const ask = { askId: 'a1', kind: 'confirm' } as never;
    expect(describeInput(input(PRIORITY), state(), ME, { ask }).ok.label).toBe('');
    expect(describeInput(input(PRIORITY), state(), ME, { over: true }).mode).toBe('over');
  });

  it("Forge's own waiting prompt is waiting, not a card click", () => {
    const v = describeInput(input('Waiting for Forge AI...', { buttons: { ok: { label: 'OK', enabled: false }, cancel: { label: 'Cancel', enabled: false } } }), state(), ME);
    expect(v.mode).toBe('waiting');
  });
});

describe('cardRole', () => {
  const s = state();
  const ctxFor = (i: InputBody, st = s) => ({ view: describeInput(i, st, ME), input: i, state: st, seat: ME });
  const [hand1, hand2] = s.players[0]!.zones.hand.cards as Card[];
  const [land, mine] = s.players[0]!.zones.battlefield.cards as Card[];
  const theirs = s.players[1]!.zones.battlefield.cards[0] as Card;

  it('main phase: your hand and permanents are clickable, theirs open details', () => {
    const c = ctxFor(input(PRIORITY));
    expect(cardRole(hand1!, c)).toBe('act');
    expect(cardRole(land!, c)).toBe('act');
    expect(cardRole(theirs, c)).toBeNull();
  });

  it("the opponent's turn: only instants in hand", () => {
    const st = state({ activePlayer: OPP, phase: 'COMBAT_BEGIN' });
    const c = ctxFor(input('Priority: Human\nTurn: 4 (Forge AI)\nPhase: Beginning of Combat Step\nStack: Empty'), st);
    expect(cardRole(hand1!, c)).toBeNull();
    expect(cardRole(hand2!, c)).toBe('act');
  });

  it("the engine's explicit selection wins", () => {
    const i = input('Select target creature', { buttons: { ok: { label: 'OK', enabled: false }, cancel: { label: 'Cancel', enabled: true } }, selectable: { cardIds: [5], min: 1, max: 1, mode: 'cards' } });
    const c = ctxFor(i);
    expect(cardRole(theirs, c)).toBe('select');
    expect(cardRole(mine!, c)).toBeNull();
  });

  it('blocking: your creatures and their attackers', () => {
    const st = state({ activePlayer: OPP });
    const c = ctxFor(input('Select creatures to block Card 5 (5) or select another attacker to declare blockers for.'), st);
    expect(cardRole(mine!, c)).toBe('act');
    expect(cardRole(theirs, c)).toBe('act');
    expect(cardRole(land!, c)).toBeNull();
  });

  it('players are clickable only when the engine asks for one', () => {
    expect(playerClickable(ctxFor(input(PRIORITY)))).toBe(false);
    const i = input('Select target player', { buttons: { ok: { label: 'OK', enabled: false }, cancel: { label: 'Cancel', enabled: true } }, selectable: { cardIds: [], min: 1, max: 1, mode: 'players' } });
    expect(playerClickable(ctxFor(i))).toBe(true);
  });
});

describe('planPlayKey', () => {
  const ctx = (over: Partial<PlayKeyContext> = {}): PlayKeyContext => ({
    view: describeInput(input(PRIORITY), state(), ME),
    askOpen: false,
    over: false,
    canUndo: false,
    poolColors: [],
    overlay: false,
    ...over,
  });
  it('Space presses the primary button, Esc the engine Cancel', () => {
    expect(planPlayKey({ key: ' ' }, ctx())).toEqual({ kind: 'ok' });
    expect(planPlayKey({ key: 'Escape' }, ctx())).toEqual({ kind: 'cancel' });
  });
  it('Space on a focused button is left to the button', () => {
    expect(planPlayKey({ key: ' ', targetTag: 'BUTTON' }, ctx())).toBeNull();
  });
  it('typing never triggers a key', () => {
    expect(planPlayKey({ key: 'e', targetTag: 'INPUT' }, ctx())).toBeNull();
  });
  it('pass shortcuts are yields', () => {
    expect(planPlayKey({ key: 'e' }, ctx())).toMatchObject({ kind: 'act', body: { action: 'yieldTo', kind: 'endOfTurn' } });
    expect(planPlayKey({ key: 't' }, ctx())).toMatchObject({ kind: 'act', body: { action: 'yieldTo', kind: 'marker', phase: 'UPKEEP', turn: 'own' } });
  });
  it('floating mana takes its letter (B spends black instead of passing)', () => {
    expect(planPlayKey({ key: 'b' }, ctx({ poolColors: ['B'] }))).toMatchObject({ kind: 'act', body: { action: 'useMana', color: 'B' } });
    expect(planPlayKey({ key: 'b' }, ctx())).toMatchObject({ body: { action: 'yieldTo', phase: 'END_OF_TURN' } });
  });
  it('A attacks with everything only while attacking', () => {
    const attack = describeInput(input('Select creatures to attack Forge AI or select player/card you wish to attack.'), state(), ME);
    expect(planPlayKey({ key: 'a' }, ctx({ view: attack }))).toMatchObject({ body: { action: 'alphaStrike' } });
    expect(planPlayKey({ key: 'a' }, ctx())).toMatchObject({ kind: 'inert' });
  });
  it('L opens the log', () => {
    expect(planPlayKey({ key: 'l' }, ctx())).toEqual({ kind: 'log' });
  });
  it('an open ask owns the keyboard', () => {
    expect(planPlayKey({ key: ' ' }, ctx({ askOpen: true }))).toBeNull();
  });
});

describe('action bar words', () => {
  it('your main phase: the big button says what OK does, the engine label rides along', () => {
    const v = describeInput(input(PRIORITY), state(), ME);
    const p = primaryView(v);
    expect(p.which).toBe('ok');
    expect(p.enabled).toBe(true);
    expect(p.engine).toBe('OK');
    expect(p.words).not.toBe('OK');
    expect(canPassAhead(v)).toBe(true);
  });
  it('declaring attackers offers no pass-ahead', () => {
    const v = describeInput(input('Select creatures to attack Forge AI or select player/card you wish to attack.'), state(), ME);
    expect(canPassAhead(v)).toBe(false);
  });
  it('To EOT is yieldTo endOfTurn; the menu has the turn markers on the right columns', () => {
    expect(PASS_EOT.body).toEqual({ action: 'yieldTo', kind: 'endOfTurn' });
    const menu = passMenu(describeInput(input(PRIORITY), state(), ME));
    expect(menu.map((m) => m.body)).toContainEqual({ action: 'yieldTo', kind: 'marker', phase: 'UPKEEP', turn: 'own' });
    expect(menu.map((m) => m.body)).toContainEqual({ action: 'yieldTo', kind: 'marker', phase: 'END_OF_TURN', turn: 'opp' });
    expect(menu.some((m) => m.id === 'stack')).toBe(false);
  });
});

describe('liveDecision', () => {
  const log = {
    header: { gameId: 'g1', startedAt: 't0', seat: ME },
    frames: [{ type: 'hello_ok', body: {} }, { type: 'state', body: state() }],
    hello: null,
    over: null,
    seat: ME,
  } as unknown as GameLog;

  it('the live moment as a Decision on the newest state frame', () => {
    const d = liveDecision({ log, state: state(), input: input(PRIORITY), ask: null, seat: ME });
    expect(d).not.toBeNull();
    expect(d!.kind).toBe('main');
    expect(d!.frameIndex).toBe(1);
    expect(d!.actions).toEqual([]);
    expect(d!.label).toBe('R2 · Your main 1');
  });

  it('kinds follow the engine prompt', () => {
    expect(liveKind(state(), input('Select creatures to attack Forge AI'), null, ME)).toBe('attack');
    expect(liveKind(state({ activePlayer: OPP }), input('Select creatures to block X (5)'), null, ME)).toBe('block');
    expect(liveKind(state({ activePlayer: OPP, phase: 'END_OF_TURN' }), input(PRIORITY), null, ME)).toBe('priority');
  });

  it('the moment key is stable within a moment and changes with the step', () => {
    const a = momentKey({ log, state: state(), input: input(PRIORITY), ask: null, seat: ME });
    const b = momentKey({ log, state: state(), input: input('X\n\nPay Mana Cost: {1}'), ask: null, seat: ME });
    const c = momentKey({ log, state: state({ phase: 'MAIN2' }), input: input(PRIORITY), ask: null, seat: ME });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});

describe('noticeLine', () => {
  it('names a card the engine refers to by id, when the board shows it', () => {
    expect(noticeLine('Not selectable', 'card 3 cannot be selected now', state())).toBe('Not selectable — Card 3 cannot be selected now');
  });
  it('leaves an id the board does not show, and a title alone', () => {
    expect(noticeLine('Not selectable', 'card 99 cannot be selected now', state())).toBe('Not selectable — card 99 cannot be selected now');
    expect(noticeLine('Not selectable', 'card 3 cannot be selected now', null)).toBe('Not selectable — card 3 cannot be selected now');
    expect(noticeLine('Reconnected', '', state())).toBe('Reconnected');
  });
  it('never names a hidden card', () => {
    const s = state();
    s.players[1]!.zones.hand = { count: 1, cards: [{ id: 42, hidden: true } as never] };
    expect(noticeLine('Not selectable', 'card 42 cannot be selected now', s)).toBe('Not selectable — card 42 cannot be selected now');
  });
});

describe('handNeeded', () => {
  const ctxFor = (i: InputBody, st = state()) => ({ view: describeInput(i, st, ME), input: i, state: st, seat: ME });
  const pick = (prompt: string, ids: number[]) =>
    input(prompt, { buttons: { ok: { label: 'OK', enabled: false }, cancel: { label: 'Auto', enabled: true } }, selectable: { cardIds: ids, min: 1, max: 1, mode: 'cards' } });

  it('opens the hand at your main phase', () => {
    expect(handNeeded(ctxFor(input(PRIORITY)))).toBe(true);
  });
  it('opens it for the London mulligan, whose picks are hand cards', () => {
    const st = state({ turn: 0, round: 0, phase: null, activePlayer: null, priority: null });
    expect(handNeeded(ctxFor(pick('Return 1 card(s) to the bottom of your library', [1, 2]), st))).toBe(true);
    // As Forge 2.0.14 sends it: no selection set, only the prompt (mtg-table, a real draft match).
    expect(handNeeded(ctxFor(pick('Return 1 card(s) to the bottom of your library', []), st))).toBe(true);
  });
  it('keeps it folded for an unscoped board target', () => {
    expect(handNeeded(ctxFor(pick('Select any target', [])))).toBe(false);
  });
  it('keeps it folded when the selection is on the battlefield, and in combat', () => {
    expect(handNeeded(ctxFor(pick('Select target creature', [5])))).toBe(false);
    const st = state({ activePlayer: OPP });
    expect(handNeeded(ctxFor(input('Select creatures to block Card 5 (5) or select another attacker to declare blockers for.'), st))).toBe(false);
  });
});

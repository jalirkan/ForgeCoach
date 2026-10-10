/*
 * ForgeCoach — ui/play/decisionModel.test.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The decision slot's model: whose move it is (pending vs the opponent's vs
 * nothing), the waiting line, the nudge clock, the counter line, the buttons
 * with their printed keys, and the auto-pass toggles lit from state.yield.
 */
import { describe, expect, it } from 'vitest';
import type { AskBody, GameStateBody, InputBody, YieldState } from '../../protocol.ts';
import { describeInput } from './inputView.ts';
import { selectionSummary } from './selection.ts';
import {
  NUDGE_MS,
  THEY_ACT_END_STEP,
  attentionOf,
  choiceCounter,
  inputCounter,
  inputPending,
  markedTitle,
  nudgeDelay,
  offersTheyAct,
  passToggles,
  slotButtons,
  slotTitle,
  theyActWhyNot,
  yieldLit,
} from './decisionModel.ts';

const ME = 1;
const OPP = 0;
const state = (over: Partial<GameStateBody> = {}): GameStateBody =>
  ({ turn: 3, round: 2, phase: 'MAIN1', activePlayer: ME, priority: ME, players: [], stack: [], stackCards: [], combat: null, events: [], ...over }) as unknown as GameStateBody;
const input = (prompt: string, ok = true, cancel = false, sel: Partial<InputBody['selectable']> = {}): InputBody => ({
  prompt,
  focusCardId: null,
  focusCard: null,
  buttons: { ok: { label: 'OK', enabled: ok }, cancel: { label: 'Cancel', enabled: cancel }, focus: 'ok' },
  selectable: { cardIds: [], min: 0, max: 0, mode: 'none', ...sel },
  highlighted: [],
  weak: [],
  openZones: [],
});
const ASK = { askId: 'q9', kind: 'confirm', timeoutMs: 0, title: '', prompt: 'Use it?', yesLabel: 'Yes', noLabel: 'No', defaultYes: true, card: null } as unknown as AskBody;

function att(p: { input?: InputBody | null; st?: GameStateBody | null; ask?: AskBody | null; connected?: boolean; over?: boolean }) {
  const st = p.st === undefined ? state() : p.st;
  const inp = p.input ?? null;
  const view = describeInput(inp, st, ME, { ask: p.ask ?? null, over: !!p.over });
  return attentionOf({ connected: p.connected ?? true, over: !!p.over, ask: p.ask ?? null, input: inp, view, state: st, seat: ME, oppName: 'Forge AI', inputSeq: 4 });
}

describe('attentionOf: is the engine waiting on this seat?', () => {
  it('an open ask is pending, keyed by its id', () => {
    expect(att({ ask: ASK })).toEqual({ attention: 'pending', line: null, key: 'ask:q9' });
  });
  it('priority in your main phase (OK enabled) is pending, keyed by the input seq', () => {
    expect(att({ input: input('Priority: You\nPhase: Main 1') })).toEqual({ attention: 'pending', line: null, key: 'input:4' });
  });
  it('a target prompt with OK off but cards to click is pending', () => {
    expect(att({ input: input('Lightning Bolt - Select any target', false, true, { mode: 'cards', cardIds: [5], min: 1, max: 1 }) }).attention).toBe('pending');
  });
  it('the opponent holding priority: their move, with the waiting line', () => {
    expect(att({ st: state({ priority: OPP, activePlayer: OPP }) })).toEqual({ attention: 'opponent', line: 'Waiting for Forge AI…', key: null });
  });
  it('Forge’s own "Waiting for…" input is their move too', () => {
    const r = att({ input: input('Waiting for Forge AI...', false, false), st: state({ priority: null }) });
    expect(r.attention).toBe('opponent');
    expect(r.line).toBe('Waiting for Forge AI…');
  });
  it('a running yield, a game over, a closed socket and no state are quiet', () => {
    expect(att({ input: input('Yielding until end of turn.', false, true), st: state({ priority: ME }) }).attention).toBe('idle');
    expect(att({ input: input('Priority: You'), over: true }).attention).toBe('idle');
    expect(att({ input: input('Priority: You'), connected: false }).attention).toBe('idle');
    expect(att({ st: null }).attention).toBe('idle');
  });
  it('an input with nothing enabled and nothing to click does not wait on you', () => {
    const inp = input('Something odd', false, false);
    expect(inputPending(inp, { ...describeInput(inp, state(), ME), needClick: false })).toBe(false);
  });
});

describe('the nudge', () => {
  it('is due NUDGE_MS after the later of the arrival and the last act', () => {
    expect(nudgeDelay({ pendingSince: null, lastAct: null, now: 5 })).toBeNull();
    expect(nudgeDelay({ pendingSince: 1000, lastAct: null, now: 1000 })).toBe(NUDGE_MS);
    expect(nudgeDelay({ pendingSince: 1000, lastAct: 6000, now: 7000 })).toBe(NUDGE_MS - 1000);
    expect(nudgeDelay({ pendingSince: 1000, lastAct: 500, now: 1000 + NUDGE_MS + 3 })).toBe(0);
  });
  it('prefixes the slot title once, and marks the tab title without doubling', () => {
    expect(slotTitle('Declare attackers', true)).toBe('Your move — Declare attackers');
    expect(slotTitle('Your move — Declare attackers', true)).toBe('Your move — Declare attackers');
    expect(slotTitle('Declare attackers', false)).toBe('Declare attackers');
    expect(markedTitle('ForgeCoach', true)).toBe('● ForgeCoach');
    expect(markedTitle('● ForgeCoach', true)).toBe('● ForgeCoach');
    expect(markedTitle('● ForgeCoach', false)).toBe('ForgeCoach');
  });
});

describe('the counter line', () => {
  it('reads like Endstep: 0/1 · need 1 more', () => {
    expect(choiceCounter(0, 1, 1)).toBe('0/1 · need 1 more');
    expect(choiceCounter(1, 1, 2)).toBe('1/2 · up to 1 more');
    expect(choiceCounter(2, 1, 2)).toBe('2/2');
    expect(choiceCounter(0, 0, 0)).toBeNull();
  });
  it('counts a targeting input from the engine’s own "Targeted:" lines and selectable.min/max', () => {
    const none = input('Lightning Bolt - Select any target', false, true, { mode: 'cards', cardIds: [5, 6], min: 1, max: 1 });
    expect(inputCounter(none, describeInput(none, state(), ME))).toBe('0/1 · need 1 more');
    const one = input('Fireball - Select up to two target creatures\nTargeted:\nGoblin Guide\n(1 more can be targeted)', true, true, {
      mode: 'cards',
      cardIds: [5, 6],
      min: 0,
      max: 2,
    });
    expect(inputCounter(one, describeInput(one, state(), ME))).toBe('1/2 · up to 1 more');
  });
  it('says nothing it cannot read: no max, or not a targeting input', () => {
    const nomax = input('Lightning Bolt - Select any target', false, true);
    expect(inputCounter(nomax, describeInput(nomax, state(), ME))).toBeNull();
    const prio = input('Priority: You');
    expect(inputCounter(prio, describeInput(prio, state(), ME))).toBeNull();
  });
});

describe('the counter line from the engine’s own count (M65 selectable.chosen)', () => {
  const chosen = (cardIds: number[], playerIds: number[] = []) => ({ cardIds, playerIds, blocks: [], attacks: [] });
  it('counts chosen cards and players against selectable.min/max, over the prompt’s lines', () => {
    const two = input('Fireball - Select up to two targets\nTargeted:\nGoblin Guide\n(1 more can be targeted)', true, true, {
      mode: 'cards',
      cardIds: [5, 6],
      min: 0,
      max: 3,
      chosen: chosen([5], [0]),
    });
    expect(inputCounter(two, describeInput(two, state(), ME))).toBe('2/3 · up to 1 more');
  });
  it('a discard says how many are picked; with no stated count, "N chosen"', () => {
    const discard = input('Discard 2 cards', false, false, { mode: 'cards', cardIds: [5, 6, 7], min: 2, max: 2, chosen: chosen([6]) });
    expect(inputCounter(discard, describeInput(discard, state(), ME))).toBe('1/2 · need 1 more');
    const open = input('Lightning Bolt - Select any target', false, true, { mode: 'cards', cardIds: [5], min: 0, max: 0, chosen: chosen([5]) });
    expect(inputCounter(open, describeInput(open, state(), ME))).toBe('1 chosen');
  });
  it('null chosen is "this frame does not say": the prompt’s count, as before', () => {
    const none = input('Lightning Bolt - Select any target', false, true, { mode: 'cards', cardIds: [5, 6], min: 1, max: 1, chosen: null });
    expect(inputCounter(none, describeInput(none, state(), ME))).toBe('0/1 · need 1 more');
  });
});

describe('a player-only choice (M66 selectable.playerIds)', () => {
  it('is pending though selectable.mode reads "none"', () => {
    const only = input('Blood Artist - Select target player', false, false, { playerIds: [0, 1] });
    expect(inputPending(only, describeInput(only, state(), ME))).toBe(true);
    expect(att({ input: only }).attention).toBe('pending');
  });
  it('[] is a fact: priority with no player to click is pending only by its buttons', () => {
    const prio = input('Priority: You', false, false, { playerIds: [] });
    expect(inputPending(prio, describeInput(prio, state({ phase: 'UPKEEP' }), ME))).toBe(false);
  });
});

describe('the slot’s buttons and their keys', () => {
  const view = (inp: InputBody, st = state()) => describeInput(inp, st, ME);
  it('priority: Pass priority [Space] and the engine’s other button [Esc]', () => {
    const v = view(
      { ...input('Priority: You', true, true), buttons: { ok: { label: 'OK', enabled: true }, cancel: { label: 'End Turn', enabled: true }, focus: 'ok' } },
      state({ phase: 'UPKEEP' }),
    );
    const [p, o] = slotButtons(v, undefined, { canUndo: false, undoDepth: 0, wide: true });
    expect(p).toMatchObject({ id: 'primary', which: 'ok', words: 'Pass priority', kbd: 'Space', enabled: true });
    expect(o).toMatchObject({ id: 'other', which: 'cancel', kbd: 'Esc' });
  });
  it('paying: Auto pay [A], Cancel [Esc]', () => {
    const v = view({
      ...input('Goblin - Creature 1 / 1\n\nPay Mana Cost: {R}', true, true),
      buttons: { ok: { label: 'Auto', enabled: true }, cancel: { label: 'Cancel', enabled: true } },
    });
    const [p, o] = slotButtons(v, undefined, { canUndo: false, undoDepth: 0, wide: true });
    expect(p).toMatchObject({ words: 'Auto pay', kbd: 'A' });
    expect(o).toMatchObject({ words: 'Cancel', kbd: 'Esc' });
  });
  it('attacking: the engine’s Alpha Strike is ALPHA STRIKE [A]; Undo is [Ctrl+Z] while state.undo.can', () => {
    const v = view({ ...input('Select creatures to attack', true, true), buttons: { ok: { label: 'OK', enabled: true }, cancel: { label: 'Alpha Strike', enabled: true } } });
    const sel = selectionSummary(v, { attackers: 0, blockers: 0 });
    const b = slotButtons(v, sel, { canUndo: true, undoDepth: 2, wide: true });
    expect(b.find((x) => x.id === 'other')).toMatchObject({ words: 'Alpha strike', kbd: 'A', which: 'cancel' });
    expect(b.find((x) => x.id === 'undo')).toMatchObject({ words: 'Undo (2)', kbd: 'Ctrl+Z' });
  });
});

describe('declaring blockers', () => {
  const BLOCK = 'Select creatures to block Bird Token (91) or select another attacker to declare blockers for.';
  const view = (inp: InputBody) => describeInput(inp, state({ activePlayer: OPP }), ME);
  const blockView = (ok: boolean) => view({ ...input(BLOCK, ok, false), buttons: { ok: { label: 'OK', enabled: ok }, cancel: { label: 'Cancel', enabled: false } } });
  it('the instruction is the engine’s flow, beside the count', () => {
    const v = blockView(true);
    const sel = selectionSummary(v, { attackers: 0, blockers: 2 });
    expect(sel.count).toBe(2);
    expect(sel.line).toBe('Click an attacker, then your creature that blocks it. Click another attacker to switch. Click a blocker again, or its ×, to take it off.');
    expect(v.blockingAttackerId).toBe(91);
  });
  it('Confirm follows the engine’s ok.enabled exactly; the engine’s Cancel is off here, so there is no second button', () => {
    const on = slotButtons(blockView(true), selectionSummary(blockView(true), { attackers: 0, blockers: 1 }), { canUndo: false, undoDepth: 0, wide: true });
    expect(on).toEqual([expect.objectContaining({ id: 'primary', which: 'ok', words: 'Confirm blocks', kbd: 'Space', enabled: true })]);
    const off = slotButtons(blockView(false), selectionSummary(blockView(false), { attackers: 0, blockers: 0 }), { canUndo: false, undoDepth: 0, wide: true });
    expect(off[0]).toMatchObject({ which: 'ok', enabled: false });
  });
  it('an enabled Cancel in a block declaration is shown, not hidden ([Esc])', () => {
    const v = view({ ...input(BLOCK, true, true), buttons: { ok: { label: 'OK', enabled: true }, cancel: { label: 'Reset', enabled: true } } });
    const b = slotButtons(v, selectionSummary(v, { attackers: 0, blockers: 1 }), { canUndo: false, undoDepth: 0, wide: true });
    expect(b.find((x) => x.id === 'other')).toMatchObject({ which: 'cancel', kbd: 'Esc', enabled: true });
  });
});

describe('auto-pass toggles', () => {
  const y = (kind: YieldState['kind'], phase: string | null, playerId: number | null): YieldState => ({ kind, phase, playerId });
  it('are lit from state.yield: end of turn, before my turn (the opponent’s end step), my next turn, the stack', () => {
    expect(yieldLit(y('endOfTurn', null, null), ME).eot).toBe(true);
    expect(yieldLit(y('marker', 'END_OF_TURN', OPP), ME).before).toBe(true);
    expect(yieldLit(y('marker', 'END_OF_TURN', ME), ME).before).toBe(false);
    expect(yieldLit(y('marker', 'UPKEEP', ME), ME).myturn).toBe(true);
    expect(yieldLit(y('stack', null, null), ME).stack).toBe(true);
    expect(Object.values(yieldLit(null, ME)).some(Boolean)).toBe(false);
  });
  it('unlit: send the yield while you could pass ahead; lit: send the engine’s Cancel only when it is enabled', () => {
    const prio = describeInput(input('Priority: You'), state({ phase: 'UPKEEP' }), ME);
    const off = passToggles({ yielding: null, seat: ME, view: prio, canAct: true });
    expect(off.map((t) => [t.id, t.kbd])).toEqual([
      ['eot', 'E'],
      ['before', 'B'],
      ['myturn', 'T'],
    ]);
    expect(off[0]).toMatchObject({ lit: false, enabled: true, body: { action: 'yieldTo', kind: 'endOfTurn' } });
    expect(off[1]!.body).toEqual({ action: 'yieldTo', kind: 'marker', phase: 'END_OF_TURN', turn: 'opp' });

    const running = describeInput(input('Yielding until end of turn.', false, true), state(), ME);
    const on = passToggles({ yielding: y('endOfTurn', null, null), seat: ME, view: running, canAct: true });
    expect(on[0]).toMatchObject({ lit: true, enabled: true, body: { action: 'buttonCancel' } });
    expect(on[1]).toMatchObject({ lit: false, enabled: false });
    const noCancel = passToggles({ yielding: y('endOfTurn', null, null), seat: ME, view: { ...running, cancel: { ...running.cancel, enabled: false } }, canAct: true });
    expect(noCancel[0]!.enabled).toBe(false);
  });
  it('M64 "until they act": lit from endStepOrOpponent, [Y], a lit one sends Cancel', () => {
    expect(yieldLit(y('endStepOrOpponent', 'END_OF_TURN', OPP), ME)).toMatchObject({ theyAct: true, before: false, eot: false });
    const prio = describeInput(input('Priority: You'), state({ phase: 'UPKEEP' }), ME);
    const off = passToggles({ yielding: null, seat: ME, view: prio, canAct: true, theyAct: true, phase: 'UPKEEP' });
    expect(off.map((t) => [t.id, t.label, t.kbd])).toEqual([
      ['eot', 'End of turn', 'E'],
      ['before', 'Before my turn', 'B'],
      ['myturn', 'My next turn', 'T'],
      ['theyAct', 'Until they act', 'Y'],
    ]);
    expect(off[3]).toMatchObject({ lit: false, enabled: true, body: { action: 'yieldTo', kind: 'endStepOrOpponent' } });
    const running = describeInput(input('Yielding until Forge AI’s End step.', false, true), state(), ME);
    const on = passToggles({ yielding: y('endStepOrOpponent', 'END_OF_TURN', OPP), seat: ME, view: running, canAct: true, theyAct: true, phase: 'MAIN1' });
    expect(on.find((t) => t.id === 'theyAct')).toMatchObject({ lit: true, enabled: true, body: { action: 'buttonCancel' } });
  });
  it('M64: off in the end step and cleanup (the engine refuses it there), saying why', () => {
    for (const phase of ['END_OF_TURN', 'CLEANUP']) {
      const v = describeInput(input('Priority: You'), state({ phase }), ME);
      const t = passToggles({ yielding: null, seat: ME, view: v, canAct: true, theyAct: true, phase }).find((x) => x.id === 'theyAct')!;
      expect(t.enabled).toBe(false);
      expect(t.title).toContain('end step');
      expect(theyActWhyNot({ offered: true, phase, lit: false })).toBe(THEY_ACT_END_STEP);
    }
    expect(theyActWhyNot({ offered: true, phase: 'MAIN2', lit: false })).toBeNull();
    expect(theyActWhyNot({ offered: false, phase: 'MAIN2', lit: false })).toMatch(/update/);
    expect(theyActWhyNot({ offered: true, phase: 'END_OF_TURN', lit: true })).toBeNull();
  });
  it('M64: only on an engine that shows it has it (M65/M66 keys on its inputs, or the yield running)', () => {
    const old = input('Priority: You');
    expect(offersTheyAct(old, null)).toBe(false);
    expect(offersTheyAct(input('Priority: You', true, false, { playerIds: null }), null)).toBe(true);
    expect(offersTheyAct(input('Priority: You', true, false, { chosen: null }), null)).toBe(true);
    expect(offersTheyAct(null, y('endStepOrOpponent', 'END_OF_TURN', ME))).toBe(true);
    const prio = describeInput(old, state({ phase: 'UPKEEP' }), ME);
    expect(passToggles({ yielding: null, seat: ME, view: prio, canAct: true }).map((t) => t.id)).not.toContain('theyAct');
  });
  it('are all off while the board may not act (an ask open, the game over)', () => {
    const prio = describeInput(input('Priority: You'), state({ phase: 'UPKEEP' }), ME);
    expect(passToggles({ yielding: null, seat: ME, view: prio, canAct: false }).every((t) => !t.enabled)).toBe(true);
  });
  it('"Stack resolves" shows only with something on the stack or while it runs', () => {
    const st = state({ stack: [{ id: 1, sourceCardId: null, controller: OPP, text: 'x' }] } as unknown as Partial<GameStateBody>);
    const v = describeInput(input('Priority: You'), st, ME);
    expect(v.mode).toBe('stack');
    expect(passToggles({ yielding: null, seat: ME, view: v, canAct: true }).map((t) => t.id)).toContain('stack');
  });
});

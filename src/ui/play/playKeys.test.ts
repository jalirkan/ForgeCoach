/*
 * ForgeCoach — ui/play/playKeys.test.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The keyboard as one table: within one scope (the board, or an open
 * question) and one input mode, no key does two things — except floating mana,
 * which takes its letter (B) while it floats, by design. The board's planner
 * and the question's planner agree with the table, and an open question turns
 * every board key off.
 */
import { describe, expect, it } from 'vitest';
import type { ManaColor } from '../../protocol.ts';
import type { InputMode, InputView } from './inputView.ts';
import { KEY_BINDINGS, PLAY_KEYS, planPlayKey, type KeyLike, type PlayKeyContext } from './playKeys.ts';
import { planAskKey } from './askKeys.ts';

const MODES: InputMode[] = ['waiting', 'mulligan', 'main', 'stack', 'priority', 'pay', 'attack', 'block', 'discard', 'target', 'yield', 'over', 'ask', 'other'];
const ALL_COLORS: ManaColor[] = ['W', 'U', 'B', 'R', 'G', 'C'];

const view = (mode: InputMode): InputView => ({
  mode,
  title: '',
  detail: null,
  engineText: '',
  ok: { label: 'OK', enabled: true, meaning: null },
  cancel: { label: 'Cancel', enabled: true, meaning: null },
  primary: 'ok',
  payCost: null,
  payFor: null,
  needClick: false,
  clickWhat: 'card',
  blockingAttackerId: null,
});
const ctx = (mode: InputMode, o: Partial<PlayKeyContext> = {}): PlayKeyContext => ({
  view: view(mode),
  askOpen: false,
  over: false,
  canUndo: true,
  poolColors: [],
  overlay: false,
  ...o,
});
const ev = (k: string): KeyLike =>
  k.startsWith('ctrl+') ? { key: k.slice(5), ctrlKey: true, targetTag: 'BODY' } : { key: k === 'escape' ? 'Escape' : k === 'enter' ? 'Enter' : k, targetTag: 'BODY' };

describe('KEY_BINDINGS: no key does two things in one scope and mode', () => {
  for (const scope of ['board', 'ask'] as const) {
    for (const mode of MODES) {
      it(`${scope} · ${mode}`, () => {
        const live = KEY_BINDINGS.filter((b) => b.scope === scope && (b.modes === null || b.modes.includes(mode)));
        const seen = new Map<string, boolean>();
        for (const b of live) {
          for (const k of b.keys) {
            const prior = seen.get(k);
            // The one allowed overlap: floating mana over a letter binding (it wins while that colour floats).
            if (prior !== undefined) expect(prior !== !!b.precedence, `${k} is bound twice in ${scope}/${mode}`).toBe(true);
            seen.set(k, !!b.precedence);
          }
        }
      });
    }
  }
});

describe('the planners agree with the table', () => {
  it('every board binding plans something in its modes (mana while it floats)', () => {
    for (const b of KEY_BINDINGS.filter((x) => x.scope === 'board')) {
      for (const mode of b.modes ?? ['main', 'priority', 'attack', 'pay']) {
        for (const k of b.keys) {
          const plan = planPlayKey(ev(k), ctx(mode, { poolColors: b.precedence ? ALL_COLORS : [] }));
          expect(plan, `${k} in ${mode}`).not.toBeNull();
          expect(plan!.kind, `${k} in ${mode}`).not.toBe('inert');
        }
      }
    }
  });
  it('floating black takes B; without it B is "before my turn"', () => {
    expect(planPlayKey(ev('b'), ctx('main', { poolColors: ['B'] }))).toMatchObject({ kind: 'act', body: { action: 'useMana', color: 'B' } });
    expect(planPlayKey(ev('b'), ctx('main'))).toMatchObject({ kind: 'act', body: { action: 'yieldTo', kind: 'marker', phase: 'END_OF_TURN', turn: 'opp' } });
  });
  it('A: alpha strike while attacking, the engine’s OK (Auto pay) while paying, otherwise nothing', () => {
    expect(planPlayKey(ev('a'), ctx('attack'))).toMatchObject({ kind: 'act', body: { action: 'alphaStrike' } });
    expect(planPlayKey(ev('a'), ctx('pay'))).toEqual({ kind: 'ok' });
    expect(planPlayKey(ev('a'), ctx('pay', { view: { ...view('pay'), ok: { label: 'Auto', enabled: false, meaning: null } } }))?.kind).toBe('inert');
    expect(planPlayKey(ev('a'), ctx('main'))?.kind).toBe('inert');
  });
  it('a lit auto-pass key stops its yield with the engine’s Cancel', () => {
    const lit = { eot: true, before: false, myturn: false, theyAct: false, stack: false };
    expect(planPlayKey(ev('e'), ctx('yield', { yieldLit: lit }))).toEqual({ kind: 'cancel' });
    expect(planPlayKey(ev('e'), ctx('yield', { yieldLit: lit, view: { ...view('yield'), cancel: { label: 'Cancel', enabled: false, meaning: null } } }))?.kind).toBe('inert');
    expect(planPlayKey(ev('b'), ctx('yield', { yieldLit: lit }))).toMatchObject({ kind: 'act', body: { action: 'yieldTo' } });
  });
  it('Y: until they act (M64); stops its own yield; inert with the reason on an engine without it or in the end step', () => {
    expect(planPlayKey(ev('y'), ctx('priority'))).toMatchObject({ kind: 'act', body: { action: 'yieldTo', kind: 'endStepOrOpponent' } });
    const lit = { eot: false, before: false, myturn: false, theyAct: true, stack: false };
    expect(planPlayKey(ev('y'), ctx('yield', { yieldLit: lit, theyActWhyNot: 'x' }))).toEqual({ kind: 'cancel' });
    expect(planPlayKey(ev('y'), ctx('priority', { theyActWhyNot: 'Off in the end step' }))).toEqual({ kind: 'inert', why: 'Off in the end step' });
  });
  it('an open question turns every board key off, and the question plans its own', () => {
    for (const b of KEY_BINDINGS) {
      for (const k of b.keys) {
        const plan = planPlayKey(ev(k), ctx('ask', { askOpen: true, poolColors: ALL_COLORS }));
        expect(plan, `${k} with a question open`).toBeNull();
      }
    }
    for (const b of KEY_BINDINGS.filter((x) => x.scope === 'ask')) {
      for (const k of b.keys) {
        const plan = planAskKey({ ...ev(k), key: ev(k).key }, { placement: 'slot', minimized: false, canConfirm: true, digits: 9, escSkips: false });
        expect(plan, `${k} in a question`).not.toBeNull();
      }
    }
  });
  it('digits are not board keys', () => {
    for (const d of '123456789') expect(planPlayKey(ev(d), ctx('main'))).toBeNull();
  });
  it('the ? list names every key the table binds', () => {
    const chords = PLAY_KEYS.map((r) => r.chord.toLowerCase()).join(' ');
    for (const k of ['space', 'enter', 'esc', '1', 'p', 'e', 'b', 't', 'y', 'a', 'ctrl+z', 'w u b r g c', 'l', '?']) expect(chords).toContain(k);
  });
});

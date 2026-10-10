/*
 * ForgeCoach — ui/play/askKeys.test.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The keys inside an engine question: digits pick the numbered option (in
 * the order the dialog draws them), Space / Enter confirm, Esc hides and
 * never declines — except "Choose how to play", whose Esc is never mind.
 */
import { describe, expect, it } from 'vitest';
import type { AskBody, AskOption } from '../../protocol.ts';
import { digitMode, digitOf, digitSlots, planAskKey, type AskKeyContext } from './askKeys.ts';

const ctx = (o: Partial<AskKeyContext> = {}): AskKeyContext => ({ placement: 'slot', minimized: false, canConfirm: true, digits: 3, escSkips: false, ...o });
const card = (id: number, label: string): AskOption => ({ id, label, kind: 'card', cardId: 100 + id, card: { id: 100 + id, name: label, zone: 'library' } as never });
const list = (options: AskOption[], min: number, max: number, extra: object = {}): AskBody =>
  ({ askId: 'l', kind: 'choose_list', timeoutMs: 0, prompt: 'Choose', options, min, max, preselected: [], reveal: false, ...extra }) as unknown as AskBody;

describe('planAskKey', () => {
  it('Esc hides and shows the question; it never declines', () => {
    expect(planAskKey({ key: 'Escape' }, ctx())).toEqual({ kind: 'hide' });
    expect(planAskKey({ key: 'Escape' }, ctx({ minimized: true }))).toEqual({ kind: 'hide' });
  });
  it('ability_menu: Esc is its never mind while shown; folded, Esc shows it again', () => {
    expect(planAskKey({ key: 'Escape' }, ctx({ escSkips: true }))).toEqual({ kind: 'skip' });
    expect(planAskKey({ key: 'Escape' }, ctx({ escSkips: true, minimized: true }))).toEqual({ kind: 'hide' });
  });
  it('Space and Enter confirm (the dialog checks the answer is valid)', () => {
    expect(planAskKey({ key: ' ', code: 'Space', targetTag: 'BODY' }, ctx())).toEqual({ kind: 'confirm' });
    expect(planAskKey({ key: 'Enter', targetTag: 'SECTION', inAsk: true }, ctx())).toEqual({ kind: 'confirm' });
    expect(planAskKey({ key: 'Enter', targetTag: 'BODY' }, ctx({ canConfirm: false }))).toBeNull();
    expect(planAskKey({ key: 'Enter', targetTag: 'BODY', repeat: true }, ctx())).toBeNull();
  });
  it('a focused button keeps its own keys — except Enter on an option, which confirms', () => {
    expect(planAskKey({ key: ' ', targetTag: 'BUTTON', inAsk: true, onOption: true }, ctx())).toBeNull();
    expect(planAskKey({ key: 'Enter', targetTag: 'BUTTON', inAsk: true, onOption: true }, ctx())).toEqual({ kind: 'confirm' });
    expect(planAskKey({ key: 'Enter', targetTag: 'BUTTON', inAsk: true }, ctx())).toBeNull();
    expect(planAskKey({ key: ' ', targetTag: 'BUTTON' }, ctx())).toBeNull();
  });
  it('a text answer: Enter sends it, Space and digits are typing', () => {
    expect(planAskKey({ key: 'Enter', targetTag: 'INPUT', inAsk: true }, ctx())).toEqual({ kind: 'confirm' });
    expect(planAskKey({ key: ' ', targetTag: 'INPUT', inAsk: true }, ctx())).toBeNull();
    expect(planAskKey({ key: '2', targetTag: 'INPUT', inAsk: true }, ctx())).toBeNull();
    expect(planAskKey({ key: 'Enter', targetTag: 'TEXTAREA', inAsk: true }, ctx())).toBeNull();
  });
  it('the modal answers Space / Enter only from inside it (or the page); the slot from anywhere but a control', () => {
    expect(planAskKey({ key: 'Enter', targetTag: 'DIV' }, ctx({ placement: 'modal' }))).toBeNull();
    expect(planAskKey({ key: 'Enter', targetTag: 'BODY' }, ctx({ placement: 'modal' }))).toEqual({ kind: 'confirm' });
    expect(planAskKey({ key: 'Enter', targetTag: 'DIV' }, ctx({ placement: 'slot' }))).toEqual({ kind: 'confirm' });
  });
  it('digits 1..n pick option n-1, from the key or the code; beyond n nothing', () => {
    expect(planAskKey({ key: '1' }, ctx())).toEqual({ kind: 'digit', index: 0 });
    expect(planAskKey({ key: '!', code: 'Digit3' }, ctx())).toEqual({ kind: 'digit', index: 2 });
    expect(planAskKey({ key: '4' }, ctx())).toBeNull();
    expect(planAskKey({ key: '0' }, ctx())).toBeNull();
    expect(digitOf('x', 'Numpad7')).toBe(7);
  });
  it('folded, with a modifier, or in another sheet: nothing but Esc (and not even Esc in a sheet)', () => {
    expect(planAskKey({ key: '1' }, ctx({ minimized: true }))).toBeNull();
    expect(planAskKey({ key: 'Enter', targetTag: 'BODY' }, ctx({ minimized: true }))).toBeNull();
    expect(planAskKey({ key: '1', ctrlKey: true }, ctx())).toBeNull();
    expect(planAskKey({ key: 'Escape', inSheet: true }, ctx())).toBeNull();
  });
});

describe('digitSlots: the digits follow what the dialog draws', () => {
  it('rows: one per option; a single pick answers at once', () => {
    const ask = {
      askId: 'o',
      kind: 'options',
      timeoutMs: 0,
      title: '',
      prompt: 'Mode',
      options: [
        { id: 0, label: 'A', kind: 'text' },
        { id: 1, label: 'B', kind: 'text' },
      ],
      defaultIndex: 0,
      card: null,
    } as unknown as AskBody;
    expect(digitSlots(ask)).toEqual([[0], [1]]);
    expect(digitMode(ask)).toBe('send');
  });
  it('a card grid collapses identical copies into one numbered tile', () => {
    const ask = list([card(0, 'Forest'), card(1, 'Forest'), card(2, 'Island'), card(3, 'Bear'), card(4, 'Elk')], 0, 2);
    expect(digitSlots(ask)).toEqual([[0, 1], [2], [3], [4]]);
    expect(digitMode(ask)).toBe('toggle');
  });
  it('“choose 1” answers at once; a reveal has no digits; at most nine', () => {
    expect(digitMode(list([card(0, 'A'), card(1, 'B')], 1, 1))).toBe('send');
    expect(digitSlots(list([card(0, 'A')], 0, 0, { reveal: true }))).toEqual([]);
    expect(digitMode(list([card(0, 'A')], 0, 0, { reveal: true }))).toBeNull();
    const many = Array.from({ length: 12 }, (_, i) => ({ id: i, label: `n${i}`, kind: 'other' as const }));
    expect(digitSlots(list(many, 0, 12))).toHaveLength(9);
  });
  it('kinds without digits: text, order, sideboard, assign_*', () => {
    expect(digitSlots({ askId: 't', kind: 'text', timeoutMs: 0, prompt: 'x', title: '', numeric: true, suggestions: [] } as unknown as AskBody)).toEqual([]);
  });
});

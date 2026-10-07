/*
 * ForgeCoach — e2e/playtest/playtest.test.mjs
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The playtest's pure parts, in node: the protocol tap's view of the stream,
 * Forge card scripts, .dck decks, mana values, the log check and the
 * report's finding shapes. The games themselves run in `npm run playtest`.
 */
import { describe, expect, it } from 'vitest';
import { SeatTap, namesIn } from './tap.mjs';
import { parseScript } from './scripts.mjs';
import { parseDck } from './decks.mjs';
import { manaValue } from './monkey.mjs';
import { logCovers } from './checks.mjs';
import { findingShape } from './report.mjs';

const input = (prompt, over = {}) => ({
  prompt,
  focusCardId: null,
  focusCard: null,
  buttons: { ok: { label: 'OK', enabled: true }, cancel: { label: 'End Turn', enabled: true }, focus: 'ok' },
  selectable: { cardIds: [], min: 0, max: 0, mode: 'none' },
  highlighted: [],
  weak: [],
  openZones: [],
  ...over,
});
const frame = (type, seq, body) => JSON.stringify({ v: 1, seq, t: 1, type, body });

describe('SeatTap', () => {
  it('keeps the newest state and input by seq, and says when the engine waits on the seat', () => {
    const t = new SeatTap('solo');
    t.receive(frame('hello_ok', 1, { gameId: 'g1', you: 0, players: [] }));
    expect(t.deciding()).toBe(false);
    t.receive(frame('input', 3, input('Waiting for Forge AI...', { buttons: { ok: { label: 'OK', enabled: false }, cancel: { label: 'Cancel', enabled: false } } })));
    expect(t.deciding()).toBe(false);
    t.receive(frame('input', 5, input('Priority: Human')));
    t.receive(frame('input', 4, input('stale')));
    expect(t.prompt).toBe('Priority: Human');
    expect(t.deciding()).toBe(true);
    t.receive(frame('over', 6, { winner: 0, reason: 'x', matchOver: true }));
    expect(t.deciding()).toBe(false);
  });

  it('an ask is open until this seat answers it, and a new game clears what was', () => {
    const t = new SeatTap('solo');
    t.receive(frame('hello_ok', 1, { gameId: 'g1', you: 0, players: [] }));
    t.receive(frame('ask', 2, { askId: 'a1', kind: 'confirm', prompt: 'Sure?' }));
    expect(t.deciding()).toBe(true);
    t.sentFrame(JSON.stringify({ v: 1, seq: 1, t: 1, type: 'answer', body: { askId: 'a1', value: true } }));
    expect(t.ask).toBeNull();
    // A re-delivery of an answered ask is not a new question.
    t.receive(frame('ask', 3, { askId: 'a1', kind: 'confirm', prompt: 'Sure?' }));
    expect(t.ask).toBeNull();
    t.receive(frame('hello_ok', 1, { gameId: 'g2', you: 0, players: [] }));
    expect(t.games).toEqual(['g1', 'g2']);
    expect(t.gameFrames()).toHaveLength(1);
  });

  it('a table seat that the table says is not deciding is not deciding', () => {
    const t = new SeatTap('host');
    t.receive(frame('hello_ok', 1, { gameId: 'g1', you: 0, players: [] }));
    t.receive(frame('input', 2, input('Priority: Justin')));
    t.receive(frame('table', 3, { you: 0, seats: [{ seat: 0, deciding: false }, { seat: 1, deciding: true }] }));
    expect(t.deciding()).toBe(false);
  });

  it('names every visible card a frame shows, never a hidden one', () => {
    const names = namesIn({ players: [{ zones: { hand: { cards: [{ id: 1, name: 'Shock' }, { id: 2, zone: 'hand', hidden: true }] } } }], options: [{ id: 0, label: 'x', card: { id: 9, name: 'Opt' } }] });
    expect([...names].sort()).toEqual(['Opt', 'Shock']);
  });
});

describe('Forge card scripts', () => {
  it('Equip, cycling and flashback, and a mana ability apart', () => {
    expect(parseScript('Name:Skullclamp\nManaCost:1\nTypes:Artifact Equipment\nK:Equip:1\n')).toMatchObject({ name: 'Skullclamp', bf: ['Equip'], hand: [], gy: [] });
    expect(parseScript('Name:Krosan Tusker\nK:Cycling:2 G\n')).toMatchObject({ hand: ['Cycling'] });
    expect(parseScript('Name:Deep Analysis\nK:Flashback:1 U PayLife<3>\nA:SP$ Draw | NumCards$ 2\n')).toMatchObject({ gy: ['Flashback'], bf: [] });
    expect(parseScript('Name:Llanowar Elves\nA:AB$ Mana | Cost$ T | Produced$ G\n')).toMatchObject({ bf: ['mana'], manaOnly: true });
    expect(parseScript('Name:Unwilling Ingredient\nA:AB$ Draw | Cost$ 2 B ExileFromGrave<1/CARDNAME> | ActivationZone$ Graveyard\n')).toMatchObject({ gy: ['ability'] });
  });
  it('stops at the other face', () => {
    expect(parseScript('Name:Front\nK:Equip:1\nALTERNATE\nName:Back\nK:Flashback:1\n')).toMatchObject({ name: 'Front', gy: [] });
  });
});

describe('decks', () => {
  it('reads a .dck: name, main and sideboard, set codes dropped', () => {
    const d = parseDck('[metadata]\nName=Pacho SHIELD\n[Main]\n4 Quake, Agent of S.H.I.E.L.D.|MSH\n16 Plains\n[Sideboard]\n2 Shock|M21\n');
    expect(d).toEqual({ name: 'Pacho SHIELD', main: [[4, 'Quake, Agent of S.H.I.E.L.D.'], [16, 'Plains']], sideboard: [[2, 'Shock']] });
  });
  it('mana value', () => {
    expect(manaValue('{2}{R}{R}')).toBe(4);
    expect(manaValue('{X}{U}')).toBe(1);
    expect(manaValue(null)).toBe(0);
  });
});

describe('the log check and the report', () => {
  it('every turn of the stream has a header', () => {
    expect(logCovers({ turns: ['T1', 'T2', 'T3'] }, [1, 2, 3])).toEqual([]);
    expect(logCovers({ turns: ['T5'] }, [1, 2, 5])[0]).toMatch(/no header for turns 1, 2/);
    expect(logCovers(null, [1])[0]).toMatch(/did not open/);
  });
  it('a finding’s shape ignores ids and quoted prompts', () => {
    expect(findingShape({ kind: 'unreachable-option', what: 'Krosan Tusker (31, hand) — "Priority: Justin" (MAIN1)' })).toBe(findingShape({ kind: 'unreachable-option', what: 'Krosan Tusker (77, hand) — "Priority: Sam" (MAIN1)' }));
  });
});

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
import { clickWhy, manaValue, Monkey } from './monkey.mjs';
import { hiddenLeaks, logCovers } from './checks.mjs';
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

  it("a mandatory trigger's player target waits on the seat with every button off (J107's hang)", () => {
    const t = new SeatTap('solo');
    t.receive(frame('hello_ok', 1, { gameId: 'g1', you: 0, players: [] }));
    const off = { ok: { label: 'OK', enabled: false }, cancel: { label: 'Cancel', enabled: false } };
    t.receive(frame('input', 2, input('Blood Artist (30) - Whenever Blood Artist or another creature dies, target player loses 1 life and you gain 1 life.\n\nSelect target player', { buttons: off })));
    expect(t.deciding()).toBe(true);
    // An empty prompt with nothing on is not a question.
    t.receive(frame('input', 3, input('', { buttons: off })));
    expect(t.deciding()).toBe(false);
  });

  it('the session\'s ping/pong is not progress for the watchdog', () => {
    const t = new SeatTap('solo');
    t.lastFrameAt = 0;
    t.receive(JSON.stringify({ v: 1, seq: 0, t: 1, type: 'pong', body: {} }));
    expect(t.lastFrameAt).toBe(0);
    t.receive(frame('hello_ok', 1, { gameId: 'g1', you: 0, players: [] }));
    expect(t.lastFrameAt).toBeGreaterThan(0);
  });

  it('names every visible card a frame shows, never a hidden one', () => {
    const names = namesIn({ players: [{ zones: { hand: { cards: [{ id: 1, name: 'Shock' }, { id: 2, zone: 'hand', hidden: true }] } } }], options: [{ id: 0, label: 'x', card: { id: 9, name: 'Opt' } }] });
    expect([...names].sort()).toEqual(['Opt', 'Shock']);
  });
});

/** A Monkey on a stub page: `evaluate` answers `probe()`, a click runs `onClick(selector)`. */
function stubMonkey(tap, { probe = () => null, onClick = () => {} } = {}) {
  const findings = [];
  const clicks = [];
  const page = {
    evaluate: async () => probe(),
    locator: (sel) => ({ first: () => ({ click: async () => (clicks.push(sel), onClick(sel)) }) }),
    mouse: { move: async () => {} },
  };
  const m = new Monkey({ page, tap, rand: () => 0.5, scripts: new Map(), label: 'host', finding: async (f) => void findings.push(f) });
  return { m, findings, clicks };
}
const OFF = { ok: { label: 'OK', enabled: false }, cancel: { label: 'Cancel', enabled: false }, focus: 'ok' };
const seats = (deciding) => ({ you: 0, seats: [{ seat: 0, deciding }, { seat: 1, deciding: !deciding }] });
const noControls = { cards: [], buttons: [], players: [], eot: null };

describe('the monkey, on J109\'s two hangs that were not the board\'s', () => {
  // J109 2.1 (host, seq 2394–2405): the cleanup discard was taken (card 5), Forge's last update of it
  // emptied the list with every button off, and the frames that passed the turn to Sam reached the
  // page 1.4 s late. The board drew "Waiting for Sam…", rightly; that last update is not a target.
  const cleanup = (cardIds) =>
    input('Cleanup Phase\nSelect 1 card(s) to discard to bring your hand down to the maximum of 7 cards.', {
      buttons: OFF,
      selectable: { cardIds, min: cardIds.length ? 1 : 0, max: cardIds.length ? 1 : 0, mode: cardIds.length ? 'cards' : 'none' },
    });
  const atCleanup = () => {
    const t = new SeatTap('host');
    t.receive(frame('hello_ok', 1, { gameId: 'g', you: 0, players: [] }));
    t.receive(frame('table', 2396, seats(true)));
    t.receive(frame('input', 2400, cleanup([])));
    return t;
  };

  it('an emptied selection that the engine closes a moment later is no unreachable target', async () => {
    const t = atCleanup();
    expect(t.deciding()).toBe(true);
    const { m, findings } = stubMonkey(t);
    setTimeout(() => {
      t.receive(frame('table', 2403, seats(false)));
      t.receive(frame('input', 2404, input('Waiting for Sam...', { buttons: OFF })));
    }, 50);
    expect(await m.openTarget(noControls)).toBe('moved-on');
    expect(findings).toEqual([]);
  });

  it('nor when the closing frames come in while the board is probed', async () => {
    const t = atCleanup();
    const probe = () => {
      t.receive(frame('table', 2403, seats(false)));
      return { board: 'mode-waiting', primary: 'Waiting for Sam… (disabled)', dialog: false, card: [] };
    };
    const { m, findings } = stubMonkey(t, { probe });
    await m.unreachable('a target with nothing named', { input: t.input });
    expect(findings).toEqual([]);
  });

  it('an input that stays open with nothing to click still is one', async () => {
    const t = atCleanup();
    const { m, findings } = stubMonkey(t);
    await m.openTarget(noControls);
    expect(findings.map((f) => f.kind)).toEqual(['unreachable-option']);
  });

  // J109 3.1 (friend, a phone, seq 1791): priority with OK and Forge's "End Turn" both on. The phone's bar
  // keeps End Turn only as To EOT; the monkey's 1-in-14 Cancel found no button and came back "stuck"
  // four times running, and the seat conceded a game the board had never stopped offering moves in.
  it("a phone's End Turn is pressed through To EOT", async () => {
    const t = new SeatTap('friend');
    t.receive(frame('hello_ok', 1, { gameId: 'g', you: 1, players: [] }));
    t.receive(frame('table', 1793, { you: 1, seats: [{ seat: 0, deciding: false }, { seat: 1, deciding: true }] }));
    t.receive(frame('input', 1791, input('Priority: Sam\nTurn: 12 (Justin)\nPhase: Beginning of Combat Step\nStack: Empty')));
    const onClick = () => {
      t.sentFrame(JSON.stringify({ v: 1, seq: 9, t: 1, type: 'act', body: { action: 'yieldTo', target: 'EOT' } }));
      t.receive(frame('input', 1794, input('Waiting for Justin...', { buttons: OFF })));
    };
    const { m, clicks } = stubMonkey(t, { onClick });
    const dom = { ...noControls, buttons: [{ t: 'pt1', which: 'ok', enabled: true, vis: true, where: 'bar' }], eot: 'pt2' };
    expect(await m.press(dom, 'cancel')).toBe(true);
    expect(clicks).toEqual(['[data-pt="pt2"]']);
    // A Cancel that is not End Turn has no such stand-in.
    t.receive(frame('input', 1795, input('Pay', { buttons: { ok: { label: 'Auto', enabled: false }, cancel: { label: 'Cancel', enabled: true } } })));
    expect(await m.press(dom, 'cancel')).toBe(false);
  });
});

describe('a click Playwright gave up on', () => {
  it('keeps the reason from the call log', () => {
    const msg = 'locator.click: Timeout 6000ms exceeded.\nCall log:\n\x1b[2m  - attempting click action\x1b[22m\n\x1b[2m      - <div class="ask-layer">…</div> intercepts pointer events\x1b[22m\n\x1b[2m    - retrying click action\x1b[22m';
    expect(clickWhy(new Error(msg))).toBe('locator.click: Timeout 6000ms exceeded. (<div class="ask-layer">…</div> intercepts pointer events)');
    expect(clickWhy(new Error('locator.click: Timeout 6000ms exceeded.'))).toBe('locator.click: Timeout 6000ms exceeded.');
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

describe('hidden information in the page', () => {
  const page = (text) => ({ evaluate: async () => text });
  it('a hidden card’s name on the page is a leak; one this seat was shown, or a basic land type, is not', async () => {
    const text = 'Opponent hand 7 · Options · Savannah Land — Forest · Lightning Bolt was revealed · Counterspell';
    const leaks = await hiddenLeaks(page(text), new Set(['Counterspell', 'Lightning Bolt', 'Forest', 'Opt', 'Brainstorm']), new Set(['Lightning Bolt']));
    expect(leaks).toHaveLength(1);
    expect(leaks[0]).toMatch(/^"Counterspell" is in the page/);
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

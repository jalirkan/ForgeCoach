// SPDX-License-Identifier: GPL-3.0-or-later
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { parseLog, type GameLog } from './log.ts';
import type { GameStateBody, InputBody } from './protocol.ts';
import { isHidden } from './protocol.ts';
import {
  askHint,
  askRoomHint,
  roomHintInfo,
  TABLE_HINT_OFF,
  roomHintInfoOf,
  helperHintAvailable,
  hintCardIds,
  hintCaveat,
  hintChoiceWords,
  hintDecisionKey,
  hintKindOf,
  hintMoment,
  hintSupported,
  hintLineSteps,
  hintWords,
  isRefused,
  parseHint,
  parseLine,
  type HintFetch,
  type SearchHint,
} from './searchHint.ts';

function load(name: string): GameLog {
  return parseLog(gunzipSync(readFileSync(new URL(`../public/samples/${name}.jsonl.gz`, import.meta.url))).toString('utf8'));
}
const auto = load('human-auto-42');

/** The log cut just after the first input whose prompt matches, with its state and input. */
function momentAt(log: GameLog, test: (p: string, s: GameStateBody) => boolean): { log: GameLog; state: GameStateBody; input: InputBody } {
  let state: GameStateBody | null = null;
  for (let i = 0; i < log.frames.length; i++) {
    const f = log.frames[i]!;
    if (f.type === 'state') state = f.body as GameStateBody;
    if (f.type === 'input' && state && test(String((f.body as InputBody).prompt), state)) {
      return { log: { ...log, frames: log.frames.slice(0, i + 1) }, state, input: f.body as InputBody };
    }
  }
  throw new Error('no such moment');
}
const attack = momentAt(auto, (p) => p.startsWith('Select creatures to attack'));
const block = momentAt(auto, (p) => p.startsWith('Select creatures to block'));
const target = momentAt(auto, (p) => /Select target creature/.test(p));
const main = momentAt(auto, (p, s) => /^Priority/.test(p) && s.phase === 'MAIN1' && s.activePlayer === 0 && s.turn >= 3 && !s.stack.length);
const theirTurn = momentAt(auto, (p, s) => /^Priority/.test(p) && s.activePlayer === 1 && s.turn >= 2);

const ok = (b: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => b });

describe('when a hint is offered', () => {
  it('reads hint: 1 from /health, nothing else', async () => {
    expect(helperHintAvailable({ hint: 1 })).toBe(true);
    expect(helperHintAvailable({ hint: 0 })).toBe(false);
    expect(helperHintAvailable({ review: 1 })).toBe(false);
    expect(helperHintAvailable(null)).toBe(false);
    const f: HintFetch = async () => ok({ ok: false, error: 'claude not ready', hint: 1 });
    expect(await hintSupported({ baseUrl: 'http://h', token: null }, f)).toBe(true);
    expect(await hintSupported({ baseUrl: 'http://h', token: null }, async () => { throw new Error('down'); })).toBe(false);
  });

  it('only at a decision the engine judges: main-phase spells, attacks, blocks, targets', () => {
    expect(hintKindOf(attack.state, attack.input, 0)).toBe('attack');
    expect(hintKindOf(block.state, block.input, 0)).toBe('block');
    expect(hintKindOf(target.state, target.input, 0)).toBe('target');
    expect(hintKindOf(main.state, main.input, 0)).toBe('spell');
    expect(hintKindOf(theirTurn.state, theirTurn.input, 0)).toBeNull();
    expect(hintKindOf(main.state, main.input, null)).toBeNull();
    expect(hintKindOf(main.state, null, 0)).toBeNull();
    // A spell on the stack: not a main-phase "what to cast" decision.
    expect(hintKindOf({ ...main.state, stack: [{} as never] }, main.input, 0)).toBeNull();
    // A target prompt with nothing to click is not one either.
    expect(hintKindOf(target.state, { ...target.input, selectable: { ...target.input.selectable, cardIds: [], mode: 'cards' } }, 0)).toBeNull();
  });

  it('names the moment by the seq of the newest state and input', () => {
    const m = hintMoment(attack.log)!;
    const lastState = [...attack.log.frames].reverse().find((f) => f.type === 'state')!;
    expect(m.stateSeq).toBe(lastState.seq);
    expect(m.inputSeq).toBe(attack.log.frames.at(-1)!.seq);
    expect(hintMoment(null)).toBeNull();
  });

  it('keeps one decision while it stays open, a new one when it moves', () => {
    const k = hintDecisionKey(attack.state, attack.input, 0)!;
    expect(k).toContain('attack');
    expect(hintDecisionKey({ ...attack.state }, { ...attack.input, highlighted: [1] }, 0)).toBe(k);
    expect(hintDecisionKey(block.state, block.input, 0)).not.toBe(k);
    expect(hintDecisionKey(theirTurn.state, theirTurn.input, 0)).toBeNull();
    // A main phase: a new board (a land played, a spell resolved) is a new decision.
    expect(hintDecisionKey(main.state, main.input, 0, 10)).not.toBe(hintDecisionKey(main.state, main.input, 0, 11));
    expect(hintDecisionKey(attack.state, attack.input, 0, 10)).toBe(hintDecisionKey(attack.state, attack.input, 0, 11));
  });
});

const answer = (over: Record<string, unknown> = {}) => ({
  ok: true, v: 1, kind: 'search-hint', status: 'ok', type: 'attack', stateSeq: 900, measure: 'leaf', wallMs: 3120,
  pick: 'attack:25,31', strength: 'clear', options: [
    { token: 'attack:25,31', label: 'attack with Aerial Doombot #25, Quake #31', verdict: 'best', winRate: 0.6 },
    { token: 'attack:none', label: 'no attack', verdict: 'worse', winRate: 0.4 },
  ],
  knowledge: { opponent: 'unknown', opponentModel: 'basic-lands', ownDeck: 'deck:decks/pacho-shield.dck' },
  ...over,
});

describe('the answer', () => {
  it('is read strictly', () => {
    const h = parseHint(answer());
    expect(h.pick).toBe('attack:25,31');
    expect(h.strength).toBe('clear');
    expect(h.runnerUp).toBeNull();
    expect(h.knowledge).toBe('basic-lands');
    expect(h.options.map((o) => o.verdict)).toEqual(['best', 'worse']);
    expect(() => parseHint({ ...answer(), kind: 'game-review' })).toThrow();
    expect(() => parseHint({ ...answer(), status: 'great' })).toThrow();
    expect(() => parseHint({ ...answer(), pick: 'attack:25; drop table' })).toThrow();
    expect(() => parseHint({ ...answer(), strength: 'certain' })).toThrow();
    // A runner-up only beside "close": a clear pick never names one.
    expect(parseHint(answer({ runnerUp: 'attack:none' })).runnerUp).toBeNull();
    expect(parseHint(answer({ strength: 'close', runnerUp: 'attack:none' })).runnerUp).toBe('attack:none');
    expect(parseHint({ ok: true, kind: 'search-hint', status: 'unsupported', message: 'no decision the analysis grades is open here' }).pick).toBeNull();
  });

  it('says the pick in board words, never an engine id', () => {
    const w = hintWords(parseHint(answer()), attack.state, 0);
    expect(w.line).toBe('Attack with Aerial Doombot and Quake, Agent of S.H.I.E.L.D.');
    expect(w.strength).toBe('clearly best');
    expect(w.line).not.toMatch(/#\d|\d{2}/);
  });

  it('a close call names the runner-up and says it is too close to call', () => {
    const h = parseHint(answer({ strength: 'close', runnerUp: 'attack:none' }));
    expect(hintWords(h, attack.state, 0)).toMatchObject({ line: 'Attack with Aerial Doombot and Quake, Agent of S.H.I.E.L.D., or don’t attack', strength: 'too close to call' });
  });

  it('a main phase: the land first, then the cast or casting nothing', () => {
    const hand = main.state.players.find((p) => p.id === 0)!.zones.hand.cards.filter((c) => !isHidden(c));
    const spell = hand.find((c) => !/Land/.test(String((c as { types?: string }).types ?? '')))!;
    const land = main.state.players.flatMap((p) => p.zones.battlefield.cards).find((c) => /Land/.test(String((c as { types?: string }).types ?? '')))!;
    const h = parseHint(answer({ type: 'spell', pick: `cast:${spell.id}`, strength: 'close', runnerUp: 'pass', landFirst: land.id }));
    const w = hintWords(h, main.state, 0);
    expect(w.line).toMatch(/^Play .+ first, then: cast .+, or cast nothing now$/);
    expect(w.line).not.toMatch(/#/);
    expect(hintCardIds(h)).toEqual([spell.id, land.id]);
  });

  it('a block, grouped by attacker, says whose card is whose when both sides have the name', () => {
    expect(hintChoiceWords('block:94>91', block.state, 0)).toBe('Block their Soldier Token with your Soldier Token');
    expect(hintChoiceWords('block:none', block.state, 0)).toBe('Don’t block');
  });

  it('a target, a player, a card you cannot see', () => {
    expect(hintChoiceWords('target:44', target.state, 0)).toBe('Target Peggy Carter, Secret Agent');
    expect(hintChoiceWords('target:player0', target.state, 0)).toBe('Target yourself');
    const opp = attack.state.players.find((p) => p.id !== 0)!;
    expect(hintChoiceWords(`target:player${opp.id}`, attack.state, 0)).toBe(`Target ${opp.name}`);
    const hidden = opp.zones.hand.cards.find(isHidden);
    if (hidden) expect(hintChoiceWords(`cast:${hidden.id}`, attack.state, 0)).toBe('Cast a card');
    expect(hintChoiceWords('attack:999998,999999', attack.state, 0)).toBe('Attack with 2 × a card you can’t see');
  });

  it('the caveat says what it knows and how far it looks', () => {
    expect(hintCaveat({ knowledge: 'basic-lands', measure: 'leaf' })).toBe('Knows only what you know (hidden cards as lands).');
    expect(hintCaveat({ knowledge: 'basic-lands', measure: 'leaf' }, true)).toMatch(/treated as lands, so it may be too hopeful\. It plays the decision out to the end of this turn/);
    expect(hintCaveat({ knowledge: 'pool', measure: 'leaf' })).toBe('Knows only what you know (hidden cards from the cube).');
    const u = hintWords(parseHint({ ok: true, kind: 'search-hint', status: 'unsupported' }), attack.state, 0);
    expect(u.line).toBe('The search AI can’t judge this decision.');
    expect(u.strength).toBeNull();
  });
});

describe('asking', () => {
  it('sends which moment, the seat and the pool — never a deck — with the pairing token', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const f: HintFetch = async (url, init) => {
      calls.push({ url, init });
      return ok(answer());
    };
    const r = await askHint({ baseUrl: 'http://127.0.0.1:8643', token: 'tok' }, { gameId: 'human-ws-7', seat: 0, stateSeq: 900, inputSeq: 903, oppPool: [[1, 'Shock']], oppKnown: ['Shock'] }, f);
    expect(isRefused(r)).toBe(false);
    expect(calls[0]!.url).toBe('http://127.0.0.1:8643/hint');
    const body = JSON.parse(String(calls[0]!.init!.body));
    expect(Object.keys(body).sort()).toEqual(['gameId', 'inputSeq', 'oppKnown', 'oppPool', 'seat', 'stateSeq']);
    expect((calls[0]!.init!.headers as Record<string, string>)['X-ForgeCoach-Token']).toBe('tok');
  });

  it('says why not, in plain words', async () => {
    const t = { baseUrl: 'http://h', token: null };
    const req = { gameId: 'g', seat: 0, stateSeq: 5 };
    const moved = await askHint(t, req, async () => ok({ ok: false, code: 'moved-on', message: 'x' }, 409));
    expect(isRefused(moved) && moved.code === 'moved-on' && moved.message).toBe('The game moved on before the search AI finished.');
    const sup = await askHint(t, req, async () => ok({ ok: false, code: 'superseded' }, 409));
    expect(isRefused(sup) && sup.code).toBe('superseded');
    const off = await askHint(t, req, async () => ok({ ok: false, message: 'off' }, 503));
    expect(isRefused(off) && off.message).toMatch(/off on your PC/);
    const down = await askHint(t, req, async () => { throw new TypeError('fetch failed'); });
    expect(isRefused(down) && down.message).toMatch(/Couldn’t reach the engine on your PC/);
    const junk = await askHint(t, req, async () => ok({ ok: true, kind: 'nope' }));
    expect(isRefused(junk) && junk.message).toMatch(/could not be read/);
    const bad = await askHint(t, { ...req, gameId: '../x' }, async () => ok(answer()));
    expect(isRefused(bad)).toBe(true);
  });
});

describe('at a table of two (mtg-table D453): the room, behind this seat\'s token', () => {
  const room = { base: 'https://play.example.org/', id: 'rAbC12_xy', token: 'seat-token-0' };
  it('asks the room, never the helper: this seat, the moment, the room token in a header — no pool, no deck', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const f: HintFetch = async (url, init) => {
      calls.push({ url, init });
      return ok(answer());
    };
    const r = await askRoomHint(room, { gameId: 'friend-m1790000000042', seat: 1, stateSeq: 900, inputSeq: 903, budgetMs: 3000 }, f);
    expect(isRefused(r)).toBe(false);
    expect(calls[0]!.url).toBe('https://play.example.org/room/rAbC12_xy/hint');
    expect(calls[0]!.url).not.toContain('seat-token-0');
    expect(calls[0]!.init!.method).toBe('POST');
    expect((calls[0]!.init!.headers as Record<string, string>)['X-Room-Token']).toBe('seat-token-0');
    const body = JSON.parse(String(calls[0]!.init!.body));
    expect(body).toEqual({ gameId: 'friend-m1790000000042', seat: 1, stateSeq: 900, inputSeq: 903, budgetMs: 3000 });
  });
  it('sends a game id only when it is a table\'s: the room names the game itself', async () => {
    const bodies: Record<string, unknown>[] = [];
    const f: HintFetch = async (_u, init) => {
      bodies.push(JSON.parse(String(init!.body)));
      return ok(answer());
    };
    await askRoomHint(room, { gameId: 'friend-m1790000000042-seat1', seat: 1, stateSeq: 5 }, f);
    await askRoomHint(room, { gameId: 'human-ws-7', seat: 1, stateSeq: 5 }, f);
    await askRoomHint(room, { gameId: null, seat: 1, stateSeq: 5 }, f);
    expect(bodies.map((b) => b.gameId)).toEqual(['friend-m1790000000042-seat1', undefined, undefined]);
  });
  it('the room gone (404), hints off (503) or the link replaced (403) is off, each in its own words — not an error', async () => {
    for (const [status, body, why] of [[404, { ok: false, code: 'gone', message: 'no such room' }, 'gone'], [503, { ok: false, code: 'off', message: 'x' }, 'off'], [403, { ok: false, code: 'token' }, 'link']] as const) {
      const r = await askRoomHint(room, { seat: 0, stateSeq: 5 }, async () => ok(body, status));
      expect(isRefused(r) && [r.code, r.off, r.message]).toEqual(['off', why, TABLE_HINT_OFF[why]]);
    }
    expect(new Set(Object.values(TABLE_HINT_OFF)).size).toBe(Object.keys(TABLE_HINT_OFF).length);
    expect(TABLE_HINT_OFF.gone).not.toMatch(/latest ForgeCoach/);
    expect(TABLE_HINT_OFF['no-seat']).not.toMatch(/latest ForgeCoach/);
  });
  it('the room\'s other answers, in plain words', async () => {
    const req = { seat: 0, stateSeq: 5 };
    const game = await askRoomHint(room, req, async () => ok({ ok: false, code: 'game' }, 409));
    expect(isRefused(game) && game.code).toBe('moved-on');
    const none = await askRoomHint(room, req, async () => ok({ ok: false, code: 'no-game' }, 409));
    expect(isRefused(none) && [none.code, none.message]).toEqual([null, 'No game is being played in the room right now.']);
    const moved = await askRoomHint(room, req, async () => ok({ ok: false, code: 'moved-on' }, 409));
    expect(isRefused(moved) && moved.code).toBe('moved-on');
    const down = await askRoomHint(room, req, async () => { throw new TypeError('fetch failed'); });
    expect(isRefused(down) && down.message).toMatch(/room’s PC/);
  });
  it('availability is the room\'s state `hint: 1`, read with this seat\'s token', async () => {
    expect(roomHintInfoOf({ v: 1, id: 'r', hint: 1 })).toMatchObject({ available: true, off: null });
    expect(roomHintInfoOf({ v: 1, id: 'r', hint: 0 })).toMatchObject({ available: false, off: 'off' });
    expect(roomHintInfoOf({ v: 1, id: 'r' })).toMatchObject({ available: false, off: 'old' });
    const calls: { url: string; init?: RequestInit }[] = [];
    const info = await roomHintInfo(room, async (url, init) => {
      calls.push({ url, init });
      return ok({ v: 1, id: room.id, hint: 1 });
    });
    expect(info.available).toBe(true);
    expect(calls[0]!.url).toBe('https://play.example.org/room/rAbC12_xy');
    expect((calls[0]!.init!.headers as Record<string, string>)['X-Room-Token']).toBe('seat-token-0');
    expect(await roomHintInfo(room, async () => ok({ ok: false, code: 'gone' }, 404))).toMatchObject({ available: false, off: 'gone' });
    expect(await roomHintInfo(room, async () => ok({ ok: false, code: 'token' }, 403))).toMatchObject({ available: false, off: 'link' });
    expect(await roomHintInfo(room, async () => { throw new TypeError('fetch failed'); })).toMatchObject({ available: false, off: 'unreachable' });
  });
});

it('every answer the engine can give reads back (the helper\'s own shapes)', () => {
  const trivial = parseHint({ ok: true, kind: 'search-hint', status: 'trivial', pick: 'pass', strength: 'only', options: [{ token: 'pass', label: 'pass' }], knowledge: { opponentModel: 'pool' } });
  expect(hintWords(trivial, main.state, 0)).toMatchObject({ line: 'Cast nothing now', strength: 'the only choice' });
  const h: SearchHint = parseHint(answer({ options: [{ token: 'cast:3', label: 'x', verdict: 'best', same: ['cast:4', 'bad token'] }] }));
  expect(h.options[0]!.same).toEqual(['cast:4']);
});

describe('the pick’s line (mtg-table D454)', () => {
  // Seed 42's turn 7, second main phase: the real engine's answer (mtg-table docs/search-hint.md).
  const main2 = momentAt(auto, (p, s) => /^Priority/.test(p) && s.phase === 'MAIN2' && s.activePlayer === 0 && s.turn === 7 && !s.stack.length);
  const ANSWER = { ok: true, v: 1, kind: 'search-hint', status: 'ok', type: 'spell', turn: 7, pick: 'cast:5', strength: 'clear',
    options: [{ token: 'cast:5', label: 'cast Quantum Reduction', verdict: 'best' }, { token: 'pass', label: 'cast nothing now', verdict: 'worse' }],
    knowledge: { opponentModel: 'basic-lands' }, measure: 'leaf', stateSeq: 497,
    line: [{ kind: 'target', text: 'Quantum Reduction → Peggy Carter, Secret Agent', ids: [5, 44] }], lineStop: 'passed' };
  it('reads the line: known kinds, one-line text, whole-number ids', () => {
    const h = parseHint(ANSWER);
    expect(h.line).toEqual([{ kind: 'target', text: 'Quantum Reduction → Peggy Carter, Secret Agent', ids: [5, 44] }]);
    expect(parseHint({ ...ANSWER, line: undefined }).line).toBeNull();
    expect(parseHint({ ...ANSWER, line: [] }).line).toEqual([]);
    // ONE malformed step rejects the whole line, as the helper does
    const good = { kind: 'number', text: 'number = 1', ids: [] };
    for (const bad of [{ kind: 'nonsense', text: 'x', ids: [] }, { kind: 'x', text: 'X =\n3', ids: [2] }, { kind: 'x', text: 'Fireball: X = 3', ids: [1.5] },
      { kind: 'x', text: 'Fireball: X = 3', ids: [-1] }, { kind: 'x', text: 'Fireball: X = 3', ids: 'a' }, { kind: 'mode', text: '' }, null, 'x', []]) {
      expect(parseLine([good, bad])).toBeNull();
    }
    expect(parseLine([good, { kind: 'number', text: 'number = 2' }])).toEqual([{ ...good }, { kind: 'number', text: 'number = 2', ids: [] }]);
    expect(parseLine(Array.from({ length: 8 }, () => good))).toHaveLength(8);
    expect(parseLine(Array.from({ length: 9 }, () => good))).toBeNull();
    expect(parseHint({ ...ANSWER, line: [...ANSWER.line, { kind: 'bogus', text: 'x', ids: [] }] }).line).toBeNull();
  });
  it('shows the steps whose cards the board shows by name, as the engine worded them', () => {
    expect(main2.state.turn).toBe(7);
    const steps = hintLineSteps(parseHint(ANSWER), main2.state, 0);
    expect(steps.map((s) => s.text)).toEqual(['Quantum Reduction → Peggy Carter, Secret Agent']);
  });
  it('rejects the WHOLE line when any step names a card this seat cannot see, as the helper does', () => {
    const hiddenId = main2.state.players[1]!.zones.hand.cards.find((c) => isHidden(c))?.id;
    expect(hiddenId).toBeDefined();
    const withStep = (st: unknown) => parseHint({ ...ANSWER, line: [...ANSWER.line, st] });
    // a name behind a hidden card's id; an id not on the board
    expect(hintLineSteps(withStep({ kind: 'choose', text: 'choose → Doombot', ids: [hiddenId] }), main2.state, 0)).toEqual([]);
    expect(hintLineSteps(withStep({ kind: 'then', text: 'then cast an unseen card', ids: [999999] }), main2.state, 0)).toEqual([]);
    // PLANTED: ids [] with a name in the text -- the grammar catches it
    expect(hintLineSteps(withStep({ kind: 'choose', text: 'choose → Doctor Doom', ids: [] }), main2.state, 0)).toEqual([]);
    expect(hintLineSteps(withStep({ kind: 'target', text: 'an unseen card → Doctor Doom', ids: [] }), main2.state, 0)).toEqual([]);
    // a mode or an X names exactly its own card
    expect(hintLineSteps(withStep({ kind: 'mode', text: 'an unseen card mode → Destroy target artifact.', ids: [] }), main2.state, 0)).toEqual([]);
    expect(hintLineSteps(withStep({ kind: 'x', text: 'X = 3', ids: [] }), main2.state, 0)).toEqual([]);
    // a visible name the ids do not list
    expect(hintLineSteps(withStep({ kind: 'target', text: 'Quantum Reduction → Peggy Carter, Secret Agent', ids: [5] }), main2.state, 0)).toEqual([]);
    expect(hintLineSteps({ ...parseHint(ANSWER), pick: null }, main2.state, 0)).toEqual([]);
  });
  it('every shape the helper allows passes on the page too', () => {
    const steps = [
      { kind: 'x', text: 'Quantum Reduction: X = 2', ids: [5] },
      { kind: 'mode', text: 'Quantum Reduction mode → Destroy target artifact.', ids: [5] },
      { kind: 'sacrifice', text: 'sacrifice → Peggy Carter, Secret Agent, an unseen card', ids: [44] },
      { kind: 'trigger', text: 'Quantum Reduction trigger → the opponent, you', ids: [5] },
      { kind: 'then', text: 'then equip Quantum Reduction → a token', ids: [5] },
      { kind: 'number', text: 'number = 4', ids: [] },
    ];
    const got = hintLineSteps(parseHint({ ...ANSWER, line: [...ANSWER.line, ...steps] }), main2.state, 0).map((s) => s.text);
    expect(got).toHaveLength(7);
    expect(got[5]).toBe('Then equip Quantum Reduction → a token');
  });
});

// SPDX-License-Identifier: GPL-3.0-or-later
// The live coach's plan mode (mtg-table D419), tested on REAL recorded games:
// mtg-table's LLM seat playing as Sonnet against Forge in plan mode — its frame
// logs, Sonnet's real replies, the steps the seat carried out (and the one that
// failed), and the very user message the seat sent. Card text comes from the
// Scryfall snapshots the cube tests use (cards.ts's mapping).
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type { GameStateBody, InputBody } from '../protocol.ts';
import { MOMENTS, cardsAt, cardsFor, loadLog, snapshotOf, type RecordedMoment } from './testdata/load.ts';
import { buildPlanPrompt, correctionFor, momentOf, reviewReply, type Snapshot } from './coach.ts';
import { oracleFromCards } from './oracle.ts';
import { matchAbility, matchRef, parsePlan, parseRef, partialPlan, splitNames } from './parse.ts';
import { MAX_CORRECTIONS, PLAN_SYSTEM, REPLY_FORMAT, REPLY_REMINDER } from './prompt.ts';
import { dueMoment, momentAt, selectChoices } from './moments.ts';
import { planProgress } from './progress.ts';
import { ManaBudget } from './mana.ts';
import { HUMAN_OPPONENT_PHRASE } from '../opponent.ts';

interface AllMoment {
  log: string;
  momentNo: number;
  moment: string;
  correction: number;
  frameSeq: number;
  turn: number;
  phase: string | null;
  replies: string[];
  steps: string[] | null;
  failed: { step: number; text: string; reason: string } | null;
}
const FIX = JSON.parse(readFileSync(new URL('./testdata/moments.json', import.meta.url), 'utf8')) as { recordedSystem: string; all: AllMoment[] };
const ALL = FIX.all;

const picked = (log: string, n: number): RecordedMoment => MOMENTS.find((m) => m.log === log && m.momentNo === n)!;
const S2 = 's2-search-p0-s6-001';

function at(m: { log: string; frameSeq: number }) {
  const { log, snap, seat } = snapshotOf(m as RecordedMoment);
  const cards = cardsAt(snap);
  return { log, snap, seat, cards, oracle: oracleFromCards(cards) };
}

/** A real moment's reply, checked at its real snapshot. */
function review(m: { log: string; frameSeq: number }, reply: string) {
  const { log, snap, seat, cards, oracle } = at(m);
  const moment = momentOf(log, snap, seat, oracle)!;
  return reviewReply(reply, log, snap, seat, cards, moment);
}

/** The steps an earlier plan of the same game had done by `snap` (for "Your plan was:"). */
function planBefore(m: RecordedMoment, snap: Snapshot, seat: number) {
  const prev = ALL.filter((x) => x.log === m.log && x.momentNo < m.momentNo && x.moment === 'turn' && x.turn === m.turn).at(-1);
  if (!prev) return null;
  const p = parsePlan(prev.replies.at(-1)!);
  if (!p.ok) return null;
  const from = at(prev).snap.frameIndex;
  const log = loadLog(m.log);
  const pr = planProgress({ steps: p.steps, frames: log.frames.slice(0, snap.frameIndex + 1), from, me: seat, moment: { kind: 'turn', id: `turn:${prev.turn}`, turn: prev.turn, phase: prev.phase } });
  return { steps: p.steps, done: pr.done };
}

describe('parsePlan on real replies', () => {
  it('reads every recorded reply into the steps the seat carried out', () => {
    let n = 0;
    for (const m of ALL) {
      for (const [i, reply] of m.replies.entries()) {
        const p = parsePlan(reply);
        if (i < m.replies.length - 1 || !m.steps) continue;
        expect(p.ok, `${m.log} m${m.momentNo}`).toBe(true);
        if (p.ok) expect(p.steps.map((s) => s.raw)).toEqual(m.steps);
        n++;
      }
    }
    expect(n).toBeGreaterThanOrEqual(60);
  });

  it('keeps the reasoning before PLAN: as the why', () => {
    const p = parsePlan(picked(S2, 19).reply);
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.preamble).toMatch(/^Crypt Rats could sweep my board/);
    expect(p.plan).not.toMatch(/\n/);
  });

  it('refuses what the seat refused, with the reason', () => {
    const real = picked(S2, 3).reply;
    expect(parsePlan('')).toEqual({ ok: false, error: 'the reply is empty' });
    const after = parsePlan(`${real}\nGood luck!`);
    expect(after.ok).toBe(false);
    if (!after.ok) expect(after.error).toMatch(/^nothing may follow END/);
    const noEnd = parsePlan(real.replace(/\nEND\s*$/, ''));
    expect(noEnd.ok === false && /no END line/.test(noEnd.error)).toBe(true);
    const verb = parsePlan(real.replace('2. cast Mind Stone', '2. tap Mind Stone'));
    expect(verb.ok === false && /"tap" is not a verb this program knows/.test(verb.error)).toBe(true);
    const order = parsePlan('PLAN: x\nSTEPS:\n1. pass\n2. hold\nEND');
    expect(order.ok === false && /must be the last step/.test(order.error)).toBe(true);
    const keep = parsePlan('PLAN: x\nSTEPS:\n1. keep\n2. hold\nEND');
    expect(keep.ok === false && /must be the only step/.test(keep.error)).toBe(true);
  });

  it('shows the PLAN: sentence while the rest streams', () => {
    const real = picked(S2, 19).reply;
    const cut = real.slice(0, real.indexOf('STEPS:'));
    expect(partialPlan(cut).plan).toBe(parsePlan(real).ok && (parsePlan(real) as { plan: string }).plan);
    expect(partialPlan('Thinking about').plan).toBeNull();
  });

  it('matches names the seat way', () => {
    const cands = [
      { id: 27, name: 'Island', group: 'hand' },
      { id: 22, name: 'Island', group: 'hand' },
      { id: 14, name: 'Monastery Swiftspear', group: 'battlefield' },
    ];
    expect(matchRef(parseRef('Island #22'), cands)).toMatchObject({ ok: true, pick: { id: 22 } });
    expect(matchRef(parseRef('island'), cands)).toMatchObject({ ok: true, pick: { id: 27 } });
    expect(matchRef(parseRef('Monastery Swiftspear (1/2)'), cands)).toMatchObject({ ok: true, pick: { id: 14 } });
    expect(matchRef(parseRef('Island #99'), cands)).toMatchObject({ ok: false, why: 'id' });
    expect(splitNames('Monastery Swiftspear, Bird Token #140, Bird Token #141')).toEqual(['Monastery Swiftspear', 'Bird Token #140', 'Bird Token #141']);
    // one ability: whatever the words (ch3: "activate Clue Token: {2}")
    expect(matchAbility('{2}', ['{2}, Sacrifice this token: Draw a card.'])).toEqual({ ok: true, index: 0 });
    expect(matchAbility('+1', ['+1: Create a 1/1 white Soldier creature token.', '+1: Target creature gets +3/+3 and gains flying until end of turn.', '−8: Emblem'])).toEqual({ ok: false, why: 'ambiguous' });
    expect(matchAbility('-8', ['+1: Create a token.', '−8: Emblem'])).toEqual({ ok: true, index: 1 });
  });
});

describe('the prompt, byte for byte against what the seat sent', () => {
  it('keeps the tested REPLY FORMAT and only words THE GAME for coaching', () => {
    const recorded = FIX.recordedSystem;
    expect(recorded.startsWith(`${REPLY_FORMAT}\n\nTHE GAME.`)).toBe(true);
    expect(PLAN_SYSTEM.startsWith(`${REPLY_FORMAT}\n\nTHE GAME. You are coaching a player`)).toBe(true);
    expect(PLAN_SYSTEM.endsWith('\n\nPlay to win.')).toBe(true);
    expect(PLAN_SYSTEM).toMatch(/A program checks each step you write against what the engine allows/);
    expect(PLAN_SYSTEM).toMatch(/The player then carries out your steps in order/);
    expect(PLAN_SYSTEM.split('against the Forge AI').length).toBe(2);
  });

  // cg4: Sonnet's run had no card text, so Mulldrifter's evoke was unreadable and it was listed as
  // unaffordable; with Scryfall's text the cost is left to the engine. Every other picked moment is
  // the seat's message to the byte.
  const SAME = MOMENTS.filter((m) => m.log !== 'cg4-peasant-001');
  it.each(SAME.map((m) => [`${m.log} m${m.momentNo} ${m.moment}`, m] as const))('%s', (_n, m) => {
    const { log, snap, seat, cards, oracle } = at(m);
    const plan = planBefore(m, snap, seat);
    const moment = momentOf(log, snap, seat, oracle, { plan })!;
    expect(moment.kind).toBe(m.moment);
    const p = buildPlanPrompt(log, snap, seat, cards, moment.question, { moment });
    expect(p.user).toBe(m.recordedUser.trimEnd());
    // deterministic
    expect(buildPlanPrompt(log, snap, seat, cards, moment.question, { moment }).user).toBe(p.user);
  });

  it('shows two-faced cards by face, and adds the play guide and a friend opponent', () => {
    const m = picked(S2, 18);
    const { log, snap, seat, cards, oracle } = at(m);
    const moment = momentOf(log, snap, seat, oracle)!;
    const p = buildPlanPrompt(log, snap, seat, cards, moment.question, { moment, guide: '  Attack early; keep Stomp for a blocker.  ' });
    expect(p.user).toMatch(/^Bonecrusher Giant: Bonecrusher Giant: .* \/\/ Stomp: /m);
    expect(p.user).toMatch(/\n\nTHE PLAYER'S PLAY GUIDE FOR THIS DECK \(their own notes\)\nAttack early; keep Stomp for a blocker\.\n\nIt is your turn 12/);
    expect(p.user.endsWith(`\n${REPLY_REMINDER}`)).toBe(true);
    const friend = buildPlanPrompt({ ...log, hello: { ...log.hello!, match: { ...(log.hello as { match?: object }).match, opponent: 'human' } } as never }, snap, seat, cards, moment.question, { moment });
    expect(friend.system).toContain(HUMAN_OPPONENT_PHRASE);
    expect(friend.system).not.toContain('against the Forge AI');
  });
});

describe('moments', () => {
  it('finds the moment the seat was asked at, for every recorded one', () => {
    for (const m of ALL) {
      const { log, snap, seat, oracle } = at(m);
      expect(momentOf(log, snap, seat, oracle)?.kind, `${m.log} m${m.momentNo}`).toBe(m.moment);
    }
  });

  it('asks each moment once', () => {
    const m = picked(S2, 3);
    const { log, snap, seat, oracle } = at(m);
    const input = { frames: log.frames.slice(0, snap.frameIndex + 1), state: snap.state, input: snap.input, ask: snap.ask, me: seat, oracle };
    const due = dueMoment(input, new Set());
    expect(due?.id).toBe('turn:4');
    expect(dueMoment(input, new Set(['turn:4']))).toBeNull();
  });

  it('does not ask a turn with nothing to play; Ask about this still can', () => {
    const m = picked(S2, 3);
    const { log, snap, seat, oracle } = at(m);
    const bare: GameStateBody = { ...snap.state, playable: [], activatable: [] };
    const input = { frames: log.frames.slice(0, snap.frameIndex + 1), state: bare, input: snap.input, ask: snap.ask, me: seat, oracle };
    expect(momentAt(input)).toBeNull();
    expect(momentAt(input, { force: true })?.kind).toBe('turn');
  });

  it('a question the plan already answers is not asked again', () => {
    const m = ALL.find((x) => x.log === 'cg4-peasant-001' && x.momentNo === 6)!;
    const { log, snap, seat, oracle } = at(m);
    const p = parsePlan(m.replies[0]!);
    if (!p.ok) throw new Error(p.error);
    const base = { frames: log.frames.slice(0, snap.frameIndex + 1), state: snap.state, input: snap.input, ask: snap.ask, me: seat, oracle };
    expect(momentAt(base)?.kind).toBe('question');
    expect(momentAt({ ...base, plan: { steps: p.steps, done: p.steps.map(() => false) } })).toBeNull();
  });
});

describe('the check', () => {
  it('lets through every plan the seat carried out without a failure (no false refusals)', () => {
    let n = 0;
    for (const m of ALL) {
      if (m.failed || !m.steps) continue;
      const r = review(m, m.replies.at(-1)!);
      expect(r.check?.ok, `${m.log} m${m.momentNo}: ${JSON.stringify(r.check?.first)}`).toBe(true);
      n++;
    }
    expect(n).toBeGreaterThanOrEqual(60);
  });

  it('m20: a second {1}{W} after Momentary Blink — the step that failed on the engine, caught before', () => {
    const m = ALL.find((x) => x.log === 'm20-search-p10-001' && x.momentNo === 7)!;
    expect(m.failed?.text).toBe('cast Ancestral Blade');
    const r = review(m, m.replies[0]!);
    expect(r.check?.first?.step.raw).toBe('cast Ancestral Blade');
    expect(r.check?.first?.why).toBe('it costs {1}{W}, which needs 1 white mana, and after step 2 (cast Momentary Blink, {1}{W}) your untapped mana has no white left (you have 5 untapped mana sources (Island, Island, Plains, Island, Island))');
  });

  it('s2: casting Brazen Borrower twice — the second is refused', () => {
    const m = picked(S2, 19);
    expect(m.failed?.text).toBe('cast Brazen Borrower');
    const r = review(m, m.reply);
    expect(r.check?.steps.map((s) => s.ok)).toEqual([true, false, true]);
    expect(r.check?.first?.why).toBe('Brazen Borrower is already cast by an earlier step');
    const c = correctionFor(r, m.reply, 'It is your turn 14. What do you do this turn?', 0)!;
    expect(c.split('\n')[0]).toBe("Step 2 'cast Brazen Borrower' cannot be done: Brazen Borrower is already cast by an earlier step.");
    expect(c).toContain('Your plan was: 1. cast Brazen Borrower -> Crypt Rats; 2. cast Brazen Borrower; 3. attack with Bird Token #140, Bird Token #141.');
    expect(c).toContain(`(Correction 1 of ${MAX_CORRECTIONS}.)`);
    expect(c.endsWith('\n\nIt is your turn 14. What do you do this turn?')).toBe(true);
    expect(correctionFor(r, m.reply, 'q', MAX_CORRECTIONS)).toBeNull();
  });

  it('what only the engine knows is let through (ch3: the Clue cancelled by Forge; cg4: evoke)', () => {
    const ch3 = ALL.find((x) => x.log === 'ch3-pauper-001' && x.momentNo === 13)!;
    expect(ch3.failed?.reason).toMatch(/cancelled/);
    expect(review(ch3, ch3.replies[0]!).check?.ok).toBe(true);
    const cg4 = ALL.find((x) => x.log === 'cg4-peasant-001' && x.momentNo === 14)!;
    expect(review(cg4, cg4.replies[0]!).check?.ok).toBe(true);
  });

  const s2 = (n: number) => ALL.find((x) => x.log === S2 && x.momentNo === n)!;
  const edited = (n: number, steps: string[]) => review(s2(n), `PLAN: edited from the real reply.\nSTEPS:\n${steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}\nEND`).check!;

  it('one land a turn, lands only in your own turn', () => {
    expect(edited(3, ['play land Island #27', 'play land Island #22']).first?.why).toBe('you play one land a turn, and step 1 already plays one');
    expect(edited(12, ['play land Plains #37']).first?.why).toMatch(/^a land can be played only in your own main phase/);
    expect(edited(3, ['play land Mind Stone']).first?.why).toBe('Mind Stone is not a land: write "cast Mind Stone"');
  });

  it('names that match nothing, and mana a turn cannot make', () => {
    expect(edited(3, ['cast Lightning Bolt']).first?.why).toBe('no card named "Lightning Bolt" is in your hand or on the battlefield (names as the game shows them)');
    expect(edited(3, ['play land Island #27', 'cast Mind Stone', 'cast Perilous Myr']).first?.why).toMatch(/^it costs \{2\} \(2 mana\), and after step 2 \(cast Mind Stone, \{2\}\)/);
    // Mind Stone taps for {C} at once: Mind Stone + Bonesplitter on three lands
    expect(edited(3, ['play land Island #27', 'cast Mind Stone', 'cast Bonesplitter']).ok).toBe(true);
  });

  it('attacks and blocks', () => {
    expect(edited(28, ['play land Island #21', 'cast Eagles of the North', 'attack with Eagles of the North']).first?.why).toBe('Eagles of the North comes in this turn by an earlier step, so it is summoning sick');
    expect(edited(3, ['attack with Mind Stone']).first?.why).toBe('you have no creature named "Mind Stone" on the battlefield');
    expect(edited(3, ['block Swamp with Mind Stone']).first?.why).toBe("you block on the opponent's turn, not yours");
    expect(edited(34, ['block Kor Skyfisher with Eagles of the North', 'block Restless Reef with Eagles of the North']).first?.why).toBe('Eagles of the North already blocks; each creature blocks one attacker');
    expect(edited(34, ['block Island with Eagles of the North']).first?.why).toMatch(/^"Island" is not attacking you/);
    expect(edited(12, ['attack with Monastery Swiftspear']).first?.why).toBe('it is not your turn');
  });

  it('questions, keep and mulligan', () => {
    expect(edited(6, ['target Crypt Rats']).first?.why).toBe('"Crypt Rats" is not one of the choices (the choices: me; opponent; Monastery Swiftspear (yours))');
    expect(edited(6, ['target me']).ok).toBe(true);
    expect(edited(3, ['target Swamp']).first?.why).toBe('nothing is asking you to choose or target right now (you have priority)');
    expect(edited(3, ['keep']).first?.why).toBe('it is not the start of the game: keep and mulligan are only for your opening hand');
    expect(edited(1, ['pass']).first?.why).toBe('the opening hand is decided with the single step "keep" or "mulligan"');
  });

  it('an unreadable reply is asked again with the invalid-reply words', () => {
    const m = picked(S2, 3);
    const r = review(m, 'Play a land and pass.');
    expect(r.parsed.ok).toBe(false);
    const q = correctionFor(r, 'Play a land and pass.', m.question, 1)!;
    expect(q.split('\n')[0]).toBe('Your last reply could not be read by the program: there is no line starting with "PLAN:".');
    expect(q).toContain(`(Correction 2 of ${MAX_CORRECTIONS}.)`);
  });
});

describe('mana budget', () => {
  it('pays colours across steps', () => {
    const { snap, seat, oracle } = at(ALL.find((x) => x.log === 'm20-search-p10-001' && x.momentNo === 7)!);
    const b = new ManaBudget(snap.state, seat, oracle);
    expect(b.spend('{1}{W}', 'a')).toBeNull();
    expect(b.spend('{1}{W}', 'b')).toMatch(/no white left/);
    expect(b.spend('{1}', 'c')).toBeNull();
  });
});

describe('progress', () => {
  it('ticks the turn plan off from the log (s2 turn 8: land, Swiftspear, equip, attack)', () => {
    const m5 = ALL.find((x) => x.log === S2 && x.momentNo === 5)!;
    const m6 = ALL.find((x) => x.log === S2 && x.momentNo === 6)!;
    const p = parsePlan(m5.replies[0]!);
    if (!p.ok) throw new Error(p.error);
    const log = loadLog(S2);
    const from = at(m5).snap.frameIndex;
    const mid = log.frames.findIndex((f, i) => i > from && f.type === 'state' && ((f.body as GameStateBody).events ?? []).some((e) => e.kind === 'land'));
    const early = planProgress({ steps: p.steps, frames: log.frames.slice(0, mid + 1), from, me: 0, moment: { kind: 'turn', id: 'turn:8', turn: 8, phase: 'MAIN1' } });
    expect(early.done).toEqual([true, false, false, false]);
    expect(early.complete).toBe(false);
    const later = planProgress({ steps: p.steps, frames: log.frames.slice(0, at(m6).snap.frameIndex + 1), from, me: 0, moment: { kind: 'turn', id: 'turn:8', turn: 8, phase: 'MAIN1' } });
    expect(later.done).toEqual([true, true, true, true]);
    expect(later.complete).toBe(true);
    expect(later.passed).toBe(false);
  });

  it('a response plan is complete once its stack item is gone; keep once the game began', () => {
    const log = loadLog(S2);
    const m7 = ALL.find((x) => x.log === S2 && x.momentNo === 7)!;
    const p = parsePlan(m7.replies[0]!);
    if (!p.ok) throw new Error(p.error);
    const { snap, seat, oracle } = at(m7);
    const mo = momentOf(log, snap, seat, oracle)!;
    const end = at(ALL.find((x) => x.log === S2 && x.momentNo === 8)!).snap.frameIndex;
    const r = planProgress({ steps: p.steps, frames: log.frames.slice(0, end + 1), from: snap.frameIndex, me: seat, moment: { kind: 'response', id: mo.id, turn: 8, phase: snap.state.phase } });
    expect(r).toMatchObject({ passed: true, complete: true, done: [true] });
    const keep = parsePlan('PLAN: k\nSTEPS:\n1. keep\nEND');
    if (!keep.ok) throw new Error(keep.error);
    const m1 = at(ALL.find((x) => x.log === S2 && x.momentNo === 1)!).snap.frameIndex;
    expect(planProgress({ steps: keep.steps, frames: log.frames.slice(0, end + 1), from: m1, me: 0, moment: { kind: 'mulligan', id: 'mulligan:0', turn: 0, phase: null } }).done).toEqual([true]);
  });
});

describe('card text', () => {
  it('names both faces of an adventure and drops reminder text', () => {
    const o = oracleFromCards(cardsFor(['Bonecrusher Giant', 'Brazen Borrower', 'Monastery Swiftspear']));
    expect(o.text('Bonecrusher Giant')).toMatch(/^Bonecrusher Giant: .*\/\/ Stomp: /);
    expect(o.faces('Brazen Borrower')).toEqual(['Brazen Borrower', 'Petty Theft']);
    expect(o.faceCost('Brazen Borrower', 'Petty Theft')).toBe('{1}{U}');
    expect(o.text('Monastery Swiftspear')).toBe('Haste\nProwess');
    expect(o.text('Stomp')).toBe(o.text('Bonecrusher Giant'));
  });
});

describe('selectChoices: the players a target may be (M66 selectable.playerIds)', () => {
  const st = { players: [{ id: 0, zones: {} }, { id: 1, zones: {} }], stackCards: [] } as unknown as GameStateBody;
  const inp = (prompt: string, sel: Partial<InputBody['selectable']>): InputBody =>
    ({ prompt, buttons: { ok: { label: 'OK', enabled: false }, cancel: { label: 'Cancel', enabled: true } }, selectable: { cardIds: [], min: 1, max: 1, mode: 'none', ...sel } }) as InputBody;
  it('takes the listed players when the frame says (a player-only choice reads mode "none")', () => {
    const q = selectChoices(inp('Choose a player', { playerIds: [0, 1] }), st, 0);
    expect(q?.choices.filter((c) => c.playerId !== undefined)).toEqual([
      { label: 'me', playerId: 0 },
      { label: 'opponent', playerId: 1 },
    ]);
    // One listed player and nothing else to choose: no question to ask.
    expect(selectChoices(inp('Lava Spike - Select target opponent', { playerIds: [1] }), st, 0)).toBeNull();
  });
  it('without the list (null or absent) the prompt’s words decide, as before', () => {
    const q = selectChoices(inp('Blood Artist - Select target player', { mode: 'players', playerIds: null }), st, 0);
    expect(q?.choices.filter((c) => c.playerId !== undefined).map((c) => c.playerId)).toEqual([0, 1]);
    expect(selectChoices(inp('Lava Spike - Select target opponent', {}), st, 0)).toBeNull();
  });
});

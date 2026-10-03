// SPDX-License-Identifier: GPL-3.0-or-later
// The three coach-prompt bugs the coach bench found: a Thriving land's chosen
// colour, the play-or-draw question, and picking a target in your own main
// phase. Real fixture logs where they have the moment, synthetic states for the
// edge cases.
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { GameLog, LoggedFrame } from './log.ts';
import type { AskBody, Card, GameStateBody, InputBody } from './protocol.ts';
import { chosenColors, chosenColorSource, manaColorsOf, untappedManaSources } from './state.ts';
import { isPlayDrawInput, isTargetInput } from './decisions.ts';
import { buildCoachPrompt } from './prompt.ts';
import { liveDecision, liveKind } from './ui/play/liveDecision.ts';
import { buildAll, readCards, readCases, readLogFile } from './bench/benchFiles.ts';
import { liveMoment, type BuiltCase } from './bench/coachBench.ts';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const cards = readCards(ROOT);
const { built } = buildAll(
  ROOT,
  readCases(ROOT)
    .filter((l) => l.value)
    .map((l) => l.value!),
  cards,
);
const benchCase = (id: string): BuiltCase => {
  const b = built.find((x) => x.case.id === id);
  if (!b) throw new Error(`no case ${id}`);
  return b;
};
const log = (path: string): GameLog => readLogFile(`${ROOT}/${path}`);
const COMFORT = 'public/samples/human-comfort-13.jsonl.gz';
const AUTO2026 = 'bench/coach/logs/human-auto-2026.jsonl.gz';
const AUTO7 = 'bench/coach/logs/human-auto-7.jsonl.gz';
const ABILITY42 = 'src/play/testdata/human-ability-42.jsonl.gz';

/** Index of the viewer's answer to the "Choose a color" question. */
function colorAnswerFrame(l: GameLog): number {
  const ask = l.frames.findIndex((f) => f.type === 'ask' && (f.body as AskBody).kind === 'choose_list' && /choose a color/i.test((f.body as { prompt: string }).prompt));
  const id = (l.frames[ask]!.body as AskBody).askId;
  return l.frames.findIndex((f, i) => i > ask && f.type === 'answer' && (f.body as { askId: string }).askId === id);
}

// ---------------------------------------------------------------------------
// 1. Thriving lands

describe('Thriving lands: the colour chosen as they entered', () => {
  it('is not in the card state, so the viewer’s own answer is the only record', () => {
    // The protocol's Card has no chosen colour; the bench's games all answered "black" (option 0).
    for (const path of [COMFORT, AUTO2026, AUTO7]) {
      const l = log(path);
      const at = colorAnswerFrame(l);
      expect(at, path).toBeGreaterThan(0);
      expect(chosenColors(l, at - 1, l.seat, cards).get(9), `${path} before the answer`).toBeUndefined();
      expect(chosenColors(l, l.frames.length - 1, l.seat, cards).get(9), path).toBe('B');
    }
  });

  it('ties the answer to the land whether it entered before the question or after it', () => {
    // human-auto-2026: the zone event comes in the state before the question; human-comfort-13: after it.
    for (const path of [AUTO2026, COMFORT]) {
      const l = log(path);
      const at = colorAnswerFrame(l);
      const next = l.frames.findIndex((f, i) => i > at && f.type === 'state');
      expect(chosenColors(l, next, l.seat, cards).get(9), path).toBe('B');
    }
  });

  it('never knows the opponent’s choice (only the viewer’s answers are in the log)', () => {
    const l = log(ABILITY42);
    const end = l.frames.length - 1;
    const s = l.frames.filter((f) => f.type === 'state').pop()!.body as GameStateBody;
    const opp = s.players.find((p) => p.id !== l.seat)!;
    const thriving = (opp.zones.battlefield.cards as Card[]).filter((c) => /^Thriving /.test(c.name));
    expect(thriving.length).toBeGreaterThan(0);
    const chosen = chosenColors(l, end, l.seat, cards);
    for (const c of thriving) expect(chosen.has(c.id)).toBe(false);
  });

  it('makes the fixed colour plus the chosen one, only the fixed one when not recorded, and stays lenient without a lookup', () => {
    const isle = { ...thrivingCard(9, 'Thriving Isle'), tapped: false };
    const state = stateWith([isle]);
    expect(untappedManaSources(state, 0, cards, new Map([[9, 'B']]))).toEqual([{ cardId: 9, name: 'Thriving Isle', colors: ['U', 'B'] }]);
    expect(untappedManaSources(state, 0, cards, new Map())).toEqual([{ cardId: 9, name: 'Thriving Isle', colors: ['U'], unrecordedChoice: true }]);
    expect(untappedManaSources(state, 0, cards)[0]!.colors.sort()).toEqual(['B', 'G', 'R', 'U', 'W']);
    // Without card text the name says which Thriving land it is.
    expect(chosenColorSource(isle)).toEqual({ fixed: ['U'] });
    expect(manaColorsOf(thrivingCard(3, 'Thriving Moor'), undefined, new Map([[3, 'R']]))).toEqual(['B', 'R']);
    expect(chosenColorSource({ ...isle, name: 'Island', types: 'Basic Land - Island' })).toBeNull();
  });

  it('assigns nothing when two lands entered together and the question named neither', () => {
    const l = synthLog([
      stateFrame([thrivingCard(9, 'Thriving Isle'), thrivingCard(10, 'Thriving Heath')], [enter(9), enter(10)]),
      colorAsk('a1'),
      answer('a1', [0]),
    ]);
    expect(chosenColors(l, 10, 0).size).toBe(0);
  });

  it('uses the card id a replacement-order question named, and forgets a choice when the land re-enters', () => {
    const order = { type: 'ask', dir: 's2c', body: { askId: 'o1', kind: 'order', prompt: 'Select order for replacement effects', destLabel: '', dest: [], source: [{ id: 1, label: 'Thriving Heath (10) - As Thriving Heath enters, choose a color other than white.', kind: 'other' }], min: 0, max: 1 } } as unknown as LoggedFrame;
    const l = synthLog([
      stateFrame([thrivingCard(9, 'Thriving Isle'), thrivingCard(10, 'Thriving Heath')], [enter(9), enter(10)]),
      order,
      colorAsk('a1'),
      answer('a1', [1]), // red
      stateFrame([thrivingCard(9, 'Thriving Isle'), thrivingCard(10, 'Thriving Heath')], [enter(10)]),
    ]);
    expect(chosenColors(l, 3, 0)).toEqual(new Map([[10, 'R']]));
    expect(chosenColors(l, 4, 0).size).toBe(0);
  });

  it('tells the coach black, not white, in the bench’s Thriving case', () => {
    const p = benchCase('spell-comfort13-thriving-black').appPrompt.user;
    expect(p).toContain('Untapped mana sources: 1 — U/B×1 (Thriving Isle) · sources by colour: U 1, B 1');
    expect(p).toContain('Thriving Isle (untapped, chosen colour black)');
    expect(p).not.toContain('W/U/B/R/G');
    // White spells are no longer offered as castable.
    expect(benchCase('spell-comfort13-thriving-black').choices.choices.map((c) => c.token)).toEqual(['cast:23', 'pass']);
    // A false "Helicarrier Strike {W}" instant-speed option is gone.
    expect(benchCase('block-comfort13-must-block').appPrompt.user).not.toContain('Instant-speed options the mana covers');
  });

  it('says honestly when the choice is not recorded (the opponent’s Thriving Isle)', () => {
    const p = benchCase('block-auto7-must-block').appPrompt.user;
    expect(p).toContain('Thriving Isle: U, or the colour chosen as it entered (not recorded)');
    expect(p).toContain('Thriving Isle (untapped, chosen colour not recorded)');
    expect(p).toContain('is counted only for its own colour');
  });
});

// ---------------------------------------------------------------------------
// 2. Play or draw

describe('play or draw', () => {
  const input = (prompt: string, ok: string, cancel: string): InputBody =>
    ({ prompt, focusCardId: null, focusCard: null, buttons: { ok: { label: ok, enabled: true }, cancel: { label: cancel, enabled: true } }, selectable: { cardIds: [], min: 0, max: 0, mode: 'none' }, highlighted: [], weak: [], openZones: [] }) as InputBody;

  it('is the Play / Draw buttons before the game, not a leftover prompt under Keep / Mulligan', () => {
    expect(isPlayDrawInput(input('Human, you have won the coin toss.\n\nWould you like to play or draw?', 'Play', 'Draw'), { phase: null })).toBe(true);
    expect(isPlayDrawInput(input('', 'Play', 'Draw'), { phase: null })).toBe(true);
    // human-auto-2026 frame 6: the coin-toss prompt is still up but the buttons are already Keep / Mulligan.
    expect(isPlayDrawInput(input('Human, you have won the coin toss.\n\nWould you like to play or draw?', 'Keep', 'Mulligan'), { phase: null })).toBe(false);
    expect(isPlayDrawInput(input('', 'Play', 'Draw'), { phase: 'MAIN1' })).toBe(false);
  });

  it('asks play or draw with the seat’s own deck, not keep or mulligan about an empty hand', () => {
    const b = benchCase('playdraw-sideboard7-game2');
    const p = b.appPrompt.user;
    expect(b.moment.decision.label).toBe('Pre-game · play or draw');
    expect(p).toContain('Pre-game · play or draw (no opening hand dealt yet)');
    expect(p).not.toMatch(/keep it or mulligan|Hand \(0\): empty/);
    expect(p).toContain('Should I play or draw');
    // The seat's own sideboarding answer is its deck list; nothing of the opponent's.
    expect(p).toContain('Main deck for this game (as I sideboarded it): 40 cards, 18 lands');
    expect(p).toContain("Other cards: Garruk's Companion ×21, Giant Growth");
    const opp = p.slice(p.indexOf('## OPPONENT'), p.indexOf('# Card text'));
    expect(opp).not.toMatch(/Hand \(|revealed/);
  });

  it('falls back to the deck name and size from the header when there was no sideboarding', () => {
    const p = benchCase('playdraw-auto2026-coin-toss').appPrompt.user;
    expect(p).toContain('# My deck\npacho-shield — 40 cards');
    expect(p).toContain('Should I play or draw');
  });

  it('keeps the keep-or-mulligan question once the hand is dealt', () => {
    const p = benchCase('mulligan-comfort13-two-lands-on-draw').appPrompt.user;
    expect(p).toContain('Should I keep it or mulligan?');
    expect(p).not.toContain('# My deck');
  });
});

// ---------------------------------------------------------------------------
// 3. A target in your own main phase

describe('picking a target in your own main phase', () => {
  it('is a target input only when the prompt says target and ids are selectable', () => {
    const base = { focusCardId: 5, focusCard: null, buttons: { ok: { label: 'OK', enabled: true }, cancel: { label: 'End Turn', enabled: true } }, highlighted: [], weak: [], openZones: [] };
    const sel = { cardIds: [12, 65, 63], min: 1, max: 1, mode: 'cards' as const };
    expect(isTargetInput({ ...base, prompt: 'Quantum Reduction (5) - Quantum Reduction\n\nSelect target creature', selectable: sel } as InputBody)).toBe(true);
    // A transient mix: the priority prompt with the next input's selectable set.
    expect(isTargetInput({ ...base, prompt: 'Priority: Human\nTurn: 5 (Human)\nPhase: Main phase, precombat\nStack: Empty', selectable: sel } as InputBody)).toBe(false);
    expect(isTargetInput({ ...base, prompt: 'Select target creature', selectable: { ...sel, cardIds: [], mode: 'none' } } as InputBody)).toBe(false);
  });

  it('makes the live moment a choice about the target, not "what should I do this turn?"', () => {
    const l = log(AUTO2026);
    const m = liveMoment(l, 318);
    expect(liveKind(m.state!, m.input, m.ask, l.seat)).toBe('choice');
    const d = liveDecision({ ...m, seat: l.seat }, cards)!;
    expect(d.label).toBe('R3 · Your main 1');
    const p = buildCoachPrompt(m.log, d, cards).user;
    expect(p).toContain('Choosing a target for: Quantum Reduction #5');
    expect(p).toContain('Legal targets (the engine accepts only these; choose 1):');
    expect(p).toContain('  - Bold Biochemist #12 · 1/3 · Creature - Human Scientist · yours');
    expect(p).toContain("  - Ant-Man's Air Force #63 · 2/1 · Creature - Insect · SUMMONING SICK · Forge AI's");
    expect(p).toContain('The engine wants me to choose a target for Quantum Reduction #5.');
    expect(p).not.toContain('What should I do this turn');
    // The spell's own text is there to judge the targets by.
    expect(p).toContain('Quantum Reduction {');
  });

  it('asks about the target for a trigger too, naming the ability', () => {
    const p = benchCase('target-auto2026-seismic-takedown').appPrompt.user;
    expect(p).toContain('Choosing a target for: Quake, Agent of S.H.I.E.L.D. #31 — Seismic Takedown');
    expect(p).toContain('choose a target for Quake, Agent of S.H.I.E.L.D. #31 — Seismic Takedown');
    expect(p).toContain("  - Giant-Sized Flying Ant #64 · 3/2 · Creature - Insect · SUMMONING SICK · Forge AI's");
  });
});

// ---------------------------------------------------------------------------
// Synthetic frames

function thrivingCard(id: number, name: string): Card {
  return {
    id,
    name,
    setCode: 'MSC',
    manaCost: null,
    types: 'Land',
    power: null,
    toughness: null,
    loyalty: null,
    damage: 0,
    counters: {},
    tapped: true,
    sick: false,
    attacking: false,
    blocking: false,
    faceDown: false,
    token: false,
    alt: null,
    attachedToId: null,
    attachmentIds: [],
    controller: 0,
    owner: 0,
    zone: 'battlefield',
    abilities: [],
  } as unknown as Card;
}

function stateWith(battlefield: Card[]): GameStateBody {
  const zone = (cards: Card[]) => ({ count: cards.length, cards });
  const player = (id: number, bf: Card[]) => ({
    id,
    name: id === 0 ? 'Human' : 'Forge AI',
    isAi: id !== 0,
    life: 20,
    poison: 0,
    counters: {},
    manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
    zones: { hand: zone([]), battlefield: zone(bf), graveyard: zone([]), exile: zone([]), command: zone([]), library: { count: 30, cards: [] } },
  });
  return { gameId: 'synth', turn: 3, round: 2, phase: 'MAIN1', activePlayer: 0, priority: 0, gameOver: null, players: [player(0, battlefield), player(1, [])], stack: [], events: [] } as unknown as GameStateBody;
}

const enter = (cardId: number) => ({ kind: 'zone', cardId, from: { zone: 'hand', player: 0 }, to: { zone: 'battlefield', player: 0 } });

function stateFrame(battlefield: Card[], events: object[]): LoggedFrame {
  return { type: 'state', dir: 's2c', body: { ...stateWith(battlefield), events } } as unknown as LoggedFrame;
}
function colorAsk(askId: string): LoggedFrame {
  const options = ['black', 'red', 'green', 'white'].map((label, id) => ({ id, label, kind: 'color' }));
  return { type: 'ask', dir: 's2c', body: { askId, kind: 'choose_list', prompt: 'Choose a color', options, preselected: [], min: 1, max: 1, reveal: false } } as unknown as LoggedFrame;
}
function answer(askId: string, value: unknown): LoggedFrame {
  return { type: 'answer', dir: 'c2s', body: { askId, value } } as unknown as LoggedFrame;
}
function synthLog(frames: LoggedFrame[]): GameLog {
  return { header: null, frames, hello: null, over: null, seat: 0 } as unknown as GameLog;
}

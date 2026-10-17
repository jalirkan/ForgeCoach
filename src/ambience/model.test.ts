/*
 * ForgeCoach — ambience/model.test.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { parseLog } from '../log.ts';
import type { AnyCard, Card } from '../protocol.ts';
import { SceneryTracker, biomeWeights, dualPairs, dualsOf, landBiomes, landPair, sceneryFromLog, slotsOf, stageFor, stepScenery } from './model.ts';
import { chosenColors } from '../state.ts';
import type { CardInfo } from '../cards.ts';
import { simCard, simLog, simState, type SimPlay } from './sim.ts';

const land = (id: number, name: string, types: string, extra: Partial<Card> = {}) => simCard(id, 1, name, types, extra);

const seq: SimPlay[] = [
  { kind: 'land', player: 1, name: 'Island' },
  { kind: 'land', player: 2, name: 'Forest' },
  { kind: 'land', player: 1, name: 'Island' },
  { kind: 'land', player: 1, name: 'Swamp' },
  { kind: 'land', player: 2, name: 'Plains' },
  { kind: 'land', player: 1, name: 'Island' },
  { kind: 'land', player: 1, name: 'Mountain' },
];

describe('landBiomes', () => {
  it('reads basic land types, splitting duals and triomes evenly', () => {
    expect(landBiomes(land(1, 'Island', 'Basic Land - Island'))).toEqual({ island: 1 });
    expect(landBiomes(land(2, 'Watery Grave', 'Land - Island Swamp'))).toEqual({ island: 0.5, swamp: 0.5 });
    const tri = landBiomes(land(3, 'Ketria Triome', 'Land - Forest Island Mountain'))!;
    expect(Object.keys(tri).sort()).toEqual(['forest', 'island', 'mountain']);
    expect(Object.values(tri).reduce((a, b) => a + b, 0)).toBeCloseTo(1);
    expect(landBiomes(land(4, 'Wastes', 'Basic Land - Wastes'))).toEqual({ wastes: 1 });
  });

  it('falls back to the colours a nonbasic taps for, then to wastes', () => {
    const ab = (text: string) => [{ id: 1, text, canPlay: false, isSpell: false }];
    expect(landBiomes(land(5, 'Karplusan Forest', 'Land', { abilities: ab('{T}: Add {R} or {G}. Karplusan Forest deals 1 damage to you.') }))).toEqual({ mountain: 0.5, forest: 0.5 });
    // A Thriving land with no card data and no recorded choice: its fixed colour (it went to wastes before 2026-10-16).
    expect(landBiomes(land(6, 'Thriving Isle', 'Land'))).toEqual({ island: 1 });
    expect(landBiomes(land(7, 'City of Brass', 'Land', { abilities: ab('{T}: Add one mana of any color.') }))).toEqual({ wastes: 1 });
    expect(landBiomes(land(8, 'Ancient Tomb', 'Land', { abilities: ab('{T}: Add {C}{C}.') }))).toEqual({ wastes: 1 });
    const cards = new Map([['Hallowed Fountain X', { name: 'Hallowed Fountain X', found: true, manaCost: '', typeLine: 'Land', oracleText: '', producedMana: ['W', 'U'], colors: [] }]]);
    expect(landBiomes(land(9, 'Hallowed Fountain X', 'Land'), cards)).toEqual({ plains: 0.5, island: 0.5 });
  });

  it('never classifies hidden, face-down or non-land cards', () => {
    const hidden = { id: 9, zone: 'battlefield', controller: 1, owner: 1, hidden: true } as AnyCard;
    expect(landBiomes(hidden)).toBeNull();
    expect(landBiomes(land(10, '', 'Creature', { faceDown: true }))).toBeNull();
    expect(landBiomes(land(11, 'Bear', 'Creature - Bear'))).toBeNull();
    expect(landBiomes(land(12, 'Dryad Arbor', 'Land Creature - Forest Dryad'))).toEqual({ forest: 1 });
  });
});

describe('two-colour lands count by the colours they produce (spec 1.9)', () => {
  const info = (name: string, producedMana: string[], oracleText: string, typeLine = 'Land'): [string, CardInfo] => [name, { name, found: true, manaCost: '', typeLine, oracleText, producedMana, colors: [] }];
  // Scryfall's own data for these (oracle-cards, 2026-10-09): a Thriving land's produced_mana lists all five colours.
  const cards = new Map<string, CardInfo>([
    info('Thriving Heath', ['B', 'G', 'R', 'U', 'W'], 'This land enters tapped. As it enters, choose a color other than white.\n{T}: Add {W} or one mana of the chosen color.'),
    info('Hengegate Pathway', ['U', 'W'], '{T}: Add {W}.\n//\n{T}: Add {U}.', 'Land // Land'),
    info('Hallowed Fountain', ['U', 'W'], '({T}: Add {W} or {U}.)\nAs this land enters, you may pay 2 life.', 'Land — Plains Island'),
    info('Polluted Delta', [], '{T}, Pay 1 life, Sacrifice this land: Search your library for an Island or Swamp card, put it onto the battlefield, then shuffle.'),
    info('Karplusan Forest', ['C', 'G', 'R'], '{T}: Add {C}.\n{T}: Add {R} or {G}. This land deals 1 damage to you.'),
    info('Island', ['U'], '({T}: Add {U}.)', 'Basic Land — Island'),
  ]);
  const heath = land(20, 'Thriving Heath', 'Land');

  it('a Thriving land: its fixed colour and the chosen one, ½ / ½ and a dual of that pair, once the seat’s choice is known', () => {
    const chosen = new Map([[20, 'U']]);
    expect(landBiomes(heath, cards, chosen)).toEqual({ plains: 0.5, island: 0.5 });
    expect(landPair(landBiomes(heath, cards, chosen))).toBe('island+plains');
    expect(landBiomes(heath, undefined, chosen)).toEqual({ plains: 0.5, island: 0.5 }); // no card data: Forge's name tells the fixed colour
    // A choice of its own colour (Forge does not allow it) is still one colour.
    expect(landBiomes(heath, cards, new Map([[20, 'W']]))).toEqual({ plains: 1 });
  });
  it('a Thriving land whose choice is unknown (an opponent’s, or before the answer): its fixed colour — before 1.9, with card data, wastes', () => {
    expect(landBiomes(heath, cards)).toEqual({ plains: 1 });
    expect(landBiomes(heath)).toEqual({ plains: 1 });
    expect(landBiomes(heath, cards, new Map([[99, 'U']]))).toEqual({ plains: 1 });
  });
  it('a Pathway: ½ / ½ from its card data (both faces’ colours), wastes with none — unchanged', () => {
    expect(landBiomes(land(21, 'Hengegate Pathway', 'Land'), cards)).toEqual({ plains: 0.5, island: 0.5 });
    expect(landPair(landBiomes(land(21, 'Hengegate Pathway', 'Land'), cards))).toBe('island+plains');
    expect(landBiomes(land(21, 'Hengegate Pathway', 'Land'))).toEqual({ wastes: 1 });
  });
  it('a shock and a painland: ½ / ½ (by its types, or its two colours with the colourless left out) — unchanged', () => {
    expect(landBiomes(land(22, 'Hallowed Fountain', 'Land - Plains Island'), cards)).toEqual({ plains: 0.5, island: 0.5 });
    expect(landBiomes(land(22, 'Hallowed Fountain', 'Land - Plains Island'))).toEqual({ plains: 0.5, island: 0.5 });
    expect(landBiomes(land(23, 'Karplusan Forest', 'Land'), cards)).toEqual({ mountain: 0.5, forest: 0.5 });
  });
  it('a fetch land makes no mana: wastes, with card data or without — today’s rule, kept', () => {
    expect(landBiomes(land(24, 'Polluted Delta', 'Land'), cards)).toEqual({ wastes: 1 });
    expect(landBiomes(land(24, 'Polluted Delta', 'Land'))).toEqual({ wastes: 1 });
  });
  it('basics and mono lands: unchanged', () => {
    expect(landBiomes(land(25, 'Island', 'Basic Land - Island'), cards, new Map([[25, 'B']]))).toEqual({ island: 1 });
    const ab = (text: string) => [{ id: 1, text, canPlay: false, isSpell: false }];
    expect(landBiomes(land(26, 'Mono Land', 'Land', { abilities: ab('{T}: Add {R}.') }))).toEqual({ mountain: 1 });
  });
  it('the side counts the Thriving land as a dual of its pair (the band and the bridge widen by it)', () => {
    const st = simState(new Map([[1, [land(1, 'Plains', 'Basic Land - Plains'), land(2, 'Island', 'Basic Land - Island'), heath, land(22, 'Hallowed Fountain', 'Land - Plains Island')]]]), [], 1);
    const chosen = new Map([[20, 'U']]);
    expect(dualPairs(st, 1, cards, chosen)).toEqual({ 'island+plains': 2 });
    expect(dualPairs(st, 1, cards)).toEqual({ 'island+plains': 1 });
    expect(biomeWeights(st, 1, cards, chosen)).toEqual({ plains: 2, island: 2 });
    const sc = stepScenery(null, st, { cards, chosen });
    expect(dualsOf(sc, 1)).toEqual({ 'island+plains': 2 });
    // The tracker takes a new choice without starting over: the next state counts it.
    const t = new SceneryTracker({ cards });
    const log = { ...simLog([]), frames: [{ type: 'state', body: st }] } as unknown as Parameters<SceneryTracker['at']>[0];
    expect(dualsOf(t.at(log, 0), 1)).toEqual({ 'island+plains': 1 });
    t.setChosen(chosen);
    const log2 = { ...log, frames: [...log.frames, { type: 'state', body: st }] } as typeof log;
    expect(dualsOf(t.at(log2, 1), 1)).toEqual({ 'island+plains': 2 });
  });
  it('a recorded game: the seat’s Thriving Isle (black chosen) counts ½ island, ½ swamp once its answer is in the log', () => {
    const log = parseLog(gunzipSync(readFileSync(new URL('../../public/samples/human-auto-42.jsonl.gz', import.meta.url))).toString('utf8'));
    const chosen = chosenColors(log, Infinity, log.seat);
    expect([...chosen]).toEqual([[9, 'B']]);
    const isle = (s: ReturnType<typeof sceneryFromLog>) => dualsOf(s, log.seat)['island+swamp'] ?? 0;
    expect(isle(sceneryFromLog(log, Infinity))).toBe(0);
    const withChoice = sceneryFromLog(log, Infinity, { chosen });
    expect(isle(withChoice)).toBeGreaterThanOrEqual(1);
    expect(slotsOf(withChoice, log.seat).map((s) => s.biome)).toContain('swamp');
  });
});

describe('stages', () => {
  it('maps weights to 1 / 2–3 / 4–5 / 6+', () => {
    expect([0, 0.5, 1, 2, 3, 4, 5, 6, 9].map((w) => stageFor(w))).toEqual([0, 1, 1, 2, 2, 3, 3, 4, 4]);
  });
  it('takes custom thresholds', () => {
    expect([1, 2, 3].map((w) => stageFor(w, [1, 3]))).toEqual([1, 1, 2]);
  });
});

describe('scenery from a log', () => {
  it('orders slots by first appearance, per player, and grows stages', () => {
    const s = sceneryFromLog(simLog(seq), Infinity);
    expect(slotsOf(s, 1).map((x) => [x.biome, x.index, x.weight, x.stage])).toEqual([
      ['island', 0, 3, 2],
      ['swamp', 1, 1, 1],
      ['mountain', 2, 1, 1],
    ]);
    expect(slotsOf(s, 2).map((x) => x.biome)).toEqual(['forest', 'plains']);
  });

  it('keeps a slot (at stage 0) after its lands leave', () => {
    const log = simLog(seq.slice(0, 4));
    const before = sceneryFromLog(log, Infinity);
    const last = log.frames.at(-1)!.body as ReturnType<typeof simState>;
    const p1 = last.players[0]!;
    const emptied = { ...last, players: [{ ...p1, zones: { ...p1.zones, battlefield: { count: 1, cards: p1.zones.battlefield.cards.filter((c) => (c as Card).name === 'Swamp') } } }, last.players[1]!] };
    const after = stepScenery(before, emptied);
    expect(slotsOf(after, 1).map((x) => [x.biome, x.stage, x.peak])).toEqual([
      ['island', 0, 2],
      ['swamp', 1, 1],
    ]);
  });

  it('is empty for a state with no lands', () => {
    const s = stepScenery(null, simState(new Map(), [], 1));
    expect(s.players.map((p) => p.slots)).toEqual([[], []]);
    expect(biomeWeights(simState(new Map(), [], 1), 1)).toEqual({});
    expect(slotsOf(s, 99)).toEqual([]);
  });

  it('orders biomes that arrive in the same state by battlefield order', () => {
    const st = simState(new Map([[1, [land(1, 'Forest', 'Basic Land - Forest'), land(2, 'Watery Grave', 'Land - Island Swamp')]]]), [], 1);
    expect(slotsOf(stepScenery(null, st), 1).map((x) => [x.biome, x.weight])).toEqual([
      ['forest', 1],
      ['island', 0.5],
      ['swamp', 0.5],
    ]);
  });

  it('the tracker matches a fresh reduce, forwards and after a jump back', () => {
    const log = simLog(seq);
    const t = new SceneryTracker();
    for (let i = 0; i < log.frames.length; i++) expect(t.at(log, i)).toEqual(sceneryFromLog(log, i));
    expect(t.at(log, 2)).toEqual(sceneryFromLog(log, 2));
    expect(t.previous().scenery).toEqual(sceneryFromLog(log, 1));
  });

  it('a live seat’s snapshots (a new log object each frame, the same frames) are followed, not started over (J109)', () => {
    const full = parseLog(gunzipSync(readFileSync(new URL('../../public/samples/human-auto-42.jsonl.gz', import.meta.url))).toString('utf8'));
    const t = new SceneryTracker();
    for (let k = 0; k < full.frames.length; k++) {
      const snap = { ...full, frames: full.frames.slice(0, k + 1) };
      const got = t.at(snap, k);
      // Only the frame that came: a tracker that started over would list up to MAX_TRACKED_STEPS steps.
      if (full.frames[k]!.type === 'state') expect(t.steps().map((s) => s.frameIndex)).toEqual([k]);
      if (k % 97 === 0) expect(got).toEqual(sceneryFromLog(full, k));
    }
    expect(t.at({ ...full, frames: full.frames.slice() }, full.frames.length - 1)).toEqual(sceneryFromLog(full, Infinity));
    // Another game (its own first frame): from the start.
    const other = simLog(seq);
    expect(t.at(other, other.frames.length - 1)).toEqual(sceneryFromLog(other, Infinity));
  });

  it('reads a recorded game: only the viewer-visible battlefield, slots stable', () => {
    const log = parseLog(gunzipSync(readFileSync(new URL('../../public/samples/human-auto-42.jsonl.gz', import.meta.url))).toString('utf8'));
    const t = new SceneryTracker();
    let prevOrder: string[] = [];
    for (let i = 0; i < log.frames.length; i += 7) {
      const order = slotsOf(t.at(log, i), log.seat).map((s) => s.biome);
      expect(order.slice(0, prevOrder.length)).toEqual(prevOrder);
      prevOrder = order;
    }
    const end = sceneryFromLog(log, Infinity);
    expect(end.players.length).toBe(2);
    expect(end.players.some((p) => p.slots.length > 0)).toBe(true);
  });
});

describe('slotLayout', () => {
  it('keeps arrival order and widens richer scenes', async () => {
    const { slotLayout } = await import('./layout.ts');
    const s = sceneryFromLog(simLog(seq), Infinity);
    const l = slotLayout(slotsOf(s, 1), null);
    expect(l.map((x) => x.slot.biome)).toEqual(['island', 'swamp', 'mountain']);
    expect(l[0]!.grow).toBeGreaterThan(l[1]!.grow);
    expect(slotLayout(slotsOf(s, 1), null, 4).map((x) => x.stage)).toEqual([4, 4, 4]);
  });
  it('orders by preference when the pack asks', async () => {
    const { slotLayout } = await import('./layout.ts');
    const { validateManifest } = await import('./manifest.ts');
    const layer = [{ layers: [{ id: 'a', kind: 'image', src: 'a.webp' }] }];
    const pack = validateManifest(
      { schema: 1, strip: { order: 'preference' }, biomes: { island: { slot: { prefer: 'right' }, stages: layer }, mountain: { slot: { prefer: 'left' }, stages: layer } } },
      'http://x.test/',
    ).pack;
    const s = sceneryFromLog(simLog(seq), Infinity);
    expect(slotLayout(slotsOf(s, 1), pack).map((x) => x.slot.biome)).toEqual(['mountain', 'swamp', 'island']);
  });
});

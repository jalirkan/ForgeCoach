/*
 * ForgeCoach — ambience/model.test.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';
import { parseLog } from '../log.ts';
import type { AnyCard, Card } from '../protocol.ts';
import { SceneryTracker, biomeWeights, dualPairs, dualsOf, landBiomes, landPair, sceneryFromLog, slotsOf, stageFor, stepScenery } from './model.ts';
import { chosenColors } from '../state.ts';
import { mapScryfallCard, type CardInfo } from '../cards.ts';
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
    // Spec 1.11: the basic Wastes makes no coloured mana, so it draws nothing (it was the built-in wastes scene).
    expect(landBiomes(land(4, 'Wastes', 'Basic Land - Wastes'))).toBeNull();
  });

  it('falls back to the colours a nonbasic taps for, then to nothing (spec 1.11)', () => {
    const ab = (text: string) => [{ id: 1, text, canPlay: false, isSpell: false }];
    expect(landBiomes(land(5, 'Karplusan Forest', 'Land', { abilities: ab('{T}: Add {R} or {G}. Karplusan Forest deals 1 damage to you.') }))).toEqual({ mountain: 0.5, forest: 0.5 });
    // A Thriving land with no card data and no recorded choice: its fixed colour (it went to wastes before 2026-10-16).
    expect(landBiomes(land(6, 'Thriving Isle', 'Land'))).toEqual({ island: 1 });
    expect(landBiomes(land(7, 'City of Brass', 'Land', { abilities: ab('{T}: Add one mana of any color.') }))).toBeNull();
    expect(landBiomes(land(8, 'Ancient Tomb', 'Land', { abilities: ab('{T}: Add {C}{C}.') }))).toBeNull();
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
  it('a Pathway: the face in play only, one colour and not a dual (spec 1.11; 1.9 counted both faces ½ / ½); nothing with no data', () => {
    const hengegate: CardInfo = { ...cards.get('Hengegate Pathway')!, faces: [
      { name: 'Hengegate Pathway', manaCost: '', typeLine: 'Land', oracleText: '{T}: Add {W}.' },
      { name: 'Mistgate Pathway', manaCost: '', typeLine: 'Land', oracleText: '{T}: Add {U}.' },
    ] };
    const withFaces = new Map([...cards, ['Hengegate Pathway', hengegate], ['Mistgate Pathway', { ...hengegate, name: 'Mistgate Pathway' }]]);
    expect(landBiomes(land(21, 'Hengegate Pathway', 'Land'), withFaces)).toEqual({ plains: 1 });
    expect(landBiomes(land(21, 'Mistgate Pathway', 'Land'), withFaces)).toEqual({ island: 1 });
    expect(landPair(landBiomes(land(21, 'Hengegate Pathway', 'Land'), withFaces))).toBeNull();
    expect(landBiomes(land(21, 'Hengegate Pathway', 'Land'))).toBeNull();
  });
  it('a shock and a painland: ½ / ½ (by its types, or its two colours with the colourless left out) — unchanged', () => {
    expect(landBiomes(land(22, 'Hallowed Fountain', 'Land - Plains Island'), cards)).toEqual({ plains: 0.5, island: 0.5 });
    expect(landBiomes(land(22, 'Hallowed Fountain', 'Land - Plains Island'))).toEqual({ plains: 0.5, island: 0.5 });
    expect(landBiomes(land(23, 'Karplusan Forest', 'Land'), cards)).toEqual({ mountain: 0.5, forest: 0.5 });
  });
  it('a fetch land makes no coloured mana: nothing, with card data or without (spec 1.11; it was wastes)', () => {
    expect(landBiomes(land(24, 'Polluted Delta', 'Land'), cards)).toBeNull();
    expect(landBiomes(land(24, 'Polluted Delta', 'Land'))).toBeNull();
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

describe('spec 1.11: lands that make no coloured mana draw nothing; three colours in thirds; Pathways by face', () => {
  // Scryfall's oracle-cards data for the audit's examples (lands-audit.csv, 2026-10-19), trimmed to the fields the board reads.
  const raw = JSON.parse(readFileSync(new URL('./testdata/lands-1.11.scryfall.json', import.meta.url), 'utf8')) as { name: string; card_faces?: { name: string }[] }[];
  /** The board's card map: keyed by the name Forge sends (a Pathway's face in play), as `cards.ts` caches it. */
  const cards = new Map<string, CardInfo>();
  for (const sc of raw) for (const n of [sc.name, ...(sc.card_faces ?? []).map((f) => f.name)]) if (!n.includes(' // ')) cards.set(n, mapScryfallCard(n, sc as Parameters<typeof mapScryfallCard>[1]));
  const wire = (id: number, name: string, types = 'Land') => land(id, name, types); // abilities: [] — the wire never carries a land's mana ability

  it('a land that makes no coloured mana is not scenery: the fetch lands, colourless lands, Urza’s Saga, the basic Wastes', () => {
    expect(landBiomes(wire(30, 'Arid Mesa'), cards)).toBeNull();
    expect(landBiomes(wire(31, 'Prismatic Vista'), cards)).toBeNull();
    expect(landBiomes(wire(32, 'Ancient Tomb'), cards)).toBeNull();
    expect(landBiomes(wire(33, 'Mutavault'), cards)).toBeNull();
    expect(landBiomes(wire(34, "Urza's Saga", "Enchantment Land - Urza's Saga"), cards)).toBeNull();
    expect(landBiomes(wire(35, 'Wastes', 'Basic Land - Wastes'), cards)).toBeNull();
  });
  it('an any-colour land says nothing about the deck: City of Brass, Exotic Orchard', () => {
    expect(landBiomes(wire(36, 'City of Brass'), cards)).toBeNull();
    expect(landBiomes(wire(37, 'Exotic Orchard'), cards)).toBeNull();
  });
  it('a fixed three-colour land splits into thirds, as a Triome does', () => {
    const citadel = landBiomes(wire(38, 'Seaside Citadel'), cards)!;
    const triome = landBiomes(wire(39, 'Zagoth Triome', 'Land - Swamp Mountain Forest'), cards)!;
    expect(Object.keys(citadel).sort()).toEqual(['forest', 'island', 'plains']);
    expect(Object.keys(triome).sort()).toEqual(['forest', 'mountain', 'swamp']);
    for (const w of [citadel, triome]) for (const v of Object.values(w)) expect(v).toBeCloseTo(1 / 3);
    expect(landPair(citadel)).toBeNull();
  });
  it('a Pathway counts as the face in play: Blightstep is swamp, Searstep (its back) mountain, neither a dual', () => {
    expect(landBiomes(wire(40, 'Blightstep Pathway'), cards)).toEqual({ swamp: 1 });
    expect(landBiomes(wire(41, 'Searstep Pathway'), cards)).toEqual({ mountain: 1 });
    const st = simState(new Map([[1, [wire(40, 'Blightstep Pathway'), wire(41, 'Searstep Pathway')]]]), [], 1);
    expect(dualPairs(st, 1, cards)).toEqual({});
    expect(biomeWeights(st, 1, cards)).toEqual({ swamp: 1, mountain: 1 });
  });
  it('unchanged: Bayou ½ / ½ and a dual; a Thriving land its fixed colour, then ½ / ½ with the seat’s choice', () => {
    expect(landBiomes(wire(42, 'Bayou', 'Land - Swamp Forest'), cards)).toEqual({ swamp: 0.5, forest: 0.5 });
    expect(landPair(landBiomes(wire(42, 'Bayou', 'Land - Swamp Forest'), cards))).toBe('forest+swamp');
    expect(landBiomes(wire(43, 'Thriving Isle'), cards)).toEqual({ island: 1 });
    expect(landBiomes(wire(43, 'Thriving Isle'), cards, new Map([[43, 'R']]))).toEqual({ island: 0.5, mountain: 0.5 });
  });
  it('a card with no data draws nothing (quiet, not the coded default), and says so once per card in dev', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    try {
      expect(landBiomes(wire(44, 'Seaside Citadel'))).toBeNull();
      expect(landBiomes(wire(45, 'Seaside Citadel'), new Map())).toBeNull();
      expect(landBiomes(wire(46, 'Arid Mesa'))).toBeNull();
      const said = info.mock.calls.map((c) => String(c[0]));
      expect(said.filter((m) => m.includes('"Seaside Citadel"'))).toHaveLength(1);
      expect(said.filter((m) => m.includes('"Arid Mesa"'))).toHaveLength(1);
      // A land with data that makes no coloured mana is a rule, not missing data: no word.
      info.mockClear();
      expect(landBiomes(wire(47, 'Ancient Tomb'), cards)).toBeNull();
      expect(info).not.toHaveBeenCalled();
    } finally {
      info.mockRestore();
    }
  });
  it('a fetch land opens no slot; the land it fetches claims one (the 10-17 friend game: no wastes, no withered sliver)', () => {
    const mesa = wire(50, 'Arid Mesa');
    const plateau = wire(51, 'Plateau', 'Land - Mountain Plains');
    const island = wire(52, 'Island', 'Basic Land - Island');
    const s1 = stepScenery(null, simState(new Map([[1, [island, mesa]]]), [], 1), { cards });
    expect(slotsOf(s1, 1).map((x) => x.biome)).toEqual(['island']);
    const s2 = stepScenery(s1, simState(new Map([[1, [island, plateau]]]), [], 1), { cards });
    expect(slotsOf(s2, 1).map((x) => [x.biome, x.weight])).toEqual([['island', 1], ['mountain', 0.5], ['plains', 0.5]]);
    // Without card data the Mesa waits too: nothing to clear when the data arrives.
    expect(slotsOf(stepScenery(null, simState(new Map([[1, [mesa]]]), [], 1)), 1)).toEqual([]);
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

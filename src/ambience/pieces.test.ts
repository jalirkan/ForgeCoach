/*
 * ForgeCoach — ambience/pieces.test.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Spec 1.14's planner (pc-results scenery/SYSTEM.md, section A) and the
 * pieces' placement: the worked example (Evan's half in the friend game of
 * 2026-10-17, as spec 1.19 b amends it: the pair is kept as the base), the
 * tie rule, the stack of every further colour (spec 1.19 a), landmarks,
 * veils, fronts, and a landmark standing on pack-v9.1's measured horizon.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { GameStateBody } from '../protocol.ts';
import { validateManifest } from './manifest.ts';
import { halfLayout, HORIZON_AT } from './layout.ts';
import { stepScenery, slotsOf, type SlotState } from './model.ts';
import { FORGECOACH_PACK_URL } from './prefs.ts';
import { frontFor, heaviestPair, horizonAt, landNamesOf, makeupFromSlots, makeupOf, pairStageOf, panelGround, piecePlacement, planHalf, stackElements, stackRegion, WHOLE, type HalfPlan } from './pieces.ts';

let nextId = 1;
const land = (name: string, types: string) => ({ id: String(nextId++), name, types, tapped: false, abilities: [] });
const stateWith = (cards: object[]): GameStateBody => ({ turn: 1, players: [{ id: 1, life: 20, zones: { battlefield: { cards } } }] }) as unknown as GameStateBody;

describe('makeup and the heaviest pair', () => {
  it('keeps arrival order and drops colours at zero', () => {
    const m = makeupOf({ W: 1.5, U: 0, R: 0.5 }, ['R', 'W', 'U']);
    expect(m).toEqual({ colours: ['R', 'W'], weights: { R: 0.5, W: 1.5 }, total: 2 });
  });
  it('a tie keeps the pair on screen, else the colours that arrived first', () => {
    const m = makeupOf({ W: 2, U: 1, R: 1 }, ['W', 'U', 'R']);
    expect(heaviestPair(m)).toEqual(['U', 'W']);
    expect(heaviestPair(m, ['R', 'W'])).toEqual(['R', 'W']);
  });
  it('pair stages by the half’s coloured lands', () => {
    expect([0, 0.5, 2, 3, 4, 5, 9].map(pairStageOf)).toEqual([0, 1, 1, 2, 2, 3, 3]);
  });
});

describe('the worked example: Evan’s half, 2026-10-17', () => {
  // Lands come in order; the scenery reducer counts them as the board does.
  const turns: [string, object[]][] = [];
  const mesa = land('Arid Mesa', 'Land');
  const plateau = land('Plateau', 'Land — Mountain Plains');
  const plains = land('Plains', 'Basic Land — Plains');
  const island = land('Island', 'Basic Land — Island');
  const tundra = land('Tundra', 'Land — Plains Island');
  turns.push(['T2', [mesa]], ['T3', [plateau]], ['T4', [plateau, plains]], ['T8', [plateau, plains, island]], ['T10', [plateau, plains, island, tundra]]);
  const plans: Record<string, HalfPlan> = {};
  let scenery = null as ReturnType<typeof stepScenery> | null;
  let prev: HalfPlan | null = null;
  const fronts: Record<string, ReturnType<typeof frontFor>> = {};
  for (const [t, cards] of turns) {
    scenery = stepScenery(scenery, stateWith(cards));
    const plan = planHalf({ makeup: makeupFromSlots(slotsOf(scenery, 1)), prevPair: prev?.pair });
    fronts[t] = frontFor(prev, plan);
    plans[t] = plan;
    prev = plan;
  }
  it('T2: a fetch alone is the empty table', () => {
    expect(plans.T2!.empty).toBe(true);
  });
  it('T3: Plateau is mountain+plains at stage 1, split 0.5, and the mist dissolves', () => {
    expect(plans.T3).toMatchObject({ pair: ['R', 'W'], split: 0.5, pairStage: 1, element: null });
    expect(fronts.T3).toEqual({ dissolve: true });
  });
  it('T4: a Plains pans to the plains (0.25)', () => {
    expect(plans.T4).toMatchObject({ pair: ['R', 'W'], split: 0.25, pairStage: 1 });
    expect(fronts.T4).toBeNull();
  });
  // Spec 1.19 b (2026-11-02): SYSTEM.md's table re-keyed to island+plains here (2.5 outweighs 2.0); the pair showing
  // now stays the base while both its colours are among the three heaviest, so the Island joins as the element.
  it('T8: an Island joins mountain+plains as its element at stage 2 (spec 1.19 b: no re-key), blue’s front plays', () => {
    expect(plans.T8).toMatchObject({ pair: ['R', 'W'], split: 0.25, pairStage: 2 });
    expect(plans.T8!.element).toMatchObject({ colour: 'U', opacity: 1 });
    expect(plans.T8!.extras).toEqual([]);
    expect(fronts.T8).toEqual({ colour: 'U', reverse: false });
  });
  it('T10: Tundra pans further to the plains (mountain 0.25 → 0.2), the island fully in, no front', () => {
    expect(plans.T10).toMatchObject({ pair: ['R', 'W'], split: 0.2, pairStage: 2 });
    expect(plans.T10!.element).toMatchObject({ colour: 'U', opacity: 1 });
    expect(fronts.T10).toBeNull();
  });
});

describe('every colour visible (spec 1.19 a), landmarks, veils and fronts', () => {
  it('four colours: the pair, the third the element, the fourth a cut-out, each faded by its share', () => {
    const p = planHalf({ makeup: makeupOf({ W: 3, U: 2, B: 1, G: 0.5 }, ['W', 'U', 'B', 'G']) });
    expect(p.pair).toEqual(['U', 'W']);
    // 4 × 1 / 6.5 and 4 × 0.5 / 6.5.
    expect(p.element).toMatchObject({ colour: 'B', opacity: 0.615 });
    expect(p.extras).toEqual([{ colour: 'G', opacity: 0.308 }]);
  });
  it('the stack: the heavier pair colour’s ground holds two (the third and the fourth), the lighter’s the fifth; the heaviest at the outer edge', () => {
    // W heavier (left: it arrived first), U lighter (right); B third, R and G extras.
    const p = planHalf({ makeup: makeupOf({ W: 3, U: 2, B: 1.5, R: 1, G: 0.5 }, ['W', 'U', 'B', 'R', 'G']) });
    expect([p.pair, p.element?.side, p.lighterSide]).toEqual([['U', 'W'], 'left', 'right']);
    const cut = stackElements(p, 'cut', () => true);
    expect(cut.map((e) => [e.colour, e.ground, e.side, e.slot, e.of, e.opacity])).toEqual([
      ['B', 'heavier', 'left', 0, 2, 0.938],
      ['R', 'heavier', 'left', 1, 2, 0.625],
      ['G', 'lighter', 'right', 0, 1, 0.313],
    ]);
    // A painted third keeps its place (no cut-out drawn); a third with its own panel is not on a ground at all.
    expect(stackElements(p, 'painted', () => true).map((e) => [e.colour, e.cut, e.ground, e.slot])).toEqual([
      ['B', false, 'heavier', 0],
      ['R', true, 'heavier', 1],
      ['G', true, 'lighter', 0],
    ]);
    expect(stackElements(p, null, () => true).map((e) => [e.colour, e.ground, e.slot, e.of])).toEqual([
      ['R', 'heavier', 0, 2],
      ['G', 'heavier', 1, 2],
    ]);
    // A colour the pack has no cut-out for at this shape takes no place.
    expect(stackElements(p, 'cut', (c) => c !== 'R').map((e) => e.colour)).toEqual(['B', 'G']);
    // Side by side on the ground, the first at the half's outer edge.
    expect(stackRegion({ left: 0, width: 0.4 }, { side: 'left', slot: 0, of: 2 })).toEqual({ left: 0, width: 0.2 });
    expect(stackRegion({ left: 0, width: 0.4 }, { side: 'left', slot: 1, of: 2 })).toEqual({ left: 0.2, width: 0.2 });
    expect(stackRegion({ left: 0.6, width: 0.4 }, { side: 'right', slot: 0, of: 2 })).toEqual({ left: 0.8, width: 0.2 });
  });
  it('a panel as a ground (the board without the flag): its span less the seam where it meets another panel', () => {
    const slot = (biome: SlotState['biome'], index: number, weight: number): SlotState => ({ biome, index, weight, stage: 1, progress: 0, peak: 1 });
    const layout = halfLayout([slot('plains', 0, 2), slot('island', 1, 1), slot('swamp', 2, 1)], null);
    expect(layout.map((l) => l.share)).toEqual([0.5, 0.25, 0.25]);
    // Row of 1 + 2 × 0.1 split 0.5 : 0.25 : 0.25, seams overlapping: plains 0–0.6, island 0.5–0.8, swamp 0.7–1.
    expect(panelGround(layout, 'plains', 0.1)).toEqual({ left: 0, width: 0.5 });
    expect(panelGround(layout, 'island', 0.1)).toEqual({ left: 0.6, width: 0.1 });
    expect(panelGround(layout, 'swamp', 0.1)).toEqual({ left: 0.8, width: 0.2 });
    expect(panelGround(layout, 'forest', 0.1)).toBeNull();
  });
  it('landmarks: only names the pack has, one per name, the earliest two', () => {
    const p = planHalf({ makeup: makeupOf({}, []), landNames: ['City of Brass', 'Island', 'City of Brass', 'Exotic Orchard', 'Seaside Citadel'], landmarks: ['Seaside Citadel', 'Exotic Orchard', 'City of Brass'] });
    expect(p.landmarks).toEqual(['City of Brass', 'Exotic Orchard']);
    expect(p.empty).toBe(true);
  });
  it('reads only visible, face-up lands', () => {
    const st = stateWith([land('City of Brass', 'Land'), { id: 'h', hidden: true }, { ...land('Seaside Citadel', 'Land'), faceDown: true }]);
    expect(landNamesOf(st, 1)).toEqual(['City of Brass']);
  });
  it('a veil only once won or lost', () => {
    const m = makeupOf({ W: 1 }, ['W']);
    expect([null, 'won', 'lost', 'draw'].map((o) => planHalf({ makeup: m, outcome: o as never }).veil)).toEqual([null, 'won', 'lost', null]);
  });
  it('a colour leaving plays its front backwards; a re-key plays the colour that joined the pair', () => {
    const a = planHalf({ makeup: makeupOf({ W: 2, U: 1 }, ['W', 'U']) });
    const b = planHalf({ makeup: makeupOf({ W: 2 }, ['W']) });
    expect(frontFor(a, b)).toEqual({ colour: 'U', reverse: true });
    // Spec 1.19 b: a re-key only when a pair colour leaves the top three -- here the island, outweighed by three.
    const c = planHalf({ makeup: makeupOf({ W: 2, U: 1, R: 1, G: 0.5 }, ['W', 'U', 'R', 'G']) });
    const d = planHalf({ makeup: makeupOf({ W: 2, U: 1, R: 1.5, G: 1.5 }, ['W', 'U', 'R', 'G']), showing: c.pick });
    expect([c.pair, d.pair]).toEqual([['U', 'W'], ['R', 'W']]);
    expect(frontFor(c, d)).toEqual({ colour: 'R', reverse: false });
    expect(frontFor(null, d)).toBeNull();
    // A fourth colour arriving is on screen now (a cut-out): its front plays.
    const e = planHalf({ makeup: makeupOf({ W: 2, U: 1, R: 1, G: 0.5, B: 0.5 }, ['W', 'U', 'R', 'G', 'B']), showing: c.pick });
    expect(frontFor(c, e)).toEqual({ colour: 'B', reverse: false });
  });
});

describe('placement', () => {
  const box = { w: 1600, h: 500 };
  it('a horizon piece stands its foot on the horizon, raised by lift', () => {
    const f = piecePlacement({ sit: 'horizon', x: 0.5, w: 0.25, lift: 0.02 }, 2, WHOLE, box, 0.43);
    expect(f).toEqual({ left: 0.375, top: 0.01, width: 0.25, height: 0.4 });
  });
  it('a ground piece stands on the bottom, inside its region', () => {
    const f = piecePlacement({ sit: 'ground', x: 0.5, w: 0.5, lift: 0 }, 4, { left: 0.5, width: 0.5 }, box, 0.43);
    expect(f).toEqual({ left: 0.625, top: 0.8, width: 0.25, height: 0.2 });
  });
  it('a fill piece covers its region', () => {
    expect(piecePlacement({ sit: 'fill', x: 0.5, w: 1, lift: 0 }, 3.2, WHOLE, box, 0.43)).toEqual({ left: 0, top: 0, width: 1, height: 1 });
    const tall = piecePlacement({ sit: 'fill', x: 0.5, w: 1, lift: 0 }, 1, WHOLE, box, 0.43);
    expect(tall.width).toBe(1);
    expect(tall.height).toBeCloseTo(3.2);
  });
});

describe('horizonAt on pack-v9.1’s measured horizons', () => {
  const pack = validateManifest(JSON.parse(readFileSync(new URL('./testdata/pack-v9.1.scenery.json', import.meta.url), 'utf8')), `${FORGECOACH_PACK_URL}scenery.json`).pack!;
  const slot = (biome: SlotState['biome'], index: number, weight: number): SlotState => ({ biome, index, weight, stage: 2, peak: 2 });
  const box = { w: 1600, h: 500 };
  it('with one horizon on, a panel’s horizon is pinned at HORIZON_AT where the crop allows', () => {
    // A panel wider than the picture leaves the crop room to move up and down.
    const layout = halfLayout([slot('island', 0, 2)], pack);
    expect(horizonAt(pack, layout, 0.5, { w: 2400, h: 500 }, { horizon: true })).toBeCloseTo(HORIZON_AT, 3);
    // As wide as the picture, there is no room: the picture's own line (island s2: 0.42).
    expect(horizonAt(pack, layout, 0.5, box, { horizon: true })).toBe(0.42);
  });
  it('off, it is the picture’s own measured line through the crop; the panel under x decides', () => {
    const layout = halfLayout([slot('island', 0, 2), slot('mountain', 1, 2)], pack);
    const left = horizonAt(pack, layout, 0.2, box);
    const right = horizonAt(pack, layout, 0.8, box);
    // The mountain's ground line (0.55 at stage 2) sits lower than the island's (0.42).
    expect(right).toBeGreaterThan(left);
  });
  it('no panel and no empty picture: the desktop default', () => {
    expect(horizonAt(pack, [], 0.5, box)).toBe(0.43);
  });
});

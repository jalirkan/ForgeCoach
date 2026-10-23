/*
 * ForgeCoach — ambience/pieces.test.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Spec 1.14's planner (pc-results scenery/SYSTEM.md, section A) and the
 * pieces' placement: the worked example (Evan's half in the friend game of
 * 2026-10-17), the tie rule, folding, landmarks, veils, fronts, and a
 * landmark standing on pack-v9.1's measured horizon.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { GameStateBody } from '../protocol.ts';
import { validateManifest } from './manifest.ts';
import { halfLayout, HORIZON_AT } from './layout.ts';
import { stepScenery, slotsOf, type SlotState } from './model.ts';
import { FORGECOACH_PACK_URL } from './prefs.ts';
import { frontFor, heaviestPair, horizonAt, landNamesOf, makeupFromSlots, makeupOf, pairStageOf, piecePlacement, planHalf, WHOLE, type HalfPlan } from './pieces.ts';

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
  it('T8: an Island re-keys to island+plains at stage 2, red becomes the element, blue’s front plays', () => {
    expect(plans.T8).toMatchObject({ pair: ['U', 'W'], split: 0.4, pairStage: 2, mirror: true });
    expect(plans.T8!.element).toEqual({ colour: 'R', opacity: 0.5, side: 'left' });
    expect(fronts.T8).toEqual({ colour: 'U', reverse: false });
  });
  it('T10: Tundra eases the pan toward the island (plains 0.60 → 0.57), no front', () => {
    expect(plans.T10).toMatchObject({ pair: ['U', 'W'], split: 0.429, pairStage: 2 });
    expect(fronts.T10).toBeNull();
  });
});

describe('folding, landmarks, veils and fronts', () => {
  it('four colours fold to the three heaviest, one element', () => {
    const p = planHalf({ makeup: makeupOf({ W: 3, U: 2, B: 1, G: 0.5 }, ['W', 'U', 'B', 'G']) });
    expect(p.pair).toEqual(['U', 'W']);
    expect(p.element?.colour).toBe('B');
    expect(p.element?.opacity).toBe(0.5);
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
    const c = planHalf({ makeup: makeupOf({ W: 2, U: 1, R: 0.5 }, ['W', 'U', 'R']) });
    const d = planHalf({ makeup: makeupOf({ W: 2, U: 1, R: 1.5 }, ['W', 'U', 'R']), prevPair: c.pair });
    expect(frontFor(c, d)).toEqual({ colour: 'R', reverse: false });
    expect(frontFor(null, d)).toBeNull();
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

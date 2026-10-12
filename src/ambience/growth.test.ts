/*
 * ForgeCoach — ambience/growth.test.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Spec 1.6, growth between stages: the progress toward the next stage, the
 * smooth slot width, the eased cross-fade and its fade stack land by land,
 * the accents thickening with the progress, the warm list ("current and
 * next"), and the manifest's optional `growth` field.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { growthLevel, sceneryFromLog, slotsOf, stageFor, stageProgress, type Biome, type SlotState } from './model.ts';
import { easeGrowth, fadeBusy, fadeStack, growthMs, MAX_FADE_ENTRIES, nextStageFade, settleFades, type FadeEntry } from './growth.ts';
import { slotLayout } from './layout.ts';
import { DEFAULT_GROWTH, growthOf, validateManifest } from './manifest.ts';
import { overlayPieces } from './overlay.ts';
import { growthPictures } from './pack.ts';
import { FORGECOACH_PACK_URL } from './prefs.ts';
import { simLog, type SimPlay } from './sim.ts';

const BASE = 'http://127.0.0.1:8650/scenery.json';
const islands = (n: number): SimPlay[] => Array.from({ length: n }, () => ({ kind: 'land', player: 1, name: 'Island' }) as SimPlay);
const islandSlot = (n: number) => slotsOf(sceneryFromLog(simLog(islands(n)), Infinity), 1)[0]!;
const slot = (biome: Biome, weight: number): SlotState => ({ biome, index: 0, weight, stage: stageFor(weight), progress: stageProgress(weight), peak: stageFor(weight) });

describe('progress toward the next stage', () => {
  it('is the fraction between the stage’s threshold and the next (default 1 / 2–3 / 4–5 / 6+)', () => {
    const w = [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 5, 6, 9];
    expect(w.map((x) => stageFor(x))).toEqual([0, 1, 1, 1, 2, 2, 2, 2, 3, 3, 4, 4]);
    expect(w.map((x) => stageProgress(x))).toEqual([0, 0, 0, 0.5, 0, 0.25, 0.5, 0.75, 0, 0.5, 1, 1]);
  });
  it('takes custom thresholds, and clamps at the last one', () => {
    expect([1, 2, 3, 4].map((x) => stageProgress(x, [1, 3]))).toEqual([0, 0.5, 1, 1]);
    expect(stageProgress(5, [2, 4, 8])).toBe(0.25);
    expect(stageProgress(1, [2, 4, 8])).toBe(0); // under the first threshold: stage 1 at 0
    expect(stageProgress(3, [])).toBe(0);
  });
  it('rides on every slot the model makes, its stages unchanged', () => {
    expect([1, 2, 3, 4, 5, 6, 7].map((n) => [islandSlot(n).stage, islandSlot(n).progress])).toEqual([
      [1, 0],
      [2, 0],
      [2, 0.5],
      [3, 0],
      [3, 0.5],
      [4, 1],
      [4, 1],
    ]);
  });
  it('as one continuous level: the stage plus the progress, never jumping at a threshold', () => {
    expect([1, 2, 3, 4, 5, 6, 7].map((n) => growthLevel(islandSlot(n)))).toEqual([1, 2, 2.5, 3, 3.5, 4, 4]);
    expect(growthLevel({ stage: 3 })).toBe(3);
    expect(growthLevel({ stage: 0, progress: 0.5 })).toBe(0);
  });
});

describe('the slot width grows with every land', () => {
  it('grows smoothly between stages and lands where the steps did at each threshold', () => {
    const grows = [1, 2, 3, 4, 5, 6, 7].map((n) => slotLayout([islandSlot(n)], null)[0]!.grow);
    expect(grows).toEqual([1, 1.18, 1.27, 1.36, 1.45, 1.54, 1.54]);
  });
  it('the preview’s stage override draws whole stages (no progress)', () => {
    expect(slotLayout([islandSlot(3)], null, 3).map((l) => [l.stage, l.progress, l.grow])).toEqual([[3, 0, 1.36]]);
  });
  it('a slot with no progress (made by hand) keeps the 1.5 steps', () => {
    expect(slotLayout([{ biome: 'island', index: 0, weight: 3, stage: 2, peak: 2 }], null)[0]!.grow).toBe(1.18);
  });
});

describe('the eased cross-fade', () => {
  it('eases: half the stage is half the next picture', () => {
    expect([0, 0.25, 0.5, 0.75, 1].map(easeGrowth)).toEqual([0, 0.146, 0.5, 0.854, 1]);
  });
  it('is on only with a next stage, below full growth, when the pack allows it', () => {
    expect(nextStageFade(0.5, true, DEFAULT_GROWTH)).toBe(0.5);
    expect(nextStageFade(0.5, false, DEFAULT_GROWTH)).toBe(0);
    expect(nextStageFade(1, true, DEFAULT_GROWTH)).toBe(0);
    expect(nextStageFade(undefined, true, DEFAULT_GROWTH)).toBe(0);
    expect(nextStageFade(0.5, true, { crossfade: false, seconds: 1.2 })).toBe(0);
  });
  it('takes the pack’s seconds, and none with reduced motion', () => {
    expect(growthMs(DEFAULT_GROWTH, false)).toBe(1200);
    expect(growthMs({ crossfade: true, seconds: 0.4 }, false)).toBe(400);
    expect(growthMs(DEFAULT_GROWTH, true)).toBe(0);
  });
});

type E = FadeEntry<string>;
const want = (k: string | null) => (k ? { key: k, payload: k } : null);
const view = (st: E[]) => st.map((e) => `${e.key}:${e.role}:${e.opacity}`);

describe('the fade stack, land by land (2 → 6 Islands)', () => {
  // Each land: the picture of the stage, the next stage's, the fade (as the renderer derives them).
  const lands: [number, string, string | null, number][] = [
    [2, 's2', 's3', 0],
    [3, 's2', 's3', 0.5],
    [4, 's3', 's4', 0],
    [5, 's3', 's4', 0.5],
    [6, 's4', null, 0],
  ];
  it('draws the current picture with the next one over it, and keeps the old one beneath a stage-up until it settles', () => {
    let st: E[] = [];
    const seen: string[][] = [];
    for (const [n, cur, next, fade] of lands) {
      st = fadeStack(st, want(cur), want(next), fade, n === 2);
      seen.push(view(st));
      expect(st.length).toBeLessThanOrEqual(MAX_FADE_ENTRIES);
      if (fadeBusy(st)) st = settleFades(st);
      expect(st.length).toBeLessThanOrEqual(2);
    }
    expect(seen).toEqual([['s2:cur:1'], ['s2:cur:1', 's3:next:0.5'], ['s2:base:1', 's3:cur:1'], ['s3:cur:1', 's4:next:0.5'], ['s3:base:1', 's4:cur:1']]);
  });
  it('a picture appearing fades in from nothing; one already shown keeps its element', () => {
    const a = fadeStack<string>([], want('s2'), null, 0, true);
    const b = fadeStack(a, want('s2'), want('s3'), 0.5, false);
    expect(b.find((e) => e.key === 's3')!.from).toBe(0);
    const c = fadeStack(b, want('s3'), null, 0, false);
    expect(c.map((e) => e.key)).toEqual(['s2', 's3']);
  });
  it('is instant with reduced motion (no base, nothing fading out)', () => {
    const st = fadeStack(fadeStack<string>([], want('s2'), want('s3'), 0.5, true), want('s3'), want('s4'), 0.5, true);
    expect(view(st)).toEqual(['s3:cur:1', 's4:next:0.5']);
    expect(st[1]!.from).toBe(0.5);
  });
  it('a jump cross-fades the old picture out over the new one', () => {
    const st = fadeStack(fadeStack<string>([], want('s1'), null, 0, true), want('s4'), null, 0, false);
    expect(view(st)).toEqual(['s4:cur:1', 's1:out:0']);
    expect(view(settleFades(st))).toEqual(['s4:cur:1']);
  });
  it('a land leaving fades the next picture back out, or the stage back down', () => {
    const at3 = fadeStack(fadeStack<string>([], want('s2'), null, 0, true), want('s2'), want('s3'), 0.5, false);
    expect(view(fadeStack(at3, want('s2'), want('s3'), 0, false))).toEqual(['s2:cur:1', 's3:out:0']);
    const at5 = settleFades(fadeStack(fadeStack<string>([], want('s3'), null, 0, true), want('s3'), want('s4'), 0.5, false));
    expect(view(fadeStack(at5, want('s2'), want('s3'), 0.5, false))).toEqual(['s2:cur:1', 's3:next:0.5', 's4:out:0']);
  });
  it('a second land in the middle of a fade keeps the picture beneath, three at most', () => {
    const mid = fadeStack(fadeStack<string>([], want('s2'), want('s3'), 0.5, true), want('s3'), null, 0, false);
    const next = fadeStack(mid, want('s3'), want('s4'), 0.5, false);
    expect(view(next)).toEqual(['s2:base:1', 's3:cur:1', 's4:next:0.5']);
    const jump = fadeStack(next, want('s1'), null, 0, false);
    expect(jump.length).toBe(MAX_FADE_ENTRIES);
    expect(jump[0]!.key).toBe('s2');
  });
});

describe('accents thicken with the progress', () => {
  const at = (n: number, opts: { builtinArea?: boolean; growth?: { crossfade: boolean; seconds: number } } = {}) =>
    overlayPieces([slot('forest', n)], null, { side: 'bottom', widthPx: 1100, reduced: false, ...opts });
  it('the built-in accents: the next stage’s new pieces fade in, still, after the current ones', () => {
    expect(at(2).map((p) => [p.piece.id, p.fade])).toEqual([
      ['bl', undefined],
      ['br', undefined],
    ]);
    const three = at(3);
    expect(three.map((p) => [p.piece.id, p.fade, p.animate])).toEqual([
      ['bl', undefined, true],
      ['br', undefined, true],
      ['edge', 0.5, false],
    ]);
    expect(at(4).map((p) => [p.piece.id, p.fade])).toEqual([
      ['bl', undefined],
      ['br', undefined],
      ['edge', undefined],
    ]);
    expect(at(5).filter((p) => p.fade !== undefined).map((p) => [p.piece.id, p.fade])).toEqual([
      ['left', 0.5],
      ['right', 0.5],
    ]);
    expect(at(7).some((p) => p.fade !== undefined)).toBe(false);
  });
  it('a full-area piece cross-fades to the next stage’s picture', () => {
    const areas = at(3, { builtinArea: true }).filter((p) => p.anchor === 'area');
    expect(areas.map((p) => [p.key, p.piece.builtinLevel, p.fade])).toEqual([
      ['forest:area:area', 2, undefined],
      ['forest:area:area:next', 3, 0.5],
    ]);
  });
  it('a pack that opts out keeps the steps', () => {
    expect(at(3, { growth: { crossfade: false, seconds: 1.2 } }).some((p) => p.fade !== undefined)).toBe(false);
  });
  it('the pack-v5 front layer: stage 2 at 3 lands shows front-s3 at half over front-s2', () => {
    const r = validateManifest(JSON.parse(readFileSync(new URL('./testdata/pack-v5.scenery.json', import.meta.url), 'utf8')), `${FORGECOACH_PACK_URL}scenery.json`);
    const areas = overlayPieces([slot('island', 3)], r.pack, { side: 'bottom', widthPx: 1100, reduced: false }).filter((p) => p.anchor === 'area');
    expect(areas.map((p) => [p.piece.src!.split('/').pop(), p.fade])).toEqual([
      ['front-s2.webp', undefined],
      ['front-s3.webp', 0.5],
    ]);
  });
});

describe('warming the current and the next stage', () => {
  const r = validateManifest(JSON.parse(readFileSync(new URL('./testdata/pack-v5.scenery.json', import.meta.url), 'utf8')), `${FORGECOACH_PACK_URL}scenery.json`);
  const names = (l: { src: string }[]) => l.map((p) => p.src.replace(FORGECOACH_PACK_URL, ''));
  it('the half pictures of each slot’s stage and the next (the phone ones on a phone)', () => {
    expect(names(growthPictures(r.pack!, [{ biome: 'island', stage: 2 }, { biome: 'forest', stage: 1 }], { half: true, phone: false }))).toEqual(['island/s2-half.webp', 'island/s3-half.webp', 'forest/s1-half.webp', 'forest/s2-half-vined.webp']);
    expect(names(growthPictures(r.pack!, [{ biome: 'island', stage: 4 }], { half: true, phone: true }))).toEqual(['island/s4-phone.webp']);
    expect(growthPictures(r.pack!, [{ biome: 'island', stage: 2 }], { half: true, phone: false })[0]!.src2x).toMatch(/s2-half@2x\.webp$/);
  });
  it('the strip’s still layers when the half is not filled; nothing for a withered slot or a biome with no art', () => {
    expect(names(growthPictures(r.pack!, [{ biome: 'island', stage: 3 }], { half: false, phone: false }))).toEqual(['island/s3-sky.webp', 'island/s4-sky.webp']);
    expect(growthPictures(r.pack!, [{ biome: 'island', stage: 0 }, { biome: 'wastes', stage: 2 }], { half: true, phone: false })).toEqual([]);
  });
});

describe('the manifest’s growth (spec 1.6)', () => {
  const pack = (top: Record<string, unknown>) => ({ schema: 1, spec: '1.6', ...top, biomes: { island: { stages: [{ layers: [{ id: 'sky', kind: 'image', src: 'island/s1.webp' }] }] } } });
  it('defaults to a 1.2 s cross-fade, and an older pack reads the same', () => {
    const r = validateManifest(pack({}), BASE);
    expect(r.warnings).toEqual([]);
    expect(r.pack!.growth).toEqual({ crossfade: true, seconds: 1.2 });
    expect(growthOf(null)).toEqual(DEFAULT_GROWTH);
    const v5 = validateManifest(JSON.parse(readFileSync(new URL('./testdata/pack-v5.scenery.json', import.meta.url), 'utf8')), `${FORGECOACH_PACK_URL}scenery.json`);
    expect(v5.pack!.growth).toEqual(DEFAULT_GROWTH);
  });
  it('a pack may opt out or tune it', () => {
    const r = validateManifest(pack({ growth: { crossfade: false, seconds: 0.6 } }), BASE);
    expect(r.warnings).toEqual([]);
    expect(r.pack!.growth).toEqual({ crossfade: false, seconds: 0.6 });
    expect(validateManifest(pack({ growth: { seconds: 0 } }), BASE).pack!.growth).toEqual({ crossfade: true, seconds: 0 });
  });
  it('bad fields fall back to their defaults, with a warning', () => {
    expect(validateManifest(pack({ growth: 'slow' }), BASE).warnings).toEqual(['growth: not an object; defaults used']);
    const r = validateManifest(pack({ growth: { crossfade: 'yes', seconds: 9 } }), BASE);
    expect(r.warnings).toEqual(['growth.crossfade: "yes" is not true or false; using true', 'growth.seconds: 9 is out of range 0–5; using 1.2']);
    expect(r.pack!.growth).toEqual(DEFAULT_GROWTH);
  });
});

/*
 * ForgeCoach — ambience/manifest-pieces.test.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Spec 1.14's top-level `pieces`: a good pack reads whole; each bad entry is
 * warned with its path and dropped alone; a pack without `pieces` is
 * unchanged.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MAX_PIECES_BYTES, pieceUrls, piecesBytes, validateManifest } from './manifest.ts';

const BASE = 'https://example.org/pack/';
const piece = (src: string, extra: Record<string, unknown> = {}) => ({ src, width: 400, height: 200, ...extra });
const GOOD = {
  elements: { R: piece('el/fire.webp', { place: { sit: 'ground', x: 0.3, w: 0.5 } }) },
  landmarks: { 'City of Brass': piece('lm/brass.webp', { phone: { src: 'lm/brass-phone.webp' }, place: { sit: 'horizon', x: 0.7, w: 0.2, lift: 0.01 }, bytes: 1000 }) },
  fronts: { U: { frames: [{ src: 'fr/u1.webp', phone: 'fr/u1p.webp' }, { src: 'fr/u2.webp' }], holdMs: 160, fadeMs: 300 } },
  veils: { won: piece('veil/won.webp'), lost: piece('veil/lost.webp') },
  empty: { src: 'empty/half.webp', phone: { src: 'empty/phone.webp' } },
};
const pack = (pieces: unknown) => ({ schema: 1, biomes: { island: { stages: [{ layers: [], half: { src: 'island/s1.webp' } }] } }, pieces });
const read = (pieces: unknown) => validateManifest(pack(pieces), BASE);

describe('spec 1.14 pieces', () => {
  it('reads a good pack whole, with defaults for what it leaves out', () => {
    const r = read(GOOD);
    expect(r.warnings).toEqual([]);
    const p = r.pack!.pieces!;
    expect(p.elements.R).toMatchObject({ src: `${BASE}el/fire.webp`, width: 400, height: 200, phone: null, place: { sit: 'ground', x: 0.3, w: 0.5, lift: 0 } });
    expect(p.landmarks['City of Brass']).toMatchObject({ phone: { src: `${BASE}lm/brass-phone.webp`, width: 400, height: 200 }, place: { sit: 'horizon', x: 0.7, w: 0.2, lift: 0.01 }, bytes: 1000 });
    expect(p.fronts.U).toMatchObject({ holdMs: 160, fadeMs: 300, frames: [{ src: `${BASE}fr/u1.webp`, phone: `${BASE}fr/u1p.webp`, holdMs: 160 }, { phone: null }] });
    expect(p.veils.won!.place).toEqual({ sit: 'fill', x: 0.5, w: 1, lift: 0 });
    expect(p.empty).toMatchObject({ src: `${BASE}empty/half.webp`, phone: { src: `${BASE}empty/phone.webp` } });
    expect(pieceUrls(p, { phone: true })).toEqual([`${BASE}lm/brass-phone.webp`, `${BASE}veil/won.webp`, `${BASE}veil/lost.webp`, `${BASE}fr/u1p.webp`, `${BASE}fr/u2.webp`, `${BASE}empty/phone.webp`]);
  });

  it('a pack without pieces is read as before', () => {
    const r = read(undefined);
    expect(r.warnings).toEqual([]);
    expect('pieces' in r.pack!).toBe(false);
    const v91 = JSON.parse(readFileSync(new URL('./testdata/pack-v9.1.scenery.json', import.meta.url), 'utf8'));
    expect('pieces' in validateManifest(v91, BASE).pack!).toBe(false);
  });

  it('drops each bad entry alone, with its path', () => {
    const r = read({
      elements: { R: piece('el/fire.jpg'), X: piece('x.webp'), G: { src: 'el/g.webp' }, W: piece('el/w.webp', { place: { sit: 'sky', x: 2 } }) },
      landmarks: { 'Seaside Citadel': 'nope', 'City of Brass': piece('lm/brass.webp', { phone: { src: 'javascript:void.webp' } }) },
      fronts: { U: { frames: [] }, B: { frames: [{ src: 'fr/b.webp' }, { src: '' }] }, G: { frames: [{ src: 'fr/g.webp' }], holdMs: 5 } },
      veils: { draw: piece('v.webp'), won: 3 },
      empty: 'nope',
    });
    expect(r.warnings).toEqual([
      'pieces.elements.R.src: expected .webp, .avif or .png (transparent); piece dropped',
      'pieces.elements.X: not a colour (W, U, B, R, G); ignored',
      'pieces.elements.G: width and height (the 1x file\'s pixels, 8–16384) are required to place it; piece dropped',
      'pieces.elements.W.place.sit: "sky" is not one of fill, horizon, ground; using ground',
      'pieces.elements.W.place.x: 2 is out of range 0–1; using 0.5',
      'pieces.fronts.U.frames: 1–4 frames; front dropped',
      'pieces.fronts.B.frames[1].src: missing; front dropped',
      'pieces.fronts.G.holdMs: 5 is out of range 40–1000; using 200',
      'pieces.landmarks.Seaside Citadel: not an object; piece dropped',
      'pieces.landmarks.City of Brass.phone.src: the javascript: scheme is not allowed (http, https or relative only); phone picture dropped',
      'pieces.veils.draw: not won or lost (a draw dims both halves); ignored',
      'pieces.veils.won: not an object; piece dropped',
      'pieces.empty: not an object; ignored',
    ]);
    const p = r.pack!.pieces!;
    expect(Object.keys(p.elements)).toEqual(['W']);
    expect(Object.keys(p.fronts)).toEqual(['G']);
    expect(p.landmarks['City of Brass']!.phone).toBeNull();
    expect(p.veils).toEqual({});
    expect(p.empty).toBeNull();
  });

  it('nothing usable is no pieces; too many bytes is a warning, pieces kept', () => {
    expect(read({ elements: { X: piece('x.webp') } }).pack!.pieces).toBeUndefined();
    expect(read('nope').warnings).toEqual(['pieces: not an object; ignored']);
    const big = read({ veils: { won: piece('v.webp', { bytes: MAX_PIECES_BYTES + 1 }) } });
    expect(big.warnings).toEqual(['pieces: 6.0 MB declared; their budget is 6 MB (pieces kept)']);
    expect(piecesBytes(big.pack!.pieces)).toBe(MAX_PIECES_BYTES + 1);
  });

  it('a landmark name must be a clean card name', () => {
    const r = read({ landmarks: { 'Bad\u0007Name': piece('a.webp') } });
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toMatch(/^pieces\.landmarks\..*a card's exact name/);
  });
});

/*
 * ForgeCoach — ambience/fronts.test.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The scenery review's faults 3, 4 and 10 on the pieces (2026-10-24):
 * - fault 3: a front's frames were warmed by the window's width but picked by
 *   the half's shape, so a tall desktop half warmed one set and asked for the
 *   other; and a front played only if its frames were decoded at the very
 *   render of the change, so a cold one never played. One shape rule
 *   (pieces.ts `piecesPhone`) now serves both, and `FrontGate` plays a front
 *   when its frames land.
 * - fault 4: elements were never warmed (`elementUrls`); the picture store
 *   (pack.ts) records a picture's load and error for the load gates.
 * - fault 10: a veil fades out on a scrub back (`veilState`).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { pieceUrls, validateManifest, type PackPieces } from './manifest.ts';
import { markPicture, pictureFailed, pictureReady, pictureStatus, resetPictures, subscribePictures } from './pack.ts';
import { elementUrls, FRONT_WAIT_MS, frontFrameList, FrontGate, piecesPhone, veilState } from './pieces.ts';
import { tweenAt } from './transitions.ts';

const BASE = 'https://example.org/pack/';
const piece = (src: string, extra: Record<string, unknown> = {}) => ({ src, width: 400, height: 200, ...extra });
const pieces: PackPieces = validateManifest(
  {
    schema: 1,
    biomes: { island: { stages: [{ layers: [], half: { src: 'island/s1.webp' } }] } },
    pieces: {
      elements: { R: piece('el/fire.webp', { phone: { src: 'el/fire-phone.webp' } }), B: piece('el/rot.webp') },
      fronts: {
        U: { frames: [{ src: 'fr/u1.webp', phone: 'fr/u1p.webp' }, { src: 'fr/u2.webp', phone: 'fr/u2p.webp' }, { src: 'fr/u3.webp', phone: 'fr/u3p.webp' }], holdMs: 160, fadeMs: 300 },
      },
      veils: { won: piece('veil/won.webp') },
    },
  },
  BASE,
).pack!.pieces!;

afterEach(() => resetPictures());

describe('one shape rule for warming and picking a front (fault 3)', () => {
  it('a phone-width screen always takes the phone frames; a desktop half by its own shape', () => {
    expect(piecesPhone({ w: 376, h: 176 }, true)).toBe(true);
    expect(piecesPhone({ w: 1600, h: 420 }, false)).toBe(false);
    // A tall desktop half (a narrow window on a tall monitor, 900 × 700): phone-shaped, whatever innerWidth says.
    expect(piecesPhone({ w: 900, h: 700 }, false)).toBe(true);
    // Not measured yet: the screen alone.
    expect(piecesPhone({ w: 0, h: 0 }, false)).toBe(false);
  });

  it('the frames a front picks are among the files warmed at that shape (the tall desktop half included)', () => {
    for (const box of [
      { w: 900, h: 700 },
      { w: 1600, h: 420 },
    ]) {
      const phone = piecesPhone(box, false);
      const warmed = new Set(pieceUrls(pieces, { phone }));
      const picked = frontFrameList(pieces, { colour: 'U', reverse: false }, phone)!.frames.map((f) => f.src);
      expect(picked.every((src) => warmed.has(src))).toBe(true);
    }
    expect(frontFrameList(pieces, { colour: 'U', reverse: false }, true)!.frames.map((f) => f.src)).toEqual([`${BASE}fr/u1p.webp`, `${BASE}fr/u2p.webp`, `${BASE}fr/u3p.webp`]);
    // Leaving plays it backwards; a dissolve or a colour without a front plays none.
    expect(frontFrameList(pieces, { colour: 'U', reverse: true }, false)!.frames.map((f) => f.src)).toEqual([`${BASE}fr/u3.webp`, `${BASE}fr/u2.webp`, `${BASE}fr/u1.webp`]);
    expect(frontFrameList(pieces, { dissolve: true }, false)).toBeNull();
    expect(frontFrameList(pieces, { colour: 'G', reverse: false }, false)).toBeNull();
  });
});

describe('a front plays when its frames are ready (fault 3)', () => {
  it('frames already decoded: it starts in the render that sees the change', () => {
    const g = new FrontGate();
    expect(g.token(false, 0)).toBe(0);
    g.change({ colour: 'U', reverse: false }, 100);
    const t = g.token(true, 100);
    expect(t).toBe(1);
    expect(g.frontOf(t)).toEqual({ colour: 'U', reverse: false });
  });

  it('frames arriving late: it waits, then starts once (never twice)', () => {
    const g = new FrontGate();
    g.change({ colour: 'U', reverse: false }, 0);
    expect(g.token(false, 10)).toBe(0);
    expect(g.waiting(10)).toEqual({ colour: 'U', reverse: false });
    expect(g.token(false, 900)).toBe(0);
    // The last frame decodes 1.2 s after the land arrived: the front plays now.
    expect(g.token(true, 1200)).toBe(1);
    expect(g.waiting(1300)).toBeNull();
    expect(g.token(true, 1300)).toBe(1);
  });

  it('frames later than FRONT_WAIT_MS, or a newer change first: that front is skipped', () => {
    const g = new FrontGate();
    g.change({ colour: 'U', reverse: false }, 0);
    expect(g.token(true, FRONT_WAIT_MS + 1)).toBe(0);
    g.change({ colour: 'R', reverse: false }, 5000);
    g.change(null, 5100);
    expect(g.token(true, 5100)).toBe(0);
    expect(g.waiting(5100)).toBeNull();
    // The token of an older generation plays nothing.
    g.change({ colour: 'B', reverse: false }, 6000);
    const t = g.token(true, 6000);
    expect(g.frontOf(t)).toEqual({ colour: 'B', reverse: false });
    // A newer change does not take the started front away from its token (it keeps playing, fade and all).
    g.change({ colour: 'G', reverse: false }, 6100);
    expect(g.frontOf(t)).toEqual({ colour: 'B', reverse: false });
    expect(g.frontOf(0)).toBeNull();
  });

  /**
   * The review of #198: useTween restarts its timers whenever its key (the token) or its fade changes. A second
   * makeup change while a front played turned frontOf(token) null, so the fade went to 0 and the front restarted
   * with no fade. This plays useTween's contract render by render through two changes.
   */
  it('tweens through two changes: a change mid-front neither restarts it nor drops its fade; the next front starts when ready', () => {
    const g = new FrontGate();
    const u = { colour: 'U', reverse: false } as const;
    const r = { colour: 'R', reverse: false } as const;
    const withR: PackPieces = { ...pieces, fronts: { ...pieces.fronts, R: { frames: [{ src: 'r1', phone: null, holdMs: 100 }, { src: 'r2', phone: null, holdMs: 100 }], holdMs: 100, fadeMs: 250, bytes: null } } };
    let key: { token: number; fadeMs: number } | null = null;
    let startedAt = 0;
    const restarts: { at: number; front: string | null; fadeMs: number }[] = [];
    const render = (at: number, ready: boolean) => {
      const token = g.token(ready, at);
      const list = frontFrameList(withR, g.frontOf(token), false);
      const now = { token, fadeMs: list?.fadeMs ?? 0 };
      if (!key || key.token !== now.token || key.fadeMs !== now.fadeMs) {
        if (key) restarts.push({ at, front: g.frontOf(token) && 'colour' in g.frontOf(token)! ? (g.frontOf(token) as typeof u).colour : null, fadeMs: now.fadeMs });
        startedAt = at;
      }
      key = now;
      return list ? tweenAt(list.frames, list.fadeMs, at - startedAt) : null;
    };
    render(0, false);
    // Blue arrives, its frames decoded: the front starts (160 ms × 3 holds, then a 300 ms fade).
    g.change(u, 10);
    expect(render(10, true)).toEqual({ index: 0, fading: false, done: false });
    // Red arrives 200 ms in, its frames still loading: blue plays on, same frames, same fade.
    g.change(r, 210);
    expect(render(210, false)).toEqual({ index: 1, fading: false, done: false });
    expect(render(500, false)).toEqual({ index: 2, fading: true, done: false });
    expect(restarts).toEqual([{ at: 10, front: 'U', fadeMs: 300 }]);
    // Red's frames land at 600 ms (within FRONT_WAIT_MS): red starts then, with its own fade.
    expect(render(600, true)).toEqual({ index: 0, fading: false, done: false });
    expect(restarts.at(-1)).toEqual({ at: 600, front: 'R', fadeMs: 250 });
    expect(render(805, true)).toEqual({ index: 1, fading: true, done: false });
    expect(render(1060, true)!.done).toBe(true);
  });
});

describe('the picture store the load gates read (fault 4)', () => {
  it('records a load and an error from a warm or from the img itself, and tells its listeners', () => {
    let heard = 0;
    const off = subscribePictures(() => heard++);
    expect(pictureStatus('a.webp')).toBe('pending');
    markPicture('a.webp', false);
    expect([pictureFailed('a.webp'), pictureStatus('a.webp')]).toEqual([true, 'failed']);
    // It loaded after all (a retry, or the img drawing it): ready.
    markPicture('a.webp', true);
    expect([pictureReady('a.webp'), pictureFailed('a.webp')]).toEqual([true, false]);
    // A later error elsewhere does not undo a load; a repeat is not news.
    markPicture('a.webp', false);
    markPicture('a.webp', true);
    expect(pictureStatus('a.webp')).toBe('ready');
    expect(heard).toBe(2);
    off();
  });

  it('elements are warmed with three or more colours, at the half’s shape', () => {
    expect(elementUrls(pieces, ['W', 'U'], false)).toEqual([]);
    expect(elementUrls(pieces, ['W', 'U', 'R'], false).map((x) => x.src)).toEqual([`${BASE}el/fire.webp`]);
    expect(elementUrls(pieces, ['B', 'U', 'R', 'W'], true).map((x) => x.src)).toEqual([`${BASE}el/rot.webp`, `${BASE}el/fire-phone.webp`]);
  });
});

describe('the veil fades out on a scrub back (fault 10)', () => {
  it('keeps the last veil, leaving, until the fade is over', () => {
    expect(veilState('won', null)).toEqual({ veil: 'won', leaving: false });
    expect(veilState(null, 'won')).toEqual({ veil: 'won', leaving: true });
    expect(veilState(null, null)).toBeNull();
  });
});

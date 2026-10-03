/*
 * ForgeCoach — ambience/layout.test.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { describe, expect, it } from 'vitest';
import { ANCHORS, FITS } from './manifest.ts';
import { anchorFractions, fitRect, frameAspect, objectPosition, spriteFrameCss } from './layout.ts';

/** Evaluate spriteFrameCss's strings for a box of w × h px (cqw / cqh are 1% of it). */
function evalCss(css: string, w: number, h: number): number {
  const js = css
    .replace(/100cqw/g, String(w))
    .replace(/100cqh/g, String(h))
    .replace(/100%/g, 'NaN')
    .replace(/calc\(/g, '(')
    .replace(/min\(/g, 'Math.min(')
    .replace(/max\(/g, 'Math.max(');
  expect(js).toMatch(/^[\d\s.+\-*/(),Mathminax]+$/);
  return Function(`return ${js}`)() as number;
}

describe('anchors', () => {
  it('maps names to fractions and object-position', () => {
    expect(anchorFractions('center')).toEqual({ x: 0.5, y: 0.5 });
    expect(anchorFractions('bottom')).toEqual({ x: 0.5, y: 1 });
    expect(anchorFractions('top-left')).toEqual({ x: 0, y: 0 });
    expect(anchorFractions('bottom-right')).toEqual({ x: 1, y: 1 });
    expect(anchorFractions('left')).toEqual({ x: 0, y: 0.5 });
    expect(objectPosition('bottom')).toBe('50% 100%');
    expect(objectPosition('bottom-left')).toBe('0% 100%');
    expect(objectPosition('top-right')).toBe('100% 0%');
    expect(objectPosition('center')).toBe('50% 50%');
  });
});

describe('sprite frames', () => {
  it('frameAspect is one frame’s width over height', () => {
    expect(frameAspect(1200, 800, 6, 2)).toBeCloseTo(0.5); // 200 × 400 frames
    expect(frameAspect(512, 512, 4, 4)).toBe(1);
    expect(frameAspect(0, 512, 4, 4)).toBeNull();
    expect(frameAspect(512, 512, 0, 4)).toBeNull();
  });

  it('fitRect: a tall palm in a wide box, contain, anchored bottom', () => {
    // Box 400 × 200 (aspect 2), frame aspect 0.5: contained, it is 100 × 200, i.e. 0.25 of the width.
    expect(fitRect(2, 0.5, 'contain', 'bottom')).toEqual({ left: 0.375, top: 0, width: 0.25, height: 1 });
    expect(fitRect(2, 0.5, 'contain', 'bottom-left')).toEqual({ left: 0, top: 0, width: 0.25, height: 1 });
    expect(fitRect(2, 0.5, 'contain', 'right')).toEqual({ left: 0.75, top: 0, width: 0.25, height: 1 });
  });

  it('fitRect: a wide frame in a tall box, contain sits at the anchor, cover overflows', () => {
    // Box aspect 0.7 (a narrow palm box), frame aspect 2.
    const c = fitRect(0.7, 2, 'contain', 'bottom');
    expect(c.width).toBe(1);
    expect(c.height).toBeCloseTo(0.35);
    expect(c.top).toBeCloseTo(0.65); // on the ground, not floating mid-box
    expect(fitRect(0.7, 2, 'contain', 'top').top).toBe(0);
    expect(fitRect(0.7, 2, 'contain', 'center').top).toBeCloseTo(0.325);
    const v = fitRect(0.7, 2, 'cover', 'center');
    expect(v.height).toBe(1);
    expect(v.width).toBeCloseTo(2 / 0.7);
    expect(v.left).toBeCloseTo((1 - 2 / 0.7) / 2);
    expect(fitRect(0.7, 2, 'cover', 'left').left).toBe(0);
  });

  it('fitRect: fill, or no aspect yet, is the whole box', () => {
    expect(fitRect(2, 0.5, 'fill', 'bottom')).toEqual({ left: 0, top: 0, width: 1, height: 1 });
    expect(fitRect(2, null, 'contain', 'bottom')).toEqual({ left: 0, top: 0, width: 1, height: 1 });
  });

  it('spriteFrameCss computes the same rectangle as fitRect', () => {
    const boxes = [
      [400, 200],
      [130, 186],
      [90, 250],
      [500, 500],
    ] as const;
    for (const [w, h] of boxes) {
      for (const aspect of [0.7, 1, 2.6, 0.5]) {
        for (const fit of FITS.filter((f) => f !== 'fill')) {
          for (const anchor of ANCHORS) {
            const css = spriteFrameCss(aspect, fit, anchor);
            const r = fitRect(w / h, aspect, fit, anchor);
            expect(evalCss(css.width, w, h)).toBeCloseTo(r.width * w, 1);
            expect(evalCss(css.height, w, h)).toBeCloseTo(r.height * h, 1);
            expect(evalCss(css.left, w, h)).toBeCloseTo(r.left * w, 1);
            expect(evalCss(css.top, w, h)).toBeCloseTo(r.top * h, 1);
          }
        }
      }
    }
    expect(spriteFrameCss(0.5, 'fill', 'bottom')).toEqual({ left: '0', top: '0', width: '100%', height: '100%' });
    expect(spriteFrameCss(null, 'contain', 'bottom')).toEqual({ left: '0', top: '0', width: '100%', height: '100%' });
  });
});

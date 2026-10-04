/*
 * ForgeCoach — ui/keyboardInset.test.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { describe, expect, it } from 'vitest';
import { keyboardInset, trackKeyboardInset } from './keyboardInset.ts';

describe('keyboardInset', () => {
  it('is the part of the layout the keyboard covers', () => {
    expect(keyboardInset(844, { height: 508, offsetTop: 0, scale: 1 })).toBe(336);
  });
  it('subtracts how far the visual viewport has scrolled down', () => {
    expect(keyboardInset(844, { height: 508, offsetTop: 100, scale: 1 })).toBe(236);
  });
  it('is 0 with no keyboard, for URL-bar wobble, and without a visual viewport', () => {
    expect(keyboardInset(844, { height: 844, offsetTop: 0, scale: 1 })).toBe(0);
    expect(keyboardInset(844, { height: 790, offsetTop: 0, scale: 1 })).toBe(0);
    expect(keyboardInset(844, null)).toBe(0);
    expect(keyboardInset(0, { height: 0, offsetTop: 0, scale: 1 })).toBe(0);
  });
  it('a pinch-zoom is not a keyboard', () => {
    expect(keyboardInset(844, { height: 422, offsetTop: 200, scale: 2 })).toBe(0);
  });
});

describe('trackKeyboardInset', () => {
  it('sets --kb-inset now and on each visual-viewport change, until stopped', () => {
    const vv = Object.assign(new EventTarget(), { height: 844, offsetTop: 0, scale: 1 });
    const set: string[] = [];
    const root = { style: { setProperty: (n: string, v: string) => set.push(`${n}=${v}`) } };
    const win = { innerHeight: 844, visualViewport: vv, requestAnimationFrame: (fn: () => void) => (fn(), 1) };
    const stop = trackKeyboardInset(win, root);
    expect(set).toEqual(['--kb-inset=0px']);
    vv.height = 500;
    vv.dispatchEvent(new Event('resize'));
    expect(set.at(-1)).toBe('--kb-inset=344px');
    vv.dispatchEvent(new Event('scroll')); // unchanged: not written again
    expect(set).toHaveLength(2);
    stop();
    vv.height = 844;
    vv.dispatchEvent(new Event('resize'));
    expect(set).toHaveLength(2);
  });
  it('does nothing without a visual viewport', () => {
    const set: string[] = [];
    trackKeyboardInset({ innerHeight: 800, requestAnimationFrame: () => 0 }, { style: { setProperty: (n) => set.push(n) } });
    expect(set).toEqual([]);
  });
});

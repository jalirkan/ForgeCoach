/*
 * ForgeCoach — ui/floating.test.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { describe, expect, it } from 'vitest';
import { clampPanel, parsePos } from './floating.ts';

const size = { w: 340, h: 500 };
const view = { w: 1440, h: 900 };

describe('clampPanel', () => {
  it('leaves a panel that fits alone', () => {
    expect(clampPanel({ x: 600, y: 120 }, size, view)).toEqual({ x: 600, y: 120 });
  });
  it('keeps a grip on screen at every edge, and the header below the top', () => {
    expect(clampPanel({ x: 1430, y: -40 }, size, view)).toEqual({ x: 1360, y: 0 });
    expect(clampPanel({ x: -900, y: 2000 }, size, view)).toEqual({ x: -260, y: 856 });
  });
});

describe('parsePos', () => {
  it('reads "x,y" and nothing else', () => {
    expect(parsePos('12,-4')).toEqual({ x: 12, y: -4 });
    expect(parsePos('12')).toBeNull();
    expect(parsePos(null)).toBeNull();
  });
});

/*
 * ForgeCoach — cube/cubes.test.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { describe, expect, it } from 'vitest';
import { cubeForMeta } from './cubes.ts';

describe('cubeForMeta', () => {
  it('finds the cube a lab meta.json is for, by file or by title', () => {
    expect(cubeForMeta({ cube: { file: 'cubes/pauper-cube-180.md' } })?.id).toBe('pauper');
    expect(cubeForMeta({ cube: { name: 'Vintage Cube' } })?.id).toBe('vintage');
  });
  it('gives a meta that names no cube to the cube being viewed, and refuses a stranger', () => {
    expect(cubeForMeta({ cube: {} }, 'synergy')?.id).toBe('synergy');
    expect(cubeForMeta({ cube: {} })).toBeUndefined();
    expect(cubeForMeta({ cube: { file: 'legacy-cube-360.md' } }, 'synergy')).toBeUndefined();
    expect(cubeForMeta({ cube: { file: 'cubes/omega-cube-180.md' } })?.id).toBe('omega');
  });
});

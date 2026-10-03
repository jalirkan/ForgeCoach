/*
 * ForgeCoach — cube/cubes.test.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { describe, expect, it } from 'vitest';
import { cubeForMeta, cubeInfo, loadShippedMeta } from './cubes.ts';

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

describe('loadShippedMeta', () => {
  it('does not fetch a meta.json for a cube that ships none', async () => {
    const asked: string[] = [];
    const fetcher = async (u: string) => {
      asked.push(u);
      return new Response('{}', { status: 404 });
    };
    expect(await loadShippedMeta(cubeInfo('peasant')!, '/', fetcher)).toBeNull();
    expect(asked).toEqual([]);
    expect(await loadShippedMeta(cubeInfo('synergy')!, '/', fetcher)).toBeNull();
    expect(asked).toEqual(['/cubes/synergy-cube-180.meta.json']);
  });
});

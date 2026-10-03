/*
 * ForgeCoach — ui/skin.test.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { describe, expect, it } from 'vitest';
import { applySkin, resolveSkin, skinFromUrl } from './skin.ts';

describe('skin', () => {
  it('defaults to classic, and falls back to classic for an unknown saved value', () => {
    expect(resolveSkin(undefined)).toBe('classic');
    expect(resolveSkin('neon')).toBe('classic');
    expect(resolveSkin(3)).toBe('classic');
    expect(resolveSkin('felt')).toBe('felt');
    expect(resolveSkin('stack')).toBe('stack');
  });
  it('previews a ?skin= parameter over the saved one, ignoring unknown values', () => {
    expect(skinFromUrl('?skin=stack')).toBe('stack');
    expect(skinFromUrl('?play=1&skin=felt')).toBe('felt');
    expect(skinFromUrl('?skin=neon')).toBeNull();
    expect(skinFromUrl('', '#sample=human-auto-42&skin=felt')).toBe('felt');
    expect(skinFromUrl('', '#lab?src=sample&skin=stack')).toBe('stack');
    expect(skinFromUrl('', '#lab?src=sample')).toBeNull();
    expect(resolveSkin('felt', '?skin=stack')).toBe('stack');
    expect(resolveSkin('felt', '?skin=bogus')).toBe('felt');
  });
  it('sets data-skin on the root', () => {
    const attrs = new Map<string, string>();
    applySkin({ setAttribute: (k, v) => void attrs.set(k, v) }, 'stack');
    expect(attrs.get('data-skin')).toBe('stack');
  });
});

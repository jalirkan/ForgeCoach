/*
 * ForgeCoach — ui/skin.test.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { readFileSync } from 'node:fs';
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

// The cube section's stylesheets take their colours from --fx-* tokens, so each
// skin reaches the start page, Draft vs AI, Draft & build and the cube pages.
const css = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const SECTION = ['./lobby.css', './forge-theme.css', './draft/draft.css', './draft/collection.css', './deck/deck.css', './deck/skin.css'];

/** The custom properties declared in the first rule block whose selector is exactly `selector`. */
function declared(source: string, selector: string): Set<string> {
  const at = source.indexOf(`${selector} {`);
  expect(at, `${selector} block`).toBeGreaterThanOrEqual(0);
  const block = source.slice(at, source.indexOf('}', at));
  return new Set([...block.matchAll(/(--fx-[\w-]+)\s*:/g)].map((m) => m[1]));
}

describe('skin tokens in the cube section', () => {
  const used = new Set(SECTION.flatMap((f) => [...css(f).matchAll(/var\((--fx-[\w-]+)\)/g)].map((m) => m[1])));
  const classic = declared(css('./forge-theme.css'), ':root');
  const skins = css('./skins.css');

  it('defines every --fx token for Classic, Stack and Hot Felt', () => {
    expect(used.size).toBeGreaterThan(20);
    for (const t of used) expect(classic, t).toContain(t);
    for (const skin of ['stack', 'felt']) {
      // The skin's --fx block is the root block that starts with --fx-page.
      const from = skins.indexOf(`:root[data-skin='${skin}'] {\n  --fx-page`);
      expect(from, skin).toBeGreaterThanOrEqual(0);
      const fx = declared(skins.slice(from), `:root[data-skin='${skin}']`);
      expect([...classic].filter((t) => !fx.has(t)), skin).toEqual([]);
    }
  });

  it('writes none of Classic’s warm browns and golds by hand outside the tokens', () => {
    // Classic's tile, hover, raise and gold triplets, and its gold buttons.
    const warm = /rgba\((23, 19, 13|40, 32, 20|58, 44, 23|58, 46, 28|227, 178, 95|13, 11, 8),|#e2b754|#e8bf5f|#24180a|#3a2c17/;
    for (const f of SECTION) {
      const lines = css(f)
        .split('\n')
        .filter((l) => warm.test(l) && !/^\s*--/.test(l));
      expect(lines, f).toEqual([]);
    }
  });
});

/*
 * ForgeCoach — ui/nav.test.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Sibling pages and the way back up (nav.ts): moving between cubes replaces
 * the history entry, so neither the app's Back nor the browser's steps
 * through every cube viewed; Back goes up a level, to where the cubes were
 * entered from, else to the list. A fake history stands in for the browser.
 */
import { describe, expect, it } from 'vitest';
import { familyOf, Navigator, type NavEnv } from './nav.ts';

/** A browser history in miniature: entries, an index, and the hash changes it would fire. */
function fakeHistory(start = '') {
  const entries = [start];
  let i = 0;
  const nav: { n: Navigator | null } = { n: null };
  const env: NavEnv = {
    hash: () => entries[i]!,
    push: (h) => {
      entries.splice(i + 1, entries.length, h);
      i++;
      nav.n?.observe();
    },
    replace: (h) => {
      entries[i] = h;
      nav.n?.observe();
    },
    back: () => {
      if (i > 0) i--;
      nav.n?.observe();
    },
  };
  nav.n = new Navigator(env);
  return { env, nav: nav.n, at: () => entries[i]!, stack: () => entries.slice(0, i + 1), browserBack: env.back };
}

describe('families of sibling pages', () => {
  it('cube pages (and their guide tab) are one family; the builder is not', () => {
    expect(familyOf('#cube/synergy')?.id).toBe('cube');
    expect(familyOf('#cube/vintage/guide')?.id).toBe('cube');
    expect(familyOf('#cube/new')).toBeNull();
    expect(familyOf('#cube/edit/my-x')).toBeNull();
    expect(familyOf('#watch/watch-a-1')?.id).toBe('watch');
    expect(familyOf('#watch')).toBeNull();
    expect(familyOf('#practice/p1')?.id).toBe('practice');
    expect(familyOf('#practice')).toBeNull();
    expect(familyOf('')).toBeNull();
  });
});

describe('push vs replace', () => {
  it('entering the family is a new entry; cube to cube (and tab to tab) replaces', () => {
    const h = fakeHistory('');
    expect(h.nav.go('#cube/synergy')).toBe('push');
    expect(h.nav.go('#cube/vintage')).toBe('replace');
    expect(h.nav.go('#cube/omega')).toBe('replace');
    expect(h.nav.go('#cube/omega/guide')).toBe('replace');
    expect(h.stack()).toEqual(['', '#cube/omega/guide']);
  });
  it('leaving the family for another screen is a new entry', () => {
    const h = fakeHistory('');
    h.nav.go('#cube/synergy');
    expect(h.nav.go('#draft/setup?cube=synergy')).toBe('push');
    expect(h.nav.go('#cube/new')).toBe('push');
  });
});

describe('up a level', () => {
  it('after several cubes, Back goes to where the cubes were entered from in one step', () => {
    const h = fakeHistory('');
    h.nav.go('#cube/synergy');
    h.nav.go('#cube/vintage');
    h.nav.go('#cube/omega');
    expect(h.nav.entryOf('cube')).toBe('');
    expect(h.nav.up()).toBe('back');
    expect(h.at()).toBe('');
  });
  it('the browser’s own back leaves in one step too', () => {
    const h = fakeHistory('#draft/setup');
    h.nav.go('#cube/synergy');
    h.nav.go('#cube/vintage');
    h.browserBack();
    expect(h.at()).toBe('#draft/setup');
  });
  it('entered from another screen (Draft setup), Back returns there, not to a list', () => {
    const h = fakeHistory('#draft/setup');
    h.nav.go('#cube/synergy');
    h.nav.go('#cube/vintage');
    h.nav.up();
    expect(h.at()).toBe('#draft/setup');
  });
  it('a cube page opened directly goes up to the cubes list', () => {
    const h = fakeHistory('#cube/vintage');
    h.nav.go('#cube/omega');
    expect(h.nav.up()).toBe('#draft/setup');
    expect(h.at()).toBe('#draft/setup');
  });
  it('back from the builder to a cube page, then up: still where the cubes were entered from', () => {
    const h = fakeHistory('');
    h.nav.go('#cube/synergy');
    h.nav.go('#cube/new');
    h.browserBack();
    expect(h.at()).toBe('#cube/synergy');
    h.nav.up();
    expect(h.at()).toBe('');
  });
  it('a watch: from the watch list to a watch, Back to the list; a watch opened directly goes up to the list', () => {
    const h = fakeHistory('#watch');
    h.nav.go('#watch/watch-a-1');
    h.nav.up();
    expect(h.at()).toBe('#watch');
    expect(h.stack()).toEqual(['#watch']);
    const d = fakeHistory('#watch/watch-a-1');
    expect(d.nav.up()).toBe('#watch');
  });
  it('practice: puzzle to next puzzle replaces; Back to the puzzle list in one step', () => {
    const h = fakeHistory('#practice');
    h.nav.go('#practice/p1');
    h.nav.go('#practice/p2');
    h.nav.go('#practice/p3');
    h.nav.up();
    expect(h.stack()).toEqual(['#practice']);
  });
});

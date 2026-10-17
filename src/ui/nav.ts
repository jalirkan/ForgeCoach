/*
 * ForgeCoach — ui/nav.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Sibling pages reached from one list — a cube's page and the next cube's,
 * a watch, a practice puzzle — and the way back up (Justin's play test,
 * 2026-10-17: after viewing several cubes, Back stepped through each one
 * before reaching the list).
 *
 *   - Going from one sibling to another (or between a page's tabs) REPLACES
 *     the history entry, so the browser's own back leaves the family in one
 *     step.
 *   - The app's own Back goes UP A LEVEL: to the screen the family was
 *     entered from (the list, or wherever the player came from), which —
 *     since every move inside the family replaced — is exactly one history
 *     entry behind; on a page opened directly (nothing entered it during this
 *     visit) it goes to the family's list instead.
 *
 * The entry is tracked in app state from the hash changes this page sees,
 * never by reading the browser's history. Pure apart from `browserNav`;
 * tested with a fake environment (nav.test.ts).
 */

export interface Family {
  id: string;
  /** A hash on one of the family's pages. */
  is: (hash: string) => boolean;
  /** Up a level when the family was not entered during this visit (a page opened directly). */
  list: string;
}

export const FAMILIES: readonly Family[] = [
  // #cube/<id>[/guide], not the builder (#cube/new, #cube/edit/<id>): a screen of its own.
  { id: 'cube', is: (h) => /^#cube\/(?!new\b|edit\b)[\w-]+/.test(h), list: '#draft/setup' },
  { id: 'watch', is: (h) => /^#watch\/./.test(h), list: '#watch' },
  { id: 'practice', is: (h) => /^#practice\/./.test(h), list: '#practice' },
];

export const familyOf = (hash: string): Family | null => FAMILIES.find((f) => f.is(hash)) ?? null;

export interface NavEnv {
  hash: () => string;
  /** A new history entry. */
  push: (hash: string) => void;
  /** This history entry, changed in place (and the page told, as a hash change would). */
  replace: (hash: string) => void;
  back: () => void;
}

export class Navigator {
  /** Each family entered during this visit, by the hash it was entered from. */
  private readonly entered = new Map<string, string>();
  private last: string;

  constructor(private readonly env: NavEnv) {
    this.last = env.hash();
  }

  /** Every hash change the page sees (App's listener and our own `replace`). */
  observe(next: string = this.env.hash()): void {
    const prev = this.last;
    this.last = next;
    const from = familyOf(prev);
    const to = familyOf(next);
    if (to && from?.id !== to.id) this.entered.set(to.id, prev);
    // Left the family for good (up, or anywhere else): forget how it was entered.
    if (from && to?.id !== from.id && !to) this.entered.delete(from.id);
  }

  /** The hash a family was entered from during this visit, or null. */
  entryOf(id: string): string | null {
    return this.entered.get(id) ?? null;
  }

  /** To `hash`: a sibling of the page shown replaces it; anything else is a new entry. */
  go(hash: string): 'replace' | 'push' {
    const here = familyOf(this.env.hash());
    if (here && here.is(hash) && familyOf(hash)?.id === here.id) {
      this.env.replace(hash);
      this.observe(hash);
      return 'replace';
    }
    this.env.push(hash);
    return 'push';
  }

  /** Up a level from the family shown: back to where it was entered from, else its list. */
  up(): 'back' | string {
    const here = familyOf(this.env.hash());
    if (here && this.entered.has(here.id)) {
      this.env.back();
      return 'back';
    }
    const target = here?.list ?? '';
    this.env.replace(target);
    this.observe(target);
    return target;
  }
}

/** The page's own navigator, watching every hash change. */
function browserNav(): Navigator {
  const env: NavEnv = {
    hash: () => location.hash,
    push: (h) => {
      location.hash = h;
    },
    replace: (h) => {
      history.replaceState(null, '', h || location.pathname + location.search);
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    },
    back: () => history.back(),
  };
  const nav = new Navigator(env);
  window.addEventListener('hashchange', () => nav.observe());
  return nav;
}

let shared: Navigator | null = null;
/** The page's navigator (created on first use). */
export function nav(): Navigator {
  if (!shared) shared = browserNav();
  return shared;
}

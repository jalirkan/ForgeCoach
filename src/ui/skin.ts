/*
 * ForgeCoach — ui/skin.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The site's skin (Classic, Stack, Hot Felt): `data-skin` on the root element,
 * from Settings (claude.ts `skin`, localStorage) or, for a quick preview that is
 * not saved, a `?skin=` URL parameter (also read from the hash, `#…&skin=felt`).
 * The tokens and the few skin-scoped rules live in ui/skins.css; Classic adds
 * none, so it renders exactly as before.
 */
import { DEFAULT_SKIN, isSkin, loadSettings, onSettingsChange, type Skin } from '../claude.ts';

/** A `skin` parameter in the query or the hash, or null when absent or unknown. */
export function skinFromUrl(search: string, hash = ''): Skin | null {
  const read = (q: string) => {
    try {
      return new URLSearchParams(q).get('skin');
    } catch {
      return null;
    }
  };
  const fromSearch = read(search.replace(/^\?/, ''));
  if (isSkin(fromSearch)) return fromSearch;
  // The hash may carry its own query after a route (#lab?src=…&skin=stack) or be one (#sample=…&skin=felt).
  const h = hash.replace(/^#/, '');
  const fromHash = read(h.includes('?') ? h.slice(h.indexOf('?') + 1) : h);
  return isSkin(fromHash) ? fromHash : null;
}

/** The skin to show: a URL preview first, then the saved setting, then Classic. */
export function resolveSkin(saved: unknown, search = '', hash = ''): Skin {
  return skinFromUrl(search, hash) ?? (isSkin(saved) ? saved : DEFAULT_SKIN);
}

/** Puts the skin on the root element (and the browser's theme colour). */
export function applySkin(root: { setAttribute(name: string, value: string): void }, skin: Skin): void {
  root.setAttribute('data-skin', skin);
  if (typeof document === 'undefined') return;
  const meta = document.querySelector('meta[name="theme-color"]');
  meta?.setAttribute('content', THEME_COLOR[skin]);
}

/** Each skin's page background (`--bg` in ui/styles.css and ui/skins.css), for the browser's bar and the installed app's title bar. */
export const THEME_COLOR: Record<Skin, string> = { classic: '#0e1014', stack: '#121417', felt: '#1a312b' };

/** At start-up: apply the skin, and follow Settings when it is saved. */
export function initSkin(): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  try {
    applySkin(root, resolveSkin(loadSettings().skin, location.search, location.hash));
  } catch {
    applySkin(root, DEFAULT_SKIN);
  }
  // Saving Settings is the player choosing: it wins over a preview link.
  onSettingsChange(() => applySkin(root, loadSettings().skin ?? DEFAULT_SKIN));
}

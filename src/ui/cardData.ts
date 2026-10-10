/*
 * ForgeCoach — ui/cardData.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Bridges cards.ts (async Scryfall cache) to React: a version counter that
 * bumps whenever new card data lands, so memoised tiles re-render once.
 */
import { useEffect, useMemo, useSyncExternalStore } from 'react';
import type { CardInfo } from '../cards.ts';
import type { TokenSource } from '../cards.ts';
import { getCachedCard, getCachedToken, getCards, getToken, initCardCache, isLookupName, tokenRef } from '../cards.ts';

let version = 0;
const listeners = new Set<() => void>();
const requested = new Set<string>();

function bump() {
  version++;
  for (const l of listeners) l();
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

let initStarted = false;
function ensureInit() {
  if (initStarted) return;
  initStarted = true;
  initCardCache()
    .then(bump)
    .catch(() => undefined);
}

/** Fetches every not-yet-requested name in the background; bumps the version per batch. */
export function prefetchCards(names: string[]): void {
  ensureInit();
  const fresh = names.filter((n) => isLookupName(n) && !requested.has(n));
  if (fresh.length === 0) return;
  for (const n of fresh) requested.add(n);
  // Smaller chunks so the first tiles light up quickly.
  for (let i = 0; i < fresh.length; i += 40) {
    getCards(fresh.slice(i, i + 40))
      .then(bump)
      .catch(() => undefined);
  }
}

export function useCardsVersion(): number {
  const snap = () => version;
  return useSyncExternalStore(subscribe, snap, snap);
}

/** Cached card info for a name (undefined until it arrives). */
export function useCardInfo(name: string | null | undefined): CardInfo | undefined {
  const v = useCardsVersion();
  return useMemo(() => (name ? safeCached(name) : undefined), [name, v]);
}

const tokensRequested = new Set<string>();

/**
 * Card info for a wire card: a real card by name, a token by what it is (base
 * name, types, base P/T — one Scryfall search per distinct token, once per
 * session). Undefined until it arrives, and for a token Scryfall has no art for.
 */
export function useTileCardInfo(card: TokenSource, name: string | null | undefined): CardInfo | undefined {
  const ref = useMemo(() => tokenRef(card), [card.name, card.token, card.types, card.power, card.toughness, card.counters]);
  const v = useCardsVersion();
  const real = useCardInfo(ref ? null : name);
  const key = ref?.key;
  useEffect(() => {
    if (!ref || tokensRequested.has(ref.key)) return;
    tokensRequested.add(ref.key);
    ensureInit();
    getToken(ref)
      .then(bump)
      .catch(() => undefined);
  }, [key]);
  return useMemo(() => (ref ? getCachedToken(ref) : real), [ref, real, v]);
}

export function safeCached(name: string): CardInfo | undefined {
  try {
    return getCachedCard(name);
  } catch {
    return undefined;
  }
}

/** A Map of whatever is cached for these names (for state.ts helpers). */
export function cachedMap(names: string[]): Map<string, CardInfo> {
  const m = new Map<string, CardInfo>();
  for (const n of names) {
    const c = safeCached(n);
    if (c) m.set(n, c);
  }
  return m;
}

/** Card data for a prompt: tries the network, falls back to the cache. */
export async function cardsForPrompt(names: string[]): Promise<Map<string, CardInfo>> {
  try {
    const m = await getCards(names);
    bump();
    return m;
  } catch {
    return cachedMap(names);
  }
}

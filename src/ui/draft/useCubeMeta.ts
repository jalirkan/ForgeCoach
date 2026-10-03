/*
 * ForgeCoach — ui/draft/useCubeMeta.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * What each card is, for the shared Collection: the cube's facts plus
 * Scryfall's rarity, refreshed as card data arrives.
 */
import { useMemo } from 'react';
import type { CubeContext } from '../../cube/score.ts';
import { metaFromCube, type MetaOf } from '../../draft/poolView.ts';
import { safeCached, useCardsVersion } from '../cardData.ts';

export function useCubeMeta(ctx: CubeContext | null): MetaOf | null {
  const v = useCardsVersion();
  return useMemo(() => (ctx ? metaFromCube(ctx, (n) => safeCached(n)?.rarity) : null), [ctx, v]);
}

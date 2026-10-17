/*
 * ForgeCoach — ui/tableDeckLoad.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * What building Play vs Bot's table decks needs in the browser
 * (play/tableBuild.ts `DeckDeps`): a cube's context — its document, card data
 * and lab meta (imported first, as Draft & build reads it) — and what this
 * browser has saved. Loaded lazily with the builder.
 */
import { getCards } from '../cards.ts';
import { cubeInfo, loadCubeDoc, loadShippedMeta } from '../cube/cubes.ts';
import { getImportedMeta } from '../cube/metaStore.ts';
import { listPools } from '../cube/pools.ts';
import { makeContext, type CubeContext } from '../cube/score.ts';
import { loadDraft } from '../draft/store.ts';
import { newSeed } from '../draft/rng.ts';
import type { DeckDeps } from '../play/tableBuild.ts';

const BASE = import.meta.env.BASE_URL;
const ctxCache = new Map<string, Promise<CubeContext>>();

function loadCtx(cubeId: string): Promise<CubeContext> {
  const info = cubeInfo(cubeId);
  if (!info) return Promise.reject(new Error(`Unknown cube “${cubeId}”.`));
  // A custom cube saved again is another cube (cube/custom.ts).
  const key = `${cubeId}@${info.version ?? ''}`;
  let p = ctxCache.get(key);
  if (!p) {
    p = (async () => {
      const cube = await loadCubeDoc(info, BASE);
      const [infos, shipped, imported] = await Promise.all([getCards(cube.cards.map((c) => c.name)).catch(() => null), loadShippedMeta(info, BASE), getImportedMeta(info.id)]);
      return makeContext(cube, infos, imported ?? shipped);
    })();
    p.catch(() => ctxCache.delete(key));
    ctxCache.set(key, p);
  }
  return p;
}

export function tableDeckDeps(): DeckDeps {
  return {
    loadCtx,
    draft: loadDraft(),
    pools: listPools(),
    seed: newSeed(),
    cubeTitle: (id) => cubeInfo(id)?.title ?? id,
  };
}

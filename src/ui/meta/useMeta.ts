/*
 * ForgeCoach — ui/meta/useMeta.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Loads what the Cube metagame page shows for one cube: the cube lab meta (an
 * imported file from the deck assistant wins over the one shipped beside the
 * cube) and the cube document's theme names.
 */
import { useEffect, useState } from 'react';
import { cubeInfo, loadCubeDoc, loadShippedMeta } from '../../cube/cubes.ts';
import type { CubeMeta } from '../../cube/meta.ts';
import { getImportedMeta } from '../../cube/metaStore.ts';

export interface MetaState {
  loading: boolean;
  meta: CubeMeta | null;
  source: 'imported' | 'shipped' | null;
  /** Theme code → name, from the cube document's theme table. */
  themes: Record<string, string>;
}

const BASE = import.meta.env.BASE_URL;

export function useMeta(cubeId: string): MetaState {
  const [state, setState] = useState<MetaState>({ loading: true, meta: null, source: null, themes: {} });
  useEffect(() => {
    const info = cubeInfo(cubeId);
    setState({ loading: true, meta: null, source: null, themes: {} });
    if (!info) {
      setState({ loading: false, meta: null, source: null, themes: {} });
      return;
    }
    let live = true;
    Promise.all([
      getImportedMeta(info.id).catch(() => null),
      loadShippedMeta(info, BASE),
      loadCubeDoc(info, BASE).catch(() => null),
    ]).then(([imported, shipped, cube]) => {
      if (!live) return;
      const themes = Object.fromEntries((cube?.themes ?? []).map((t) => [t.code, t.name]));
      setState({ loading: false, meta: imported ?? shipped, source: imported ? 'imported' : shipped ? 'shipped' : null, themes });
    });
    return () => {
      live = false;
    };
  }, [cubeId]);
  return state;
}

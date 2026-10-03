/*
 * ForgeCoach — ui/meta/useMeta.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Loads what the Cube metagame page shows for one cube: the cube lab meta (an
 * imported file from the deck assistant wins over the one shipped beside the
 * cube) and the cube document's theme names.
 */
import { useCallback, useEffect, useState } from 'react';
import { cubeInfo, loadCubeDoc, loadShippedMeta } from '../../cube/cubes.ts';
import type { CubeMeta } from '../../cube/meta.ts';
import { getImportedMeta } from '../../cube/metaStore.ts';

export interface MetaState {
  loading: boolean;
  meta: CubeMeta | null;
  source: 'imported' | 'shipped' | null;
  /** Theme code → name, from the cube document's theme table. */
  themes: Record<string, string>;
  /** Re-read the imported file (after an import or removal). */
  reload: () => void;
}

const BASE = import.meta.env.BASE_URL;

export function useMeta(cubeId: string): MetaState {
  const [state, setState] = useState<Omit<MetaState, 'reload'>>({ loading: true, meta: null, source: null, themes: {} });
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((n) => n + 1), []);
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
  }, [cubeId, tick]);
  return { ...state, reload };
}

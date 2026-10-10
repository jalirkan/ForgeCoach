/*
 * ForgeCoach — ui/meta/useAllMetas.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Every cube's lab meta (an imported file wins over the shipped one), for the
 * "Compare cubes" table. Cubes marked labData: false skip the shipped fetch.
 */
import { useEffect, useState } from 'react';
import { DRAFT_CUBES, loadShippedMeta } from '../../cube/cubes.ts';
import type { CompareInput } from '../../cube/flatness.ts';
import { getImportedMeta } from '../../cube/metaStore.ts';

const BASE = import.meta.env.BASE_URL;

/** `tick` changes when an import or removal should refresh the table. */
export function useAllMetas(tick: unknown): { loading: boolean; inputs: CompareInput[] } {
  const [state, setState] = useState<{ loading: boolean; inputs: CompareInput[] }>({ loading: true, inputs: [] });
  useEffect(() => {
    let live = true;
    Promise.all(
      DRAFT_CUBES.map(async (c): Promise<CompareInput> => {
        const imported = await getImportedMeta(c.id).catch(() => null);
        if (imported) return { id: c.id, title: c.title, meta: imported, source: 'imported' };
        const shipped = c.labData === false ? null : await loadShippedMeta(c, BASE);
        return { id: c.id, title: c.title, meta: shipped, source: shipped ? 'shipped' : null };
      }),
    ).then((inputs) => live && setState({ loading: false, inputs }));
    return () => {
      live = false;
    };
  }, [tick]);
  return state;
}

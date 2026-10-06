/*
 * ForgeCoach — ui/deck/useCubeData.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Loads a cube for the deck assistant: its document, the cube-lab meta (an
 * imported file wins over the one shipped beside the document), and card
 * data from Scryfall through cards.ts. The scoring context is rebuilt when
 * card data arrives, so the page works from the first paint (document
 * colours only) and sharpens a moment later. The matchup model's card
 * strengths (card-power.json, one file for every cube) are loaded once.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CardInfo } from '../../cards.ts';
import { getCards } from '../../cards.ts';
import { cubeInfo, loadCubeDoc, loadShippedMeta } from '../../cube/cubes.ts';
import { loadCardPower, type CardPowerData } from '../../cube/cardPower.ts';
import type { Cube } from '../../cube/parseCube.ts';
import { metaMatchesCube, type CubeMeta } from '../../cube/meta.ts';
import { getImportedMeta, setImportedMeta } from '../../cube/metaStore.ts';
import { makeContext, type CubeContext } from '../../cube/score.ts';
import { prefetchCards } from '../cardData.ts';

export type MetaSource = 'imported' | 'shipped' | null;

export interface CubeData {
  cube: Cube | null;
  ctx: CubeContext | null;
  meta: CubeMeta | null;
  metaSource: MetaSource;
  /** Card data has arrived (mana values, types, oracle text). */
  cardsReady: boolean;
  error: string | null;
  importMeta: (m: CubeMeta) => Promise<string | null>;
  clearImport: () => Promise<void>;
}

const BASE = import.meta.env.BASE_URL;

export function useCubeData(cubeId: string | null): CubeData {
  const [cube, setCube] = useState<Cube | null>(null);
  const [shipped, setShipped] = useState<CubeMeta | null>(null);
  const [imported, setImported] = useState<CubeMeta | null>(null);
  const [infos, setInfos] = useState<Map<string, CardInfo> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [power, setPower] = useState<CardPowerData | null>(null);

  useEffect(() => {
    let live = true;
    loadCardPower(BASE).then((p) => live && setPower(p));
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    setCube(null);
    setShipped(null);
    setImported(null);
    setInfos(null);
    setError(null);
    const info = cubeId ? cubeInfo(cubeId) : undefined;
    if (!info) return;
    let live = true;
    loadCubeDoc(info, BASE)
      .then((c) => {
        if (!live) return;
        setCube(c);
        const names = c.cards.map((x) => x.name);
        prefetchCards(names);
        getCards(names)
          .then((m) => live && setInfos(m))
          .catch(() => undefined);
      })
      .catch((e: unknown) => live && setError(e instanceof Error ? e.message : String(e)));
    loadShippedMeta(info, BASE).then((m) => live && setShipped(m));
    getImportedMeta(info.id).then((m) => live && setImported(m));
    return () => {
      live = false;
    };
  }, [cubeId]);

  const meta = imported ?? shipped;
  const metaSource: MetaSource = imported ? 'imported' : shipped ? 'shipped' : null;
  const ctx = useMemo(() => (cube ? makeContext(cube, infos, meta, power) : null), [cube, infos, meta, power]);
  const cardsReady = !!infos && [...infos.values()].some((i) => i.found);

  const importMeta = useCallback(
    async (m: CubeMeta) => {
      const info = cubeId ? cubeInfo(cubeId) : undefined;
      if (!info || !cube) return 'Open a cube first.';
      if (!metaMatchesCube(m, `${info.file}.md`, cube.title)) {
        return `That meta is for “${m.cube.name ?? m.cube.file ?? 'another cube'}”, not ${cube.title}.`;
      }
      await setImportedMeta(info.id, m);
      setImported(m);
      return null;
    },
    [cubeId, cube],
  );
  const clearImport = useCallback(async () => {
    if (!cubeId) return;
    await setImportedMeta(cubeId, null);
    setImported(null);
  }, [cubeId]);

  return { cube, ctx, meta, metaSource, cardsReady, error, importMeta, clearImport };
}

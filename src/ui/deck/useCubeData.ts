/*
 * ForgeCoach — ui/deck/useCubeData.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Loads a cube for the deck assistant: its document, the cube-lab meta (an
 * imported file wins over the one shipped beside the document), and card
 * data from Scryfall through cards.ts, and the cube's 17Lands human numbers
 * when it ships them (cube/human.ts; score.ts blends them into card values). The scoring context is rebuilt when
 * card data arrives, so the page works from the first paint (document
 * colours only) and sharpens a moment later.
 *
 * `standIn`: a cube this browser does not have (a friend's own cube in a
 * draft room, cube/custom.ts) is read as a plain list of the cards seen so
 * far, so the pick screen works; it grows as the room shows more.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CardInfo } from '../../cards.ts';
import { getCards } from '../../cards.ts';
import { cubeInfo, loadCubeDoc, loadShippedMeta } from '../../cube/cubes.ts';
import { parseCube, type Cube } from '../../cube/parseCube.ts';
import { metaMatchesCube, type CubeMeta } from '../../cube/meta.ts';
import { getImportedMeta, setImportedMeta } from '../../cube/metaStore.ts';
import { makeContext, type CubeContext } from '../../cube/score.ts';
import { prefetchCards } from '../cardData.ts';
import { humanCardsFor } from '../HumanNumbers.tsx';
import type { HumanCards } from '../../cube/human.ts';

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

/** A plain cube document of `names`, for a cube this browser does not have. */
export function standInDoc(title: string, names: string[]): string {
  return `# ${title.replace(/\s+/g, ' ').trim() || 'A cube'}\n\n## The list\n\n${[...new Set(names)].join('\n')}\n`;
}

export function useCubeData(cubeId: string | null, standIn?: { title: string; names: string[] } | null): CubeData {
  const [cube, setCube] = useState<Cube | null>(null);
  const [shipped, setShipped] = useState<CubeMeta | null>(null);
  const [imported, setImported] = useState<CubeMeta | null>(null);
  const [infos, setInfos] = useState<Map<string, CardInfo> | null>(null);
  const [human, setHuman] = useState<HumanCards | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setCube(null);
    setShipped(null);
    setImported(null);
    setInfos(null);
    setHuman(null);
    setError(null);
  }, [cubeId]);

  useEffect(() => {
    const info = cubeId ? cubeInfo(cubeId) : undefined;
    const doc = !info && standIn?.names.length ? standInDoc(standIn.title, standIn.names) : null;
    if (!info && !doc) return;
    let live = true;
    (info ? loadCubeDoc(info, BASE) : Promise.resolve(parseCube(doc!)))
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
    if (info) {
      loadShippedMeta(info, BASE).then((m) => live && setShipped(m));
      getImportedMeta(info.id).then((m) => live && setImported(m));
      if (info.humanData) humanCardsFor(info).then((h) => live && setHuman(h));
    }
    return () => {
      live = false;
    };
  }, [cubeId, standIn?.title, standIn?.names.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const meta = imported ?? shipped;
  const metaSource: MetaSource = imported ? 'imported' : shipped ? 'shipped' : null;
  const ctx = useMemo(() => (cube ? makeContext(cube, infos, meta, human) : null), [cube, infos, meta, human]);
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

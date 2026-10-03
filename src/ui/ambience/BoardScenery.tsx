/*
 * ForgeCoach — ui/ambience/BoardScenery.tsx
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The one hook a board needs for scenery: pass it as (part of) the Board's
 * `overlay`. Off by default; when off it renders nothing and the scenery
 * bundle is never loaded. Imports only the tiny prefs module.
 */
import { lazy, Suspense, useEffect, useState } from 'react';
import type { GameLog } from '../../log.ts';
import { currentPrefs, onSceneryPrefs } from '../../ambience/prefs.ts';

const SceneryLayer = lazy(() => import('./SceneryLayer.tsx'));

export function BoardScenery({ log, frameIndex, seat }: { log: GameLog | null | undefined; frameIndex: number; seat: number | null | undefined }) {
  const [on, setOn] = useState(() => currentPrefs().mode !== 'off');
  useEffect(() => {
    const check = () => setOn(currentPrefs().mode !== 'off');
    const off = onSceneryPrefs(check);
    window.addEventListener('hashchange', check);
    return () => {
      off();
      window.removeEventListener('hashchange', check);
    };
  }, []);
  if (!on || !log || seat === null || seat === undefined) return null;
  return (
    <Suspense fallback={null}>
      <SceneryLayer log={log} frameIndex={frameIndex} seat={seat} />
    </Suspense>
  );
}

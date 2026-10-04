/*
 * ForgeCoach — ui/winchance/WinChanceLine.tsx
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The win-chance line for a game on screen (GameView's timeline, the engine
 * review), or nothing when the setting is off or the helper has no model.
 * With a helper that explains (mtg-table D368) each drop says why it fell.
 */
import { useMemo } from 'react';
import type { GameLog } from '../../log.ts';
import { decisionDrops, DROP_THRESHOLD, evalPoints, type DecisionSpan } from '../../winChance.ts';
import { WinChanceChart } from './WinChance.tsx';
import { useDropWhy, useWinChanceModel, useWinSeries } from './useWinChance.ts';

const NO_DROPS: never[] = [];

export function WinChanceLine({
  log,
  decisions,
  current,
  onMarker,
}: {
  log: GameLog;
  /** The player's decisions: the frames each covers, and the id `onMarker` gets back. */
  decisions: readonly DecisionSpan[];
  current: number | null;
  onMarker: (id: number) => void;
}) {
  const model = useWinChanceModel();
  const series = useWinSeries(log, model);
  const positions = useMemo(() => (model ? evalPoints(log).map((p) => ({ frameIndex: p.frameIndex, turn: p.state.turn })) : []), [log, model]);
  const drops = useMemo(() => decisionDrops(series.points, decisions), [series.points, decisions]);
  // D368: why each drop fell, once the line is done (only from a helper that explains).
  const why = useDropWhy(log, model, series.done ? drops : NO_DROPS);
  if (!model) return null;
  return (
    <WinChanceChart
      positions={positions}
      points={series.points}
      drops={drops}
      current={current}
      done={series.done}
      error={series.error}
      onMarker={onMarker}
      threshold={Math.round(DROP_THRESHOLD * 100)}
      why={why}
    />
  );
}

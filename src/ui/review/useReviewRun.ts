/*
 * ForgeCoach — ui/review/useReviewRun.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Running an engine review from the page: does the coach helper offer
 * `/review` (its /health says `review: 1`), and one run at a time — queued,
 * running (with its stage), done (the report) or failed — polled every ~2 s
 * and stopped when the screen goes away.
 *
 * After a Draft vs AI match the cube list and the AI picks you saw go along
 * (draft/reviewInput.ts), so the engine draws the opponent's hidden cards from
 * the pool; other games send neither (the engine then uses basic lands). The
 * AI's deck is never sent: there is no field for it.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { GameLog } from '../../log.ts';
import { pageHelperTarget } from '../../coachHelper.ts';
import { reviewSupported, runReview, type ReviewRequest, type ReviewStage, type ReviewState } from '../../gameReviewClient.ts';
import type { ReviewReport } from '../../gameReview.ts';
import { cubeInfo, loadCubeDoc } from '../../cube/cubes.ts';
import { loadDraft } from '../../draft/store.ts';
import { draftReviewFields, isDraftMatch, type DraftReviewFields } from '../../draft/reviewInput.ts';

export interface RunView {
  state: ReviewState | 'starting';
  stage: ReviewStage | null;
  position: number | null;
  error: string | null;
  startedAt: number;
}

export const STAGE_WORDS: Record<ReviewStage, string> = {
  plan: 'Finding your decisions',
  triage: 'Quick grade of every decision',
  deepen: 'Grading the moments that matter, to the end of the game',
  report: 'Writing the report',
};

/** After a Draft vs AI match: the cube list and the AI picks you saw; any other game: nothing. */
async function opponentFields(log: GameLog): Promise<DraftReviewFields> {
  try {
    const saved = loadDraft();
    if (!saved || !isDraftMatch(log, saved)) return {};
    const info = cubeInfo(saved.draft.cubeId);
    if (!info) return {};
    const cube = await loadCubeDoc(info, import.meta.env.BASE_URL);
    return draftReviewFields(log, saved, cube.cards.map((c) => c.name));
  } catch {
    return {};
  }
}

export function useReviewRun(log: GameLog, onReport: (r: ReviewReport) => void) {
  const gameId = log.header?.gameId ?? '';
  const [available, setAvailable] = useState<boolean | null>(null);
  const [run, setRun] = useState<RunView | null>(null);
  const ctrl = useRef<AbortController | null>(null);
  const reportRef = useRef(onReport);
  reportRef.current = onReport;

  useEffect(() => {
    let live = true;
    void reviewSupported(pageHelperTarget()).then((ok) => live && setAvailable(ok));
    return () => {
      live = false;
      ctrl.current?.abort();
    };
  }, []);

  const start = useCallback(async () => {
    ctrl.current?.abort();
    const c = new AbortController();
    ctrl.current = c;
    const startedAt = Date.now();
    setRun({ state: 'starting', stage: null, position: null, error: null, startedAt });
    const opp = await opponentFields(log);
    if (c.signal.aborted) return;
    const req: ReviewRequest = { gameId, ...(log.seat === 0 || log.seat === 1 ? { seat: log.seat } : {}), ...opp };
    const r = await runReview(pageHelperTarget(), req, {
      signal: c.signal,
      onUpdate: (j) => !c.signal.aborted && setRun({ state: j.state, stage: j.stage, position: j.position, error: j.error, startedAt }),
    });
    if (c.signal.aborted) return;
    if (!r.ok) setRun({ state: 'failed', stage: null, position: null, error: r.message, startedAt });
    else if (r.state === 'done' && r.report) {
      setRun(null);
      reportRef.current(r.report);
    } else setRun({ state: 'failed', stage: r.stage, position: null, error: r.error ?? 'The review failed.', startedAt });
  }, [gameId, log]);

  const cancel = useCallback(() => {
    ctrl.current?.abort();
    ctrl.current = null;
    setRun(null);
  }, []);

  return { available, canRun: !!available && /^[A-Za-z0-9._-]{1,128}$/.test(gameId), run, start, cancel };
}

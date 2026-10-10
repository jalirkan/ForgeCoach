/*
 * ForgeCoach — ui/play/PlanView.tsx
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * One plan-mode answer (mtg-table D419): its PLAN: sentence as the headline,
 * the numbered steps as a checklist — ticked as the log shows them done
 * (livePlan/progress.ts), a step the check refused marked "can't be done: …"
 * (livePlan/check.ts) — and the coach's reasoning behind a Why toggle. While a
 * correction is asked, one line says so. A reply that never came in the steps
 * format is shown as it was written.
 */
import { useMemo, useState } from 'react';
import type { GameLog } from '../../log.ts';
import type { Answer } from '../answers.ts';
import { parsePlan, partialPlan } from '../../livePlan/parse.ts';
import { planPromptNames, reviewReply } from '../../livePlan/coach.ts';
import { planProgress } from '../../livePlan/progress.ts';
import { cachedMap, useCardsVersion } from '../cardData.ts';
import { Markdown } from '../Markdown.tsx';
import { IconCheck, IconChevronDown } from '../Icons.tsx';
import { cx } from '../util.ts';
import type { AdviceEntry } from './autoPlan.ts';
import { MAX_PLAN_CORRECTIONS, snapshotOf, type RunStatus } from './planRun.ts';

export function PlanView({ entry, answer, log, seat, run }: { entry: AdviceEntry; answer: Answer | undefined; log: GameLog | null; seat: number | null; run?: RunStatus | undefined }) {
  const [why, setWhy] = useState(false);
  const text = answer?.text ?? '';
  const streaming = answer?.status === 'streaming';
  const cardsV = useCardsVersion();
  const parsed = useMemo(() => (text && !streaming ? parsePlan(text) : null), [text, streaming]);
  const partial = useMemo(() => (streaming && text ? partialPlan(text) : null), [streaming, text]);
  const d = entry.decision;
  const review = useMemo(() => {
    if (!parsed?.ok || !d || !log || seat === null || !entry.moment) return null;
    try {
      const snap = snapshotOf(d);
      return reviewReply(text, log, snap, seat, cachedMap(planPromptNames(snap)), entry.moment);
    } catch {
      return null;
    }
    // log.frames grows; the check reads only the frames up to the moment
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parsed, d, seat, entry.moment, text, cardsV]);
  const frames = log?.frames.length ?? 0;
  const progress = useMemo(() => {
    if (!parsed?.ok || !d || !log || seat === null || !entry.moment) return null;
    try {
      return planProgress({
        steps: parsed.steps,
        frames: log.frames,
        from: d.frameIndex,
        me: seat,
        moment: { kind: entry.moment.kind, id: entry.moment.id, turn: d.state.turn, phase: d.state.phase },
      });
    } catch {
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parsed, d, seat, entry.moment, frames]);

  const reasking = run && run.phase === 'reasking' && run.problem;
  const status = reasking ? (
    <p className="plan-status pulse" role="status">
      Checked against the engine: {run.problem}. Asking the coach again (correction {run.attempt} of {MAX_PLAN_CORRECTIONS})…
    </p>
  ) : run?.phase === 'checking' ? (
    <p className="plan-status pulse" role="status">
      Checking the steps against the engine…
    </p>
  ) : entry.attempt ? (
    <p className="plan-status tiny muted">Corrected {entry.attempt === 1 ? 'once' : `${entry.attempt} times`} after the check.</p>
  ) : null;

  // advice asked in another coach style earlier in the game: as written
  if (!entry.moment) return text ? <Markdown text={text} streaming={streaming} /> : null;
  if (partial) {
    return (
      <div className="plan-view is-streaming">
        {status}
        {partial.plan ? <p className="plan-headline">{partial.plan}</p> : <p className="muted small pulse">Planning…</p>}
      </div>
    );
  }
  if (!parsed) return status;
  if (!parsed.ok) {
    return (
      <div className="plan-view is-raw">
        {status}
        {!reasking && <p className="tiny muted">This reply did not come as numbered steps ({parsed.error}), so it is shown as written.</p>}
        <Markdown text={text} />
      </div>
    );
  }
  const checks = review?.check?.steps ?? [];
  return (
    <div className={cx('plan-view', progress?.complete && 'is-complete')}>
      {status}
      <p className="plan-headline">{parsed.plan}</p>
      <ol className="plan-steps">
        {parsed.steps.map((s, i) => {
          const done = progress?.done[i] === true;
          const bad = checks[i] && !checks[i]!.ok ? checks[i]!.why : null;
          return (
            <li key={i} className={cx('plan-step', done && 'is-done', bad && 'is-bad')} data-step-done={done ? '' : undefined}>
              <span className="plan-mark" {...(done ? { role: 'img', 'aria-label': `step ${s.n}, done`, title: 'Done' } : { 'aria-hidden': true })}>
                {done ? <IconCheck size={12} /> : s.n}
              </span>
              <span className="plan-text">
                {s.raw.replace(/\s*(?:->|=>)\s*/, ' → ')}
                {bad && <span className="plan-bad">can’t be done: {bad}</span>}
              </span>
            </li>
          );
        })}
      </ol>
      {parsed.preamble && (
        <>
          <button className="link-btn plan-why-toggle" onClick={() => setWhy((w) => !w)} aria-expanded={why}>
            Why <IconChevronDown size={12} className={why ? 'rot' : ''} />
          </button>
          {why && <p className="plan-why">{parsed.preamble}</p>}
        </>
      )}
    </div>
  );
}

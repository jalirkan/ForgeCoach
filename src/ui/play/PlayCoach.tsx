/*
 * ForgeCoach — ui/play/PlayCoach.tsx
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The coach while you play. It advises; it never acts.
 *
 * - Auto-coach plans your next turn once per turn cycle, during the opponent's
 *   end step (autoPlan.ts says when), so the plan is there when your turn starts.
 *   The plan stays on screen through your turn and the opponent's next one,
 *   until the next cycle's plan replaces it or you ask for a new one.
 * - Ask about the exact moment any time; that answer sits above the plan and
 *   never clears it. A question about a moment the game has moved on from is
 *   stopped (its `claude` too), and keeps whatever it had written.
 * - Nothing is blanked because the opponent has priority: the last plan, the
 *   last answer and "Earlier advice" stay readable.
 * - At most one question at a time per seat for the plan and one for your own
 *   asks (answers.ts slots; the coach helper's replaceRunning, mtg-table D410).
 *
 * Live answers take Settings → Coach style: short commands by default, with
 * Claude Code's thinking capped at low (about twice as fast late in a game).
 */
import { memo, useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { AskBody, GameStateBody, InputBody } from '../../protocol.ts';
import type { GameLog } from '../../log.ts';
import type { Decision } from '../../decisions.ts';
import type { Prompt } from '../../prompt.ts';
import { slotKey, startAnswer, stopAnswer, useAnswer, type Answer } from '../answers.ts';
import { AnswerBox, AnswerHead, TerseView, coachPrompt, stoppedNote } from '../CoachPanel.tsx';
import { feedbackTarget } from '../../feedback.ts';
import { parseCoachAnswer, parseTerseAnswer } from '../../coachAnswer.ts';
import { Markdown } from '../Markdown.tsx';
import { IconBook, IconChevronDown, IconSpark, KindIcon, KIND_LABEL } from '../Icons.tsx';
import { stripRound } from '../Timeline.tsx';
import { cx, readLS, writeLS } from '../util.ts';
import { useCoachAvailability } from '../hooks.ts';
import { detectHelper } from '../../coachHelper.ts';
import { liveDecision, momentKey } from './liveDecision.ts';
import {
  adviceFor,
  askLabel,
  currentPlan,
  earlierAdvice,
  gameKeyOf,
  lastAsk,
  markPlanAsked,
  planDue,
  planKey,
  planLabel,
  plansAsked,
  recordAdvice,
  subscribeAdvice,
  type AdviceEntry,
} from './autoPlan.ts';
import './coach.css';

const AUTO_KEY = 'forgecoach.autoCoach';
export const AUTO_HELP = 'Plans your next turn during your opponent’s end step.';

/**
 * The live coach's supersede keys (D325), one per tab — a tab is one seat, also
 * at a table of two — and one for the plan, one for your own asks: a newer
 * question replaces an older one of the same kind in the coach helper's queue
 * and, with D410, while it runs.
 */
const TAB = Math.random().toString(36).slice(2, 10);
const PLAN_SUPERSEDE = `live-coach:${TAB}:plan`;
const ASK_SUPERSEDE = `live-coach:${TAB}:ask`;
const planSlot = (game: string) => `plan:${game}`;
const askSlot = (game: string) => `ask:${game}`;

function useAdvice(game: string | null): readonly AdviceEntry[] {
  return useSyncExternalStore(subscribeAdvice, () => adviceFor(game));
}

export const PlayCoach = memo(function PlayCoach({
  log,
  state,
  input,
  ask,
  seat,
  myMove,
  guideName,
  onOpenGuides,
  onOpenSettings,
  onCollapse,
}: {
  log: GameLog | null;
  state: GameStateBody | null;
  input: InputBody | null;
  ask: AskBody | null;
  seat: number | null;
  /** The engine is waiting on this seat (there is something to decide). */
  myMove: boolean;
  guideName: string | null;
  onOpenGuides: () => void;
  onOpenSettings: () => void;
  /** Desktop sidebar: fold the coach away (the phase steps stay). */
  onCollapse?: () => void;
}) {
  const [auto, setAuto] = useState(() => readLS(AUTO_KEY) === '1');
  // Auto-coach only asks when something can answer (Claude Code on the PC, or an API key).
  const availability = useCoachAvailability();
  const coachReady = availability.ready;
  const terse = (availability.settings.coachStyle ?? 'short') === 'short';
  const moment = useMemo(() => (log ? { log, state, input, ask, seat } : null), [log, state, input, ask, seat]);
  const key = moment && myMove ? momentKey(moment) : null;
  const decision: Decision | null = useMemo(() => (moment && myMove ? liveDecision(moment) : null), [moment, myMove]);
  const game = gameKeyOf(log, seat ?? log?.seat);
  const advice = useAdvice(game);

  // Your own question about the moment on screen.
  const askNow = useCallback(
    (k: string, d: Decision) => {
      if (!log || !game) return;
      recordAdvice(game, { key: k, kind: 'ask', label: askLabel(d), forTurn: null, decision: d });
      void startAnswer(k, () => coachPrompt(log, d, { live: true }), { supersedes: ASK_SUPERSEDE, replaceRunning: true, slot: askSlot(game), ...(terse ? { thinkingCap: 'low' as const } : {}) });
    },
    [log, game, terse],
  );

  // A plan for a turn: auto-coach's once per cycle, or yours from the plan's Ask again.
  const planNow = useCallback(
    (forTurn: number, d: Decision) => {
      if (!log || !game) return;
      const k = planKey(game, forTurn);
      recordAdvice(game, { key: k, kind: 'plan', label: planLabel(forTurn), forTurn, decision: d });
      void startAnswer(k, () => coachPrompt(log, d, { live: true, plan: { forTurn } }), { supersedes: PLAN_SUPERSEDE, replaceRunning: true, slot: planSlot(game), ...(terse ? { thinkingCap: 'low' as const } : {}) });
    },
    [log, game, terse],
  );

  // The decision moved on: your question about an earlier moment is stale, so stop it
  // (a waiting one leaves the helper's queue; a running one stops Claude Code). It keeps
  // what it had written. Runs on mount too: the panel may have been folded meanwhile.
  // The plan is never stale this way — it is for the whole turn.
  useEffect(() => {
    if (!game) return;
    const busy = slotKey(askSlot(game));
    if (busy && busy !== key) stopAnswer(busy, 'moved_on');
  }, [key, game]);

  // A new game: the last one's questions are stale.
  useEffect(() => {
    return () => {
      if (!game) return;
      for (const slot of [askSlot(game), planSlot(game)]) {
        const busy = slotKey(slot);
        if (busy) stopAnswer(busy, 'moved_on');
      }
    };
  }, [game]);

  // Auto-coach: one plan per turn cycle, at the opponent's end step (autoPlan.ts).
  useEffect(() => {
    if (!auto || !log || !game || !state) return;
    const due = planDue(state, seat ?? log.seat, plansAsked(game));
    if (due === null) return;
    if (!coachReady) {
      // Claude Code's helper may have started since we last looked (cached; asks at most every few seconds).
      void detectHelper();
      return;
    }
    const d = liveDecision({ log, state, input, ask, seat });
    if (!d) return;
    markPlanAsked(game, due);
    planNow(due, d);
  }, [auto, log, game, state, input, ask, seat, coachReady, planNow]);

  const current = useAnswer(key);
  const plan = currentPlan(advice);
  const prevAsk = lastAsk(advice, key);
  const earlier = earlierAdvice(advice, key);

  const makePrompt = useCallback(async () => {
    if (!log || !decision) throw new Error('Nothing to ask about yet.');
    return coachPrompt(log, decision, { live: true });
  }, [log, decision]);

  // Ask again on the plan: a fresh plan from the board as it is now.
  const replan = useCallback(() => {
    if (!log || !plan) return;
    const d = moment ? liveDecision(moment) : null;
    planNow(plan.forTurn ?? (state?.turn ?? 0) + 1, d ?? plan.decision);
  }, [log, plan, moment, state, planNow]);
  const planPrompt = useCallback(async () => {
    if (!log || !plan) throw new Error('No plan yet.');
    return coachPrompt(log, plan.decision, { live: true, plan: { forTurn: plan.forTurn ?? 0 } });
  }, [log, plan]);

  return (
    <div className="coach play-coach">
      <div className="pc-head">
        <div className="pc-title">Coach</div>
        <label className="switch" title={`${AUTO_HELP} Uses Claude Code on your PC, or your API key.`}>
          <input
            type="checkbox"
            checked={auto}
            onChange={(e) => {
              setAuto(e.target.checked);
              writeLS(AUTO_KEY, e.target.checked ? '1' : null);
            }}
          />
          <span className="switch-track" aria-hidden="true" />
          <span className="switch-label">Auto-coach</span>
        </label>
        {onCollapse && (
          <button className="icon-btn pc-collapse" onClick={onCollapse} aria-label="Hide the coach" title="Hide the coach">
            <IconChevronDown size={16} />
          </button>
        )}
      </div>
      <button className="guide-btn" onClick={onOpenGuides}>
        <IconBook size={14} />
        <span className="muted">Play guide</span>
        <span className="guide-name">{guideName ?? 'None'}</span>
        <IconChevronDown size={14} />
      </button>
      {decision && key && (current || !plan) ? (
        <div className="moment">
          <div className="moment-head">
            <span className={cx('kind-badge', `k-${decision.kind}`)}>
              <KindIcon kind={decision.kind} size={13} /> {KIND_LABEL[decision.kind]}
            </span>
            <h2 className="moment-title">
              <span className="muted">Round {decision.state.round} ·</span> {stripRound(decision.label)}
            </h2>
          </div>
          <AnswerBox
            answer={current}
            askLabel="Ask coach"
            idleText={
              auto
                ? `Auto-coach is on: it ${AUTO_HELP.charAt(0).toLowerCase()}${AUTO_HELP.slice(1)} Ask any time about this moment.`
                : 'What should you do right now? The coach sees the exact board, every card’s text, and your play guide.'
            }
            onAsk={() => askNow(key, decision)}
            onStop={() => stopAnswer(key)}
            makePrompt={makePrompt}
            onOpenSettings={onOpenSettings}
            structured
            terse={terse}
            feedback={feedbackTarget(log, decision.frameIndex, 'play')}
          />
        </div>
      ) : decision && key ? (
        // A plan is on screen: this moment is one line and a button, so the plan stays in view.
        <div className="card-box pc-ask-row">
          <span className="pc-ask-what">
            <KindIcon kind={decision.kind} size={13} /> {stripRound(decision.label)}
          </span>
          <button className="btn btn-quiet btn-sm" onClick={() => askNow(key, decision)} title="Ask the coach about this exact moment (the plan stays)">
            <IconSpark size={13} /> Ask about this
          </button>
        </div>
      ) : !plan ? (
        <div className="card-box notice pc-wait">
          <p className="muted small">
            {!state
              ? 'The coach wakes up once the game starts.'
              : auto
                ? `Waiting for your next decision. ${AUTO_HELP}`
                : 'Waiting for your next decision — the coach is ready when you are.'}
          </p>
        </div>
      ) : null}
      {plan && <PlanBox plan={plan} log={log} terse={terse} onAsk={replan} makePrompt={planPrompt} onOpenSettings={onOpenSettings} />}
      {prevAsk && <PastAdvice entry={prevAsk} terse={terse} />}
      {earlier.length > 0 && <EarlierAdvice entries={earlier} terse={terse} />}
      <p className="tiny muted pc-foot">The coach only advises — every move is yours.</p>
    </div>
  );
});

/** The plan for your turn: on screen until the next cycle's plan or your Ask again. */
function PlanBox({
  plan,
  log,
  terse,
  onAsk,
  makePrompt,
  onOpenSettings,
}: {
  plan: AdviceEntry;
  log: GameLog | null;
  terse: boolean;
  onAsk: () => void;
  makePrompt: () => Promise<Prompt>;
  onOpenSettings: () => void;
}) {
  const answer = useAnswer(plan.key);
  return (
    <div className="pc-plan">
      <AnswerBox
        answer={answer}
        askLabel="Plan my turn"
        idleText=""
        onAsk={onAsk}
        onStop={() => stopAnswer(plan.key)}
        makePrompt={makePrompt}
        onOpenSettings={onOpenSettings}
        structured
        terse={terse}
        title={plan.label}
        feedback={feedbackTarget(log, plan.decision.frameIndex, 'play')}
      />
    </div>
  );
}

/** The text of an answer that is no longer the moment on screen, read-only. */
function AnswerText({ answer, terse }: { answer: Answer | undefined; terse: boolean }) {
  const streaming = answer?.status === 'streaming';
  const text = answer?.text ?? '';
  const tp = useMemo(() => (terse && text ? parseTerseAnswer(text, { complete: !streaming }) : null), [terse, text, streaming]);
  const parts = useMemo(() => (!tp?.terse && text ? parseCoachAnswer(text, { complete: !streaming }) : null), [tp, text, streaming]);
  if (!answer) return <p className="muted small">Not asked in this session.</p>;
  return (
    <>
      {tp?.terse ? (
        <TerseView parts={tp} streaming={streaming} />
      ) : (
        <>
          {parts && (parts.answer || parts.rule || parts.confidence) && (
            <AnswerHead answer={parts.answer} rule={parts.rule} confidence={parts.confidence} why={parts.confidenceWhy} />
          )}
          {text && <Markdown text={parts ? parts.body : text} streaming={streaming} />}
        </>
      )}
      {!text && answer.status !== 'stopped' && answer.status !== 'error' && <p className="muted small pulse">Thinking…</p>}
      {answer.status === 'stopped' && <p className="notice-inline">{stoppedNote(answer)}</p>}
      {answer.status === 'error' && <p className="notice-inline bad">{answer.error}</p>}
    </>
  );
}

/** Your last question, once the game has moved on from it: still readable, labelled with its moment. */
function PastAdvice({ entry, terse }: { entry: AdviceEntry; terse: boolean }) {
  const answer = useAnswer(entry.key);
  const [open, setOpen] = useState(true);
  return (
    <div className="card-box answer pc-prev">
      <button className="box-h box-toggle" onClick={() => setOpen((s) => !s)} aria-expanded={open}>
        <span>Your question · {entry.label}</span>
        <IconChevronDown size={14} className={open ? 'rot' : ''} />
      </button>
      {open && <AnswerText answer={answer} terse={terse} />}
    </div>
  );
}

/** Older plans and questions, folded: a line each, opened one at a time. */
function EarlierAdvice({ entries, terse }: { entries: AdviceEntry[]; terse: boolean }) {
  const [open, setOpen] = useState(false);
  const [which, setWhich] = useState<string | null>(null);
  return (
    <div className="card-box pc-earlier">
      <button className="box-h box-toggle" onClick={() => setOpen((s) => !s)} aria-expanded={open}>
        <span>Earlier advice ({entries.length})</span>
        <IconChevronDown size={14} className={open ? 'rot' : ''} />
      </button>
      {open && (
        <ul className="pc-earlier-list">
          {entries.map((e) => (
            <li key={e.key}>
              <button className={cx('pc-earlier-item', which === e.key && 'is-open')} onClick={() => setWhich((w) => (w === e.key ? null : e.key))} aria-expanded={which === e.key}>
                {e.label}
              </button>
              {which === e.key && <EarlierItem entry={e} terse={terse} />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function EarlierItem({ entry, terse }: { entry: AdviceEntry; terse: boolean }) {
  const answer = useAnswer(entry.key);
  return (
    <div className="pc-earlier-body">
      <AnswerText answer={answer} terse={terse} />
    </div>
  );
}

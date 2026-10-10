/*
 * ForgeCoach — ui/play/PlanCoach.tsx
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The live coach in plan mode (Settings → Coach style: Steps, the default):
 * the way Claude Sonnet played its test games against Forge through
 * mtg-table's LLM seat (D419), except that the player, not a program, carries
 * the steps out. It advises; it never acts.
 *
 * - Auto-coach asks at the seat's moments (livePlan/moments.ts): the opening
 *   hand, the player's turn (after the draw), an opponent's spell they could
 *   answer, blocks, the opponent's end step when something could be cast, and
 *   an engine question the plan does not answer — each once, a fresh call each.
 * - Every reply is read and its steps checked against what the engine allows;
 *   a step that cannot be done goes back to the coach with the reason (at most
 *   two corrections, planRun.ts), and the panel says so while it happens.
 * - The newest plan stays on screen, its steps ticked as the log shows them
 *   done, until the next moment's plan; "Ask about this" asks the moment on
 *   screen in the same format. Earlier advice folds away below.
 */
import { memo, useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { AskBody, GameStateBody, InputBody } from '../../protocol.ts';
import type { GameLog } from '../../log.ts';
import { getAnswer, slotKey, stopAnswer, useAnswer } from '../answers.ts';
import { AnswerBox } from '../CoachPanel.tsx';
import { feedbackTarget } from '../../feedback.ts';
import { IconBook, IconChevronDown, IconSpark } from '../Icons.tsx';
import { cx, readLS, writeLS } from '../util.ts';
import { useCoachAvailability } from '../hooks.ts';
import { detectHelper } from '../../coachHelper.ts';
import { activeGuideText } from '../../guide.ts';
import { liveDecision } from './liveDecision.ts';
import { buildPlanPrompt, momentOf, planPromptNames } from '../../livePlan/coach.ts';
import { dueMoment, type PlanSoFar } from '../../livePlan/moments.ts';
import { oracleFromCards } from '../../livePlan/oracle.ts';
import { parsePlan } from '../../livePlan/parse.ts';
import { planProgress } from '../../livePlan/progress.ts';
import { visibleNames } from '../../livePlan/history.ts';
import { cachedMap, cardsForPrompt, prefetchCards } from '../cardData.ts';
import {
  adviceFor,
  baseAnswerKey,
  currentPlan,
  gameKeyOf,
  markMomentAsked,
  momentAnswerKey,
  momentsAsked,
  standInPlan,
  subscribeAdvice,
  type AdviceEntry,
} from './autoPlan.ts';
import { keepAdviceInBrowser, persistAdvice, restoreKeptAdvice } from './keepAdvice.ts';
import { sessionAdviceStorage } from './adviceStore.ts';
import { PlanView } from './PlanView.tsx';
import { runPlanMoment, snapshotOf, useRunStatus } from './planRun.ts';
import './coach.css';

const AUTO_KEY = 'forgecoach.autoCoach';
export const PLAN_AUTO_HELP = 'Asks at your opening hand, your turn, a spell of theirs you could answer, your blocks, their end step and the engine’s questions.';

const TAB = Math.random().toString(36).slice(2, 10);
const PLAN_SUPERSEDE = `live-coach:${TAB}:plan`;
const ASK_SUPERSEDE = `live-coach:${TAB}:ask`;
const planSlot = (game: string) => `plan:${game}`;
const askSlot = (game: string) => `ask:${game}`;
const askKey = (game: string, momentId: string) => `${game}:live:ask:${momentId}`;

function useAdvice(game: string | null): readonly AdviceEntry[] {
  return useSyncExternalStore(subscribeAdvice, () => adviceFor(game));
}

/** The newest plan of this turn and how far it got: an engine question it answers is not asked again. */
function planSoFar(advice: readonly AdviceEntry[], log: GameLog, seat: number, turn: number): PlanSoFar | null {
  const e = advice.find((x) => x.moment && x.decision && x.decision.state.turn === turn);
  if (!e || !e.decision || !e.moment) return null;
  const text = getAnswer(e.key)?.text;
  const p = text ? parsePlan(text) : null;
  if (!p || !p.ok) return null;
  const pr = planProgress({ steps: p.steps, frames: log.frames, from: e.decision.frameIndex, me: seat, moment: { kind: e.moment.kind, id: e.moment.id, turn: e.decision.state.turn, phase: e.decision.state.phase } });
  return { steps: p.steps, done: pr.done };
}

export const PlanCoach = memo(function PlanCoach({
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
  myMove: boolean;
  guideName: string | null;
  onOpenGuides: () => void;
  onOpenSettings: () => void;
  onCollapse?: () => void;
}) {
  const [auto, setAuto] = useState(() => readLS(AUTO_KEY) === '1');
  const availability = useCoachAvailability();
  const coachReady = availability.ready;
  const me = seat ?? log?.seat ?? null;
  const game = gameKeyOf(log, me);
  const advice = useAdvice(game);

  // Card text for the moments' mana checks (the prompt itself fetches what it needs).
  useEffect(() => {
    if (state) prefetchCards(visibleNames(state));
  }, [state]);

  // The moment on screen, for "Ask about this" (any decision of the player's).
  const decision = useMemo(() => (log && state && myMove ? liveDecision({ log, state, input, ask, seat }) : null), [log, state, input, ask, seat, myMove]);
  const nowMoment = useMemo(() => {
    if (!log || !decision || me === null) return null;
    try {
      return momentOf(log, snapshotOf(decision), me, oracleFromCards(cachedMap(visibleNames(decision.state))), { force: true, plan: planSoFar(advice, log, me, decision.state.turn) });
    } catch {
      return null;
    }
  }, [log, decision, me, advice]);
  const nowAskBase = game && nowMoment ? askKey(game, nowMoment.id) : null;

  // A reload: this game's advice and the moments asked come back first (adviceStore.ts).
  useEffect(() => {
    if (!game || !log || me === null) return;
    keepAdviceInBrowser();
    restoreKeptAdvice(game, sessionAdviceStorage(), log, me);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game]);
  useEffect(() => {
    if (game && advice.length) persistAdvice(game, sessionAdviceStorage(), log);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game, advice]);

  // Your own question about a moment the game has moved on from: stopped (it keeps its text).
  useEffect(() => {
    if (!game) return;
    const busy = slotKey(askSlot(game));
    if (busy && baseAnswerKey(busy) !== nowAskBase) stopAnswer(busy, 'moved_on');
  }, [nowAskBase, game]);

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

  // Auto-coach: the seat's moments, each asked once.
  useEffect(() => {
    if (!auto || !log || !game || !state || !myMove || me === null) return;
    const d = liveDecision({ log, state, input, ask, seat });
    if (!d) return;
    const oracle = oracleFromCards(cachedMap(visibleNames(state)));
    const m = dueMoment({ frames: log.frames, state, input, ask, me, oracle, plan: planSoFar(adviceFor(game), log, me, state.turn) }, momentsAsked(game));
    if (!m) return;
    if (!coachReady) {
      void detectHelper();
      return;
    }
    markMomentAsked(game, m.id);
    void runPlanMoment({ game, base: momentAnswerKey(game, m.id), kind: 'plan', moment: m, log, seat: me, decision: d, slot: planSlot(game), supersedes: PLAN_SUPERSEDE });
  }, [auto, log, game, state, input, ask, seat, me, myMove, coachReady]);

  const askNow = useCallback(() => {
    if (!log || !game || !decision || !nowMoment || me === null) return;
    void runPlanMoment({ game, base: askKey(game, nowMoment.id), kind: 'ask', moment: nowMoment, log, seat: me, decision, slot: askSlot(game), supersedes: ASK_SUPERSEDE });
  }, [log, game, decision, nowMoment, me]);

  // The prompt for the moment on screen (Copy prompt without asking).
  const nowPrompt = useCallback(async () => {
    if (!log || !decision || !nowMoment || me === null) throw new Error('Nothing to ask about yet.');
    const snap = snapshotOf(decision);
    return buildPlanPrompt(log, snap, me, await cardsForPrompt(planPromptNames(snap)), nowMoment.question, { guide: safeGuide(), moment: nowMoment });
  }, [log, decision, nowMoment, me]);

  const plan = currentPlan(advice);
  const planAnswer = useAnswer(plan?.key ?? null);
  const standIn = standInPlan(advice, !!planAnswer?.text);
  // your newest own question, shown above the plan while it is newer than it
  const ownAsk = advice.find((e) => e.kind === 'ask') ?? null;
  const showAsk = ownAsk && (!plan || ownAsk.seq > plan.seq) ? ownAsk : null;
  const earlier = advice.filter((e) => e.key !== plan?.key && e.key !== showAsk?.key && e.key !== standIn?.key);
  // the moment on screen already has advice (auto-coach's plan for it, or your question): no second button
  const askedNow = !!(nowMoment && ((ownAsk && nowAskBase && baseAnswerKey(ownAsk.key) === nowAskBase) || (plan?.moment && plan.moment.id === nowMoment.id)));

  return (
    <div className="coach play-coach plan-coach">
      <div className="pc-head">
        <div className="pc-title">Coach</div>
        <label className="switch" title={`${PLAN_AUTO_HELP} Answers come from Claude Code on your PC or your API key (Settings → Coach source).`}>
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
      {nowMoment && !askedNow && !plan && !showAsk ? (
        // Nothing on screen yet: the full box, so "Copy prompt" works with no coach connected.
        <AnswerBox
          answer={undefined}
          askLabel="Ask coach"
          idleText={auto ? `Auto-coach is on: it ${PLAN_AUTO_HELP.charAt(0).toLowerCase()}${PLAN_AUTO_HELP.slice(1)} Ask any time about this moment.` : 'What should you do right now? The coach answers in steps, checked against what the engine allows.'}
          onAsk={askNow}
          onStop={() => undefined}
          makePrompt={nowPrompt}
          onOpenSettings={onOpenSettings}
          title={nowMoment.label}
        />
      ) : nowMoment && !askedNow && (
        <div className="card-box pc-ask-row">
          <span className="pc-ask-what">{nowMoment.label}</span>
          <button className="btn btn-quiet btn-sm" onClick={askNow} title="Ask the coach for steps for this exact moment (the plan stays)">
            <IconSpark size={13} /> Ask about this
          </button>
        </div>
      )}
      {showAsk && <PlanBox entry={showAsk} log={log} seat={me} title={`Your question · ${showAsk.label}`} onOpenSettings={onOpenSettings} slot={game ? askSlot(game) : null} supersedes={ASK_SUPERSEDE} />}
      {plan && <PlanBox entry={plan} log={log} seat={me} title={plan.label} onOpenSettings={onOpenSettings} slot={game ? planSlot(game) : null} supersedes={PLAN_SUPERSEDE} />}
      {standIn && (
        <div className="card-box answer pc-prev pc-standin" data-standin-plan="">
          <div className="box-h">
            <span>Last plan · {standIn.label}</span>
          </div>
          <p className="tiny muted pc-standin-note">Kept here until the new plan is ready.</p>
          <ReadOnlyPlan entry={standIn} log={log} seat={me} />
        </div>
      )}
      {!plan && !showAsk && !(nowMoment && !askedNow) && (
        <div className="card-box notice pc-wait">
          <p className="muted small">
            {!state
              ? 'The coach wakes up once the game starts.'
              : auto
                ? `Waiting for a moment worth a plan. ${PLAN_AUTO_HELP}`
                : 'Turn on Auto-coach for a plan at each moment that matters, or ask about this moment.'}
          </p>
        </div>
      )}
      {earlier.length > 0 && <EarlierPlans entries={earlier} log={log} seat={me} />}
      <p className="tiny muted pc-foot">The coach only advises — every move is yours. Its steps are checked against what the engine allows.</p>
    </div>
  );
});

/** A plan (auto-coach's or your own question's): the checklist, its status, feedback and buttons. */
function PlanBox({
  entry,
  log,
  seat,
  title,
  onOpenSettings,
  slot,
  supersedes,
}: {
  entry: AdviceEntry;
  log: GameLog | null;
  seat: number | null;
  title: string;
  onOpenSettings: () => void;
  slot: string | null;
  supersedes: string;
}) {
  const answer = useAnswer(entry.key);
  const run = useRunStatus(baseAnswerKey(entry.key));
  const again = () => {
    if (!log || seat === null || !entry.decision || !entry.moment || !slot) return;
    const game = gameKeyOf(log, seat);
    if (!game) return;
    void runPlanMoment({ game, base: baseAnswerKey(entry.key), kind: entry.kind, moment: entry.moment, log, seat, decision: entry.decision, slot, supersedes });
  };
  const makePrompt = async () => {
    if (!log || seat === null || !entry.decision || !entry.moment) throw new Error('This plan’s moment is no longer in the log.');
    const snap = snapshotOf(entry.decision);
    return buildPlanPrompt(log, snap, seat, await cardsForPrompt(planPromptNames(snap)), entry.moment.question, { guide: safeGuide(), moment: entry.moment });
  };
  return (
    <div className="pc-plan">
      <AnswerBox
        answer={answer}
        askLabel="Plan this"
        idleText=""
        onAsk={again}
        onStop={() => stopAnswer(entry.key)}
        makePrompt={makePrompt}
        onOpenSettings={onOpenSettings}
        title={title}
        feedback={feedbackTarget(log, entry.frameIndex >= 0 ? entry.frameIndex : null, 'play')}
        body={<PlanView entry={entry} answer={answer} log={log} seat={seat} run={run} />}
      />
    </div>
  );
}

function safeGuide(): string | null {
  try {
    return activeGuideText() || null;
  } catch {
    return null;
  }
}

function ReadOnlyPlan({ entry, log, seat }: { entry: AdviceEntry; log: GameLog | null; seat: number | null }) {
  const answer = useAnswer(entry.key);
  if (!answer?.text) return <p className="muted small">Not asked in this session.</p>;
  return <PlanView entry={entry} answer={answer} log={log} seat={seat} />;
}

/** Older plans and questions, folded: a line each, opened one at a time. */
function EarlierPlans({ entries, log, seat }: { entries: AdviceEntry[]; log: GameLog | null; seat: number | null }) {
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
                {e.kind === 'ask' ? `Your question · ${e.label}` : e.label}
              </button>
              {which === e.key && (
                <div className="pc-earlier-body">
                  <ReadOnlyPlan entry={e} log={log} seat={seat} />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

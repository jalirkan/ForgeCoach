/*
 * ForgeCoach — ui/CoachPanel.tsx
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * "What you did" next to the coach's advice for the selected decision, and the
 * post-game review. Streaming answers live in answers.ts so they survive
 * scrubbing away and back.
 */
import { memo, useCallback, useMemo, useState, type ReactNode } from 'react';
import type { GameLog } from '../log.ts';
import type { Decision } from '../decisions.ts';
import { buildCoachPrompt, coachCardNames, promptAsText, type Prompt } from '../prompt.ts';
import { buildReviewPrompt, reviewCardNames, summarizeGame } from '../review.ts';
import { loadCubeCoachInput, type CubeCoachInput, type MetaLookups } from '../cube/coachContext.ts';
import { loadShippedMeta } from '../cube/cubes.ts';
import type { CubeMeta } from '../cube/meta.ts';
import { getImportedMeta } from '../cube/metaStore.ts';
import { activeGuideText as guideText } from '../guide.ts';
import { loadSettings, MODELS } from '../claude.ts';
import { parseCoachAnswer, type StatedConfidence } from '../coachAnswer.ts';
import { SOURCE_LABEL } from '../coachHelper.ts';
import { useCoachAvailability, useNowWhile } from './hooks.ts';
import { isHelperThinking, thinkingLine } from './coachWait.ts';
import { startAnswer, stopAnswer, useAnswer, type Answer } from './answers.ts';
import { cardsForPrompt } from './cardData.ts';
import { Markdown } from './Markdown.tsx';
import { AdviceFeedback } from './AdviceFeedback.tsx';
import { feedbackTarget, type FeedbackTarget } from '../feedback.ts';
import { ManaCost } from './Mana.tsx';
import { IconBook, IconCheck, IconChevronDown, IconCopy, IconSpark, IconStop, IconTrophy, KindIcon, KIND_LABEL } from './Icons.tsx';
import { stripRound } from './Timeline.tsx';
import { copyText, cx } from './util.ts';

export function gameKey(log: GameLog): string {
  return `${log.header.gameId}@${log.header.startedAt}`;
}

function activeGuideText(): string | undefined {
  try {
    return guideText() || undefined;
  } catch {
    return undefined;
  }
}

/** Answers are keyed by the decision's state frame, which survives re-extraction. */
export function decisionKey(log: GameLog, d: Decision): string {
  return `${gameKey(log)}:f${d.frameIndex}`;
}

function safe<T>(f: () => T, fallback: T): T {
  try {
    return f();
  } catch {
    return fallback;
  }
}

const BASE = import.meta.env.BASE_URL;
const shippedCache = new Map<string, Promise<CubeMeta | null>>();
const cachedLookups: MetaLookups = {
  imported: getImportedMeta,
  shipped: (info) => {
    let p = shippedCache.get(info.id);
    if (!p) shippedCache.set(info.id, (p = loadShippedMeta(info, BASE)));
    return p;
  },
};

/** The cube context input for a game, or undefined when it isn't a cube game (never throws). */
async function cubeFor(log: GameLog): Promise<CubeCoachInput | undefined> {
  try {
    return await loadCubeCoachInput(log, cachedLookups);
  } catch {
    return undefined;
  }
}

export async function coachPrompt(log: GameLog, d: Decision): Promise<Prompt> {
  const names = safe(() => coachCardNames(log, d), [] as string[]);
  const cards = await cardsForPrompt(names);
  const guide = activeGuideText();
  const cube = await cubeFor(log);
  return buildCoachPrompt(log, d, cards, { ...(guide ? { guide } : {}), ...(cube ? { cube } : {}), format: answerFirstSetting() ? 'answer-first' : 'classic' });
}

function answerFirstSetting(): boolean {
  try {
    return loadSettings().answerFirst === true;
  } catch {
    return false;
  }
}

async function reviewPrompt(log: GameLog): Promise<Prompt> {
  const names = safe(() => reviewCardNames(log), [] as string[]);
  const cards = await cardsForPrompt(names);
  const guide = activeGuideText();
  const cube = await cubeFor(log);
  return buildReviewPrompt(log, cards, { ...(guide ? { guide } : {}), ...(cube ? { cube } : {}) });
}

export type CoachTab = 'moment' | 'review';

export function CoachPanel({
  log,
  decision,
  frameMode,
  onJumpToDecision,
  tab,
  onTab,
  onOpenSettings,
  onOpenGuides,
  guideName,
  filmRoom = null,
}: {
  log: GameLog;
  decision: Decision | null;
  frameMode: boolean;
  onJumpToDecision: () => void;
  tab: CoachTab;
  onTab: (t: CoachTab) => void;
  onOpenSettings: () => void;
  onOpenGuides: () => void;
  guideName: string | null;
  /** The film room (ui/filmroom), shown in the Game review tab. */
  filmRoom?: ReactNode;
}) {
  return (
    <div className="coach">
      <div className="coach-tabs seg" role="tablist">
        <button role="tab" aria-selected={tab === 'moment'} className={cx(tab === 'moment' && 'is-on')} onClick={() => onTab('moment')}>
          <IconSpark size={14} /> This moment
        </button>
        <button role="tab" aria-selected={tab === 'review'} className={cx(tab === 'review' && 'is-on')} onClick={() => onTab('review')}>
          <IconTrophy size={14} /> Game review
        </button>
      </div>
      <button className="guide-btn" onClick={onOpenGuides}>
        <IconBook size={14} />
        <span className="muted">Play guide</span>
        <span className="guide-name">{guideName ?? 'None'}</span>
        <IconChevronDown size={14} />
      </button>
      {tab === 'moment' ? (
        frameMode ? (
          <div className="card-box notice">
            <p>You're browsing raw state frames. The coach works on decisions — the moments you had to act.</p>
            <button className="btn btn-quiet" onClick={onJumpToDecision}>
              Jump to the nearest decision
            </button>
          </div>
        ) : decision ? (
          <MomentView log={log} d={decision} onOpenSettings={onOpenSettings} />
        ) : (
          <div className="card-box notice">
            <p className="muted">No decision selected yet.</p>
          </div>
        )
      ) : (
        <ReviewView log={log} onOpenSettings={onOpenSettings} filmRoom={filmRoom} />
      )}
    </div>
  );
}

function engineText(d: Decision): string | null {
  if (d.input?.prompt) return d.input.prompt;
  const a = d.ask as unknown as Record<string, unknown> | null;
  if (a) {
    for (const k of ['prompt', 'title', 'message', 'question']) if (typeof a[k] === 'string' && a[k]) return a[k] as string;
  }
  return null;
}

const MomentView = memo(function MomentView({ log, d, onOpenSettings }: { log: GameLog; d: Decision; onOpenSettings: () => void }) {
  const key = decisionKey(log, d);
  const answer = useAnswer(key);
  const ask = useCallback(() => void startAnswer(key, () => coachPrompt(log, d)), [key, log, d]);
  const makePrompt = useCallback(() => coachPrompt(log, d), [log, d]);
  const engine = engineText(d);
  return (
    <div className="moment">
      <div className="moment-head">
        <span className={cx('kind-badge', `k-${d.kind}`)}>
          <KindIcon kind={d.kind} size={13} /> {KIND_LABEL[d.kind]}
        </span>
        <h2 className="moment-title">
          <span className="muted">Round {d.state.round} ·</span> {stripRound(d.label)}
        </h2>
      </div>
      {engine && <div className="engine-prompt" title="What Forge was asking">{engine}</div>}
      <div className="card-box did">
        <div className="box-h">What you did</div>
        {d.actions.length === 0 ? (
          <p className="muted small">This recording has no actions (an AI-vs-AI log). Ask the coach what it would do here.</p>
        ) : (
          <ol className="did-list">
            {d.actions.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ol>
        )}
      </div>
      {d.options && d.options.length > 0 && (
        <div className="card-box options">
          <div className="box-h">You could have played</div>
          <ul className="opt-list">
            {d.options.map((o) => (
              <li key={`${o.cardId}-${o.via}`}>
                <span className="opt-name">{o.name}</span>
                <span className="opt-via">{o.via === 'ability' ? 'ability' : o.via}</span>
                {o.cost && <ManaCost cost={o.cost} size="sm" />}
              </li>
            ))}
          </ul>
        </div>
      )}
      <AnswerBox
        answer={answer}
        askLabel="Ask coach"
        idleText="Get a recommended line for this exact state, with the heuristic it follows and the trap to avoid."
        onAsk={ask}
        onStop={() => stopAnswer(key)}
        makePrompt={makePrompt}
        onOpenSettings={onOpenSettings}
        structured
        feedback={feedbackTarget(log, d.frameIndex, 'replay')}
      />
    </div>
  );
});

function ReviewView({ log, onOpenSettings, filmRoom }: { log: GameLog; onOpenSettings: () => void; filmRoom: ReactNode }) {
  const key = `${gameKey(log)}:review`;
  const answer = useAnswer(key);
  const summary = useMemo(() => safe(() => summarizeGame(log), ''), [log]);
  const [showSummary, setShowSummary] = useState(false);
  const ask = useCallback(() => void startAnswer(key, () => reviewPrompt(log)), [key, log]);
  const makePrompt = useCallback(() => reviewPrompt(log), [log]);
  const over = log.over;
  const result = over ? (over.winner === null ? 'Draw' : over.winner === log.seat ? 'You won' : 'You lost') : 'Game in progress';
  return (
    <div className="moment">
      <div className="moment-head">
        <span className={cx('kind-badge', over ? (over.winner === log.seat ? 'k-win' : 'k-loss') : 'k-priority')}>
          <IconTrophy size={13} /> {result}
        </span>
        <h2 className="moment-title">Post-game review</h2>
      </div>
      {filmRoom}
      <div className="card-box">
        <button className="box-h box-toggle" onClick={() => setShowSummary((s) => !s)} aria-expanded={showSummary}>
          Game summary <IconChevronDown size={14} className={showSummary ? 'rot' : ''} />
        </button>
        {summary ? (
          showSummary ? (
            <pre className="summary">{summary}</pre>
          ) : (
            <p className="muted small summary-peek">{summary.split('\n').filter(Boolean).slice(0, 3).join(' · ')}</p>
          )
        ) : (
          <p className="muted small">No summary available yet.</p>
        )}
      </div>
      <AnswerBox
        answer={answer}
        askLabel="Review game"
        idleText="At most three mistakes, each tied to a general rule, plus what went well."
        onAsk={ask}
        onStop={() => stopAnswer(key)}
        makePrompt={makePrompt}
        onOpenSettings={onOpenSettings}
        feedback={feedbackTarget(log, null, 'review')}
      />
    </div>
  );
}

/** "Opus 5.5" for an API model id ("claude-opus-5-5…") or a Claude Code alias ("opus"). */
export function modelLabel(id: string | null): string | null {
  if (!id) return null;
  const exact = MODELS.find((m) => id.startsWith(m.id));
  if (exact) return exact.label;
  const family = /^(opus|sonnet|haiku)$/i.exec(id.trim())?.[1]?.toLowerCase();
  if (family) return MODELS.find((m) => m.id.includes(family))?.label ?? id;
  return id;
}

/** Plain text with `code` spans (helper instructions name commands). */
function withCode(text: string) {
  return text.split(/(`[^`]+`)/).map((part, i) => (part.length > 2 && part.startsWith('`') && part.endsWith('`') ? <code key={i}>{part.slice(1, -1)}</code> : part));
}

const SETUP_ERRORS = new Set(['no_key', 'auth', 'helper_down', 'not_logged_in']);

export function AnswerBox({
  answer,
  askLabel,
  idleText,
  onAsk,
  onStop,
  makePrompt,
  onOpenSettings,
  structured = false,
  feedback = null,
}: {
  answer: Answer | undefined;
  askLabel: string;
  idleText: string;
  onAsk: () => void;
  onStop: () => void;
  makePrompt: () => Promise<Prompt>;
  onOpenSettings: () => void;
  /** A decision answer (prompt.ts's format): show its one-line answer, rule and stated confidence as a header. */
  structured?: boolean;
  /** "Was this advice helpful?" under a finished answer: the game and decision it is about (feedback.ts). */
  feedback?: FeedbackTarget | null;
}) {
  const [copyState, setCopyState] = useState<'idle' | 'busy' | 'ok' | 'err'>('idle');
  const copy = async () => {
    setCopyState('busy');
    try {
      const p = await makePrompt();
      const ok = await copyText(promptAsText(p));
      setCopyState(ok ? 'ok' : 'err');
    } catch {
      setCopyState('err');
    }
    setTimeout(() => setCopyState('idle'), 2200);
  };
  const busy = answer?.status === 'preparing' || answer?.status === 'queued' || answer?.status === 'streaming';
  const streaming = answer?.status === 'streaming';
  const parts = useMemo(
    () => (structured && answer?.text ? parseCoachAnswer(answer.text, { complete: !streaming }) : null),
    [structured, answer?.text, streaming],
  );
  const coach = useCoachAvailability();
  const needsSetup = answer?.status === 'error' && (SETUP_ERRORS.has(answer.errorKind ?? '') || /api key/i.test(answer.error ?? ''));
  const showSource = answer?.source && answer.status !== 'error';
  const now = useNowWhile(isHelperThinking(answer));
  const thinkingNow = thinkingLine(answer, now);
  return (
    <div className="card-box answer">
      <div className="box-h">
        <span>
          <IconSpark size={13} /> Coach
        </span>
        {showSource && (
          <span
            className={cx('source-badge', answer.source === 'helper' && 'is-helper')}
            title={answer.fallbackFrom ? `${modelLabel(answer.fallbackFrom)} declined; answered by a fallback model` : undefined}
          >
            {SOURCE_LABEL[answer.source!]}
            {answer.model && answer.status === 'done' && (
              <>
                {' · '}
                <b>{modelLabel(answer.model)}</b>
                {answer.fallbackFrom ? ' (fallback)' : ''}
              </>
            )}
          </span>
        )}
      </div>
      {!answer && <p className="muted small">{idleText}</p>}
      {answer?.status === 'preparing' && <p className="muted small pulse">{answer.source ? 'Gathering exact card text…' : 'Looking for a coach…'}</p>}
      {answer?.status === 'queued' && (
        <p className="muted small pulse">
          Waiting for the coach…{answer.queuePosition ? ` (${answer.queuePosition === 1 ? 'one question' : `${answer.queuePosition} questions`} ahead)` : ''}
        </p>
      )}
      {parts && (parts.answer || parts.rule || parts.confidence) && <AnswerHead answer={parts.answer} rule={parts.rule} confidence={parts.confidence} why={parts.confidenceWhy} />}
      {answer && answer.text && <Markdown text={parts ? parts.body : answer.text} streaming={streaming} />}
      {answer?.status === 'streaming' && !answer.text && (
        <p className="muted small pulse" role="status">
          {thinkingNow ?? (answer.thinking ? 'Thinking it through…' : answer.source === 'helper' ? 'Waiting for Claude Code on your PC…' : 'Waiting for Claude…')}
        </p>
      )}
      <AdviceFeedback target={feedback} answer={answer} />
      {answer?.refused && <div className="notice-inline warn">Claude declined to answer this one. Try rephrasing via “Copy prompt” in the Claude app.</div>}
      {answer?.status === 'stopped' && (
        <div className="notice-inline">
          {answer.stopReasonNote === 'moved_on' ? 'Stopped — the game moved on.' : answer.stopReasonNote === 'superseded' ? 'Replaced by a newer question.' : 'Stopped.'}
        </div>
      )}
      {answer?.status === 'error' && (
        <div className="notice-inline bad">
          {withCode(answer.error ?? '')}
          {needsSetup && (
            <button className="link-btn" onClick={onOpenSettings}>
              Coach settings
            </button>
          )}
        </div>
      )}
      <div className="answer-actions">
        {busy ? (
          <button className="btn btn-stop" onClick={onStop}>
            <IconStop size={14} /> Stop
          </button>
        ) : (
          <button className="btn btn-primary" onClick={onAsk}>
            <IconSpark size={14} /> {answer ? 'Ask again' : askLabel}
          </button>
        )}
        <button className="btn btn-quiet" onClick={copy} disabled={copyState === 'busy'} title="Copy the full prompt to paste into the Claude app">
          {copyState === 'ok' ? <IconCheck size={14} /> : <IconCopy size={14} />}
          {copyState === 'ok' ? 'Copied' : copyState === 'err' ? 'Copy failed' : 'Copy prompt'}
        </button>
      </div>
      {!coach.ready && !answer && (
        <p className="muted tiny">
          {coach.settings.coachSource === 'apiKey' ? 'No API key yet' : 'No coach connected'} — “Copy prompt” works without one.{' '}
          <button className="link-btn" onClick={onOpenSettings}>
            Set up coaching
          </button>
        </p>
      )}
    </div>
  );
}

const CONFIDENCE_WORDS: Record<StatedConfidence, string> = {
  high: 'Confident',
  medium: 'Fairly sure',
  low: 'Close call — think here',
};

/**
 * The answer's head: the one-line play (answer-first layout), the rule it
 * follows and the coach's stated confidence. Low confidence reads as a close
 * call to think about, not a play to copy.
 */
export function AnswerHead({ answer, rule, confidence, why }: { answer: string | null; rule: string | null; confidence: StatedConfidence | null; why: string | null }) {
  return (
    <div className={cx('answer-head', confidence === 'low' && 'is-close')}>
      {answer && <p className="answer-line">{answer}</p>}
      {(rule || confidence) && (
        <div className="answer-chips">
          {confidence && (
            <span className={cx('conf-chip', `conf-${confidence}`)} title={why ? `Coach’s confidence: ${confidence} — ${why}` : `Coach’s confidence: ${confidence}`}>
              {CONFIDENCE_WORDS[confidence]}
            </span>
          )}
          {rule && (
            <span className="rule-chip" title="The heuristic this line follows">
              <span className="rule-k">Rule</span> {rule}
            </span>
          )}
        </div>
      )}
      {confidence === 'low' && why && <p className="tiny muted conf-why">{why}</p>}
    </div>
  );
}

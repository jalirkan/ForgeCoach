/*
 * ForgeCoach — ui/CoachPanel.tsx
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * "What you did" next to the coach's advice for the selected decision, and the
 * post-game review. Streaming answers live in answers.ts so they survive
 * scrubbing away and back.
 */
import { memo, useCallback, useMemo, useState } from 'react';
import type { GameLog } from '../log.ts';
import type { Decision } from '../decisions.ts';
import { buildCoachPrompt, coachCardNames, promptAsText, type Prompt } from '../prompt.ts';
import { buildReviewPrompt, reviewCardNames, summarizeGame } from '../review.ts';
import { activeGuideText as guideText } from '../guide.ts';
import { MODELS, hasKey as settingsHaveKey } from '../claude.ts';
import { startAnswer, stopAnswer, useAnswer, type Answer } from './answers.ts';
import { cardsForPrompt } from './cardData.ts';
import { Markdown } from './Markdown.tsx';
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

export async function coachPrompt(log: GameLog, d: Decision): Promise<Prompt> {
  const names = safe(() => coachCardNames(log, d), [] as string[]);
  const cards = await cardsForPrompt(names);
  const guide = activeGuideText();
  return buildCoachPrompt(log, d, cards, guide ? { guide } : undefined);
}

async function reviewPrompt(log: GameLog): Promise<Prompt> {
  const names = safe(() => reviewCardNames(log), [] as string[]);
  const cards = await cardsForPrompt(names);
  const guide = activeGuideText();
  return buildReviewPrompt(log, cards, guide ? { guide } : undefined);
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
        <ReviewView log={log} onOpenSettings={onOpenSettings} />
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
      />
    </div>
  );
});

function ReviewView({ log, onOpenSettings }: { log: GameLog; onOpenSettings: () => void }) {
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
      />
    </div>
  );
}

function modelLabel(id: string | null): string | null {
  if (!id) return null;
  return MODELS.find((m) => id.startsWith(m.id))?.label ?? id;
}

export function AnswerBox({
  answer,
  askLabel,
  idleText,
  onAsk,
  onStop,
  makePrompt,
  onOpenSettings,
}: {
  answer: Answer | undefined;
  askLabel: string;
  idleText: string;
  onAsk: () => void;
  onStop: () => void;
  makePrompt: () => Promise<Prompt>;
  onOpenSettings: () => void;
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
  const busy = answer?.status === 'preparing' || answer?.status === 'streaming';
  const hasKey = useMemo(() => safe(() => settingsHaveKey(), false), [answer?.status]);
  const missingKey = answer?.status === 'error' && (answer.errorKind === 'no_key' || answer.errorKind === 'auth' || /api key/i.test(answer.error ?? ''));
  return (
    <div className="card-box answer">
      <div className="box-h">
        <span>
          <IconSpark size={13} /> Coach
        </span>
        {answer?.model && answer.status === 'done' && (
          <span className="muted small" title={answer.fallbackFrom ? `${modelLabel(answer.fallbackFrom)} declined; answered by a fallback model` : undefined}>
            {modelLabel(answer.model)}
            {answer.fallbackFrom ? ' (fallback)' : ''}
          </span>
        )}
      </div>
      {!answer && <p className="muted small">{idleText}</p>}
      {answer?.status === 'preparing' && <p className="muted small pulse">Gathering exact card text…</p>}
      {answer && answer.text && <Markdown text={answer.text} streaming={answer.status === 'streaming'} />}
      {answer?.status === 'streaming' && !answer.text && <p className="muted small pulse">{answer.thinking ? 'Thinking it through…' : 'Waiting for Claude…'}</p>}
      {answer?.refused && <div className="notice-inline warn">Claude declined to answer this one. Try rephrasing via “Copy prompt” in the Claude app.</div>}
      {answer?.status === 'stopped' && <div className="notice-inline">Stopped.</div>}
      {answer?.status === 'error' && (
        <div className="notice-inline bad">
          {answer.error}
          {missingKey && (
            <button className="link-btn" onClick={onOpenSettings}>
              Add an API key
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
      {!hasKey && !answer && (
        <p className="muted tiny">
          No API key yet — “Copy prompt” works without one. <button className="link-btn" onClick={onOpenSettings}>Add a key</button>
        </p>
      )}
    </div>
  );
}

/*
 * ForgeCoach — ui/play/PlayCoach.tsx
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The coach while you play: ask about the current moment (the same prompt as
 * the replay coach, built from the live state), or let it speak up on its own
 * at your main phases and combat. It advises; it never acts.
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AskBody, GameStateBody, InputBody } from '../../protocol.ts';
import type { GameLog } from '../../log.ts';
import type { Decision } from '../../decisions.ts';
import { hasKey } from '../../claude.ts';
import { startAnswer, stopAnswer, useAnswer } from '../answers.ts';
import { AnswerBox, coachPrompt } from '../CoachPanel.tsx';
import { Markdown } from '../Markdown.tsx';
import { IconBook, IconChevronDown, KindIcon, KIND_LABEL } from '../Icons.tsx';
import { stripRound } from '../Timeline.tsx';
import { cx, readLS, writeLS } from '../util.ts';
import { liveDecision, momentKey } from './liveDecision.ts';

const AUTO_KEY = 'forgecoach.autoCoach';

function safeHasKey(): boolean {
  try {
    return hasKey();
  } catch {
    return false;
  }
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
}) {
  const [auto, setAuto] = useState(() => readLS(AUTO_KEY) === '1');
  const moment = useMemo(() => (log ? { log, state, input, ask, seat } : null), [log, state, input, ask, seat]);
  const key = moment && myMove ? momentKey(moment) : null;
  const decision: Decision | null = useMemo(() => (moment && myMove ? liveDecision(moment) : null), [moment, myMove]);
  // The decision captured at the moment it was asked about (the board moves on).
  const asked = useRef(new Map<string, Decision>());
  const [lastAsked, setLastAsked] = useState<{ key: string; label: string } | null>(null);

  const ask_ = useCallback(
    (k: string, d: Decision) => {
      if (!log) return;
      asked.current.set(k, d);
      setLastAsked({ key: k, label: d.label });
      void startAnswer(k, () => coachPrompt(log, d));
    },
    [log],
  );
  const current = useAnswer(key);
  const previous = useAnswer(lastAsked && lastAsked.key !== key ? lastAsked.key : null);

  // Auto-coach: once per moment, at your main phases and your combat decisions.
  const autoDone = useRef(new Set<string>());
  useEffect(() => {
    if (!auto || !key || !decision || current) return;
    if (decision.kind !== 'main' && decision.kind !== 'attack' && decision.kind !== 'block') return;
    if (autoDone.current.has(key) || !safeHasKey()) return;
    autoDone.current.add(key);
    ask_(key, decision);
  }, [auto, key, decision, current, ask_]);

  const [showPrev, setShowPrev] = useState(true);
  const makePrompt = useCallback(async () => {
    if (!log || !decision) throw new Error('Nothing to ask about yet.');
    return coachPrompt(log, decision);
  }, [log, decision]);

  return (
    <div className="coach play-coach">
      <div className="pc-head">
        <div className="pc-title">Coach</div>
        <label className="switch" title="Ask the coach automatically at your main phases, attacks and blocks (uses your API key)">
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
      </div>
      <button className="guide-btn" onClick={onOpenGuides}>
        <IconBook size={14} />
        <span className="muted">Play guide</span>
        <span className="guide-name">{guideName ?? 'None'}</span>
        <IconChevronDown size={14} />
      </button>
      {decision && key ? (
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
                ? 'Auto-coach is on: it speaks up at your main phases and combat. Ask any time for other moments.'
                : 'What should you do right now? The coach sees the exact board, every card’s text, and your play guide.'
            }
            onAsk={() => ask_(key, decision)}
            onStop={() => stopAnswer(key)}
            makePrompt={makePrompt}
            onOpenSettings={onOpenSettings}
          />
        </div>
      ) : (
        <div className="card-box notice">
          <p className="muted small">{state ? 'Waiting for your next decision — the coach is ready when you are.' : 'The coach wakes up once the game starts.'}</p>
        </div>
      )}
      {previous && lastAsked && (
        <div className="card-box answer pc-prev">
          <button className="box-h box-toggle" onClick={() => setShowPrev((s) => !s)} aria-expanded={showPrev}>
            <span>Earlier advice · {stripRound(lastAsked.label)}</span>
            <IconChevronDown size={14} className={showPrev ? 'rot' : ''} />
          </button>
          {showPrev && (previous.text ? <Markdown text={previous.text} streaming={previous.status === 'streaming'} /> : <p className="muted small">{previous.status === 'error' ? previous.error : 'Thinking…'}</p>)}
        </div>
      )}
      <p className="tiny muted pc-foot">The coach only advises — every move is yours.</p>
    </div>
  );
});

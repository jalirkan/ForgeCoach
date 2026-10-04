/*
 * ForgeCoach — ui/filmroom/FilmRoom.tsx
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The film room (filmRoom.ts): after a game, the three biggest turning points
 * of the viewer's own decisions, each with a glance at the board, how far the
 * score fell, and the coach's short explanation streaming in. A card is a
 * button that jumps to the moment when the screen can (`onJump`).
 *
 * The score is the coach helper's win chance when it serves one (its /health
 * says `eval: 1`), else the engine review report the screen has open, else a
 * rough life / board / hand swing; the panel says which. Coach calls go
 * through answers.ts `startAnswer` only, and start by themselves once the
 * moments are settled and a coach is connected; without one the panel offers
 * "Copy prompts" instead. Colours are the skins' tokens (filmroom.css).
 */
import './filmroom.css';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { GameLog } from '../../log.ts';
import { extractDecisions, type Decision } from '../../decisions.ts';
import type { ReviewReport } from '../../gameReview.ts';
import { detectHelper, onHelperStatus, peekHelper, type HelperStatus } from '../../coachHelper.ts';
import { helperEval } from '../../evalClient.ts';
import { parseCoachAnswer } from '../../coachAnswer.ts';
import { promptAsText } from '../../prompt.ts';
import {
  dropWords,
  filmCardNames,
  filmKey,
  filmPrompt,
  miniBoard,
  momentTitle,
  pickFilm,
  scoreWords,
  SOURCE_SHORT,
  SOURCE_WORDS,
  type Film,
  type FilmMoment,
} from '../../filmRoom.ts';
import { useDropWhy, useWinSeries } from '../winchance/useWinChance.ts';
import { WinDropWhy } from '../winchance/WinChance.tsx';
import { dropKey, type WhyItem, type WinDrop } from '../../winChance.ts';
import type { HelperEval } from '../../coachHelper.ts';
import { answerBusy, getAnswer, startAnswer, stopAnswer, useAnswer } from '../answers.ts';
import { cardsForPrompt } from '../cardData.ts';
import { AnswerHead, gameKey } from '../CoachPanel.tsx';
import { useCoachAvailability } from '../hooks.ts';
import { Markdown } from '../Markdown.tsx';
import { IconCheck, IconCopy, IconSpark, IconStop } from '../Icons.tsx';
import { copyText, cx } from '../util.ts';

function safeDecisions(log: GameLog): Decision[] {
  try {
    return extractDecisions(log);
  } catch {
    return [];
  }
}

/** The coach helper as last seen, and whether it has been looked for at all yet. */
function useHelperSeen(): { helper: HelperStatus | null; looked: boolean } {
  const [helper, setHelper] = useState<HelperStatus | null>(() => peekHelper());
  const [looked, setLooked] = useState(() => peekHelper() !== null);
  useEffect(() => {
    const read = () => setHelper(peekHelper());
    const off = onHelperStatus(read);
    // A "down" seen while the page was busy (a game's frames arriving) is looked at again once.
    void detectHelper(peekHelper()?.state === 'down' ? { force: true } : {})
      .catch(() => null)
      .then(() => {
        read();
        setLooked(true);
      });
    return off;
  }, []);
  return { helper, looked };
}

export interface FilmState {
  film: Film | null;
  /** Scoring the win chance: positions done / to do. */
  scoring: { done: number; total: number } | null;
  /** The helper's win-chance model, when it serves one (mtg-table D368: whether it explains). */
  model?: HelperEval | null;
}

/** The film for a game: waits for the helper check and, when it serves the win chance, for every position to be scored. */
export function useFilm(log: GameLog, decisions: readonly Decision[], report: ReviewReport | null): FilmState {
  const { helper, looked } = useHelperSeen();
  const model = helperEval(helper);
  const series = useWinSeries(log, model);
  return useMemo(() => {
    if (!looked) return { film: null, scoring: null };
    if (model && !series.done && !series.error) return { film: null, scoring: { done: series.points.length, total: series.total } };
    const evalMissing = model
      ? `The win chance could not be scored${series.error ? ` (${series.error})` : ''}.`
      : helper?.state === 'ok' || helper?.state === 'down'
        ? helper.state === 'ok'
          ? 'No win chance: the coach helper has no evaluator model.'
          : 'No win chance: the coach helper is not running.'
        : 'No win chance: no coach helper.';
    const film = pickFilm({ log, decisions, evalPoints: model && series.done ? series.points : null, evalMissing, report });
    return { film, scoring: null, model };
  }, [looked, model, series.done, series.error, series.points, series.total, helper?.state, log, decisions, report]);
}

export function FilmRoom({
  log,
  decisions: given,
  report = null,
  onJump,
  current = null,
  variant = 'panel',
  autoAsk = true,
  onOpenSettings,
}: {
  log: GameLog;
  /** The screen's own decision list (GameView), so a jump lands on the same one; computed when omitted. */
  decisions?: readonly Decision[];
  /** An engine review report open on this screen (a fallback source). */
  report?: ReviewReport | null;
  /** Go to the moment (its decision's frame). Without it the cards are not buttons. */
  onJump?: (m: FilmMoment) => void;
  /** The decision frame shown now, to mark its card. */
  current?: number | null;
  variant?: 'panel' | 'over';
  /** Ask the coach about every moment by itself (default); else one tap per moment. */
  autoAsk?: boolean;
  onOpenSettings?: () => void;
}) {
  const decisions = useMemo(() => given ?? safeDecisions(log), [given, log]);
  const { film, scoring, model = null } = useFilm(log, decisions, report);
  // mtg-table D368: why each win-chance fall happened, from a helper that explains (nothing is asked otherwise).
  const evalDrops = useMemo<WinDrop[]>(
    () => (film?.source === 'eval' ? film.moments.map((m) => ({ id: m.rank, decisionFrame: m.decision.frameIndex, before: m.before, after: m.after, drop: m.drop })) : []),
    [film],
  );
  const why = useDropWhy(log, model, evalDrops);
  const coach = useCoachAvailability();
  const gk = gameKey(log);

  const makePrompt = useCallback(
    async (m: FilmMoment) => {
      const cards = await cardsForPrompt(filmCardNames(log, m));
      return filmPrompt(log, m, cards, { report });
    },
    [log, report],
  );

  // Ask once the moments are settled and a coach is there; answers stay in the store (and keep streaming) when the panel closes.
  const keys = film ? film.moments.map((m) => filmKey(gk, m)).join('|') : '';
  useEffect(() => {
    if (!film || !coach.ready || !autoAsk) return;
    for (const m of film.moments) {
      const k = filmKey(gk, m);
      if (!getAnswer(k) && !answerBusy(k)) void startAnswer(k, () => makePrompt(m));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keys, coach.ready, autoAsk]);

  const [copyState, setCopyState] = useState<'idle' | 'busy' | 'ok' | 'err'>('idle');
  const copyAll = async () => {
    if (!film) return;
    setCopyState('busy');
    try {
      const ps = await Promise.all(film.moments.map((m) => makePrompt(m)));
      const ok = await copyText(ps.map((p, i) => `### Turning point ${i + 1}\n\n${promptAsText(p)}`).join('\n\n=====\n\n'));
      setCopyState(ok ? 'ok' : 'err');
    } catch {
      setCopyState('err');
    }
    setTimeout(() => setCopyState('idle'), 2200);
  };

  return (
    <section className={cx('film', `film-${variant}`)} aria-labelledby={`film-h-${variant}`}>
      <div className="film-head">
        <h3 className="film-title" id={`film-h-${variant}`}>
          Film room
        </h3>
        {film && (
          <span className={cx('film-source', `is-${film.source}`)} title={SOURCE_WORDS[film.source]}>
            {SOURCE_SHORT[film.source]}
          </span>
        )}
        <span className="grow" />
        {film && film.moments.length > 0 && (
          <button className="btn btn-quiet btn-sm film-copy" onClick={() => void copyAll()} disabled={copyState === 'busy'} title="Copy the three coach prompts to paste into the Claude app">
            {copyState === 'ok' ? <IconCheck size={13} /> : <IconCopy size={13} />}
            {copyState === 'ok' ? 'Copied' : copyState === 'err' ? 'Copy failed' : 'Copy prompts'}
          </button>
        )}
      </div>
      {!film ? (
        <p className="film-wait tiny muted pulse" role="status">
          {scoring ? `Scoring your positions for the win chance… ${scoring.done}/${scoring.total}` : 'Looking for the coach helper…'}
        </p>
      ) : (
        <>
          <p className="film-lede tiny muted">
            {film.moments.length === 0
              ? film.source === 'eval'
                ? 'No fall of 3 points or more across one of your decisions.'
                : 'No turning point big enough to show.'
              : `The ${film.moments.length === 1 ? 'biggest fall' : `${film.moments.length} biggest falls`} across one of your decisions — scored by ${SOURCE_WORDS[film.source].replace(/^./, (c) => c.toLowerCase())}. The opponent’s moves in between count too: a fall says where, not why.`}
            {film.note && film.source !== 'eval' ? <span className="film-note"> {film.note}</span> : null}
          </p>
          {film.moments.length > 0 && (
            <ol className="film-cards">
              {film.moments.map((m) => (
                <MomentCard
                  key={filmKey(gk, m)}
                  log={log}
                  m={m}
                  answerKey={filmKey(gk, m)}
                  canAsk={coach.ready}
                  onAsk={() => void startAnswer(filmKey(gk, m), () => makePrompt(m))}
                  {...(onJump ? { onJump: () => onJump(m) } : {})}
                  current={current !== null && m.decision.frameIndex === current}
                  why={m.source === 'eval' ? why.get(dropKey({ id: m.rank, after: m.after })) : undefined}
                />
              ))}
            </ol>
          )}
          {!coach.ready && film.moments.length > 0 && (
            <p className="film-off tiny muted">
              {coach.settings.coachSource === 'apiKey' ? 'No API key yet' : 'No coach connected'} — the explanations are off. “Copy prompts” works without one.{' '}
              {onOpenSettings && (
                <button className="link-btn" onClick={onOpenSettings}>
                  Set up coaching
                </button>
              )}
            </p>
          )}
        </>
      )}
    </section>
  );
}

/** "**What happened:** …" and "**Instead:** …" each as a paragraph of its own. */
function paragraphs(text: string): string {
  return text.replace(/\n(?=\*\*[A-Z][^*\n]{0,40}:\*\*)/g, '\n\n');
}

function MomentCard({
  log,
  m,
  answerKey,
  canAsk,
  onAsk,
  onJump,
  current,
  why,
}: {
  log: GameLog;
  m: FilmMoment;
  /** mtg-table D368: the parts of the position that moved the win chance most across this fall. */
  why?: readonly WhyItem[] | undefined;
  answerKey: string;
  canAsk: boolean;
  onAsk: () => void;
  onJump?: () => void;
  current: boolean;
}) {
  const answer = useAnswer(answerKey);
  const streaming = answer?.status === 'streaming';
  const busy = answer?.status === 'preparing' || answer?.status === 'queued' || streaming;
  const parts = useMemo(() => (answer?.text ? parseCoachAnswer(answer.text, { complete: !streaming }) : null), [answer?.text, streaming]);
  const mini = miniBoard(m.decision.state, log.seat);
  const measure = m.review?.measure;
  const did = m.decision.actions.length ? m.decision.actions.join('; ') : 'passed';
  const head = (
    <>
      <span className="film-rank" aria-label={`Turning point ${m.rank}`}>
        {m.rank}
      </span>
      <span className="film-when">
        <span className="film-turn">{momentTitle(m, log.seat)}</span>
        <span className="film-did tiny muted" title={did}>
          You: {did}
        </span>
      </span>
      <span className={cx('film-drop', m.source === 'heuristic' && 'is-rough')} title={m.source === 'review' ? `Engine best ${scoreWords(m.before.p, m.source, measure)}, yours ${scoreWords(m.after.p, m.source, measure)}` : undefined}>
        <b>{dropWords(m)}</b>
        <span className="film-from tiny">
          {scoreWords(m.before.p, m.source, measure)} → {scoreWords(m.after.p, m.source, measure)}
        </span>
      </span>
    </>
  );
  return (
    <li className={cx('film-card', current && 'is-current')}>
      {onJump ? (
        <button type="button" className="film-card-head is-link" onClick={onJump} title="Go to this moment">
          {head}
        </button>
      ) : (
        <div className="film-card-head">{head}</div>
      )}
      {mini && (
        <div className="film-mini tiny" aria-label="The board at the decision">
          <span>
            <span className="muted">Life</span> <b>{mini.you.life}</b>–<b>{mini.them.life}</b>
          </span>
          <span>
            <span className="muted">Creatures</span> {mini.you.creatures}–{mini.them.creatures}
          </span>
          <span>
            <span className="muted">Lands</span> {mini.you.lands}–{mini.them.lands}
          </span>
          <span>
            <span className="muted">Hand</span> {mini.you.hand}–{mini.them.hand}
          </span>
        </div>
      )}
      {why && why.length > 0 && (
        <p className="film-why tiny">
          <WinDropWhy items={why} />
        </p>
      )}
      {m.review && (
        <p className="film-review tiny">
          <span className="muted">Engine:</span> {m.review.verdict.toLowerCase()} · best {m.review.best ?? '—'}
        </p>
      )}
      <div className="film-answer" aria-live="polite">
        {parts && (parts.rule || parts.confidence) && <AnswerHead answer={null} rule={parts.rule} confidence={parts.confidence} why={parts.confidenceWhy} />}
        {answer?.text ? <Markdown text={paragraphs(parts ? parts.body : answer.text)} streaming={streaming} /> : null}
        {answer?.status === 'preparing' && <p className="tiny muted pulse">Getting the coach ready…</p>}
        {answer?.status === 'queued' && <p className="tiny muted pulse">Waiting for the coach{answer.queuePosition ? ` (${answer.queuePosition} ahead)` : ''}…</p>}
        {streaming && !answer?.text && <p className="tiny muted pulse">The coach is looking at it…</p>}
        {answer?.status === 'error' && <p className="tiny film-err">{answer.error}</p>}
        {answer?.status === 'stopped' && <p className="tiny muted">Stopped.</p>}
        {canAsk && (
          <div className="film-actions">
            {busy ? (
              <button className="link-btn tiny" onClick={() => stopAnswer(answerKey)}>
                <IconStop size={11} /> Stop
              </button>
            ) : (
              (!answer || answer.status !== 'done') && (
                <button className="link-btn tiny" onClick={onAsk}>
                  <IconSpark size={11} /> {answer ? 'Ask again' : 'Explain this moment'}
                </button>
              )
            )}
          </div>
        )}
      </div>
    </li>
  );
}

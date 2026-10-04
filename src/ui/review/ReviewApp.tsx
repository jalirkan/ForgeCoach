/*
 * ForgeCoach — ui/review/ReviewApp.tsx
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The engine review screen (lazy). For one loaded game: load the engine's
 * report (a file, the sample's, or a run on the coach helper's `/review`),
 * then show the decisions by turn with the key moments marked, the board and
 * the option table for the selected moment, and a coach that explains the key
 * moments from the engine's numbers (through answers.ts `startAnswer`, the
 * one entry point for coach calls).
 */
import './review.css';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GameLog } from '../../log.ts';
import type { AnyCard, GameStateBody } from '../../protocol.ts';
import {
  decisionState,
  explainCardNames,
  fmtInterval,
  fmtRegret,
  keyDecisions,
  isTie,
  knowledgeLine,
  knowledgeWarning,
  measureCaption,
  parseReviewReport,
  reportMatchesLog,
  reviewExplainPrompt,
  ReviewReportError,
  STATUS_WORDS,
  tokenLabel,
  TYPE_WORDS,
  verdictLabel,
  type ReviewDecision,
  type ReviewReport,
} from '../../gameReview.ts';
import { phaseLabel } from '../../decisions.ts';
import { Board } from '../Board.tsx';
import { CardDetail } from '../CardDetail.tsx';
import { BoardStateRef, CardActionsContext, type CardActions } from '../cardContext.ts';
import { cardsForPrompt, prefetchCards } from '../cardData.ts';
import { AnswerBox, gameKey } from '../CoachPanel.tsx';
import { feedbackTarget } from '../../feedback.ts';
import { startAnswer, stopAnswer, useAnswer } from '../answers.ts';
import { IconGear, IconSpark, IconUpload, IconX } from '../Icons.tsx';
import { Logo } from '../Logo.tsx';
import { useMediaQuery } from '../hooks.ts';
import { allCardNames, cx } from '../util.ts';
import { OptionBars } from './OptionBars.tsx';
import { ReviewTimeline } from './ReviewTimeline.tsx';
import { SAMPLE_REVIEWS } from './samples.ts';
import { STAGE_WORDS, useReviewRun } from './useReviewRun.ts';
import { WinChanceLine } from '../winchance/WinChanceLine.tsx';
import { FilmRoom } from '../filmroom/FilmRoom.tsx';
import type { FilmMoment } from '../../filmRoom.ts';

/** The graded decision a film-room moment lands on: its own, else the first graded inside its decision, else the nearest after it. */
function reviewFrameFor(decisions: readonly ReviewDecision[], m: FilmMoment): number | null {
  if (m.review) return m.review.frame;
  const lo = m.decision.frameIndex;
  const hi = Math.max(lo, m.decision.endFrameIndex);
  const sorted = [...decisions].sort((a, b) => a.stateFrame - b.stateFrame);
  const hit = sorted.find((x) => x.stateFrame >= lo && x.stateFrame <= hi) ?? sorted.find((x) => x.stateFrame >= lo) ?? sorted[sorted.length - 1];
  return hit?.frame ?? null;
}

export interface ReviewAppProps {
  log: GameLog;
  title: string;
  /** A sample log: its shipped report can be opened. */
  sampleId?: string | null;
  /** Open the sample's report straight away. */
  autoSample?: boolean;
  onClose: () => void;
  closeLabel?: string;
  onSettings: () => void;
}

interface Loaded {
  report: ReviewReport;
  decisions: ReviewDecision[];
  problems: string[];
  source: string;
}

function accept(report: ReviewReport, log: GameLog, source: string): Loaded {
  const m = reportMatchesLog(report, log);
  if (!m.ok) throw new ReviewReportError(m.problems.join(' '));
  return { report, decisions: m.decisions, problems: [...report.warnings, ...m.problems], source };
}

export default function ReviewApp({ log, title, sampleId = null, autoSample = false, onClose, closeLabel, onSettings }: ReviewAppProps) {
  const wide = useMediaQuery('(min-width: 1024px)');
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const [detail, setDetail] = useState<{ card: AnyCard; state: GameStateBody | null } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const names = useMemo(() => allCardNames(log), [log]);
  useEffect(() => prefetchCards(names), [names]);

  const show = useCallback((l: Loaded) => {
    setLoaded(l);
    setError(null);
    const keys = keyDecisions(l.decisions, l.report.keyMoments, 1);
    setSelected(keys[0]?.frame ?? l.decisions[0]?.frame ?? null);
  }, []);

  const openText = useCallback(
    (text: string, source: string) => {
      try {
        show(accept(parseReviewReport(text), log, source));
      } catch (e) {
        setError(e instanceof ReviewReportError ? e.message : 'That file could not be read as an engine review.');
      }
    },
    [log, show],
  );

  const openFile = useCallback(
    async (f: File) => {
      if (f.size > 4 * 1024 * 1024) return setError('That file is too large to be an engine review.');
      openText(await f.text(), f.name);
    },
    [openText],
  );

  const openSample = useCallback(async () => {
    const path = sampleId ? SAMPLE_REVIEWS[sampleId] : undefined;
    if (!path) return;
    setBusy(true);
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}${path}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      openText(await res.text(), 'sample report');
    } catch (e) {
      setError(`The sample review couldn’t be downloaded (${e instanceof Error ? e.message : String(e)}).`);
    } finally {
      setBusy(false);
    }
  }, [sampleId, openText]);

  useEffect(() => {
    if (autoSample) void openSample();
  }, [autoSample, openSample]);

  const runner = useReviewRun(log, (r) => {
    try {
      show(accept(r, log, 'engine run'));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  });

  // Drops on this screen are review files: take them before the app's own handler (which opens logs).
  useEffect(() => {
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');
    let depth = 0;
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.stopPropagation();
      depth++;
      setDragging(true);
    };
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.stopPropagation();
      depth = Math.max(0, depth - 1);
      if (!depth) setDragging(false);
    };
    const over = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.stopPropagation();
      e.preventDefault();
    };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.stopPropagation();
      e.preventDefault();
      depth = 0;
      setDragging(false);
      const f = e.dataTransfer?.files?.[0];
      if (f) void openFile(f);
    };
    window.addEventListener('dragenter', enter, true);
    window.addEventListener('dragleave', leave, true);
    window.addEventListener('dragover', over, true);
    window.addEventListener('drop', drop, true);
    return () => {
      window.removeEventListener('dragenter', enter, true);
      window.removeEventListener('dragleave', leave, true);
      window.removeEventListener('dragover', over, true);
      window.removeEventListener('drop', drop, true);
    };
  }, [openFile]);

  const actions = useMemo<CardActions>(() => ({ open: (card, state) => setDetail({ card, state }), hover: () => undefined }), []);
  const d = loaded?.decisions.find((x) => x.frame === selected) ?? null;
  const state = d ? decisionState(log, d) : null;
  const boardRef = useRef<GameStateBody | null>(state);
  boardRef.current = state;

  const players = log.hello?.players ?? [];
  const opp = players.find((p) => p.id !== log.seat);
  const over = log.over;
  // The win-chance line (mtg-table D361): each graded decision at the state it was taken in; a marker selects it.
  const wcDecisions = useMemo(() => (loaded?.decisions ?? []).map((x) => ({ frame: x.stateFrame, id: x.frame })), [loaded]);

  return (
    <CardActionsContext.Provider value={actions}>
      <BoardStateRef.Provider value={boardRef}>
        <div className={cx('rv', wide ? 'is-wide' : 'is-narrow')}>
          <header className="topbar">
            <button className="logo-btn" onClick={onClose} aria-label="Back">
              <Logo compact={!wide} />
            </button>
            <div className="topbar-title">
              <span className="topbar-game">Engine review · {title}</span>
              <span className="topbar-sub">
                You vs {opp?.name ?? 'Opponent'}
                {over && (
                  <span className={cx('result', over.winner === log.seat ? 'is-win' : over.winner === null ? 'is-draw' : 'is-loss')}>
                    {over.winner === log.seat ? 'Won' : over.winner === null ? 'Draw' : 'Lost'}
                  </span>
                )}
              </span>
            </div>
            <span className="grow" />
            <button className="icon-btn" onClick={onSettings} aria-label="Settings">
              <IconGear size={18} />
            </button>
            {closeLabel ? (
              <button className="btn btn-primary btn-sm" onClick={onClose}>
                {closeLabel}
              </button>
            ) : (
              <button className="icon-btn" onClick={onClose} aria-label="Close the engine review">
                <IconX size={18} />
              </button>
            )}
          </header>

          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) void openFile(f);
            }}
          />

          {!loaded ? (
            <main className="rv-main rv-load">
              <LoadPanel
                log={log}
                sample={!!(sampleId && SAMPLE_REVIEWS[sampleId])}
                busy={busy}
                error={error}
                runner={runner}
                onPick={() => fileRef.current?.click()}
                onSample={() => void openSample()}
              />
              <div className="rv-load-film">
                <FilmRoom log={log} variant="panel" autoAsk={false} onOpenSettings={onSettings} />
              </div>
            </main>
          ) : (
            <main className="rv-main rv-grid">
              <div className="rv-side">
                <Summary loaded={loaded} onReplace={() => fileRef.current?.click()} />
                {error && (
                  <div className="notice-inline bad" role="alert">
                    {error}
                  </div>
                )}
                <section className="card-box rv-tl-box" aria-labelledby="rv-tl-h">
                  <div className="box-h" id="rv-tl-h">
                    <span>Your decisions</span>
                    <span className="rv-legend" aria-hidden="true">
                      <span className="v-mistake">! mistake</span> <span className="v-close">≈ close</span> <span className="v-best">✓ best</span> <span className="v-close">= tie</span>
                    </span>
                  </div>
                  <WinChanceLine log={log} decisions={wcDecisions} current={d?.stateFrame ?? null} onMarker={setSelected} />
                  <ReviewTimeline log={log} decisions={loaded.decisions} keyMoments={loaded.report.keyMoments} selected={selected} onSelect={setSelected} />
                </section>
                <FilmRoom
                  log={log}
                  report={loaded.report}
                  onJump={(m) => {
                    const f = reviewFrameFor(loaded.decisions, m);
                    if (f !== null) setSelected(f);
                  }}
                  onOpenSettings={onSettings}
                />
                {wide && <ExplainCoach log={log} loaded={loaded} onOpenSettings={onSettings} />}
              </div>
              <div className="rv-moment-col">
                {d ? <Moment log={log} d={d} state={state} rank={loaded.report.keyMoments.indexOf(d.frame) + 1 || null} /> : <p className="muted">Pick a decision.</p>}
                {!wide && <ExplainCoach log={log} loaded={loaded} onOpenSettings={onSettings} />}
              </div>
            </main>
          )}
          {dragging && (
            <div className="drop-overlay" aria-hidden="true">
              <div className="drop-overlay-inner">
                <IconUpload size={28} />
                <span>Drop an engine review (.json) to open it</span>
              </div>
            </div>
          )}
        </div>
        <CardDetail card={detail?.card ?? null} state={detail?.state ?? null} seat={log.seat} onClose={() => setDetail(null)} />
      </BoardStateRef.Provider>
    </CardActionsContext.Provider>
  );
}

function elapsed(since: number): string {
  const s = Math.max(0, Math.round((Date.now() - since) / 1000));
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`;
}

function useTick(on: boolean) {
  const [, set] = useState(0);
  useEffect(() => {
    if (!on) return;
    const t = setInterval(() => set((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [on]);
}

function LoadPanel({
  log,
  sample,
  busy,
  error,
  runner,
  onPick,
  onSample,
}: {
  log: GameLog;
  sample: boolean;
  busy: boolean;
  error: string | null;
  runner: ReturnType<typeof useReviewRun>;
  onPick: () => void;
  onSample: () => void;
}) {
  const run = runner.run;
  const active = !!run && run.state !== 'failed';
  useTick(active);
  return (
    <div className="rv-load-card card-box">
      <h1 className="rv-h1">Engine review</h1>
      <p>
        The engine plays each of your decisions out many times, once per option, and compares the results: what each option was worth, what you chose, and what
        scored best — with intervals, so a close call is never called a mistake.
      </p>
      <p className="muted small">Yardstick: the best play against Forge’s Default AI playing both seats. Strong, not perfect.</p>
      <div className="rv-load-actions">
        {runner.canRun && (
          <button className="btn btn-primary" onClick={() => void runner.start()} disabled={active}>
            <IconSpark size={14} /> Run engine review
          </button>
        )}
        <button className="btn btn-quiet" onClick={onPick}>
          <IconUpload size={14} /> Open a report (.json)
        </button>
        {sample && (
          <button className="btn btn-quiet" onClick={onSample} disabled={busy}>
            {busy ? <span className="spinner spinner-sm" /> : null} Open the sample review
          </button>
        )}
      </div>
      {run && (
        <div className={cx('rv-run', run.state === 'failed' && 'is-failed')} role="status" aria-live="polite">
          {run.state === 'starting' && <p className="pulse">Sending the game to the engine…</p>}
          {run.state === 'queued' && (
            <p className="pulse">
              Queued{run.position ? ` — ${run.position === 1 ? 'one review' : `${run.position} reviews`} ahead` : ''}. {elapsed(run.startedAt)}
            </p>
          )}
          {run.state === 'running' && (
            <p className="pulse">
              Running{run.stage ? ` — ${STAGE_WORDS[run.stage]}` : ''}. {elapsed(run.startedAt)} <span className="muted tiny">(usually 3–4 minutes)</span>
            </p>
          )}
          {run.state === 'failed' && <p>Review failed: {run.error}</p>}
          {active && (
            <button className="link-btn" onClick={runner.cancel}>
              Stop waiting
            </button>
          )}
        </div>
      )}
      {error && (
        <div className="notice-inline bad" role="alert">
          {error}
        </div>
      )}
      <p className="muted tiny">
        {runner.available === null
          ? 'Looking for the coach helper…'
          : runner.canRun
            ? `The coach helper on this computer can grade game ${log.header.gameId}.`
            : runner.available
              ? 'This log has no game id the engine can look up; open a report file instead.'
              : 'Running a review needs mtg-table’s coach helper (./scripts/play.sh) with the bridge built. Or open a report made with tools/coach-grade.sh review — drop it anywhere on this page.'}
      </p>
    </div>
  );
}

function Summary({ loaded, onReplace }: { loaded: Loaded; onReplace: () => void }) {
  const { report, problems } = loaded;
  const s = report.summary;
  return (
    <section className="card-box rv-summary" aria-label="Summary">
      <ul className="rv-counts">
        <li className="v-mistake">
          <b>{s.mistakes}</b> clear mistake{s.mistakes === 1 ? '' : 's'}
        </li>
        <li className="v-close">
          <b>{s.closeCalls}</b> close call{s.closeCalls === 1 ? '' : 's'}
        </li>
        <li className="v-best">
          <b>{s.best}</b> best
        </li>
        <li className="v-not-graded">
          <b>{s.notGraded}</b> not graded
        </li>
      </ul>
      <p className="small">Graded against the best play versus Forge’s Default AI playing both seats.</p>
      <p className="small muted">{knowledgeLine(report.knowledge)}</p>
      {knowledgeWarning(report.knowledge) && (
        <p className="notice-inline warn rv-warn" role="note">
          <b>Optimistic numbers.</b> {knowledgeWarning(report.knowledge)}
        </p>
      )}
      <div className="rv-summary-foot">
        <span className="muted tiny">
          {report.createdAt ? `Made ${report.createdAt.toISOString().slice(0, 16).replace('T', ' ')} UTC · ` : ''}
          {loaded.source}
        </span>
        <button className="link-btn tiny" onClick={onReplace}>
          Open another report
        </button>
      </div>
      {problems.length > 0 && (
        <details className="rv-problems">
          <summary className="tiny">
            {problems.length} note{problems.length === 1 ? '' : 's'} on reading the report
          </summary>
          <ul className="tiny muted">
            {problems.map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

function Moment({ log, d, state, rank }: { log: GameLog; d: ReviewDecision; state: GameStateBody | null; rank: number | null }) {
  const m = d.measure;
  const phase = phaseLabel(d.phase ?? state?.phase ?? null);
  const graded = d.verdict !== 'not-graded';
  return (
    <section className="rv-moment" aria-labelledby="rv-moment-h">
      <div className="rv-moment-head">
        <span className={cx('rv-verdict', `v-${d.verdict}`)}>{verdictLabel(d)}</span>
        {rank && <span className="rv-keytag">Key moment #{rank}</span>}
        <h2 id="rv-moment-h" className="rv-moment-title">
          Turn {d.turn ?? state?.turn ?? '?'} · {phase}
          {d.type === 'target' && <span className="muted"> · {TYPE_WORDS[d.type]}</span>}
        </h2>
      </div>
      <div className="card-box rv-facts">
        <dl>
          <div>
            <dt>You played</dt>
            <dd>{d.played ? tokenLabel(d.played, state, log.seat, d.playedLabel) : '—'}</dd>
          </div>
          {d.best && (
            <div>
              <dt>Engine best</dt>
              <dd>{tokenLabel(d.best, state, log.seat, d.bestLabel)}</dd>
            </div>
          )}
          {d.forgeChoice && (
            <div>
              <dt>Forge’s AI</dt>
              <dd>{tokenLabel(d.forgeChoice, state, log.seat)}</dd>
            </div>
          )}
          {graded && d.regret !== null && (
            <div>
              <dt>Regret</dt>
              <dd>
                {fmtRegret(d.regret, m)}
                {d.regretLo !== null && d.regretHi !== null && <span className="muted"> (95% interval {fmtInterval(d.regretLo, d.regretHi, m, 'regret')})</span>}
                {isTie(d) ? (
                  <span className="muted"> — as good as the engine’s best within noise.</span>
                ) : (
                  d.verdict === 'close' && <span className="muted"> — the interval includes zero: about as good.</span>
                )}
                {d.verdict === 'mistake' && <span className="muted"> — the interval excludes zero: a clear difference.</span>}
              </dd>
            </div>
          )}
        </dl>
        {graded && (
          <p className={cx('tiny', m === 'leaf' ? 'rv-caveat' : 'muted')}>
            {measureCaption(m)} {d.stage === 'deep' ? 'Graded twice; these are the deep numbers.' : 'Quick (triage) grade.'}
          </p>
        )}
        {!graded && (
          <p className="small muted">
            Not graded: {d.status === 'ok' ? 'your choice is not one of the options the engine compared' : STATUS_WORDS[d.status]}
            {d.error ? ` — ${d.error}` : ''}.
          </p>
        )}
      </div>
      {d.options.length > 0 && (graded || d.options.length > 1) && <OptionBars d={d} state={state} seat={log.seat} />}
      {(d.fidelity.length > 0 || d.notes.length > 0) && (
        <ul className="rv-notes tiny muted" aria-label="Engine notes">
          {[...d.fidelity, ...d.notes].map((n, i) => (
            <li key={i}>{n}</li>
          ))}
        </ul>
      )}
      {d.triage && d.stage === 'deep' && d.triage.best && (
        <p className="tiny muted">
          The quick grade had {tokenLabel(d.triage.best, state, log.seat)} best
          {d.triage.regret !== null ? ` (regret ${fmtRegret(d.triage.regret, d.triage.measure ?? 'leaf')}, ${d.triage.measure === 'wins' ? 'win rate' : 'short-horizon score'})` : ''}.
        </p>
      )}
      <div className="rv-board">
        {state ? (
          <Board log={log} state={state} frameIndex={d.stateFrame} seat={log.seat} />
        ) : (
          <div className="board board-empty">
            <p className="muted">No board for this moment.</p>
          </div>
        )}
      </div>
    </section>
  );
}

function ExplainCoach({ log, loaded, onOpenSettings }: { log: GameLog; loaded: Loaded; onOpenSettings: () => void }) {
  const keys = useMemo(() => keyDecisions(loaded.decisions, loaded.report.keyMoments, 5), [loaded]);
  const key = `${gameKey(log)}:engine-review:${loaded.report.createdAt?.getTime() ?? loaded.source}`;
  const answer = useAnswer(key);
  const makePrompt = useCallback(async () => {
    const cards = await cardsForPrompt(explainCardNames(keys, log));
    return reviewExplainPrompt(loaded.report, log, keys, cards);
  }, [keys, log, loaded]);
  const ask = useCallback(() => void startAnswer(key, makePrompt), [key, makePrompt]);
  return (
    <section className="rv-coach" aria-label="Coach">
      {keys.length === 0 ? (
        <div className="card-box">
          <p className="muted small">No mistakes or close calls to explain — every graded choice was the engine’s best.</p>
        </div>
      ) : (
        <AnswerBox
          answer={answer}
          askLabel="Coach: explain the key moments"
          idleText={`The coach explains the ${keys.length} key moment${keys.length === 1 ? '' : 's'} from the engine’s numbers — why the best option scores better — without re-solving them.`}
          onAsk={ask}
          onStop={() => stopAnswer(key)}
          makePrompt={makePrompt}
          onOpenSettings={onOpenSettings}
          feedback={feedbackTarget(log, null, 'engine-review')}
        />
      )}
    </section>
  );
}

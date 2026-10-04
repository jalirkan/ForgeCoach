/*
 * ForgeCoach — ui/practice/PracticeApp.tsx
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Practice (#practice, lazy): puzzles from the player's own games
 * (practice/puzzles.ts). The list, then one puzzle at a time: the replay
 * Board at the decision (the viewer's redacted state only), "what would you
 * do?" with the options the log gives, and after the pick the reveal — what
 * happened in the game, the engine's preferred option when a review graded
 * it (with its honesty rules), the swing, and the coach's explanation through
 * answers.ts `startAnswer`.
 */
import './practice.css';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GameLog } from '../../log.ts';
import type { AnyCard, GameStateBody } from '../../protocol.ts';
import { extractDecisions, type Decision } from '../../decisions.ts';
import { filmCardNames } from '../../filmRoom.ts';
import { fmtInterval, fmtRate, measureCaption } from '../../gameReview.ts';
import {
  checkAnswer,
  normalizePick,
  OUTCOME_WORDS,
  practiceOrder,
  puzzleAnswerKey,
  puzzleMoment,
  puzzlePrompt,
  recordTry,
  removeGame,
  summarizeBook,
  swingWords,
  SWING_SOURCE_WORDS,
  type Puzzle,
  type PuzzleBook,
  type PuzzleResult,
} from '../../practice/puzzles.ts';
import { Board } from '../Board.tsx';
import { CardDetail } from '../CardDetail.tsx';
import { BoardStateRef, CardActionsContext, type CardActions } from '../cardContext.ts';
import { cardsForPrompt, prefetchCards } from '../cardData.ts';
import { AnswerBox } from '../CoachPanel.tsx';
import { answerBusy, getAnswer, startAnswer, stopAnswer, useAnswer } from '../answers.ts';
import { SettingsDialog } from '../SettingsDialog.tsx';
import { IconChevronLeft, IconGear } from '../Icons.tsx';
import { Logo } from '../Logo.tsx';
import { useCoachAvailability, useMediaQuery } from '../hooks.ts';
import { stateCardNames, cx } from '../util.ts';
import { addSamples, onBookChange, puzzleLog, readBook, scanHistory, updateBook } from './practiceData.ts';

function useBook(): PuzzleBook {
  const [book, setBook] = useState(readBook);
  useEffect(() => onBookChange(() => setBook(readBook())), []);
  return book;
}

const SOURCE_BADGE = { eval: 'win chance', review: 'engine review', heuristic: 'rough swing' } as const;

function puzzleFromHash(): string | null {
  const m = /^#practice\/(.+)$/.exec(location.hash);
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]!);
  } catch {
    return null;
  }
}

export default function PracticeApp() {
  const book = useBook();
  const wide = useMediaQuery('(min-width: 1024px)');
  const [openId, setOpenId] = useState<string | null>(puzzleFromHash);
  const [settings, setSettings] = useState(false);
  const [scan, setScan] = useState<'idle' | 'busy' | string>('idle');
  const [samples, setSamples] = useState<'idle' | 'busy' | 'error'>('idle');

  useEffect(() => {
    const on = () => setOpenId(puzzleFromHash());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);

  const runScan = useCallback(async () => {
    setScan('busy');
    try {
      const r = await scanHistory();
      setScan(r.games ? `Read ${r.games} saved game${r.games === 1 ? '' : 's'}: ${r.puzzles} puzzle${r.puzzles === 1 ? '' : 's'}.` : 'idle');
    } catch {
      setScan('Your record could not be read.');
    }
  }, []);
  useEffect(() => {
    void runScan();
  }, [runScan]);

  const order = useMemo(() => practiceOrder(book.puzzles), [book.puzzles]);
  const open = (id: string | null) => {
    location.hash = id ? `#practice/${encodeURIComponent(id)}` : '#practice';
  };
  const current = openId ? book.puzzles.find((p) => p.id === openId) ?? null : null;
  const next = (fromId: string) => {
    const rest = order.filter((p) => p.id !== fromId);
    open(rest[0]?.id ?? null);
  };

  return (
    <div className={cx('pz', wide ? 'is-wide' : 'is-narrow')}>
      <header className="topbar">
        <button className="logo-btn" onClick={() => (current ? open(null) : (location.hash = ''))} aria-label={current ? 'Back to the puzzle list' : 'Home'}>
          {current ? <IconChevronLeft size={20} /> : <Logo compact={!wide} />}
        </button>
        <div className="topbar-title">
          <span className="topbar-game">{current ? `Practice · ${current.title}` : 'Practice'}</span>
          <span className="topbar-sub">{current ? current.game.title : 'Puzzles from your own games'}</span>
        </div>
        <span className="grow" />
        <button className="icon-btn" onClick={() => setSettings(true)} aria-label="Settings">
          <IconGear size={18} />
        </button>
      </header>
      {current ? (
        <PuzzleView key={current.id} puzzle={current} wide={wide} onNext={() => next(current.id)} onSettings={() => setSettings(true)} left={order.filter((p) => !p.tries.length && p.id !== current.id).length} />
      ) : openId ? (
        <main className="pz-main pz-list">
          <p className="muted">That puzzle is no longer in your list.</p>
          <button className="btn btn-sm" onClick={() => open(null)}>
            All puzzles
          </button>
        </main>
      ) : (
        <PuzzleList
          book={book}
          order={order}
          scan={scan}
          samples={samples}
          onScan={() => void runScan()}
          onSamples={async () => {
            setSamples('busy');
            try {
              await addSamples();
              setSamples('idle');
            } catch {
              setSamples('error');
            }
          }}
          onOpen={open}
        />
      )}
      <SettingsDialog open={settings} onClose={() => setSettings(false)} />
    </div>
  );
}

// ---------------------------------------------------------------------------

function PuzzleList({
  book,
  order,
  scan,
  samples,
  onScan,
  onSamples,
  onOpen,
}: {
  book: PuzzleBook;
  order: Puzzle[];
  scan: string;
  samples: 'idle' | 'busy' | 'error';
  onScan: () => void;
  onSamples: () => void;
  onOpen: (id: string) => void;
}) {
  const sum = summarizeBook(book.puzzles);
  const games = useMemo(() => {
    const m = new Map<string, { title: string; ref: string; puzzles: Puzzle[] }>();
    for (const p of order) {
      const g = m.get(p.game.ref) ?? { title: p.game.title, ref: p.game.ref, puzzles: [] };
      g.puzzles.push(p);
      m.set(p.game.ref, g);
    }
    return [...m.values()];
  }, [order]);
  const hasSamples = book.puzzles.some((p) => p.game.sample);
  return (
    <main className="pz-main pz-list">
      <section className="card-box pz-intro">
        <h1 className="pz-h1">Practice from your own games</h1>
        <p>
          The moments where your position fell the most across one of your decisions, and the engine review’s graded calls. Pick what you would do, then
          see what happened, what the engine preferred when it graded the moment, and the coach’s view.
        </p>
        <div className="pz-stats" aria-label="Your practice">
          <span>
            <b>{sum.total}</b> puzzles
          </span>
          <span>
            <b>{sum.tried}</b> tried
          </span>
          <span>
            <b>{sum.graded}</b> engine-graded
          </span>
          {sum.tried > 0 && (
            <span>
              <b>{sum.engineAgreed}</b> matched the engine
            </span>
          )}
        </div>
        <div className="pz-actions">
          {order.length > 0 && (
            <button className="btn btn-primary" onClick={() => onOpen(order[0]!.id)}>
              {order[0]!.tries.length ? 'Practise again' : 'Start practising'}
            </button>
          )}
          <button className="btn btn-sm" onClick={onScan} disabled={scan === 'busy'}>
            {scan === 'busy' ? 'Reading your record…' : 'Read Your record again'}
          </button>
          {!hasSamples && (
            <button className="btn btn-sm" onClick={onSamples} disabled={samples === 'busy'}>
              {samples === 'busy' ? 'Adding…' : 'Add the sample games'}
            </button>
          )}
        </div>
        {scan !== 'idle' && scan !== 'busy' && <p className="tiny muted">{scan}</p>}
        {samples === 'error' && <p className="tiny pz-err">The sample games could not be downloaded.</p>}
        {!order.length && scan !== 'busy' && (
          <p className="tiny muted">
            No puzzles yet. Games you finish against Forge land in <a href="#history">Your record</a>; their turning points become puzzles here. The film room and the
            engine review add theirs too.
          </p>
        )}
      </section>
      {games.map((g) => (
        <section key={g.ref} className="card-box pz-game" aria-label={g.title}>
          <div className="box-h">
            <span>{g.title}</span>
            <button className="link-btn tiny" onClick={() => updateBook((b) => removeGame(b, g.ref))} title="Remove this game’s puzzles">
              Remove
            </button>
          </div>
          <ol className="pz-items">
            {g.puzzles
              .slice()
              .sort((a, b) => a.decisionFrame - b.decisionFrame)
              .map((p) => {
                const last = p.tries[p.tries.length - 1];
                return (
                  <li key={p.id}>
                    <button className="pz-item" onClick={() => onOpen(p.id)}>
                      <span className="pz-item-t">{p.title}</span>
                      <span className={cx('pz-badge', p.engine ? 'is-engine' : `is-${p.swing.source}`)}>{p.engine ? 'engine-graded' : SOURCE_BADGE[p.swing.source]}</span>
                      <span className={cx('pz-item-o tiny', last ? `is-${last.outcome}` : 'muted')}>{last ? OUTCOME_WORDS[last.outcome] : 'new'}</span>
                    </button>
                  </li>
                );
              })}
          </ol>
        </section>
      ))}
    </main>
  );
}

// ---------------------------------------------------------------------------

function PuzzleView({ puzzle: p, wide, onNext, onSettings, left }: { puzzle: Puzzle; wide: boolean; onNext: () => void; onSettings: () => void; left: number }) {
  const [log, setLog] = useState<GameLog | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pick, setPick] = useState<string[]>([]);
  const [checked, setChecked] = useState<{ chose: string[]; result: PuzzleResult } | null>(null);
  const [detail, setDetail] = useState<{ card: AnyCard; state: GameStateBody | null } | null>(null);

  useEffect(() => {
    let live = true;
    puzzleLog(p)
      .then((l) => live && setLog(l))
      .catch((e) => live && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
    };
  }, [p]);

  const state = useMemo(() => {
    const f = log?.frames[p.boardFrame];
    return f && f.type === 'state' ? (f.body as GameStateBody) : null;
  }, [log, p.boardFrame]);
  const decision = useMemo<Decision | null>(() => {
    if (!log) return null;
    try {
      return extractDecisions(log).find((d) => d.frameIndex === p.decisionFrame) ?? null;
    } catch {
      return null;
    }
  }, [log, p.decisionFrame]);
  useEffect(() => {
    if (state) prefetchCards(stateCardNames(state));
  }, [state]);

  const boardRef = useRef<GameStateBody | null>(state);
  boardRef.current = state;
  const actions = useMemo<CardActions>(() => ({ open: (card, st) => setDetail({ card, state: st }), hover: () => undefined }), []);

  const toggle = (id: string) => {
    if (checked) return;
    if (!p.multi) return setPick([id]);
    setPick((cur) => (id === 'none' ? (cur.includes('none') ? [] : ['none']) : cur.includes(id) ? cur.filter((x) => x !== id) : [...cur.filter((x) => x !== 'none'), id]));
  };
  const check = () => {
    const chose = normalizePick(p, pick);
    if (!chose.length) return;
    const result = checkAnswer(p, chose);
    setChecked({ chose, result });
    updateBook((b) => recordTry(b, p.id, chose, result.outcome));
  };

  return (
    <CardActionsContext.Provider value={actions}>
      <BoardStateRef.Provider value={boardRef}>
        <main className="pz-main pz-grid">
          <div className="pz-board">
            {state && log ? (
              <Board log={log} state={state} frameIndex={p.boardFrame} seat={log.seat} />
            ) : (
              <div className="board board-empty">
                <p className={cx('muted', !error && 'pulse')}>{error ?? 'Setting up the board…'}</p>
              </div>
            )}
          </div>
          <div className="pz-side">
            <section className="card-box pz-q" aria-labelledby="pz-q-h">
              <div className="box-h">
                <span>What would you do?</span>
                <span className="tiny muted">{left > 0 ? `${left} new left` : 'all tried'}</span>
              </div>
              <p className="pz-question" id="pz-q-h">
                {p.question}
              </p>
              {p.derived && <p className="tiny muted">Options read from your view of the board: lands you could still play, spells your untapped mana covers, and what you played.</p>}
              <div className={cx('pz-options', p.multi && 'is-multi')} role={p.multi ? 'group' : 'radiogroup'} aria-label="Options">
                {p.options.map((o) => {
                  const on = (checked?.chose ?? pick).includes(o.id);
                  const mark = checked ? optionMarks(p, o.id, checked.chose) : [];
                  return (
                    <button
                      key={o.id}
                      type="button"
                      role={p.multi ? 'checkbox' : 'radio'}
                      aria-checked={on}
                      className={cx('pz-opt', on && 'is-on', checked && p.engine?.best === o.id && 'is-best', checked && p.played.includes(o.id) && 'is-played')}
                      onClick={() => toggle(o.id)}
                      disabled={!!checked}
                    >
                      <span className="pz-opt-box" aria-hidden="true">
                        {on ? '✓' : ''}
                      </span>
                      <span className="pz-opt-l">{o.label}</span>
                      {mark.length > 0 && <span className="pz-opt-m tiny">{mark.join(' · ')}</span>}
                    </button>
                  );
                })}
              </div>
              {!checked ? (
                <div className="pz-actions">
                  <button className="btn btn-primary" onClick={check} disabled={!normalizePick(p, pick).length}>
                    Check
                  </button>
                  <button className="btn btn-sm btn-quiet" onClick={onNext}>
                    Skip
                  </button>
                </div>
              ) : null}
            </section>
            {checked && log && <Reveal log={log} puzzle={p} decision={decision} chose={checked.chose} result={checked.result} onSettings={onSettings} />}
            {checked && (
              <div className="pz-actions">
                <button
                  className="btn btn-sm"
                  onClick={() => {
                    setChecked(null);
                    setPick([]);
                  }}
                >
                  Try again
                </button>
                <button className="btn btn-primary" onClick={onNext}>
                  Next puzzle
                </button>
              </div>
            )}
            {!wide && <div className="pz-spacer" />}
          </div>
        </main>
        <CardDetail card={detail?.card ?? null} state={detail?.state ?? null} seat={log?.seat ?? 0} onClose={() => setDetail(null)} />
      </BoardStateRef.Provider>
    </CardActionsContext.Provider>
  );
}

function optionMarks(p: Puzzle, id: string, chose: readonly string[]): string[] {
  const out: string[] = [];
  if (p.engine?.best === id) out.push('engine’s best');
  if (p.played.includes(id)) out.push('in the game');
  if (chose.includes(id)) out.push('yours');
  return out;
}

function Reveal({ log, puzzle: p, decision, chose, result, onSettings }: { log: GameLog; puzzle: Puzzle; decision: Decision | null; chose: string[]; result: PuzzleResult; onSettings: () => void }) {
  const key = puzzleAnswerKey(p, chose);
  const answer = useAnswer(key);
  const coach = useCoachAvailability();
  const makePrompt = useCallback(async () => {
    if (!decision) throw new Error('This decision is not in the game’s log any more.');
    const cards = await cardsForPrompt(filmCardNames(log, puzzleMoment(p, decision)));
    return puzzlePrompt(log, p, decision, cards, chose);
  }, [log, p, decision, chose]);
  const ask = useCallback(() => void startAnswer(key, makePrompt), [key, makePrompt]);
  // The coach explains by itself once the pick is checked, when one is connected.
  useEffect(() => {
    if (coach.ready && decision && !getAnswer(key) && !answerBusy(key)) ask();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coach.ready, decision, key]);

  const e = p.engine;
  return (
    <>
      <section className={cx('card-box pz-result', `is-${result.outcome}`)} aria-live="polite">
        <div className="pz-result-h">{result.headline}</div>
        <p className="pz-result-d">{result.detail}</p>
        <p className="tiny">
          <span className="muted">In the game you:</span> {p.playedWords.length ? p.playedWords.join('; ') : 'passed'}
          {result.sameAsGame ? <span className="muted"> — the same as your pick.</span> : null}
        </p>
      </section>
      {e && (
        <section className="card-box pz-engine" aria-labelledby="pz-e-h">
          <div className="box-h" id="pz-e-h">
            <span>Engine review</span>
            <span className="tiny muted">{e.verdict.toLowerCase()} in the game</span>
          </div>
          <p className="tiny muted">{measureCaption(e.measure)} Yardstick: the best play against Forge’s Default AI.</p>
          <table className="pz-table">
            <tbody>
              {e.options.map((o) => {
                const label = p.options.find((x) => x.id === o.id)?.label ?? o.id;
                const marks = optionMarks(p, o.id, chose);
                return (
                  <tr key={o.id} className={cx(o.id === e.best && 'is-best')}>
                    <th scope="row">
                      {label}
                      {marks.length > 0 && <span className="pz-opt-m tiny"> {marks.join(' · ')}</span>}
                    </th>
                    <td className="pz-num">{fmtRate(o.winRate, e.measure)}</td>
                    <td className="pz-iv tiny muted">{fmtInterval(o.winLo, o.winHi, e.measure)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="tiny muted">A gap whose interval includes zero is a close call, never a mistake.</p>
          {e.warning && <p className="tiny pz-warn">{e.warning}</p>}
        </section>
      )}
      <section className="card-box pz-swing" aria-label="How the position moved">
        <div className="box-h">
          <span>How the position moved</span>
        </div>
        <p className="pz-swing-n">{swingWords(p.swing)}</p>
        <p className="tiny muted">
          {SWING_SOURCE_WORDS[p.swing.source]}.{p.swing.source !== 'review' ? ' The opponent’s moves in between count too: a fall says where, not why.' : ''}
        </p>
      </section>
      <section className="pz-coach" aria-label="Coach">
        <AnswerBox
          answer={answer}
          askLabel="Explain this moment"
          idleText="The coach looks at the moment, your pick and what happened."
          onAsk={ask}
          onStop={() => stopAnswer(key)}
          makePrompt={makePrompt}
          onOpenSettings={onSettings}
          structured
        />
      </section>
    </>
  );
}

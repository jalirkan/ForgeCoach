/*
 * ForgeCoach — ui/GameView.tsx
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * A loaded game: timeline · board · coach. Desktop is three columns; phones
 * get Board / Coach tabs and a bottom scrubber dock.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GameLog } from '../log.ts';
import type { AnyCard, GameStateBody } from '../protocol.ts';
import { extractDecisions, type Decision } from '../decisions.ts';
import { activeGuideId, listGuides } from '../guide.ts';
import type { LiveStatus } from '../live.ts';
import { Board } from './Board.tsx';
import { LogDrawer, LogTab } from './play/LogDrawer.tsx';
import './play/log.css';
import { CardDetail, HoverPreview } from './CardDetail.tsx';
import { BoardStateRef, CardActionsContext, type CardActions } from './cardContext.ts';
import { cachedMap, prefetchCards, useCardsVersion } from './cardData.ts';
import type { CardInfo } from '../cards.ts';
import { CoachPanel, decisionKey, type CoachTab } from './CoachPanel.tsx';
import { GuideSheet } from './GuideSheet.tsx';
import { useMediaQuery, useStepKeys } from './hooks.ts';
import { IconGear, IconX } from './Icons.tsx';
import { Logo } from './Logo.tsx';
import { Sheet } from './Sheet.tsx';
import { ScrubDock, TimelineList, actionsSummary, stripRound, type ScrubMode } from './Timeline.tsx';
import { useAnsweredKeys } from './answers.ts';
import { allCardNames, cx, stateFrames } from './util.ts';
import { phaseLabel } from '../decisions.ts';

export interface LiveInfo {
  url: string;
  status: LiveStatus;
  detail?: string;
}

function safeDecisions(log: GameLog, cards?: Map<string, CardInfo>): Decision[] {
  try {
    return extractDecisions(log, cards ? { cards } : undefined);
  } catch {
    try {
      return extractDecisions(log);
    } catch {
      return [];
    }
  }
}

function guideNameNow(): string | null {
  try {
    const id = activeGuideId();
    return id ? listGuides().find((g) => g.id === id)?.name ?? null : null;
  } catch {
    return null;
  }
}

export function GameView({
  log,
  title,
  live,
  initialDecision,
  initialTab = 'moment',
  onIndexChange,
  onClose,
  closeLabel,
  onSettings,
  onEngineReview,
}: {
  log: GameLog;
  title: string;
  live: LiveInfo | null;
  initialDecision: number | null;
  initialTab?: CoachTab;
  onIndexChange?: (i: number) => void;
  onClose: () => void;
  /** Shown as a labelled button instead of the bare ✕ (e.g. "Back to the table"). */
  closeLabel?: string;
  onSettings: () => void;
  /** Opens the engine review screen for this game (ui/review). */
  onEngineReview?: () => void;
}) {
  const frames = useMemo(() => stateFrames(log), [log]);
  const names = useMemo(() => allCardNames(log), [log]);
  // Card text sharpens the priority stops; re-extract as it arrives.
  const cardsVersion = useCardsVersion();
  const cardMap = useMemo(() => cachedMap(names), [names, cardsVersion]);
  const decisions = useMemo(() => safeDecisions(log, cardMap.size ? cardMap : undefined), [log, cardMap]);
  const [mode, setMode] = useState<ScrubMode>(decisions.length === 0 && frames.length > 0 ? 'frames' : 'decisions');
  const [dIdx, setDIdx] = useState(() =>
    initialDecision !== null ? Math.min(Math.max(0, initialDecision), Math.max(0, decisions.length - 1)) : live ? Math.max(0, decisions.length - 1) : 0,
  );
  const [fIdx, setFIdx] = useState(() => (live ? Math.max(0, frames.length - 1) : 0));
  const [tab, setTab] = useState<CoachTab>(initialTab);
  const [phoneTab, setPhoneTab] = useState<'board' | 'coach'>('board');
  const [listOpen, setListOpen] = useState(false);
  const [guidesOpen, setGuidesOpen] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const closeLog = useCallback(() => setLogOpen(false), []);
  const [guideName, setGuideName] = useState<string | null>(guideNameNow);
  const [detail, setDetail] = useState<{ card: AnyCard; state: GameStateBody | null } | null>(null);
  const [hover, setHover] = useState<{ name: string | null; rect: DOMRect | null }>({ name: null, rect: null });
  const wide = useMediaQuery('(min-width: 1024px)');

  // Prefetch every card in the log (prefetchCards skips names already requested).
  useEffect(() => prefetchCards(names), [names]);

  // Re-extraction can add or drop decisions: keep the same moment selected.
  const selFrame = useRef<number | null>(null);
  const prevDecisions = useRef(decisions);
  useEffect(() => {
    if (prevDecisions.current === decisions) return;
    const old = prevDecisions.current;
    prevDecisions.current = decisions;
    const fi = selFrame.current;
    if (fi === null || old.length === 0) return;
    const wasLast = dIdxRef.current >= old.length - 1;
    if (live && wasLast) return; // the follow effect handles it
    let best = 0;
    decisions.forEach((d, i) => {
      if (d.frameIndex <= fi) best = i;
    });
    setDIdx(best);
  }, [decisions, live]);

  // Live: follow the newest decision/frame while the user sits at the end.
  const prevLens = useRef({ d: decisions.length, f: frames.length });
  useEffect(() => {
    const prev = prevLens.current;
    if (live) {
      setDIdx((i) => (i >= prev.d - 1 ? Math.max(0, decisions.length - 1) : i));
      setFIdx((i) => (i >= prev.f - 1 ? Math.max(0, frames.length - 1) : i));
    }
    prevLens.current = { d: decisions.length, f: frames.length };
  }, [decisions.length, frames.length, live]);

  const dIdxRef = useRef(dIdx);
  dIdxRef.current = dIdx;
  selFrame.current = decisions[dIdx]?.frameIndex ?? selFrame.current;
  const count = mode === 'decisions' ? decisions.length : frames.length;
  const index = mode === 'decisions' ? dIdx : fIdx;
  const select = useCallback(
    (i: number) => {
      const n = mode === 'decisions' ? decisions.length : frames.length;
      const c = Math.min(Math.max(0, i), Math.max(0, n - 1));
      (mode === 'decisions' ? setDIdx : setFIdx)(c);
    },
    [mode, decisions.length, frames.length],
  );
  const step = useCallback(
    (delta: number | 'first' | 'last') => {
      if (delta === 'first') select(0);
      else if (delta === 'last') select(count - 1);
      else select(index + delta);
    },
    [select, index, count],
  );
  useStepKeys(step, !detail);

  useEffect(() => {
    if (mode === 'decisions') onIndexChange?.(dIdx);
  }, [dIdx, mode, onIndexChange]);

  const decision: Decision | null = mode === 'decisions' ? decisions[dIdx] ?? null : null;
  const frame = mode === 'frames' ? frames[fIdx] ?? null : null;
  const state = decision?.state ?? frame?.state ?? frames[frames.length - 1]?.state ?? null;
  const frameIndex = decision?.frameIndex ?? frame?.frameIndex ?? 0;

  const switchMode = useCallback(
    (m: ScrubMode) => {
      if (m === mode) return;
      // Keep the board where it is when switching.
      if (m === 'frames') {
        const fi = decisions[dIdx]?.frameIndex;
        if (fi !== undefined) {
          const j = frames.findIndex((f) => f.frameIndex >= fi);
          if (j >= 0) setFIdx(j);
        }
      } else {
        const fi = frames[fIdx]?.frameIndex ?? 0;
        let best = 0;
        decisions.forEach((d, i) => {
          if (d.frameIndex <= fi) best = i;
        });
        setDIdx(best);
      }
      setMode(m);
    },
    [mode, decisions, frames, dIdx, fIdx],
  );
  const jumpToDecision = useCallback(() => switchMode('decisions'), [switchMode]);

  const boardStateRef = useRef<GameStateBody | null>(state);
  boardStateRef.current = state;
  const actions = useMemo<CardActions>(
    () => ({
      open: (card, st) => {
        setHover({ name: null, rect: null });
        setDetail({ card, state: st });
      },
      hover: (name, rect) => setHover({ name, rect: rect ?? null }),
    }),
    [],
  );

  const answers = useAnsweredKeys();
  const answered = useCallback((i: number) => !!decisions[i] && answers.has(decisionKey(log, decisions[i]!)), [answers, decisions, log]);

  const players = log.hello?.players ?? state?.players ?? [];
  const opp = players.find((p) => p.id !== log.seat);
  const over = log.over;

  const dockTitle = decision ? stripRound(decision.label) : frame ? `${frame.state.activePlayer === log.seat ? 'Your' : "Opp's"} ${phaseLabel(frame.state.phase)}` : 'Nothing yet';
  const dockSub = decision ? `R${decision.state.round} · ${actionsSummary(decision)}` : frame ? `Round ${frame.state.round} · frame #${frame.frameIndex}` : '';

  const list = (
    <TimelineList
      mode={mode}
      onMode={switchMode}
      decisions={decisions}
      frames={frames}
      index={index}
      onSelect={(i) => {
        select(i);
        setListOpen(false);
      }}
      answered={answered}
      seat={log.seat}
    />
  );

  const coach = (
    <CoachPanel
      log={log}
      decision={decision}
      frameMode={mode === 'frames'}
      onJumpToDecision={jumpToDecision}
      tab={tab}
      onTab={setTab}
      onOpenSettings={onSettings}
      onOpenGuides={() => setGuidesOpen(true)}
      guideName={guideName}
    />
  );

  const board = state ? (
    <Board log={log} state={state} frameIndex={frameIndex} seat={log.seat} />
  ) : (
    <div className="board board-empty">
      <p className="muted">{live ? 'Waiting for the first game state…' : 'This log has no game states.'}</p>
    </div>
  );

  return (
    <CardActionsContext.Provider value={actions}>
      <BoardStateRef.Provider value={boardStateRef}>
        <div className={cx('game', wide ? 'is-wide' : 'is-narrow')}>
          <header className="topbar">
            <button className="logo-btn" onClick={onClose} aria-label="Back to start">
              <Logo compact={!wide} />
            </button>
            <div className="topbar-title">
              <span className="topbar-game">{title}</span>
              <span className="topbar-sub">
                You vs {opp?.name ?? 'Opponent'}
                {over && (
                  <span className={cx('result', over.winner === log.seat ? 'is-win' : over.winner === null ? 'is-draw' : 'is-loss')}>
                    {over.winner === log.seat ? 'Won' : over.winner === null ? 'Draw' : 'Lost'}
                  </span>
                )}
              </span>
            </div>
            {live && (
              <span className={cx('live-pill', `is-${live.status}`)} title={live.detail ?? live.url}>
                <span className="live-dot" />
                {live.status === 'open' ? 'Live' : live.status === 'connecting' ? 'Connecting' : live.status === 'error' ? 'Error' : 'Closed'}
                {live.detail && wide && <span className="live-detail">{live.detail}</span>}
              </span>
            )}
            <span className="grow" />
            {onEngineReview && !live && (
              <button className="btn btn-quiet btn-sm" onClick={onEngineReview} title="The engine’s grade of every decision: what each option was worth">
                Engine review
              </button>
            )}
            <LogTab variant="button" onClick={() => setLogOpen(true)} open={logOpen} />
            <button className="icon-btn" onClick={onSettings} aria-label="Settings">
              <IconGear size={18} />
            </button>
            {closeLabel ? (
              <button className="btn btn-primary btn-sm" onClick={onClose}>
                {closeLabel}
              </button>
            ) : (
              <button className="icon-btn" onClick={onClose} aria-label="Close game">
                <IconX size={18} />
              </button>
            )}
          </header>
          {live && live.detail && !wide && <div className="live-banner">{live.detail}</div>}

          {wide ? (
            <div className="cols">
              <aside className="col col-timeline">{list}</aside>
              <main className="col col-board">{board}</main>
              <aside className="col col-coach">{coach}</aside>
            </div>
          ) : (
            <>
              <div className="phone-tabs seg">
                <button className={cx(phoneTab === 'board' && 'is-on')} onClick={() => setPhoneTab('board')}>
                  Board
                </button>
                <button className={cx(phoneTab === 'coach' && 'is-on')} onClick={() => setPhoneTab('coach')}>
                  Coach
                  {decision && answers.has(decisionKey(log, decision)) && <span className="tl-dot" />}
                </button>
              </div>
              <main className="phone-main">{phoneTab === 'board' ? board : coach}</main>
              <ScrubDock
                mode={mode}
                count={count}
                index={index}
                onSelect={select}
                title={dockTitle}
                subtitle={dockSub}
                kind={decision?.kind}
                onOpenList={() => setListOpen(true)}
              />
              <Sheet open={listOpen} onClose={() => setListOpen(false)} title="Timeline" className="sheet-list" width={460}>
                {list}
              </Sheet>
            </>
          )}
        </div>
        <LogDrawer log={log} upTo={frameIndex} open={logOpen} onClose={closeLog} />
        <CardDetail card={detail?.card ?? null} state={detail?.state ?? null} seat={log.seat} onClose={() => setDetail(null)} />
        {wide && <HoverPreview name={hover.name} rect={hover.rect} />}
        <GuideSheet open={guidesOpen} onClose={() => setGuidesOpen(false)} onChange={() => setGuideName(guideNameNow())} />
      </BoardStateRef.Provider>
    </CardActionsContext.Provider>
  );
}

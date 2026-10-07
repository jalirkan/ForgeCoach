/*
 * ForgeCoach — ui/play/PlayView.tsx
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Playing a game against the Forge AI — or, at a table of two (mtg-table
 * M59), against a friend through the engine, either seat — from the player's seat: the replay
 * board made interactive, an action bar that always has one obvious primary
 * button, your hand along the bottom, and the coach beside the board.
 *
 * The engine is the judge of every click (mtg-table protocol §4.1): cards the
 * engine names are outlined, cards a click plausibly drives are lightly
 * outlined, and the acts are the protocol's own (clickCard, clickPlayer,
 * buttonOk / buttonCancel with the engine's labels, passPriority, yieldTo,
 * useMana, undo, alphaStrike, concede, newGame).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ActBody, AnswerValue, AnyCard, Card, GameStateBody } from '../../protocol.ts';
import { isHidden, MANA_COLORS, opponentIsHuman, undoOf } from '../../protocol.ts';
import type { GameLog } from '../../log.ts';
import type { PlaySession, PlaySnapshot } from '../../play/session.ts';
import { activeGuideId, listGuides } from '../../guide.ts';
import { canPay, chosenColors, turnFacts, untappedManaSources } from '../../state.ts';
import { cardIndex } from '../../decisions.ts';
import { seatDisplayName } from '../../play/aiName.ts';
import { tableLines } from '../../play/tableView.ts';
import { Board } from '../Board.tsx';
import { CardDetail, HoverPreview } from '../CardDetail.tsx';
import { BoardStateRef, CardActionsContext, PlayContext, type CardActions, type PlayInteraction } from '../cardContext.ts';
import { cachedMap, prefetchCards, useCardsVersion } from '../cardData.ts';
import { GuideSheet } from '../GuideSheet.tsx';
import { useMediaQuery } from '../hooks.ts';
import { IconFlag, IconGear, IconKeyboard, IconMore, IconSpark, IconX } from '../Icons.tsx';
import { Logo } from '../Logo.tsx';
import { Sheet } from '../Sheet.tsx';
import { allCardNames, cx, readLS, stateCardNames, writeLS } from '../util.ts';
import { AskDialog, OpeningDialog, openingKind } from './AskDialog.tsx';
import { ActionBar } from './ActionBar.tsx';
import { GameOverCard } from './GameOverCard.tsx';
import type { FriendReviewView } from './useFriendReview.ts';
import { FilmRoom } from '../filmroom/FilmRoom.tsx';
import { HandDock } from './HandDock.tsx';
import { LogDrawer, LogTab } from './LogDrawer.tsx';
import { PhaseStrip } from './PhaseStrip.tsx';
import { cardRole, describeInput, handNeeded, noticeLine, playerClickable, type ClickContext } from './inputView.ts';
import { lastStateFrame } from './liveDecision.ts';
import { PlayCoach } from './PlayCoach.tsx';
import { ZonePickPanel } from './ZonePickPanel.tsx';
import { StackPanel } from '../StackPanel.tsx';
import { stackEntries } from '../stackModel.ts';
import { zonePick } from './zonePick.ts';
import { CombatArrows } from './CombatArrows.tsx';
import { combatLinks, combatMarks } from './combatLines.ts';
import { selectionSummary } from './selection.ts';
import { matchBox, tableMatchLine, type MatchBox } from '../../play/match.ts';
import { PLAY_KEYS, planPlayKey } from './playKeys.ts';
import { BoardScenery } from '../ambience/BoardScenery.tsx';
import { WinChanceStrip } from '../winchance/WinChance.tsx';
import { useLiveWinChance, useWinChanceModel } from '../winchance/useWinChance.ts';

import './play.css';
import './controls.css';
import './log.css';
import './board.css';

const COACH_OPEN_KEY = 'forgecoach.playCoachOpen';

function guideNameNow(): string | null {
  try {
    const id = activeGuideId();
    return id ? listGuides().find((g) => g.id === id)?.name ?? null : null;
  } catch {
    return null;
  }
}

/** `Date.now()`, refreshed every second while `on` (a table's clocks). */
function useTicker(on: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [on]);
  return now;
}

function isLandCard(c: Card): boolean {
  return /\bland\b/i.test(c.types ?? '');
}

export function PlayView({
  session,
  snapshot: snap,
  onReview,
  onEngineReview,
  onLeave,
  onSettings,
  note = null,
  onDismissNote,
  leaveLabel,
  friendReview = null,
}: {
  session: PlaySession;
  snapshot: PlaySnapshot;
  /** Open the replay of this game, at a decision's frame when given (the film room's moments). */
  onReview: (log: GameLog, atFrame?: number) => void;
  /** The engine review of the finished game (ui/review). */
  onEngineReview?: (log: GameLog) => void;
  onLeave: () => void;
  onSettings: () => void;
  /** A note from starting the engine (the helper's warning that a picked AI profile was not applied), until dismissed. */
  note?: string | null;
  onDismissNote?: () => void;
  /** A game between two people (mtg-table D402): what Leave says ("Back to the room"). */
  leaveLabel?: string;
  /** mtg-table D407: this player's own engine review of a game with a friend, from the room. */
  friendReview?: FriendReviewView | null;
}) {
  const { state, input, ask, over, log, status } = snap;
  const seat = snap.seat ?? log?.seat ?? null;
  const wide = useMediaQuery('(min-width: 1024px)');
  const connected = status === 'open';

  if (import.meta.env.DEV) (window as unknown as { __forgecoach?: unknown }).__forgecoach = snap;
  const view = useMemo(() => describeInput(input, state, seat, { ask, over: !!over }), [input, state, seat, ask, over]);

  // ---- card data
  const names = useMemo(() => (log ? allCardNames(log, Math.max(0, log.frames.length - 40)) : []), [log]);
  useEffect(() => prefetchCards(names), [names]);
  const cardsVersion = useCardsVersion();

  // ---- sending
  const [busy, setBusy] = useState<'ok' | 'cancel' | null>(null);
  useEffect(() => setBusy(null), [input, state, ask]);
  useEffect(() => {
    if (!busy) return;
    const t = setTimeout(() => setBusy(null), 2500);
    return () => clearTimeout(t);
  }, [busy]);
  const [flash, setFlash] = useState<string | null>(null);
  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 2600);
    return () => clearTimeout(t);
  }, [flash]);
  // The engine's (and the session's) notices surface briefly in the bar.
  const lastNotice = snap.notices[snap.notices.length - 1];
  const seenNotice = useRef<number | null>(lastNotice ? lastNotice.seq * 1e13 + lastNotice.t : null);
  useEffect(() => {
    if (!lastNotice) return;
    const id = lastNotice.seq * 1e13 + lastNotice.t;
    if (seenNotice.current === id) return;
    seenNotice.current = id;
    if (lastNotice.level === 'info' && lastNotice.source === 'engine') return;
    setFlash(noticeLine(lastNotice.title, lastNotice.text, snap.state));
    // Only a new notice flashes; the state it names cards from is read as of then.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastNotice]);
  const act = useCallback((body: ActBody) => void session.act(body), [session]);
  const pressOk = useCallback(() => {
    if (!view.ok.enabled) return;
    setBusy('ok');
    act({ action: 'buttonOk' });
  }, [view.ok.enabled, act]);
  const pressCancel = useCallback(() => {
    if (!view.cancel.enabled) return;
    setBusy('cancel');
    act({ action: 'buttonCancel' });
  }, [view.cancel.enabled, act]);


  // ---- the win chance (mtg-table D361; Settings → Show win chance): only with a helper that has a model
  const wcModel = useWinChanceModel();
  const winChance = useLiveWinChance(log, wcModel);

  // ---- derived facts for hints
  const frameIndex = log ? lastStateFrame(log) : -1;
  const landOpen = useMemo(() => {
    if (!log || !state || seat === null || state.activePlayer !== seat || frameIndex < 0) return null;
    try {
      const f = turnFacts(log, frameIndex, seat);
      return f.landPlayed === null ? null : !f.landPlayed;
    } catch {
      return null;
    }
  }, [log, state, seat, frameIndex]);
  const affordable = useMemo(() => {
    const out = new Set<number>();
    if (!state || seat === null || view.mode !== 'main') return out;
    const me = state.players.find((p) => p.id === seat);
    if (!me) return out;
    try {
      const cards = cachedMap(stateCardNames(state));
      const chosen = log && frameIndex >= 0 ? chosenColors(log, frameIndex, seat, cards) : undefined;
      const sources = untappedManaSources(state, seat, cards, chosen);
      for (const any of me.zones.hand.cards) {
        if (isHidden(any)) continue;
        const c = any as Card;
        if (isLandCard(c)) {
          if (landOpen) out.add(c.id);
        } else if (c.manaCost !== null && canPay(c.manaCost, sources, me.manaPool as unknown as Record<string, number>)) out.add(c.id);
      }
    } catch {
      /* hints only */
    }
    return out;
  }, [state, seat, view.mode, landOpen, cardsVersion, log, frameIndex]);

  // ---- attackers / blockers chosen so far (the wire does not say until you confirm)
  const [chosenAtk, setChosenAtk] = useState<ReadonlySet<number>>(() => new Set());
  const [chosenBlk, setChosenBlk] = useState<ReadonlyMap<number, number | null>>(() => new Map());
  useEffect(() => {
    // "Alpha Strike" is only offered while nobody is attacking yet: the engine's own reset.
    if (view.mode !== 'attack' || /alpha/i.test(view.cancel.label)) setChosenAtk((s) => (s.size ? new Set() : s));
    if (view.mode !== 'block') setChosenBlk((m) => (m.size ? new Map() : m));
  }, [view.mode, view.cancel.label]);
  const isMyCreature = useCallback(
    (c: AnyCard) => !isHidden(c) && (c as Card).controller === seat && (c as Card).zone === 'battlefield' && /creature/i.test((c as Card).types ?? ''),
    [seat],
  );
  const clickCard = useCallback(
    (c: AnyCard) => {
      if (view.mode === 'attack' && isMyCreature(c)) {
        setChosenAtk((s) => {
          const n = new Set(s);
          if (n.has(c.id)) n.delete(c.id);
          else n.add(c.id);
          return n;
        });
      } else if (view.mode === 'block' && isMyCreature(c)) {
        // Forge's InputBlock: a click on a creature already blocking the current attacker takes the block
        // back; on a free creature it blocks the current attacker; on one blocking another attacker it does nothing.
        setChosenBlk((m) => {
          const n = new Map(m);
          const now = view.blockingAttackerId;
          if (!n.has(c.id)) n.set(c.id, now);
          else if (n.get(c.id) === now || now === null) n.delete(c.id);
          return n;
        });
      }
      act({ action: 'clickCard', cardId: c.id });
    },
    [view.mode, view.blockingAttackerId, isMyCreature, act],
  );
  const alphaStrike = useCallback(() => {
    const me = state?.players.find((p) => p.id === seat);
    const all = (me?.zones.battlefield.cards ?? []).filter((c) => isMyCreature(c) && !(c as Card).tapped && !(c as Card).sick).map((c) => c.id);
    setChosenAtk(new Set(all));
  }, [state, seat, isMyCreature]);
  /** Cancel, keeping the chosen-attackers picture in step with what the engine's Cancel means here. */
  const doCancel = useCallback(() => {
    if (view.mode === 'attack' && /alpha/i.test(view.cancel.label)) alphaStrike();
    if (view.mode === 'attack' && /call back/i.test(view.cancel.label)) setChosenAtk(new Set());
    pressCancel();
  }, [view.mode, view.cancel.label, alphaStrike, pressCancel]);
  const doAct = useCallback(
    (body: ActBody) => {
      if (body.action === 'alphaStrike') alphaStrike();
      act(body);
    },
    [act, alphaStrike],
  );

  // ---- the selection under way (dims the rest of the board) and the combat lines
  const selection = useMemo(() => selectionSummary(view, { attackers: chosenAtk.size, blockers: chosenBlk.size }), [view, chosenAtk, chosenBlk]);
  // Cards the engine wants clicked that the board has no tile for (a graveyard target): their own panel.
  const offBoard = useMemo(() => (ask || over ? null : zonePick(input, state, seat, view.mode)), [ask, over, input, state, seat, view.mode]);
  const links = useMemo(() => combatLinks(state, view.mode === 'block' ? chosenBlk : undefined), [state, view.mode, chosenBlk]);
  // Every attacker and its blockers share a number on the board (endstep-style), clicks not yet confirmed included.
  const pairs = useMemo(
    () => combatMarks(state, view.mode === 'block' ? chosenBlk : undefined, view.mode === 'attack' ? chosenAtk : undefined, view.mode === 'block' ? view.blockingAttackerId : null),
    [state, view.mode, view.blockingAttackerId, chosenBlk, chosenAtk],
  );

  // ---- interaction context for tiles and avatars
  const ctx: ClickContext = useMemo(() => ({ view, input, state, seat }), [view, input, state, seat]);
  const play = useMemo<PlayInteraction>(
    () => ({
      mark: (c: AnyCard) => cardRole(c, ctx),
      hint: (c: AnyCard) => affordable.has(c.id),
      click: clickCard,
      chosen: (c: AnyCard) => (chosenAtk.has(c.id) ? 'attack' : chosenBlk.has(c.id) ? 'block' : null),
      blockersFor: (attackerId: number) => [...chosenBlk].filter(([, a]) => a === attackerId).map(([b]) => b),
      playerMark: () => playerClickable(ctx),
      clickPlayer: (id: number) => {
        if (playerClickable(ctx)) act({ action: 'clickPlayer', playerId: id });
      },
    }),
    [ctx, affordable, act, clickCard, chosenAtk, chosenBlk],
  );

  // ---- details / hover
  const [detail, setDetail] = useState<{ card: AnyCard; state: GameStateBody | null } | null>(null);
  const [hover, setHover] = useState<{ name: string | null; rect: DOMRect | null }>({ name: null, rect: null });
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
  const previewId = useCallback(
    (id: number) => {
      const c = state ? cardIndex(state).get(id) : undefined;
      if (c) setDetail({ card: c, state });
    },
    [state],
  );
  const boardStateRef = useRef<GameStateBody | null>(state);
  boardStateRef.current = state;

  // ---- panels
  const [coachOpen, setCoachOpen] = useState(() => readLS(COACH_OPEN_KEY) !== '0');
  // Phones: the coach slides up over the board (never over the action bar).
  const [phoneCoach, setPhoneCoach] = useState(false);
  const [menu, setMenu] = useState(false);
  const finePointer = useMediaQuery('(hover: hover) and (pointer: fine)');
  // Phones in landscape: the dock is a side column (play.css), so the hand never covers the board.
  const sideDock = useMediaQuery('(max-width: 1023px) and (max-height: 560px) and (orientation: landscape)');
  const [handCollapsed, setHandCollapsed] = useState(false);
  const [help, setHelp] = useState(false);
  const [concede, setConcede] = useState(false);
  // The board's Concede: usable while an engine question is open too (its dialog offers it, and the top bar sits above it).
  const canConcede = connected && !over && !!state;
  const [claim, setClaim] = useState(false);
  const [guidesOpen, setGuidesOpen] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const closeLog = useCallback(() => setLogOpen(false), []);
  // An engine question that arrives while a card's details, the log or a help sheet is open must not
  // land behind it (they sit on the same layer): close them, and the question is the one thing on screen.
  const askId = ask?.askId ?? null;
  // The stack panel folds to its heading; a new item on the stack opens it again.
  const [stackFolded, setStackFolded] = useState(false);
  const stackSize = state?.stack.length ?? 0;
  const lastStackSize = useRef(stackSize);
  useEffect(() => {
    if (stackSize > lastStackSize.current) setStackFolded(false);
    lastStackSize.current = stackSize;
  }, [stackSize]);
  useEffect(() => {
    if (askId === null) return;
    setDetail(null);
    setHelp(false);
    setGuidesOpen(false);
    setLogOpen(false);
    setMenu(false);
  }, [askId]);
  const [guideName, setGuideName] = useState<string | null>(guideNameNow);
  const [waitingNext, setWaitingNext] = useState(false);
  useEffect(() => {
    if (!over) setWaitingNext(false);
  }, [over]);

  // ---- phones: combat and paying need the board, not the hand
  const boardMode = view.mode === 'attack' || view.mode === 'block' || view.mode === 'pay';
  // Phones fold the hand away while it is not what you need (combat, paying, reading
  // the coach); a tap on its header overrides that until the moment changes.
  // Phones (portrait): the hand is open at your main phase and when the engine asks for a hand card;
  // otherwise it folds to a peek strip so both battlefields fit on screen.
  const needHand = useMemo(() => handNeeded(ctx), [ctx]);
  const autoFold = !wide && !sideDock && (!needHand || phoneCoach);
  const [handOverride, setHandOverride] = useState<boolean | null>(null);
  useEffect(() => setHandOverride(null), [view.mode, phoneCoach]);
  const handHidden = autoFold ? handOverride ?? true : handCollapsed;
  const toggleHand = useCallback(() => {
    if (autoFold) setHandOverride(!handHidden);
    else setHandCollapsed((c) => !c);
  }, [autoFold, handHidden]);
  useEffect(() => {
    if (wide || !(boardMode || view.mode === 'target') || phoneCoach) return;
    const t = setTimeout(() => {
      const q = (sel: string) => document.querySelector(`.play-phone-main ${sel}`);
      const el =
        view.mode === 'target'
          ? q('.player-top [data-mark="select"]') ?? q('[data-mark="select"]')
          : view.mode === 'attack'
            ? q('.player-me .battlefield')
            : view.mode === 'pay'
              ? q('.player-me .bf-chips') ?? q('.player-me .battlefield')
              : q('.combat-panel') ?? q('.player-me .battlefield');
      el?.scrollIntoView({ block: view.mode === 'attack' ? 'start' : 'center', behavior: 'smooth' });
    }, 60);
    return () => clearTimeout(t);
  }, [wide, boardMode, view.mode, phoneCoach]);

  // The dock's height, for surfaces portaled to <body> (the minimised ask pill) to sit above it.
  const dockRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = dockRef.current;
    const root = document.documentElement;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      // In the landscape two-column layout the dock is a side column, not a bottom bar.
      const bottom = el.getBoundingClientRect().top > window.innerHeight * 0.3;
      root.style.setProperty('--play-dock-h', bottom ? `${Math.round(el.offsetHeight)}px` : '0px');
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      root.style.removeProperty('--play-dock-h');
    };
  }, [wide]);

  // The top-bar menu closes on any tap outside it.
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const close = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenu(false);
    };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [menu]);

  // ---- keyboard
  const pool = useMemo(() => state?.players.find((p) => p.id === seat)?.manaPool ?? null, [state, seat]);
  const undo = undoOf(state);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const overlay = !!detail || help || concede || guidesOpen || (logOpen && !wide) || !!document.querySelector('.sheet-backdrop');
      const plan = planPlayKey(
        { key: e.key, code: e.code, ctrlKey: e.ctrlKey, metaKey: e.metaKey, altKey: e.altKey, isComposing: e.isComposing, targetTag: t?.tagName, targetEditable: t?.isContentEditable },
        {
          view,
          askOpen: !!ask,
          over: !!over,
          canUndo: undo.can,
          poolColors: pool ? MANA_COLORS.filter((c) => pool[c] > 0) : [],
          overlay,
        },
      );
      if (!plan) return;
      if (plan.kind === 'closeOverlay') return; // the sheet closes itself
      e.preventDefault();
      switch (plan.kind) {
        case 'ok':
          pressOk();
          break;
        case 'cancel':
          doCancel();
          break;
        case 'act':
          doAct(plan.body);
          setFlash(plan.label);
          break;
        case 'help':
          setHelp(true);
          break;
        case 'log':
          setLogOpen(true);
          break;
        case 'inert':
          setFlash(plan.why);
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [view, ask, over, undo.can, pool, detail, help, concede, guidesOpen, logOpen, wide, pressOk, doCancel, doAct]);

  // ---- render
  const me = state?.players.find((p) => p.id === seat) ?? null;
  const players = log?.hello?.players ?? state?.players ?? [];
  const opp = players.find((p) => p.id !== seat);
  const hello = log?.hello ?? null;
  // M59: at a table of two the other seat is a person, named as they named themselves in the room.
  const vsHuman = opponentIsHuman(hello) || snap.table !== null;
  // M56: the AI the player chose in match setup, by the picker's name; "Forge AI" (the engine's) before it.
  const oppName = seatDisplayName(hello, opp, vsHuman ? 'Your opponent' : 'Forge AI');
  const tableNow = useTicker(snap.table !== null && !over);
  const tableNotes = over ? [] : tableLines(snap.table, snap.tableSkewMs, tableNow, vsHuman && opp?.name ? oppName : undefined);
  const gameNo = hello?.gameNumber && (hello.gameCount ?? hello.match?.games) ? `Game ${hello.gameNumber} of ${hello.gameCount ?? hello.match?.games}` : null;
  const myDeck = hello?.match?.yourDeck?.name ?? null;
  const myMove = !!(ask || (input && view.mode !== 'waiting' && view.mode !== 'yield' && !over));
  const match = matchBox(hello, over, snap.previousLogs, seat);

  // The stack: always in view while it is not empty, in one place over the board (endstep-style).
  const stackNow = useMemo(() => stackEntries(state, seat), [state, seat]);
  const stackPanel =
    state && stackNow.length > 0 ? <StackPanel entries={stackNow} state={state} variant="float" folded={stackFolded} onFold={setStackFolded} /> : null;
  const zonePanel = offBoard ? <ZonePickPanel key={input?.prompt ?? ''} pick={offBoard} view={view} state={state} seat={seat} onOk={pressOk} onCancel={pressCancel} /> : null;

  const board =
    state && log && seat !== null ? (
      <Board
        log={log}
        state={state}
        frameIndex={Math.max(0, frameIndex)}
        seat={seat}
        hideHand
        stackElsewhere
        combatMarks={pairs}
        overlay={<><CombatArrows links={links} version={state} /><BoardScenery log={log} frameIndex={Math.max(0, frameIndex)} seat={seat} /></>}
      />
    ) : (
      <div className="board board-empty">
        <div>
          <span className="spinner spinner-lg" />
          <p className="muted">{status === 'open' ? 'Shuffling up — waiting for the first game state…' : status === 'connecting' ? 'Connecting to the engine…' : snap.detail ?? 'Not connected.'}</p>
        </div>
      </div>
    );

  // Phase stops can be changed while this is a live seat with nothing else open (M33).
  const stripInteractive = connected && !!state && !ask && !over;
  const strip = (variant: 'bar' | 'side') => (
    <PhaseStrip state={state} seat={seat} interactive={stripInteractive} onAct={act} variant={variant} {...(vsHuman ? { oppLabel: oppName } : {})} />
  );
  const toggleCoach = () =>
    setCoachOpen((o) => {
      writeLS(COACH_OPEN_KEY, o ? '0' : '1');
      return !o;
    });

  const coach = (
    <PlayCoach
      log={log}
      state={state}
      input={input}
      ask={ask}
      seat={seat}
      myMove={myMove}
      guideName={guideName}
      onOpenGuides={() => setGuidesOpen(true)}
      onOpenSettings={onSettings}
      onCollapse={wide ? toggleCoach : undefined}
    />
  );

  const dock = (
    <div className="play-dock" ref={dockRef}>
      <ActionBar
        view={view}
        busy={busy}
        pool={pool}
        canUndo={undo.can && !ask && !over}
        undoDepth={undo.depth}
        onOk={pressOk}
        onCancel={doCancel}
        onAct={doAct}
        onHelp={() => setHelp(true)}
        selection={selection}
        flash={flash}
        wide={wide}
      />
      <HandDock player={me} landOpen={landOpen} collapsed={handHidden} onToggle={toggleHand} />
    </div>
  );

  // The top bar: across the top on a phone; at the top of the sidebar on a desktop (the board keeps the height).
  const liveWords = connected ? 'Connected' : status === 'connecting' ? 'Connecting' : status === 'refused' ? 'Seat taken' : 'Disconnected';
  const header = (
    <header className={cx('topbar', wide && 'play-side-top')}>
      <button className="logo-btn" onClick={onLeave} aria-label="Back to start">
        <Logo compact />
      </button>
      <div className="topbar-title">
        <span className="topbar-game">You vs {oppName}</span>
        <span className="topbar-sub">
          {!wide && match ? <MatchScore match={match} inline /> : null}
          {[match ? null : gameNo, myDeck].filter(Boolean).join(' · ') || (match ? '' : 'Playing live')}
        </span>
      </div>
      {wide && <span className="side-break" aria-hidden="true" />}
      <span className={cx('live-pill', connected ? 'is-open' : status === 'connecting' ? 'is-connecting' : 'is-error')} title={snap.detail ?? liveWords} role="status" aria-label={liveWords}>
        <span className="live-dot" />
        <span className="live-pill-text">{liveWords}</span>
      </span>
      {!connected && status !== 'connecting' && (
        <button className="btn btn-quiet btn-sm top-reconnect" onClick={() => session.reconnect()}>
          Reconnect
        </button>
      )}
      <span className="grow" />
      {wide ? (
        <>
          <LogTab variant="button" onClick={() => setLogOpen(true)} open={logOpen} />
          <button className="icon-btn" onClick={() => setConcede(true)} aria-label="Concede" title="Concede" disabled={!connected || !!over || !state}>
            <IconFlag size={17} />
          </button>
          <button className="icon-btn" onClick={onSettings} aria-label="Settings">
            <IconGear size={18} />
          </button>
          <button className="icon-btn" onClick={onLeave} aria-label="Leave game">
            <IconX size={18} />
          </button>
        </>
      ) : (
        <>
          <button className={cx('top-coach', phoneCoach && 'is-on')} onClick={() => setPhoneCoach((o) => !o)} aria-pressed={phoneCoach} aria-label={phoneCoach ? 'Back to the board' : 'Open the coach'}>
            <span className="top-coach-pill">
              {phoneCoach ? <IconX size={15} /> : <IconSpark size={15} />}
              {phoneCoach ? 'Board' : 'Coach'}
            </span>
          </button>
          <div className="top-menu-wrap" ref={menuRef}>
            <button className="icon-btn top-more" onClick={() => setMenu((m) => !m)} aria-label="More" aria-expanded={menu} aria-haspopup="menu">
              <IconMore size={20} />
            </button>
            {menu && (
              <div className="top-menu" role="menu">
                <button role="menuitem" onClick={() => { setMenu(false); setConcede(true); }} disabled={!connected || !!over || !state}>
                  <IconFlag size={16} /> Concede
                </button>
                <button role="menuitem" onClick={() => { setMenu(false); onSettings(); }}>
                  <IconGear size={16} /> Settings
                </button>
                {finePointer && (
                  <button role="menuitem" onClick={() => { setMenu(false); setHelp(true); }}>
                    <IconKeyboard size={16} /> Keyboard
                  </button>
                )}
                <button role="menuitem" onClick={() => { setMenu(false); onLeave(); }}>
                  <IconX size={16} /> Leave the table
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </header>
  );

  return (
    <CardActionsContext.Provider value={actions}>
      <BoardStateRef.Provider value={boardStateRef}>
        <PlayContext.Provider value={play}>
          <div className={cx('game', 'play', wide ? 'is-wide' : 'is-narrow', `mode-${view.mode}`, selection.active && 'is-selecting')}>
            {/* Phones: the steps across the very top, above everything (endstep-style). */}
            {!wide && strip('bar')}
            {!wide && header}
            {!wide && wcModel && <WinChanceStrip {...winChance} compact />}
            {!connected && snap.detail && status !== 'connecting' ? (
              <div className="live-banner play-banner">{snap.detail}</div>
            ) : tableNotes.length ? (
              <div className="play-table-lines" role="status" aria-live="polite">
                {tableNotes.map((l) => (
                  <div key={l.who} className={cx('live-banner play-banner play-table', `is-${l.tone}`)}>
                    {l.text}
                    {l.canClaim && (
                      <>
                        {' '}
                        <button type="button" className="btn btn-primary btn-sm play-claim" onClick={() => setClaim(true)} disabled={!connected}>
                          Claim the win
                        </button>
                      </>
                    )}
                  </div>
                ))}
              </div>
            ) : note ? (
              <div className="live-banner play-banner play-note" role="status">
                {note}{' '}
                {onDismissNote && (
                  <button type="button" className="link-btn" onClick={onDismissNote}>
                    Dismiss
                  </button>
                )}
              </div>
            ) : null}

            {wide ? (
              <div className={cx('play-cols', coachOpen && 'has-coach')}>
                <main className="play-main">
                  <div className={cx('play-board', stackPanel && !stackFolded && 'has-stack')}>
                    {board}
                    {stackPanel}
                    {zonePanel}
                  </div>
                  {dock}
                </main>
                {/* One sidebar: the turn and its steps, then the coach (foldable). */}
                <aside className="play-side">
                  {header}
                  {match && <MatchScore match={match} />}
                  {strip('side')}
                  {wcModel && <WinChanceStrip {...winChance} />}
                  {coachOpen ? (
                    <div className="play-side-coach">{coach}</div>
                  ) : (
                    <button className="play-side-coach-fold" onClick={toggleCoach} aria-expanded={false}>
                      <IconSpark size={15} /> Coach <span className="muted tiny">— ask about this moment</span>
                    </button>
                  )}
                </aside>
              </div>
            ) : (
              <>
                {!phoneCoach && <LogTab variant="edge" onClick={() => setLogOpen(true)} open={logOpen} />}
                <div className={cx('play-stage', stackPanel && !phoneCoach && 'has-stack', stackFolded && 'is-stack-folded')}>
                  {!phoneCoach && stackPanel}
                  {!phoneCoach && zonePanel}
                  <main className="phone-main play-phone-main" aria-hidden={phoneCoach || undefined}>
                    {board}
                  </main>
                  {phoneCoach && (
                    <section className="play-coach-sheet" aria-label="Coach">
                      {coach}
                    </section>
                  )}
                </div>
                {dock}
              </>
            )}

            {over && (
              <GameOverCard
                over={over}
                seat={seat}
                oppName={oppName}
                connected={connected}
                waitingNext={waitingNext}
                onReview={() => log && onReview(log)}
                {...(onEngineReview && !vsHuman ? { onEngineReview: () => log && onEngineReview(log) } : {})}
                vsHuman={vsHuman}
                {...(leaveLabel ? { leaveLabel } : {})}
                matchLine={vsHuman ? tableMatchLine(match, over, seat, oppName) : null}
                friendReview={vsHuman ? friendReview : null}
                filmRoom={log ? <FilmRoom log={log} variant="over" onJump={(m) => onReview(log, m.decision.frameIndex)} onOpenSettings={onSettings} /> : null}
                onNext={() => {
                  setWaitingNext(true);
                  act({ action: 'newGame', mode: 'continue' });
                }}
                onRestart={() => {
                  setWaitingNext(true);
                  act({ action: 'newGame', mode: 'restart' });
                }}
                {...(status !== 'connecting' ? { onReconnect: () => session.reconnect() } : {})}
                onLeave={onLeave}
              />
            )}
          </div>
          {ask && (
            <AskDialog ask={ask} state={state} onAnswer={(value: AnswerValue) => void session.answer(ask.askId, value)} onPreviewCard={previewId} onConcede={canConcede ? () => setConcede(true) : null} />
          )}
          {!ask && !over && input && openingKind(input, state) && (
            <OpeningDialog key={input.prompt} input={input} state={state} seat={seat} onChoose={(b) => (b === 'ok' ? pressOk() : pressCancel())} onPreviewCard={previewId} onConcede={canConcede ? () => setConcede(true) : null} />
          )}
          <LogDrawer log={log} open={logOpen} onClose={closeLog} />
          <CardDetail card={detail?.card ?? null} state={detail?.state ?? null} seat={seat ?? 0} onClose={() => setDetail(null)} />
          {wide && <HoverPreview name={hover.name} rect={hover.rect} />}
          <GuideSheet open={guidesOpen} onClose={() => setGuidesOpen(false)} onChange={() => setGuideName(guideNameNow())} />
          <Sheet open={help} onClose={() => setHelp(false)} title="Keyboard" width={460}>
            <dl className="keys-list">
              {PLAY_KEYS.map((k) => (
                <div key={k.chord} className="keys-row">
                  <dt>
                    <kbd>{k.chord}</kbd>
                  </dt>
                  <dd>{k.what}</dd>
                </div>
              ))}
            </dl>
            <p className="tiny muted">Right-click a card (or press and hold on a phone) to read it without playing it.</p>
          </Sheet>
          <Sheet
            open={concede}
            onClose={() => setConcede(false)}
            title="Concede this game?"
            width={420}
            footer={
              <>
                <button className="btn btn-quiet" onClick={() => setConcede(false)}>
                  Keep playing
                </button>
                <button
                  className="btn btn-stop"
                  onClick={() => {
                    setConcede(false);
                    act({ action: 'concede' });
                  }}
                >
                  Concede
                </button>
              </>
            }
          >
            <p className="muted">There’s no undo. You can still review the game afterwards.</p>
          </Sheet>
          <Sheet
            open={claim}
            onClose={() => setClaim(false)}
            title="Claim the win?"
            width={420}
            footer={
              <>
                <button className="btn btn-quiet" onClick={() => setClaim(false)}>
                  Keep waiting
                </button>
                <button
                  className="btn btn-primary"
                  onClick={() => {
                    setClaim(false);
                    act({ action: 'claimWin' });
                  }}
                >
                  Claim the win
                </button>
              </>
            }
          >
            <p className="muted">{oppName} has been gone too long. Claiming ends the game as their concession; if they come back, the game is over.</p>
          </Sheet>
        </PlayContext.Provider>
      </BoardStateRef.Provider>
    </CardActionsContext.Provider>
  );
}

/** The match box (endstep-style): MATCH · Game 1 / 3 · 0 – 0. Inline in the phone's top bar. */
function MatchScore({ match, inline }: { match: MatchBox; inline?: boolean }) {
  const game = match.game === null ? `Best of ${match.of}` : `Game ${match.game} / ${match.of}`;
  const score = match.score ? `${match.score.me} – ${match.score.opp}` : null;
  if (inline) {
    return (
      <span className="match-inline" title={score ? `${game}, you ${match.score!.me} – ${match.score!.opp} them` : game}>
        <b>{match.game === null ? `Bo${match.of}` : `G${match.game}/${match.of}`}</b>
        {score && <span className="match-inline-score">{score}</span>}
      </span>
    );
  }
  return (
    <div className="match-box" role="group" aria-label="Match">
      <span className="match-kicker">Match</span>
      <span className="match-game">{game}</span>
      {score && (
        <span className="match-score" title="You – them">
          {score}
        </span>
      )}
    </div>
  );
}

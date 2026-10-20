/*
 * ForgeCoach — ui/play/SearchHint.tsx
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The search AI as a coach (mtg-table D429, searchHint.ts), in two places:
 *
 *   - the Coach panel: a selector — Search AI (the default), Claude, Off
 *     (play/coachChoice.ts, kept per viewer) — and, with Search AI chosen, its
 *     answer for the decision in front of you: the move in board words, how
 *     sure it is, the other choices it weighed, how long it looked against its
 *     budget, or "no hint for this decision" where it does not judge;
 *   - the decision panel: Ask now, a button like Skip, for whichever coach is
 *     chosen (S asks the search AI), and the search AI's answer in one line
 *     under it.
 *
 * With Search AI chosen it answers by itself, once per decision it can judge
 * (main-phase spells, attacks, blocks, targets): the engine on your PC is
 * free. One question at a time; a new decision cancels the one still out
 * (play/hintRunner.ts). Against the bot it asks the engine on your PC
 * (`/health` `hint: 1`, POST /hint). At a table of two (mtg-table D453) each
 * player asks the draft room, behind their own room token, for their own
 * decisions only (the room's state `hint: 1`, POST /room/<id>/hint): a friend's
 * browser cannot reach the room owner's helper, and the helper's own door
 * refuses a game between two people. A room without hints (an older one: 404)
 * shows the off text, never an error. The cards it names glow on the board
 * (`data-search-pick`) until the decision changes.
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { GameStateBody, InputBody } from '../../protocol.ts';
import type { GameLog } from '../../log.ts';
import { pageHelperTarget } from '../../coachHelper.ts';
import { askHint, askRoomHint, HINT_OFF_TABLE, TABLE_HINT_OFF, type TableHintOff, hintCardIds, hintChoiceWords, hintDecisionKey, hintInfo, hintMoment, hintWords, roomHintInfo, type HintInfo, type HintVerdict, type SearchHint as Hint } from '../../searchHint.ts';
import type { SeatHandle } from '../../play/friendReview.ts';
import { COACH_KIND_KEY, COACH_KINDS, coachPlan, readCoachKind, type CoachKind } from '../../play/coachChoice.ts';
import { HintRunner, type HintPhase } from '../../play/hintRunner.ts';
import { opponentFields } from '../review/useReviewRun.ts';
import { IconSpark } from '../Icons.tsx';
import { cx, readLS, writeLS } from '../util.ts';
import './searchHint.css';

export const ASK_NOW = 'Ask now';
export const HINT_THINKING = 'The engine is thinking…';
export const HINT_TITLE = 'The engine on your PC plays this decision out for a few seconds and says what it would do (S)';
export const NO_HINT = 'No hint for this decision: the search AI judges your main-phase spells, attacks, blocks and targets.';
export const HINT_OFF = 'The search AI needs the engine on your PC with hints on. Start ForgeCoach on your PC (the app-menu launcher, or ./scripts/play.sh).';

const NO_INFO: HintInfo = { available: false, engine: null, budgetMs: null };
/** At a table, before the room's state has been read. */
export const HINT_CHECKING_TABLE = 'Asking the room’s PC whether it gives search hints…';

/**
 * What /health says about hints — or, at a table of two, the room's state (mtg-table D453: a friend's
 * browser cannot read the room owner's /health): asked now, and every 20 s (a PC started later; the
 * engine's state).
 */
function useHintInfo(on: boolean, room: SeatHandle | null): HintInfo {
  const [info, setInfo] = useState<HintInfo>(NO_INFO);
  const roomKey = room ? `${room.base}|${room.id}|${room.token}` : '';
  useEffect(() => {
    if (!on) return;
    let live = true;
    setInfo(NO_INFO);
    const check = () => void (room ? roomHintInfo(room) : hintInfo(pageHelperTarget())).then((v) => live && setInfo(v));
    check();
    const t = setInterval(check, 20_000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [on, roomKey]); // eslint-disable-line react-hooks/exhaustive-deps
  return on ? info : NO_INFO;
}

/** Marks the pick's cards on the board; React never sets this attribute, so a re-render keeps it. */
function useBoardMarks(ids: number[], version: unknown) {
  const sig = ids.join(',');
  useEffect(() => {
    if (!sig || typeof document === 'undefined') return;
    const marked: Element[] = [];
    for (const id of sig.split(',')) {
      document.querySelectorAll(`.game [data-card-id="${id}"]`).forEach((el) => {
        el.setAttribute('data-search-pick', '1');
        marked.push(el);
      });
    }
    return () => marked.forEach((el) => el.removeAttribute('data-search-pick'));
  }, [sig, version]);
}

export interface SearchCoach {
  kind: CoachKind;
  setKind: (k: CoachKind) => void;
  /** Hints are offered: the engine on your PC against the bot, the room's at a table of two. */
  available: boolean;
  /** A table of two (mtg-table D453): the hint comes from the room, and the off text says so. */
  table: boolean;
  /** At a table, when not available: why, in words (the room gone, an older room's PC, no seat here, …). */
  offText: string | null;
  info: HintInfo;
  /** The hint for the decision on screen (`none` when the search AI does not judge it). */
  phase: HintPhase;
  ask: () => void;
  /** S asks the search AI (a coach is chosen and hints are offered). */
  searchKey: boolean;
  state: GameStateBody | null;
  seat: number | null;
}

/**
 * The search AI for the board: the coach chosen, the engine's hint state, and
 * the runner that asks once per decision with Search AI chosen. One per game
 * screen (PlayView); the Coach panel and the decision panel read it.
 */
export function useSearchCoach({
  log,
  state,
  input,
  seat,
  askOpen,
  enabled,
  table = false,
  room = null,
}: {
  log: GameLog | null;
  state: GameStateBody | null;
  input: InputBody | null;
  seat: number | null;
  /** A question is open: S belongs to it. */
  askOpen: boolean;
  /** A game still going: against the bot, or at a table of two. */
  enabled: boolean;
  /** A table of two: the hint is the room's, for this seat (mtg-table D453), never the helper's /hint. */
  table?: boolean;
  /** This seat's room and token (play/friendReview.ts `savedRoomSeat`), at a table; null when it is not known. */
  room?: SeatHandle | null;
}): SearchCoach {
  const [kind, setKindState] = useState<CoachKind>(() => readCoachKind(readLS));
  const setKind = useCallback((k: CoachKind) => {
    setKindState(k);
    writeLS(COACH_KIND_KEY, k);
  }, []);
  // At a table, only through the room (never the helper's /hint); with no room known, no hint.
  const roomSeat = table ? room : null;
  const info = useHintInfo(enabled && (!table || !!roomSeat), roomSeat);
  // A room that answers "off" (an older one has no route: 404) turns the hint off for this room, without an error.
  const roomKey = roomSeat ? `${roomSeat.base}|${roomSeat.id}` : '';
  const [offFor, setOffFor] = useState<{ key: string; why: TableHintOff } | null>(null);
  // A later read of the room's state that says `hint: 1` (the room's PC restarted with hints, say) lifts it.
  useEffect(() => {
    if (info.available) setOffFor(null);
  }, [info]);
  const offHere = table && offFor?.key === roomKey ? offFor.why : null;
  const available = enabled && info.available && !offHere;
  const offText = !table || available ? null : !roomSeat ? TABLE_HINT_OFF['no-seat'] : (offHere ?? info.off) ? TABLE_HINT_OFF[(offHere ?? info.off)!] : HINT_CHECKING_TABLE;
  const plan = coachPlan(kind, false, available);

  const latest = useRef({ log, seat, roomSeat, table, roomKey });
  latest.current = { log, seat, roomSeat, table, roomKey };
  const runner = useMemo(
    () =>
      new HintRunner(async (_key, signal) => {
        const { log: lg, seat: st, roomSeat: rs, table: atTable, roomKey: rk } = latest.current;
        const moment = hintMoment(lg);
        const gameId = lg?.header?.gameId ?? null;
        if (atTable) {
          if (!rs) return { ok: false, status: 0, code: 'off', off: 'no-seat', message: TABLE_HINT_OFF['no-seat'] };
          if (!lg || !moment || (st !== 0 && st !== 1)) return { ok: false, status: 0, code: null, message: 'This game has no moment the engine can look up yet.' };
          const r = await askRoomHint(rs, { gameId, seat: st, stateSeq: moment.stateSeq, ...(moment.inputSeq ? { inputSeq: moment.inputSeq } : {}) }, undefined, signal);
          if ('code' in r && r.code === 'off') setOffFor({ key: rk, why: r.off ?? 'off' });
          return r;
        }
        if (!lg || !moment || !gameId || (st !== 0 && st !== 1)) return { ok: false, status: 0, code: null, message: 'This game has no moment the engine can look up yet.' };
        const opp = await opponentFields(lg);
        if (signal.aborted) return { ok: false, status: 0, code: 'superseded', message: '' };
        return askHint(pageHelperTarget(), { gameId, seat: st, stateSeq: moment.stateSeq, ...(moment.inputSeq ? { inputSeq: moment.inputSeq } : {}), ...opp }, undefined, signal);
      }),
    [],
  );
  useEffect(() => () => runner.dispose(), [runner]);
  const phase = useSyncExternalStore(
    useCallback((l) => runner.subscribe(l), [runner]),
    () => runner.get(),
    () => runner.get(),
  );

  const key = available && kind !== 'off' ? hintDecisionKey(state, input, seat, hintMoment(log)?.stateSeq ?? null) : null;
  // Every render: the same decision is a no-op, a new one cancels the last question and (Search AI) asks once.
  useEffect(() => {
    runner.setDecision(key, plan.searchAuto);
  });

  const ask = useCallback(() => runner.ask(), [runner]);
  // S asks the search AI, while a decision it judges is open and nothing else wants the key.
  useEffect(() => {
    if (!plan.searchKey || !key || askOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 's' || e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;
      const t = e.target as HTMLElement | null;
      const tag = (t?.tagName ?? '').toLowerCase();
      if (t?.isContentEditable || tag === 'input' || tag === 'textarea' || tag === 'select') return;
      e.preventDefault();
      runner.ask();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [plan.searchKey, key, askOpen, runner]);

  useBoardMarks(hintCardIds(phase.state === 'answered' ? phase.hint : null), state);
  return { kind, setKind, available, table, offText, info, phase, ask, searchKey: plan.searchKey, state, seat };
}

// ---------------------------------------------------------------------------
// The selector

export function CoachPicker({ kind, onKind }: { kind: CoachKind; onKind: (k: CoachKind) => void }) {
  const shown = COACH_KINDS.find((k) => k.id === kind) ?? COACH_KINDS[0]!;
  return (
    <div className="pc-pick" data-coach-kind={kind}>
      <div className="seg pc-pick-seg" role="radiogroup" aria-label="Coach">
        {COACH_KINDS.map((k) => (
          <button key={k.id} type="button" role="radio" aria-checked={kind === k.id} className={cx(kind === k.id && 'is-on')} onClick={() => onKind(k.id)} title={k.blurb}>
            {k.label}
          </button>
        ))}
      </div>
      <p className="tiny muted pc-pick-blurb">{shown.blurb}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Words shared by both places

const VERDICT_WORDS: Record<HintVerdict, string> = { best: 'best', tie: 'as good', close: 'close', worse: 'worse', 'not-graded': 'not judged' };
const TYPE_WORDS = { spell: 'Your main phase', attack: 'Your attack', block: 'Your blocks', target: 'Your target' } as const;

const secs = (ms: number) => `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`;

/** "Looked 2.4 s of a 3 s budget" — the answer's own time against its budget (or /health's). */
export function budgetLine(h: Pick<Hint, 'ms' | 'budgetMs'>, healthBudget: number | null): string | null {
  const budget = h.budgetMs ?? healthBudget;
  if (h.ms === null) return budget ? `A ${secs(budget)} look.` : null;
  return budget ? `Looked ${secs(h.ms)} of a ${secs(budget)} budget.` : `Looked ${secs(h.ms)}.`;
}

/** The thinking line: the engine's first hint waits for it to start (about 10 s). */
export function thinkingLine(info: HintInfo): string {
  if (info.engine === 'idle' || info.engine === 'starting') return 'The engine is starting (about 10 s the first time)…';
  return info.budgetMs ? `The engine is thinking (about ${secs(info.budgetMs)})…` : HINT_THINKING;
}

/** The other choices the search AI weighed, best first, in board words (never the engine's ids). */
export function otherChoices(h: Hint, state: GameStateBody | null, seat: number | null, max = 3): { line: string; verdict: string }[] {
  const skip = new Set([h.pick, h.runnerUp].filter(Boolean) as string[]);
  return h.options
    .filter((o) => !skip.has(o.token))
    .slice(0, max)
    .map((o) => ({ line: hintChoiceWords(o.token, state, seat), verdict: o.verdict ? VERDICT_WORDS[o.verdict] : '' }));
}

// ---------------------------------------------------------------------------
// The decision panel: Ask now, and the search AI's answer in one line

export function AskNowRow({ coach, claudeAsk }: { coach: SearchCoach; claudeAsk: (() => void) | null }) {
  const { kind, phase, available } = coach;
  if (kind === 'off') return null;
  const searchOpen = available && phase.state !== 'none';
  const forSearch = kind === 'search';
  if (forSearch ? !searchOpen : !claudeAsk && !(searchOpen && phase.state !== 'idle')) return null;
  const asking = phase.state === 'asking';
  return (
    <div className="ds-hint" data-search-hint={phase.state} data-coach-kind={kind}>
      {(forSearch || claudeAsk) && (
        <button
          type="button"
          className="ab-tool ds-ask-now"
          onClick={forSearch ? coach.ask : (claudeAsk ?? undefined)}
          disabled={forSearch && asking}
          title={forSearch ? HINT_TITLE : 'Ask Claude about this moment; the answer is in the Coach panel'}
          data-ask-now={kind}
        >
          {forSearch && asking ? <span className="spinner spinner-sm" aria-hidden="true" /> : <IconSpark size={13} />}
          <span className="ab-tool-main">{ASK_NOW}</span>
          {forSearch && (
            <kbd className="ds-kbd" aria-hidden="true">
              S
            </kbd>
          )}
        </button>
      )}
      {searchOpen && <HintLine coach={coach} compact />}
    </div>
  );
}

/** The search AI's answer, one line (the decision panel) or with its reasons (the Coach panel). */
function HintLine({ coach, compact }: { coach: SearchCoach; compact?: boolean }) {
  const { phase, state, seat, info } = coach;
  if (phase.state === 'asking') {
    return (
      <span className="ds-hint-line is-thinking" role="status" aria-live="polite">
        {!compact && <span className="spinner spinner-sm" aria-hidden="true" />}
        {thinkingLine(info)}
      </span>
    );
  }
  if (phase.state === 'error') return <span className="ds-hint-line is-error" role="status">{phase.message}</span>;
  if (phase.state !== 'answered') return null;
  const w = hintWords(phase.hint, state, seat);
  return (
    <span className="ds-hint-line is-answer" role="status" aria-live="polite" title={`${w.line}${w.strength ? ` — ${w.strength}` : ''}. ${w.caveatLong}`}>
      <span className="ds-hint-k">Search AI</span> <span className="ds-hint-pick">{w.line}</span>
      {w.strength && (
        <>
          {' — '}
          <span className={cx('ds-hint-strength', `is-${phase.hint.strength}`)}>{w.strength}</span>
        </>
      )}
    </span>
  );
}

// ---------------------------------------------------------------------------
// The Coach panel with Search AI chosen

export function SearchCoachBody({ coach, myMove }: { coach: SearchCoach; myMove: boolean }) {
  const { phase, state, seat, info, available, table } = coach;
  if (!available) {
    return (
      <div className="card-box notice pc-wait" data-search-coach="off">
        <p className="muted small">{table ? (coach.offText ?? HINT_OFF_TABLE) : HINT_OFF}</p>
      </div>
    );
  }
  if (phase.state === 'none') {
    return (
      <div className="card-box notice pc-wait" data-search-coach="none">
        <p className="muted small">{myMove ? NO_HINT : 'Waiting for your next decision. The search AI answers by itself at each one it can judge.'}</p>
      </div>
    );
  }
  const head = state && phase.state === 'answered' && phase.hint.type ? TYPE_WORDS[phase.hint.type] : 'This decision';
  return (
    <div className="card-box answer pc-search" data-search-coach={phase.state}>
      <div className="box-h">
        <span>{head}</span>
        <span className="tiny muted">Search AI · free</span>
      </div>
      {phase.state === 'idle' && <p className="muted small">Ready to look at this decision.</p>}
      {phase.state === 'asking' && <HintLine coach={coach} />}
      {phase.state === 'error' && <HintLine coach={coach} />}
      {phase.state === 'answered' && <Answered hint={phase.hint} state={state} seat={seat} info={info} />}
      <div className="pc-search-foot">
        <button type="button" className="btn btn-quiet btn-sm" onClick={coach.ask} disabled={phase.state === 'asking'} title={HINT_TITLE}>
          <IconSpark size={13} /> {phase.state === 'idle' ? ASK_NOW : 'Ask again'} <kbd className="ds-kbd">S</kbd>
        </button>
      </div>
    </div>
  );
}

function Answered({ hint, state, seat, info }: { hint: Hint; state: GameStateBody | null; seat: number | null; info: HintInfo }) {
  const w = hintWords(hint, state, seat);
  const others = otherChoices(hint, state, seat);
  const budget = budgetLine(hint, info.budgetMs);
  return (
    <div className="pc-search-answer">
      <p className="pc-search-pick">{w.line}</p>
      {w.strength && <p className={cx('pc-search-strength', `is-${hint.strength}`)}>{w.strength}</p>}
      {hint.status === 'unsupported' && hint.message && <p className="tiny muted">{hint.message}</p>}
      {others.length > 0 && (
        <ul className="pc-search-others" aria-label="Other choices it weighed">
          {others.map((o, i) => (
            <li key={i}>
              {o.line}
              {o.verdict && <span className="muted"> · {o.verdict}</span>}
            </li>
          ))}
        </ul>
      )}
      <p className="tiny muted" title={w.caveatLong}>
        {w.caveat}
        {budget && ` ${budget}`}
      </p>
    </div>
  );
}

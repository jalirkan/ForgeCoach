/*
 * ForgeCoach — ui/play/PhaseStrip.tsx
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The turn's steps, the current one lit in the colour of whose turn it is
 * (gold: yours, blue: the opponent's), and the marks where Forge will stop
 * and give you priority: one row of steps (UP DR M1 … CL) — across the top on
 * a phone, at the top of the sidebar on a desktop with the turn and priority
 * above it.
 *
 * `orientation="vertical"` is the Endstep column (its own column beside the
 * board): one cell per step, grouped combat / main / ending, each cell split
 * on the diagonal into a YOU half (gold) and an OPP half (blue). A filled half
 * is a phase stop for that player and tapping it flips it directly; the
 * current step's cell is three times as tall and says what the step is. A
 * header above it names whose turn it is, the active player and who holds
 * priority, and an "On the play" chip reads the log's first turn event.
 * Standing inside the play screen it reads the board seam (`usePlayBoard()`);
 * with no provider (GameView) it falls back to its props.
 *
 * In the horizontal orientation tapping a step opens two switches — stop here on my turn / on theirs — that
 * send `setPhaseStop` (M33). The marks render from `players[].phaseStops` and
 * nothing else; a toggle on its way is drawn as pending until the next state
 * confirms it. Adapted from mtg-table web/src/render/PhaseStrip.tsx (GPL-3.0-
 * or-later, the mtg-table authors): see ./phaseStrip.ts.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ActBody, GameStateBody } from '../../protocol.ts';
import type { GameLog } from '../../log.ts';
import { cx } from '../util.ts';
import { usePlayBoard } from './playBoard.ts';
import {
  HALVES,
  halfOn,
  halfWords,
  onThePlay,
  settlePending,
  stepCopy,
  stepInstruction,
  stopKey,
  stopWords,
  stripGroups,
  stripModel,
  toggleStopAct,
  yieldWords,
  type PhaseCell,
  type StopTurn,
  type StripModel,
} from './phaseStrip.ts';

const PENDING_MS = 5000;
const NOOP = (): void => undefined;

export function PhaseStrip({
  state: stateProp,
  seat: seatProp,
  interactive: interactiveProp,
  onAct: onActProp,
  variant = 'bar',
  orientation = 'horizontal',
  log: logProp,
  oppLabel = 'Forge',
}: {
  /** Omitted: the play board's (vertical only; horizontal reads its props as it always has). */
  state?: GameStateBody | null;
  seat?: number | null;
  /** A live seat with no question open and the game not over. Omitted in the vertical strip: the board's `canAct`. */
  interactive?: boolean;
  onAct?: (body: ActBody) => void;
  /** horizontal only. bar: a phone's row across the top; side: the same row in the desktop sidebar, under the turn and priority. */
  variant?: 'bar' | 'side';
  /** horizontal: the row of two-letter codes (the default); vertical: the Endstep column with YOU / OPP halves. */
  orientation?: 'horizontal' | 'vertical';
  /** The game's log, for the "On the play" chip. Omitted: the play board's. */
  log?: GameLog | null;
  /** Whose priority it is when it is not yours: "Forge" against the AI, the friend's name at a table of two (M59). */
  oppLabel?: string;
}) {
  const board = usePlayBoard();
  const vertical = orientation === 'vertical';
  // The vertical strip lives inside the play screen and takes its facts from the seam; props still win, and a
  // replay (no provider) passes them as today. `canAct` is what the engine's act guard would allow.
  const useBoard = vertical && board !== null;
  const state = stateProp !== undefined ? stateProp : useBoard ? board.state : null;
  const seat = seatProp !== undefined ? seatProp : useBoard ? board.seat : null;
  const interactive = useBoard ? board.canAct && (interactiveProp ?? true) : (interactiveProp ?? false);
  const onAct = onActProp ?? (useBoard ? board.act : NOOP);
  const log = logProp !== undefined ? logProp : useBoard ? board.log : null;
  const [pending, setPending] = useState<Map<string, boolean>>(() => new Map());
  useEffect(() => setPending((p) => (p.size ? settlePending(p, state, seat) : p)), [state, seat]);
  useEffect(() => {
    if (!pending.size) return;
    const t = setTimeout(() => setPending(new Map()), PENDING_MS);
    return () => clearTimeout(t);
  }, [pending]);

  const model = useMemo(() => stripModel(state, seat, { interactive, pending }), [state, seat, interactive, pending]);
  const toggle = useCallback(
    (phase: string, turn: StopTurn) => {
      const body = toggleStopAct(model, phase, turn);
      if (!body) return;
      setPending((p) => new Map(p).set(stopKey(phase, turn), body.stop));
      onAct(body);
    },
    [model, onAct],
  );

  const playerOnPlay = useMemo(() => (vertical ? onThePlay(log) : null), [vertical, log, log?.frames.length]);

  const [open, setOpen] = useState<string | null>(null);
  const rootRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(null);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(null);
      }
    };
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', esc, true);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', esc, true);
    };
  }, [open]);

  const whose = model.yourTurn === null ? 'none' : model.yourTurn ? 'you' : 'opp';
  const openCell = model.cells.find((c) => c.phase === open) ?? null;
  const yieldLine = yieldWords(model.yielding, seat);
  const popover = openCell && <StopPopover cell={openCell} model={model} onToggle={toggle} onClose={() => setOpen(null)} />;

  if (vertical) {
    return (
      <VerticalStrip model={model} seat={seat} oppLabel={oppLabel} playerOnPlay={playerOnPlay} yieldLine={yieldLine} onToggle={toggle} />
    );
  }

  const cells = model.cells.filter((c) => c.phase !== 'UNTAP');
  const side = variant === 'side';
  return (
    <nav className={cx('pstrip', side ? 'pstrip-side' : 'pstrip-bar', `turn-${whose}`)} aria-label="Turn steps and phase stops" data-round={model.round} ref={rootRef}>
      {side && (
        <header className="pside-head">
          <span className="pside-whose">{model.yourTurn === null ? 'Pre-game' : model.yourTurn ? 'Your turn' : 'Opp turn'}</span>
          <span className="pside-turn">
            T{model.turn}
            <span className="pside-round"> · R{model.round}</span>
          </span>
          <span className="grow" />
          <span className={cx('pside-prio', model.priority === 'you' && 'is-you')} role="status">
            <span className="pside-prio-dot" aria-hidden="true" />
            {model.priority === 'you' ? 'Your priority' : model.priority === 'opp' ? oppLabel : '—'}
          </span>
        </header>
      )}
      <ol className="pbar">
        {cells.map((c) => (
          <li key={c.phase}>
            <button
              type="button"
              className={cx('pbar-cell', c.current && 'is-current', c.past && 'is-past', c.pending && 'is-pending', open === c.phase && 'is-open')}
              data-phase={c.phase}
              aria-current={c.current ? 'step' : undefined}
              aria-expanded={open === c.phase}
              aria-label={`${c.label}${c.current ? ' (now)' : ''}. ${stopWords(c, 'own', c.stopOwn)}; ${stopWords(c, 'opp', c.stopOpp).toLowerCase()}.`}
              onClick={() => setOpen((o) => (o === c.phase ? null : c.phase))}
            >
              {side && <span className={cx('pbar-mark is-opp', c.stopOpp && 'is-on')} aria-hidden="true" />}
              <span className="pbar-label">{c.short}</span>
              {c.marker && <span className="pbar-yield" aria-hidden="true" title="Passing until here" />}
              {side ? (
                <span className={cx('pbar-mark is-own', c.stopOwn && 'is-on')} aria-hidden="true" />
              ) : (
                <span className="pbar-under" aria-hidden="true">
                  <i className={cx('is-own', c.stopOwn && 'is-on')} />
                  <i className={cx('is-opp', c.stopOpp && 'is-on')} />
                </span>
              )}
            </button>
          </li>
        ))}
      </ol>
      {side && yieldLine && (
        <p className="pside-yieldline" role="status">
          ⏩ {yieldLine}
        </p>
      )}
      {popover}
    </nav>
  );
}

function StopPopover({
  cell,
  model,
  onToggle,
  onClose,
}: {
  cell: PhaseCell;
  model: ReturnType<typeof stripModel>;
  onToggle: (phase: string, turn: StopTurn) => void;
  onClose: () => void;
}) {
  const noStop = cell.phase === 'UNTAP';
  return (
    <div className="pstop-pop" role="dialog" aria-label={`Stops at ${cell.label}`}>
      <div className="pstop-head">
        <b>{cell.label}</b>
        <span className="muted"> · {cell.words}</span>
        <button type="button" className="pstop-x" onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>
      {noStop ? (
        <p className="pstop-hint">Forge never stops in the untap step.</p>
      ) : (
        <>
          {(['own', 'opp'] as const).map((turn) => {
            const on = turn === 'own' ? cell.stopOwn : cell.stopOpp;
            return (
              <label key={turn} className={cx('pstop-row', `is-${turn}`, !cell.toggleable && 'is-ro')}>
                <span className={cx('pstop-swatch', `is-${turn}`)} aria-hidden="true" />
                <span className="pstop-text">Stop on {turn === 'own' ? 'my turn' : 'their turn'}</span>
                <input type="checkbox" role="switch" checked={on} disabled={!cell.toggleable} onChange={() => onToggle(cell.phase, turn)} data-turn={turn} />
              </label>
            );
          })}
          <p className="pstop-hint">
            {model.canToggle
              ? 'On: Forge pauses here so you can act. Off: it passes for you.'
              : model.live
                ? 'You can change stops while it is your game and no question is open.'
                : 'This engine does not send phase stops — these are Forge’s defaults.'}
          </p>
        </>
      )}
    </div>
  );
}

/** The Endstep column: header, one cell per step with YOU / OPP halves, the legend. */
function VerticalStrip({
  model,
  seat,
  oppLabel,
  playerOnPlay,
  yieldLine,
  onToggle,
}: {
  model: StripModel;
  seat: number | null;
  oppLabel: string;
  playerOnPlay: number | null;
  yieldLine: string | null;
  onToggle: (phase: string, turn: StopTurn) => void;
}) {
  const whose = model.yourTurn === null ? 'none' : model.yourTurn ? 'you' : 'opp';
  const playWho = playerOnPlay === null || seat === null ? null : playerOnPlay === seat ? 'you' : 'opp';
  return (
    <nav className={cx('pstrip', 'pstrip-v', `turn-${whose}`)} aria-label="Turn steps and phase stops" data-round={model.round} data-orientation="vertical">
      <header className="pv-head">
        <span className="pv-whose">{model.yourTurn === null ? 'Pre-game' : model.yourTurn ? 'Your turn' : 'Opp turn'}</span>
        <span className="pv-turn">T{model.turn}</span>
        {model.activeName && <span className="pv-name">{model.activeName}</span>}
        <span className={cx('pv-prio', model.priority === 'you' && 'is-you', model.priority === 'opp' && 'is-opp')} data-who={model.priority ?? 'none'} role="status">
          <span className="pv-prio-dot" aria-hidden="true" />
          Priority{model.priority ? ` · ${model.priority === 'you' ? 'you' : oppLabel}` : ''}
        </span>
        {playWho && (
          <span className="pv-play" data-who={playWho} title={playWho === 'you' ? 'You were on the play' : `${oppLabel} was on the play`}>
            On the play
          </span>
        )}
      </header>
      <ol className="pv-col">
        {stripGroups(model.cells).flatMap((g, gi) => [
          g.label ? (
            <li key={`g${gi}`} className="pv-glabel" aria-hidden="true">
              {g.label}
            </li>
          ) : null,
          ...g.cells.map((c) => <VerticalCell key={c.phase} cell={c} onToggle={onToggle} />),
        ])}
      </ol>
      <p className="pv-legend" aria-hidden="true">
        <span className="pv-sw is-you" /> YOU <span className="pv-sw is-opp" /> OPP
      </p>
      {yieldLine && (
        <p className="pside-yieldline" role="status">
          ⏩ {yieldLine}
        </p>
      )}
    </nav>
  );
}

function VerticalCell({ cell: c, onToggle }: { cell: PhaseCell; onToggle: (phase: string, turn: StopTurn) => void }) {
  const copy = stepCopy(c.phase);
  return (
    <li
      className={cx('pcell', c.current && 'is-current', c.past && 'is-past', c.pending && 'is-pending')}
      data-phase={c.phase}
      aria-current={c.current ? 'step' : undefined}
      title={stepInstruction(c.phase) ?? c.label}
    >
      {HALVES.map(({ half, turn }) => (
        <button
          key={half}
          type="button"
          className={cx('pcell-half', `is-${half}`, halfOn(c, half) && 'is-on')}
          data-phase={c.phase}
          data-turn={turn}
          data-stop={halfOn(c, half) ? 'true' : 'false'}
          aria-pressed={halfOn(c, half)}
          aria-label={halfWords(c, half)}
          disabled={!c.toggleable}
          onClick={() => onToggle(c.phase, turn)}
        />
      ))}
      <span className="pcell-text">
        {c.current ? (
          <>
            <b className="pcell-title">{copy?.title ?? c.label}</b>
            {copy && <span className="pcell-line">{copy.line}</span>}
          </>
        ) : (
          <span className="pcell-tag">{c.tag}</span>
        )}
      </span>
      {c.marker && <span className="pbar-yield" aria-hidden="true" title="Passing until here" />}
    </li>
  );
}

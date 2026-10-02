/*
 * ForgeCoach — ui/play/PhaseStrip.tsx
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The turn's steps, the current one lit in the colour of whose turn it is
 * (gold: yours, blue: the opponent's), and the marks where Forge will stop
 * and give you priority. On a phone it is one row across the top (UP DR M1 …
 * CL); on a desktop a column beside the board with the turn and priority above.
 *
 * Tapping a step opens two switches — stop here on my turn / on theirs — that
 * send `setPhaseStop` (M33). The marks render from `players[].phaseStops` and
 * nothing else; a toggle on its way is drawn as pending until the next state
 * confirms it. Adapted from mtg-table web/src/render/PhaseStrip.tsx (GPL-3.0-
 * or-later, the mtg-table authors): see ./phaseStrip.ts.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { ActBody, GameStateBody } from '../../protocol.ts';
import { cx } from '../util.ts';
import { settlePending, stopKey, stopWords, stripModel, toggleStopAct, yieldWords, type PhaseCell, type StopTurn } from './phaseStrip.ts';

const PENDING_MS = 5000;

export function PhaseStrip({
  state,
  seat,
  interactive,
  onAct,
  variant,
  footer,
}: {
  state: GameStateBody | null;
  seat: number | null;
  /** A live seat with no question open and the game not over. */
  interactive: boolean;
  onAct: (body: ActBody) => void;
  variant: 'bar' | 'column';
  footer?: ReactNode;
}) {
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

  if (variant === 'bar') {
    const cells = model.cells.filter((c) => c.phase !== 'UNTAP');
    return (
      <nav className={cx('pstrip pstrip-bar', `turn-${whose}`)} aria-label="Turn steps and phase stops" data-round={model.round} ref={rootRef}>
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
                <span className={cx('pbar-mark is-opp', c.stopOpp && 'is-on')} aria-hidden="true" />
                <span className="pbar-label">{c.short}</span>
                {c.marker && <span className="pbar-yield" aria-hidden="true" title="Passing until here" />}
                <span className={cx('pbar-mark is-own', c.stopOwn && 'is-on')} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ol>
        {popover}
      </nav>
    );
  }

  return (
    <aside className={cx('pstrip pstrip-col', `turn-${whose}`)} aria-label="Turn, priority and phase stops" data-round={model.round} ref={rootRef}>
      <header className="pcol-head">
        <span className="pcol-whose">{model.yourTurn === null ? 'Pre-game' : model.yourTurn ? 'Your turn' : 'Opp turn'}</span>
        <span className="pcol-turn">
          T{model.turn}
          <span className="pcol-round"> · R{model.round}</span>
        </span>
        {model.yourTurn === false && model.activeName && <span className="pcol-name">{model.activeName}</span>}
      </header>
      <div className={cx('pcol-prio', model.priority === 'you' && 'is-you')} role="status">
        <span className="pcol-prio-dot" aria-hidden="true" />
        {model.priority === 'you' ? 'Your priority' : model.priority === 'opp' ? 'Forge has priority' : 'No priority'}
      </div>
      <ol className="pcol-list">
        {model.cells.map((c) => (
          <li key={c.phase} className={cx(c.phase === 'COMBAT_BEGIN' && 'pcol-combat-start')}>
            {c.phase === 'COMBAT_BEGIN' && <span className="pcol-divider">combat</span>}
            <div className={cx('pcol-row', c.current && 'is-current', c.past && 'is-past', c.combat && 'is-combat', c.pending && 'is-pending')} data-phase={c.phase} aria-current={c.current ? 'step' : undefined}>
              <button
                type="button"
                className="pcol-label"
                onClick={() => setOpen((o) => (o === c.phase ? null : c.phase))}
                aria-expanded={open === c.phase}
                title={c.phase === 'UNTAP' ? 'Forge has no stop for the untap step' : `${stopWords(c, 'own', c.stopOwn)}. ${stopWords(c, 'opp', c.stopOpp)}. Click to change.`}
              >
                {c.label}
                {c.marker && <span className="pcol-yield" title="Passing until here"> ⏩</span>}
              </button>
              {c.phase !== 'UNTAP' && (
                <span className="pcol-pips">
                  <StopPip cell={c} turn="own" onToggle={toggle} />
                  <StopPip cell={c} turn="opp" onToggle={toggle} />
                </span>
              )}
            </div>
            {open === c.phase && popover}
          </li>
        ))}
      </ol>
      <p className="pcol-legend">
        <span className="pcol-key is-own" /> you <span className="pcol-key is-opp" /> opp
        <span className="pcol-legend-hint">{model.canToggle ? ' · marks = Forge stops there' : model.live ? ' · read-only now' : ' · Forge defaults'}</span>
      </p>
      {yieldLine && (
        <p className="pcol-yieldline" role="status">
          ⏩ {yieldLine}
        </p>
      )}
      {footer && <div className="pcol-foot">{footer}</div>}
    </aside>
  );
}

function StopPip({ cell, turn, onToggle }: { cell: PhaseCell; turn: StopTurn; onToggle: (phase: string, turn: StopTurn) => void }) {
  const on = turn === 'own' ? cell.stopOwn : cell.stopOpp;
  return (
    <button
      type="button"
      className={cx('pcol-pip', `is-${turn}`, on && 'is-on')}
      disabled={!cell.toggleable}
      aria-pressed={on}
      data-act="setPhaseStop"
      data-turn={turn}
      title={stopWords(cell, turn, on) + (cell.toggleable ? ' — click to change' : ' (read-only)')}
      aria-label={stopWords(cell, turn, on)}
      onClick={() => onToggle(cell.phase, turn)}
    />
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

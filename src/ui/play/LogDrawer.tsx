/*
 * ForgeCoach — ui/play/LogDrawer.tsx
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The game log in plain words, turn by turn, newest at the bottom: a drawer
 * from the right edge, opened by a LOG tab on phones and a Log button on a
 * desktop. Card names open the card. The lines come from `eventLog.ts`; the
 * drawer idea is mtg-table's web/src/render/LogDrawer.tsx (GPL-3.0-or-later,
 * the mtg-table authors).
 */
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { GameStateBody } from '../../protocol.ts';
import type { GameLog } from '../../log.ts';
import { gameEventLog, type LogLine, type LogTurn } from '../../eventLog.ts';
import { playerLabel } from '../../review.ts';
import { useCardActions } from '../cardContext.ts';
import { IconX } from '../Icons.tsx';
import { cx } from '../util.ts';

/** The LOG tab (phone, right edge) or the Log button (desktop). */
export function LogTab({ onClick, variant, count, open }: { onClick: () => void; variant: 'edge' | 'button'; count?: number; open?: boolean }) {
  return (
    <button type="button" className={cx('log-tab', `log-tab-${variant}`, open && 'is-open')} onClick={onClick} aria-label="Game log" aria-expanded={open} title="Game log (L)">
      <span className="log-tab-text">Log</span>
      {variant === 'button' && count !== undefined && count > 0 && <span className="log-tab-count">{count}</span>}
    </button>
  );
}

export function LogDrawer({ log, upTo, open, onClose }: { log: GameLog | null; upTo?: number; open: boolean; onClose: () => void }) {
  const turns = useMemo(() => (log && open ? gameEventLog(log, upTo) : []), [log, upTo, open]);
  const bodyRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const total = turns.reduce((n, t) => n + t.lines.length, 0);

  useEffect(() => {
    if (!open) return;
    stick.current = true;
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', esc, true);
    return () => window.removeEventListener('keydown', esc, true);
  }, [open, onClose]);
  // Newest at the bottom: follow it, unless the reader scrolled up.
  useLayoutEffect(() => {
    const el = bodyRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [total, open]);

  if (!open) return null;
  return createPortal(
    <div className="log-drawer-wrap">
      <div className="log-drawer-backdrop" onClick={onClose} />
      <aside className="log-drawer" role="dialog" aria-label="Game log">
        <header className="log-drawer-head">
          <span className="log-drawer-title">Game log</span>
          <span className="muted tiny">
            {total} event{total === 1 ? '' : 's'}
          </span>
          <span className="grow" />
          <button className="icon-btn" onClick={onClose} aria-label="Close the log">
            <IconX size={18} />
          </button>
        </header>
        <div
          className="log-drawer-body"
          ref={bodyRef}
          onScroll={(e) => {
            const el = e.currentTarget;
            stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
          }}
        >
          {!log || turns.length === 0 ? (
            <p className="muted log-empty">Nothing has happened yet.</p>
          ) : (
            turns.map((t, i) => <TurnBlock key={`${t.turn}-${t.frameIndex}`} t={t} log={log} current={i === turns.length - 1 && !log.over && upTo === undefined} />)
          )}
        </div>
      </aside>
    </div>,
    document.body,
  );
}

function TurnBlock({ t, log, current }: { t: LogTurn; log: GameLog; current: boolean }) {
  const mine = t.activePlayer === log.seat;
  return (
    <section className={cx('log-turn', t.turn === 0 ? 'is-pre' : mine ? 'is-you' : 'is-opp')}>
      <h3 className="log-turn-head">
        {t.turn === 0 ? (
          'Before the game'
        ) : (
          <>
            <span className="log-turn-no">Turn {t.turn}</span>
            <span className="log-turn-who">{mine ? 'Your turn' : `${playerLabel(log, t.activePlayer)}’s turn`}</span>
          </>
        )}
      </h3>
      {t.lines.length === 0 ? (
        <p className="log-line is-quiet">{current ? 'Nothing yet.' : 'Nothing happened.'}</p>
      ) : (
        <ol className="log-lines">
          {t.lines.map((l, i) => (
            <Line key={i} l={l} log={log} />
          ))}
        </ol>
      )}
    </section>
  );
}

function Line({ l, log }: { l: LogLine; log: GameLog }) {
  const actions = useCardActions();
  const who = l.who === null ? 'none' : l.who === log.seat ? 'you' : 'opp';
  return (
    <li className={cx('log-line', `k-${l.kind}`, `w-${who}`)}>
      {l.segs.map((s, i) => {
        if (typeof s === 'string') return <span key={i}>{s}</span>;
        if ('player' in s) return <b key={i} className={cx('log-player', s.player === log.seat ? 'is-you' : 'is-opp')}>{s.name}</b>;
        const card = s.card;
        if (!card) return <span key={i} className="log-card is-plain">{s.name}</span>;
        return (
          <button
            key={i}
            type="button"
            className="log-card"
            onClick={() => {
              const f = log.frames[l.frameIndex];
              actions.open(card, f && f.type === 'state' ? (f.body as GameStateBody) : null);
            }}
            onMouseEnter={(e) => actions.hover(s.name, e.currentTarget.getBoundingClientRect())}
            onMouseLeave={() => actions.hover(null)}
          >
            {s.name}
          </button>
        );
      })}
    </li>
  );
}

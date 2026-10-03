/*
 * ForgeCoach — ui/play/LogDrawer.tsx
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The game log in plain words, newest at the bottom, grouped endstep-style:
 * a turn header ("T3 · Your turn"), then the parts of the turn ("Main phase",
 * "Combat") as small subheads, each line with a small glyph for what kind of
 * event it is. On a desktop it is a floating panel you can drag by its header
 * (the board stays live underneath); on a phone it is a bottom sheet. Card
 * names open the card. The lines come from `eventLog.ts`; the drawer idea is
 * mtg-table's web/src/render/LogDrawer.tsx (GPL-3.0-or-later, the mtg-table
 * authors).
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import type { GameStateBody } from '../../protocol.ts';
import type { GameLog } from '../../log.ts';
import { gameEventLog, sectionsOf, type LogKind, type LogLine, type LogTurn } from '../../eventLog.ts';
import { playerLabel } from '../../review.ts';
import { useCardActions } from '../cardContext.ts';
import { clampPanel, parsePos, type PanelPos } from '../floating.ts';
import { useMediaQuery } from '../hooks.ts';
import { IconX } from '../Icons.tsx';
import { cx, readLS, writeLS } from '../util.ts';

const POS_KEY = 'forgecoach.logPos';

/** The LOG tab (phone, right edge) or the Log button (desktop). */
export function LogTab({ onClick, variant, count, open }: { onClick: () => void; variant: 'edge' | 'button'; count?: number; open?: boolean }) {
  return (
    <button type="button" className={cx('log-tab', `log-tab-${variant}`, open && 'is-open')} onClick={onClick} aria-label="Game log" aria-expanded={open} title="Game log (L)">
      <span className="log-tab-text">Log</span>
      {variant === 'button' && count !== undefined && count > 0 && <span className="log-tab-count">{count}</span>}
    </button>
  );
}

/** One small glyph per kind of line (decorative; the words say it). */
const GLYPH: Record<LogKind, string> = {
  land: '▲',
  cast: '✦',
  ability: '△',
  attack: '✕',
  block: '◆',
  damage: '✸',
  life: '♥',
  died: '†',
  left: '↩',
  token: '✧',
  counter: '+',
  attach: '↳',
  info: '·',
  outcome: '★',
};

export function LogDrawer({ log, upTo, open, onClose }: { log: GameLog | null; upTo?: number; open: boolean; onClose: () => void }) {
  const turns = useMemo(() => (log && open ? gameEventLog(log, upTo) : []), [log, upTo, open]);
  const floating = useMediaQuery('(min-width: 1024px) and (hover: hover)');
  const bodyRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const stick = useRef(true);
  const total = turns.reduce((n, t) => n + t.lines.length, 0);

  // ---- where the floating panel sits (remembered), and dragging it by the header
  const [pos, setPos] = useState<PanelPos | null>(() => parsePos(readLS(POS_KEY)));
  const drag = useRef<{ dx: number; dy: number; id: number } | null>(null);
  const place = useCallback((p: PanelPos) => {
    const el = panelRef.current;
    const size = el ? { w: el.offsetWidth, h: el.offsetHeight } : { w: 360, h: 480 };
    return clampPanel(p, size, { w: window.innerWidth, h: window.innerHeight });
  }, []);
  const onDragStart = (e: ReactPointerEvent<HTMLElement>) => {
    if (!floating || e.button !== 0 || (e.target as HTMLElement).closest('button')) return;
    const r = panelRef.current?.getBoundingClientRect();
    if (!r) return;
    drag.current = { dx: e.clientX - r.left, dy: e.clientY - r.top, id: e.pointerId };
    e.currentTarget.setPointerCapture(e.pointerId);
    e.preventDefault();
  };
  const onDragMove = (e: ReactPointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    setPos(place({ x: e.clientX - d.dx, y: e.clientY - d.dy }));
  };
  const onDragEnd = (e: ReactPointerEvent<HTMLElement>) => {
    if (!drag.current || drag.current.id !== e.pointerId) return;
    drag.current = null;
    if (pos) writeLS(POS_KEY, `${pos.x},${pos.y}`);
  };
  // Re-clamp to the window when it opens (the window may have shrunk since); only on open.
  useLayoutEffect(() => {
    if (open && floating && pos) {
      const p = place(pos);
      if (p.x !== pos.x || p.y !== pos.y) setPos(p);
    }
  }, [open, floating]);

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
  const panel = (
    <aside
      ref={panelRef}
      className={cx('log-drawer', floating ? 'is-floating' : 'is-sheet')}
      role="dialog"
      aria-label="Game log"
      style={floating && pos ? { left: pos.x, top: pos.y, right: 'auto' } : undefined}
    >
      <header className="log-drawer-head" onPointerDown={onDragStart} onPointerMove={onDragMove} onPointerUp={onDragEnd} onPointerCancel={onDragEnd}>
        {floating && (
          <span className="log-grip" aria-hidden="true">
            ⠿
          </span>
        )}
        <span className="log-drawer-title">Game Log</span>
        <span className="muted tiny log-drawer-n">
          {total} event{total === 1 ? '' : 's'}
        </span>
        <span className="grow" />
        <button className="icon-btn" onClick={onClose} aria-label="Close the log">
          <IconX size={16} />
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
  );
  return createPortal(
    floating ? (
      <div className="log-float-wrap">{panel}</div>
    ) : (
      <div className="log-drawer-wrap">
        <div className="log-drawer-backdrop" onClick={onClose} />
        {panel}
      </div>
    ),
    document.body,
  );
}

function TurnBlock({ t, log, current }: { t: LogTurn; log: GameLog; current: boolean }) {
  const mine = t.activePlayer === log.seat;
  const sections = useMemo(() => sectionsOf(t.lines), [t.lines]);
  return (
    <section className={cx('log-turn', t.turn === 0 ? 'is-pre' : mine ? 'is-you' : 'is-opp')}>
      <h3 className="log-turn-head">
        {t.turn === 0 ? (
          <span className="log-turn-who">Before the game</span>
        ) : (
          <>
            <span className="log-turn-no">T{t.turn}</span>
            <span className="log-turn-who">{mine ? 'Your turn' : 'Opponent’s turn'}</span>
            {!mine && <span className="log-turn-name">{playerLabel(log, t.activePlayer)}</span>}
          </>
        )}
      </h3>
      {t.lines.length === 0 ? (
        <p className="log-line is-quiet">{current ? 'Nothing yet.' : 'Nothing happened.'}</p>
      ) : (
        sections.map((s, i) => (
          <div key={i} className="log-section">
            {(sections.length > 1 || s.section !== 'Before the game') && <div className="log-section-head">{s.section}</div>}
            <ol className="log-lines">
              {s.lines.map((l, j) => (
                <Line key={j} l={l} log={log} />
              ))}
            </ol>
          </div>
        ))
      )}
    </section>
  );
}

function Line({ l, log }: { l: LogLine; log: GameLog }) {
  const actions = useCardActions();
  const who = l.who === null ? 'none' : l.who === log.seat ? 'you' : 'opp';
  return (
    <li className={cx('log-line', `k-${l.kind}`, `w-${who}`)}>
      <span className="log-glyph" aria-hidden="true">
        {GLYPH[l.kind]}
      </span>
      <span className="log-text">
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
      </span>
    </li>
  );
}

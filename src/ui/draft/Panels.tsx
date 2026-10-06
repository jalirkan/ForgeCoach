/*
 * ForgeCoach — ui/draft/Panels.tsx
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Small pieces around the pick screen: the phone's thumb dock with the one
 * big gold action, the AI's banner, seat chips, the kebab menu and the pick
 * timer.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { describeEvent, type Draft, type DraftEvent } from '../../draft/draft.ts';
import { IconMore } from '../Icons.tsx';
import { cx } from '../util.ts';

export interface Action {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  /** Keyboard hint shown on the button (desktop). */
  kbd?: string;
}

/** Phone: the action under the thumb. */
export function Dock({ primary, secondary, status, waiting, pool, onPool }: { primary?: Action; secondary?: Action; status?: ReactNode; waiting?: string | null; pool: number; onPool: () => void }) {
  return (
    <div className="dock">
      {status && <div className="dock-line">{status}</div>}
      <div className="dock-row">
        {waiting ? (
          <div className="dock-wait">
            <span className="wwait-dot" /> {waiting}
          </div>
        ) : (
          <>
            {primary && (
              <button className="btn-gold dock-main" onClick={primary.onClick} disabled={primary.disabled}>
                {primary.label}
              </button>
            )}
            {secondary && (
              <button className="btn-line dock-second" onClick={secondary.onClick} disabled={secondary.disabled}>
                {secondary.label}
              </button>
            )}
          </>
        )}
        <button className="dock-pool" onClick={onPool} aria-label={`Your pool, ${pool} cards`}>
          <span className="fx-label">Pool</span>
          <b>{pool}</b>
        </button>
      </div>
    </div>
  );
}

/** `d`: the draft the event belongs to, so a 3+ seat Booster pick names no card (`describeEvent`). `them`: the other seat's name (a friend's), "AI" by default. */
export function AiBanner({ e, d, them }: { e: DraftEvent | null; d?: Draft; them?: string }) {
  if (!e || e.who !== 'ai') return null;
  return (
    <div className={cx('aibanner', e.kind !== 'pass' && 'is-take', them && 'is-friend')} role="status" key={e.n}>
      <span className="aibanner-mark">{them ? (them[0] ?? '?').toUpperCase() : 'AI'}</span>
      <span>{describeEvent(e, d, them)}</span>
    </div>
  );
}

export interface Seat {
  id: string;
  label: string;
  bot?: boolean;
  active?: boolean;
  onClick?: () => void;
}

export function SeatChips({ seats }: { seats: Seat[] }) {
  return (
    <div className="seats">
      {seats.map((s) => {
        const Tag = s.onClick ? 'button' : 'span';
        return (
          <Tag key={s.id} className={cx('seat-chip', s.active && 'is-active', s.bot && 'is-bot')} onClick={s.onClick}>
            {s.bot && (
              <svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true">
                <rect x="2.5" y="4.5" width="11" height="8" rx="2" fill="none" stroke="currentColor" />
                <path d="M8 2v2.5M6 8h.01M10 8h.01" stroke="currentColor" strokeLinecap="round" strokeWidth="1.6" />
              </svg>
            )}
            {s.label}
          </Tag>
        );
      })}
    </div>
  );
}

export interface MenuItem {
  label: string;
  onClick: () => void;
  hint?: string;
  checked?: boolean;
  danger?: boolean;
  disabled?: boolean;
}

export function Kebab({ items, label = 'More' }: { items: MenuItem[]; label?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const off = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('pointerdown', off);
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('pointerdown', off);
      window.removeEventListener('keydown', key);
    };
  }, [open]);
  return (
    <div className="kebab" ref={ref}>
      <button className="kebab-btn" aria-label={label} aria-expanded={open} aria-haspopup="menu" onClick={() => setOpen(!open)}>
        <IconMore size={18} />
      </button>
      {open && (
        <div className="kebab-menu" role="menu">
          {items.map((it) => (
            <button
              key={it.label}
              role={it.checked !== undefined ? 'menuitemcheckbox' : 'menuitem'}
              aria-checked={it.checked}
              className={cx('kebab-item', it.danger && 'is-danger')}
              disabled={it.disabled}
              onClick={() => {
                setOpen(false);
                it.onClick();
              }}
            >
              <span>{it.label}</span>
              {it.checked !== undefined ? <span className={cx('kebab-check', it.checked && 'is-on')}>{it.checked ? 'On' : 'Off'}</span> : it.hint ? <kbd>{it.hint}</kbd> : null}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Seconds left on the pick timer; calls `onExpire` once at zero. `key` resets it. */
export function useCountdown(seconds: number, running: boolean, resetKey: string, onExpire: () => void): number | null {
  const [left, setLeft] = useState(seconds);
  const cb = useRef(onExpire);
  cb.current = onExpire;
  useEffect(() => setLeft(seconds), [resetKey, seconds]);
  useEffect(() => {
    if (!running || seconds <= 0) return;
    const t = setInterval(() => {
      setLeft((l) => {
        if (l <= 1) {
          clearInterval(t);
          setTimeout(() => cb.current(), 0);
          return 0;
        }
        return l - 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [running, seconds, resetKey]);
  return seconds > 0 ? left : null;
}

export function Timer({ left, total }: { left: number; total: number }) {
  const p = total > 0 ? left / total : 0;
  return (
    <span className={cx('ptimer', left <= 10 && 'is-low')} aria-label={`${left} seconds left`}>
      <svg viewBox="0 0 36 36" width="36" height="36" aria-hidden="true">
        <circle cx="18" cy="18" r="15.5" fill="none" stroke="currentColor" strokeOpacity="0.18" strokeWidth="2.5" />
        <circle cx="18" cy="18" r="15.5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeDasharray={`${p * 97.4} 97.4`} transform="rotate(-90 18 18)" strokeLinecap="round" />
      </svg>
      <b>{left}</b>
    </span>
  );
}

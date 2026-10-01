/*
 * ForgeCoach — ui/play/ActionBar.tsx
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The one place the game is driven from: what the engine wants (in plain
 * words, with its own prompt underneath), and its buttons with their own
 * labels. One primary button at all times.
 */
import { useEffect, useRef, useState } from 'react';
import type { ActBody, ManaColor, ManaPool } from '../../protocol.ts';
import { MANA_COLORS } from '../../protocol.ts';
import { ManaCost, Pip } from '../Mana.tsx';
import { IconFastForward, IconHourglass, IconKeyboard, IconShield, IconSword, IconUndo } from '../Icons.tsx';
import { cx } from '../util.ts';
import type { ButtonView, InputView } from './inputView.ts';
import { oneLine } from './inputView.ts';

const PASS_MENU: { label: string; key: string; body: ActBody }[] = [
  { label: 'Pass priority once', key: 'P', body: { action: 'passPriority' } },
  { label: 'Pass until end of turn', key: 'E', body: { action: 'yieldTo', kind: 'endOfTurn' } },
  { label: 'Pass until my next turn', key: 'T', body: { action: 'yieldTo', kind: 'marker', phase: 'UPKEEP', turn: 'own' } },
  { label: 'Pass until just before my turn', key: 'B', body: { action: 'yieldTo', kind: 'marker', phase: 'END_OF_TURN', turn: 'opp' } },
];

export function ActionBar({
  view,
  busy,
  pool,
  canUndo,
  undoDepth,
  onOk,
  onCancel,
  onAct,
  onHelp,
  flash,
}: {
  view: InputView;
  busy: 'ok' | 'cancel' | null;
  pool: ManaPool | null;
  canUndo: boolean;
  undoDepth: number;
  onOk: () => void;
  onCancel: () => void;
  onAct: (body: ActBody) => void;
  onHelp: () => void;
  flash: string | null;
}) {
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const close = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenu(false);
    };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [menu]);

  const waiting = view.mode === 'waiting';
  const canPassTo = view.mode === 'main' || view.mode === 'priority' || view.mode === 'stack';
  const poolColors = pool ? MANA_COLORS.filter((c) => pool[c] > 0) : [];
  const engine = oneLine(view.engineText);
  const showEngine = engine && !waiting && view.mode !== 'ask' && engine.toLowerCase() !== view.title.toLowerCase();

  return (
    <div className={cx('actionbar', `ab-${view.mode}`)} role="region" aria-label="Your move">
      <div className="ab-text">
        <div className="ab-title" role="status" aria-live="polite">
          {waiting ? <span className="spinner" /> : <ModeIcon mode={view.mode} />}
          <span className="ab-title-text">{view.title}</span>
          {view.payCost && <ManaCost cost={view.payCost} size="sm" />}
        </div>
        {view.detail && <div className="ab-detail">{view.detail}</div>}
        {showEngine && (
          <div className="ab-engine" title={view.engineText}>
            <span className="ab-engine-k">Forge</span> {engine}
          </div>
        )}
        {flash && <div className="ab-flash">{flash}</div>}
      </div>
      <div className="ab-controls">
        {poolColors.length > 0 && (
          <div className="ab-pool" aria-label="Floating mana — tap to spend">
            {poolColors.map((c: ManaColor) => (
              <button key={c} className="ab-pool-pip" title={`Spend one ${c} from your pool (${c} key)`} onClick={() => onAct({ action: 'useMana', color: c })}>
                <Pip sym={c} size="sm" />
                {pool![c] > 1 && <b>{pool![c]}</b>}
              </button>
            ))}
          </div>
        )}
        {canUndo && (
          <button className="btn btn-quiet ab-small" onClick={() => onAct({ action: 'undo' })} title="Take back the last mana tap (Ctrl+Z)">
            <IconUndo size={14} /> Undo{undoDepth > 1 ? ` (${undoDepth})` : ''}
          </button>
        )}
        {canPassTo && (
          <div className="ab-menu-wrap" ref={menuRef}>
            <button className="icon-btn ab-icon" aria-label="Pass ahead" aria-expanded={menu} title="Pass ahead…" onClick={() => setMenu((m) => !m)}>
              <IconFastForward size={16} />
            </button>
            {menu && (
              <div className="ab-menu" role="menu">
                {PASS_MENU.map((m) => (
                  <button
                    key={m.key}
                    role="menuitem"
                    onClick={() => {
                      setMenu(false);
                      onAct(m.body);
                    }}
                  >
                    <span>{m.label}</span>
                    <kbd>{m.key}</kbd>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        <button className="icon-btn ab-icon ab-keys" aria-label="Keyboard shortcuts" title="Keyboard shortcuts (?)" onClick={onHelp}>
          <IconKeyboard size={16} />
        </button>
        {!waiting && (
          <>
            <EngineButton b={view.cancel} primary={view.primary === 'cancel'} busy={busy === 'cancel'} kbd="Esc" onClick={onCancel} />
            <EngineButton b={view.ok} primary={view.primary === 'ok'} busy={busy === 'ok'} kbd="Space" onClick={onOk} needClick={view.needClick} />
          </>
        )}
      </div>
    </div>
  );
}

function EngineButton({
  b,
  primary,
  busy,
  kbd,
  onClick,
  needClick,
}: {
  b: ButtonView;
  primary: boolean;
  busy: boolean;
  kbd: string;
  onClick: () => void;
  needClick?: boolean;
}) {
  if (!b.label) return null;
  if (!b.enabled && !primary && !needClick && kbd === 'Esc') return null; // a dead Cancel is just noise
  return (
    <button
      className={cx('ab-btn', primary ? 'ab-primary' : 'ab-secondary', busy && 'is-busy')}
      disabled={!b.enabled}
      onClick={onClick}
      title={b.enabled ? `${b.label}${b.meaning ? ` — ${b.meaning}` : ''} (${kbd})` : needClick ? 'Tap a highlighted card first' : `${b.label} is not available right now`}
      data-engine-button={kbd === 'Esc' ? 'cancel' : 'ok'}
    >
      <span className="ab-btn-main">
        {busy && <span className="spinner spinner-sm" />}
        {b.label}
      </span>
      {b.meaning && b.enabled && <span className="ab-btn-sub">{b.meaning}</span>}
      {!b.enabled && needClick && <span className="ab-btn-sub">tap a card</span>}
    </button>
  );
}

function ModeIcon({ mode }: { mode: InputView['mode'] }) {
  if (mode === 'attack') return <IconSword size={16} className="ab-mode-icon is-attack" />;
  if (mode === 'block') return <IconShield size={16} className="ab-mode-icon is-block" />;
  if (mode === 'yield') return <IconFastForward size={16} className="ab-mode-icon" />;
  if (mode === 'stack') return <IconHourglass size={16} className="ab-mode-icon is-stack" />;
  return <span className={cx('ab-dot', `dot-${mode}`)} aria-hidden="true" />;
}

/*
 * ForgeCoach — ui/play/ActionBar.tsx
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The one place the game is driven from, one slim row: what the engine wants
 * (in plain words, one line of detail under it) on the left; the smaller
 * tools (floating mana, Undo, the engine's other button), then one big
 * primary button that says what it does (the engine's own label as its
 * sub-line), "To EOT" and a ▲ menu of the other pass-ahead targets on the
 * right. Phones stack the words over the buttons.
 */
import { useEffect, useRef, useState } from 'react';
import type { ActBody, ManaColor, ManaPool } from '../../protocol.ts';
import { MANA_COLORS } from '../../protocol.ts';
import { ManaCost, Pip } from '../Mana.tsx';
import { IconFastForward, IconHourglass, IconKeyboard, IconShield, IconSword, IconUndo } from '../Icons.tsx';
import { cx } from '../util.ts';
import type { ButtonView, InputView } from './inputView.ts';
import { oneLine } from './inputView.ts';
import { buttonWords, canPassAhead, PASS_EOT, passMenu, primaryView } from './actionWords.ts';

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
  wide,
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
  wide?: boolean;
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
  const passAhead = canPassAhead(view);
  useEffect(() => {
    if (!passAhead) setMenu(false);
  }, [passAhead]);
  const poolColors = pool ? MANA_COLORS.filter((c) => pool[c] > 0) : [];
  const engine = oneLine(view.engineText);
  const showEngine = engine && !waiting && view.mode !== 'ask' && engine.toLowerCase() !== view.title.toLowerCase();
  const primary = primaryView(view);
  // The engine's other button (End Turn, Alpha Strike, Call back, Cancel…) sits with the tools.
  const other: { b: ButtonView; which: 'ok' | 'cancel' } | null =
    primary.which === 'ok' ? { b: view.cancel, which: 'cancel' } : primary.which === 'cancel' ? { b: view.ok, which: 'ok' } : view.cancel.enabled ? { b: view.cancel, which: 'cancel' } : null;
  // Forge's "End Turn" says what To EOT already says: phones keep the one button.
  const duplicateEot = !wide && passAhead && !!other && /end turn/i.test(other.b.label);
  const showOther = !!other && !!other.b.label && (other.b.enabled || other.which === 'ok') && !duplicateEot;
  const kbdOf = (which: 'ok' | 'cancel') => (which === 'ok' ? 'Space' : 'Esc');
  const hasTools = poolColors.length > 0 || canUndo || showOther;

  return (
    <div className={cx('actionbar', `ab-${view.mode}`)} role="region" aria-label="Your move">
      <div className="ab-text">
        <div className="ab-title" role="status" aria-live="polite">
          {waiting ? <span className="spinner" /> : <ModeIcon mode={view.mode} />}
          <span className="ab-title-text">{view.title}</span>
          {view.payCost && <ManaCost cost={view.payCost} size="sm" />}
          <button className="icon-btn ab-icon ab-keys" aria-label="Keyboard shortcuts" title="Keyboard shortcuts (?)" onClick={onHelp}>
            <IconKeyboard size={15} />
          </button>
        </div>
        {/* One line under the title: a passing notice, else what the mode means, else Forge's own prompt. */}
        {flash ? (
          <div className="ab-sub ab-flash">{flash}</div>
        ) : view.detail ? (
          <div className="ab-sub ab-detail">{view.detail}</div>
        ) : (
          showEngine && (
            <div className="ab-sub ab-engine" title={view.engineText}>
              <span className="ab-engine-k">Forge</span> {engine}
            </div>
          )
        )}
      </div>
      {hasTools && (
        <div className="ab-tools">
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
            <button className="ab-tool" onClick={() => onAct({ action: 'undo' })} title="Take back the last mana tap (Ctrl+Z)">
              <IconUndo size={14} /> Undo{undoDepth > 1 ? ` (${undoDepth})` : ''}
            </button>
          )}
          <span className="grow" />
          {showOther && other && (
            <button
              className={cx('ab-tool ab-alt', busy === other.which && 'is-busy')}
              disabled={!other.b.enabled}
              onClick={other.which === 'ok' ? onOk : onCancel}
              title={other.b.enabled ? `${other.b.label}${other.b.meaning ? ` — ${other.b.meaning}` : ''} (${kbdOf(other.which)})` : `${other.b.label} is not available right now`}
              data-engine-button={other.which}
            >
              {busy === other.which && <span className="spinner spinner-sm" />}
              <span className="ab-tool-main">{buttonWords(view, other.b)}</span>
              {buttonWords(view, other.b).toLowerCase() !== other.b.label.toLowerCase() && <span className="ab-tool-sub">{other.b.label}</span>}
            </button>
          )}
        </div>
      )}
      <div className="ab-go">
        <button
          className={cx('ab-big', primary.which === null && 'is-idle', busy === primary.which && primary.which && 'is-busy')}
          disabled={!primary.enabled}
          onClick={primary.which === 'ok' ? onOk : primary.which === 'cancel' ? onCancel : undefined}
          data-engine-button={primary.which ?? undefined}
          data-primary="1"
          title={
            primary.which && primary.enabled
              ? `${primary.words}${primary.engine ? ` (Forge: ${primary.engine})` : ''} — ${kbdOf(primary.which)}`
              : view.needClick
                ? 'Tap a highlighted card first'
                : primary.words
          }
        >
          <span className="ab-big-main">
            {(busy === primary.which && primary.which) || (waiting && !primary.which) ? <span className="spinner spinner-sm" /> : null}
            {primary.words}
          </span>
          {primary.which && (
            <span className="ab-big-sub">
              {!primary.enabled && view.needClick ? 'tap a card first' : primary.engine ?? ''}
              {wide && primary.enabled && <kbd>{kbdOf(primary.which)}</kbd>}
            </span>
          )}
        </button>
        <div className="ab-pass" ref={menuRef}>
          <button className="ab-eot" disabled={!passAhead} onClick={() => onAct(PASS_EOT.body)} title="Pass until end of turn (E) — Cancel stops it" aria-label="Pass until end of turn">
            <span className="ab-eot-main">To EOT</span>
          </button>
          <button className="ab-more" disabled={!passAhead} aria-label="Pass ahead…" aria-haspopup="menu" aria-expanded={menu} title="Pass ahead…" onClick={() => setMenu((m) => !m)}>
            <span aria-hidden="true">▲</span>
          </button>
          {menu && (
            <div className="ab-menu" role="menu">
              {passMenu(view).map((m) => (
                <button
                  key={m.id}
                  role="menuitem"
                  onClick={() => {
                    setMenu(false);
                    onAct(m.body);
                  }}
                >
                  <span>{m.label}</span>
                  {m.key && <kbd>{m.key}</kbd>}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ModeIcon({ mode }: { mode: InputView['mode'] }) {
  if (mode === 'attack') return <IconSword size={16} className="ab-mode-icon is-attack" />;
  if (mode === 'block') return <IconShield size={16} className="ab-mode-icon is-block" />;
  if (mode === 'yield') return <IconFastForward size={16} className="ab-mode-icon" />;
  if (mode === 'stack') return <IconHourglass size={16} className="ab-mode-icon is-stack" />;
  return <span className={cx('ab-dot', `dot-${mode}`)} aria-hidden="true" />;
}

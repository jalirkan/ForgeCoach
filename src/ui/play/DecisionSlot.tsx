/*
 * ForgeCoach — ui/play/DecisionSlot.tsx
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The decision slot (endstep-style): ONE fixed panel for every engine
 * question, at the same place every time — beside the hand on a desktop,
 * directly above it on a phone. A DECISION eyebrow, the moment in plain words,
 * one line of instruction, and the answers as buttons with their keys printed
 * on them (PASS PRIORITY [Space], AUTO PAY [A], CANCEL [Esc], ALPHA STRIKE
 * [A], UNDO [Ctrl+Z]); on a desktop an open `ask` renders inside it
 * (AskDialog placement="slot") and grows upward over the board.
 *
 * "It's you": while the engine waits on this seat the slot lights up (glow,
 * a pulse on arrival, the eyebrow and the primary in the brightest colour);
 * after a while with no act it nudges ("Your move — …", and PlayView marks
 * the tab title). While the other seat decides it says so in plain words.
 * It goes quiet when nothing is pending. Every one of these is an engine fact
 * (decisionModel.ts `attentionOf`), never a guess.
 *
 * Under it, the AUTO-PASS toggles: the protocol's `yieldTo` targets, lit from
 * `state.yield`; a lit one sends the engine's Cancel.
 *
 * Kept class names (e2e and the playtest monkey read them): .actionbar,
 * .ab-<mode>, .ab-eyebrow, .ab-title-text, .ab-flash, .ab-pool-pip, .ab-eot,
 * [data-engine-button], [data-primary].
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { ActBody, ManaColor, ManaPool } from '../../protocol.ts';
import { MANA_COLORS } from '../../protocol.ts';
import { ManaCost, Pip } from '../Mana.tsx';
import { IconFastForward, IconHourglass, IconKeyboard, IconShield, IconSword, IconUndo } from '../Icons.tsx';
import { cx } from '../util.ts';
import type { InputView } from './inputView.ts';
import { oneLine } from './inputView.ts';
import { canPassAhead, passMenu } from './actionWords.ts';
import type { SelectionSummary } from './selection.ts';
import { NUDGE_PREFIX, slotButtons, type AttentionView, type PassToggle, type SlotButton } from './decisionModel.ts';
import './decision.css';

export function DecisionSlot({
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
  selection,
  attention,
  nudged = false,
  counter = null,
  toggles,
  ask = null,
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
  /** A selection under way: its live count and the confirm button's words. */
  selection?: SelectionSummary;
  /** Whose move it is (decisionModel.ts attentionOf). */
  attention: AttentionView;
  /** The decision has waited a while with no act: "Your move — …". */
  nudged?: boolean;
  /** "0/1 · need 1 more" for a targeting input (decisionModel.ts inputCounter). */
  counter?: string | null;
  /** The auto-pass toggles (decisionModel.ts passToggles). */
  toggles: PassToggle[];
  /** An open question rendered in the slot (desktop), or null. */
  ask?: ReactNode;
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
  const [primary, ...rest] = slotButtons(view, selection, { canUndo, undoDepth, wide: !!wide });
  const pending = attention.attention === 'pending';
  const theirs = attention.attention === 'opponent';
  const eyebrow = pending ? 'Decision' : view.mode === 'over' ? 'Game over' : 'Waiting';
  const hasTools = poolColors.length > 0 || rest.length > 0;
  const eot = toggles.find((t) => t.id === 'eot');
  // "Your move — " runs inline with the title (a wrap, never a squeezed column of its own).
  const nudge = nudged && pending ? <span className="ds-nudge">{NUDGE_PREFIX}</span> : null;

  return (
    <div
      className={cx('actionbar decision-slot', `ab-${view.mode}`, `is-${attention.attention}`, nudged && pending && 'is-nudged', !!ask && 'has-ask')}
      role="region"
      aria-label="Decision"
      data-attention={attention.attention}
    >
      {/* The arrival pulse: remounted for each new decision, so it plays once per decision. */}
      {pending && <span key={attention.key ?? 'pending'} className="ds-arrive" aria-hidden="true" />}
      <div className="ab-text">
        <div className={cx('ab-eyebrow', pending && 'is-yours', theirs && 'is-theirs')}>
          <span>{eyebrow}</span>
        </div>
        <div className="ab-title" role="status" aria-live="polite">
          {waiting || theirs ? <span className={cx('spinner', theirs && 'ds-wait-spin')} /> : <ModeIcon mode={view.mode} />}
          {theirs && attention.line ? (
            <span className="ab-title-text">{attention.line}</span>
          ) : view.payCost ? (
            // endstep: "Pay {1} for Skullclamp", the cost as mana symbols.
            <span className="ab-title-text ab-pay-title">
              {nudge}
              Pay <ManaCost cost={view.payCost} size={wide ? 'md' : 'sm'} />
              {view.payFor ? ` for ${view.payFor}` : ''}
            </span>
          ) : (
            <span className="ab-title-text">
              {nudge}
              {view.title}
            </span>
          )}
          <button className="icon-btn ab-icon ab-keys" aria-label="Keyboard shortcuts" title="Keyboard shortcuts (?)" onClick={onHelp}>
            <IconKeyboard size={15} />
          </button>
        </div>
        {/* One line under the title: a passing notice, else the selection, else what the mode means, else Forge's own prompt. */}
        {flash ? (
          <div className="ab-sub ab-flash">{flash}</div>
        ) : selection?.active && (selection.line || counter) ? (
          <div className="ab-sub ab-select" aria-live="polite">
            <span className={cx('ab-select-count', !!(selection.count || counter) && 'has-picks')}>
              <span className="ab-select-dot" aria-hidden="true" />
              {counter ?? (selection.count ? `${selection.count} selected` : 'Click to select')}
            </span>
            {selection.line && (selection.count || counter || !/^click to select$/i.test(selection.line)) && (
              <span className={cx('ab-select-line', !selection.count && 'is-hint')}>{selection.line}</span>
            )}
          </div>
        ) : view.detail && !theirs ? (
          <div className="ab-sub ab-detail">{view.detail}</div>
        ) : (
          showEngine &&
          !theirs && (
            <div className="ab-sub ab-engine" title={view.engineText}>
              <span className="ab-engine-k">Forge</span> {engine}
            </div>
          )
        )}
      </div>
      {/* The question in the slot: its one-line peek in place, or the whole question grown upward over the board. */}
      {ask && <div className="ds-ask">{ask}</div>}
      {hasTools && (
        <div className="ab-tools">
          {poolColors.length > 0 && (
            <div className="ab-pool" aria-label="Floating mana — tap to spend">
              {poolColors.map((c: ManaColor) => (
                <button key={c} className="ab-pool-pip" title={`Spend one ${c} from your pool (${c} key)`} onClick={() => onAct({ action: 'useMana', color: c })}>
                  <Pip sym={c} size="sm" />
                  {pool![c] > 1 && <b>{pool![c]}</b>}
                  <kbd className="ds-kbd" aria-hidden="true">
                    {c}
                  </kbd>
                </button>
              ))}
            </div>
          )}
          <span className="grow" />
          {rest.map((b) => (
            <ToolButton key={b.id} b={b} busy={busy} onOk={onOk} onCancel={onCancel} onUndo={() => onAct({ action: 'undo' })} />
          ))}
        </div>
      )}
      <div className="ab-go">
        <button
          className={cx('ab-big', primary!.which === null && 'is-idle', busy === primary!.which && primary!.which && 'is-busy')}
          disabled={!primary!.enabled}
          onClick={primary!.which === 'ok' ? onOk : primary!.which === 'cancel' ? onCancel : undefined}
          data-engine-button={primary!.which ?? undefined}
          data-primary="1"
          title={
            primary!.which && primary!.enabled
              ? `${primary!.words}${primary!.engine ? ` (Forge: ${primary!.engine})` : ''} — ${primary!.kbd}`
              : view.needClick
                ? `Tap a highlighted ${view.clickWhat} first`
                : primary!.words
          }
        >
          <span className="ab-big-main">
            {(busy === primary!.which && primary!.which) || (waiting && !primary!.which) ? <span className="spinner spinner-sm" /> : null}
            {primary!.words}
            {primary!.kbd && primary!.enabled && (
              <kbd className="ds-kbd" aria-hidden="true">
                {primary!.kbd}
              </kbd>
            )}
          </span>
          {primary!.which && (
            <span className="ab-big-sub">{!primary!.enabled && view.needClick ? `tap a ${view.clickWhat === 'player' ? 'player' : 'card'} first` : (primary!.engine ?? '')}</span>
          )}
        </button>
        {!wide && eot && (
          <div className="ab-pass" ref={menuRef}>
            <button
              className={cx('ab-eot', eot.lit && 'is-lit')}
              disabled={!eot.enabled}
              aria-pressed={eot.lit}
              onClick={() => onAct(eot.body)}
              title={eot.title}
              aria-label={eot.lit ? 'Stop passing to end of turn' : 'Pass until end of turn'}
            >
              <span className="ab-eot-main">{eot.lit ? 'Stop EOT' : 'To EOT'}</span>
            </button>
            <button
              className="ab-more"
              disabled={!passAhead}
              aria-label="Pass ahead…"
              aria-haspopup="menu"
              aria-expanded={menu}
              title="Pass ahead…"
              onClick={() => setMenu((m) => !m)}
            >
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
        )}
      </div>
      {wide && <AutoPass toggles={toggles} onAct={onAct} />}
    </div>
  );
}

function ToolButton({ b, busy, onOk, onCancel, onUndo }: { b: SlotButton; busy: 'ok' | 'cancel' | null; onOk: () => void; onCancel: () => void; onUndo: () => void }) {
  if (b.id === 'undo') {
    return (
      <button className="ab-tool ds-undo" onClick={onUndo} title="Take back the last mana tap (Ctrl+Z)">
        <IconUndo size={14} /> {b.words}
        <kbd className="ds-kbd" aria-hidden="true">
          {b.kbd}
        </kbd>
      </button>
    );
  }
  return (
    <button
      className={cx('ab-tool ab-alt', busy === b.which && 'is-busy')}
      disabled={!b.enabled}
      onClick={b.which === 'ok' ? onOk : onCancel}
      title={b.enabled ? `${b.engine ?? b.words}${b.kbd ? ` (${b.kbd})` : ''}` : `${b.engine ?? b.words} is not available right now`}
      data-engine-button={b.which ?? undefined}
    >
      {busy === b.which && <span className="spinner spinner-sm" />}
      <span className="ab-tool-main">{b.words}</span>
      {b.engine && <span className="ab-tool-sub">{b.engine}</span>}
      {b.kbd && b.enabled && (
        <kbd className="ds-kbd" aria-hidden="true">
          {b.kbd}
        </kbd>
      )}
    </button>
  );
}

/** AUTO-PASS: END OF TURN [E], BEFORE MY TURN [B], MY NEXT TURN [T] (and the stack, while there is one). */
function AutoPass({ toggles, onAct }: { toggles: PassToggle[]; onAct: (body: ActBody) => void }) {
  return (
    <div className="ds-autopass" role="group" aria-label="Auto-pass">
      <div className="ds-autopass-head">
        <span>Auto-pass</span>
        <span className="ds-autopass-sub">skip ahead</span>
      </div>
      <div className="ds-toggles">
        {toggles.map((t) => (
          <button
            key={t.id}
            type="button"
            className={cx('ds-toggle', t.id === 'eot' && 'ab-eot', t.lit && 'is-lit')}
            aria-pressed={t.lit}
            disabled={!t.enabled}
            title={t.title}
            onClick={() => onAct(t.body)}
          >
            <span className="ds-toggle-label">{t.label}</span>
            {t.kbd && (
              <kbd className="ds-kbd" aria-hidden="true">
                {t.kbd}
              </kbd>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * "Waiting for Forge AI…" with a pulsing dot, under the opponent's half of the
 * board while it is their decision (Board's overlay: absolutely placed at the
 * bottom edge of `.player-top`, which it measures). Nothing when `line` is null.
 */
export function OppWaitingLine({ line }: { line: string | null }) {
  const ref = useRef<HTMLDivElement>(null);
  const [top, setTop] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    const board = el?.closest('.board') as HTMLElement | null;
    const opp = board?.querySelector('.player-top') as HTMLElement | null;
    if (!el || !board || !opp) return;
    const place = () => {
      const b = board.getBoundingClientRect();
      const o = opp.getBoundingClientRect();
      setTop(Math.round(o.bottom - b.top + board.scrollTop));
    };
    place();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(place);
    ro.observe(opp);
    ro.observe(board);
    return () => ro.disconnect();
  }, [line]);
  if (!line) return null;
  return (
    <div ref={ref} className="opp-waiting" role="status" style={top === null ? { visibility: 'hidden' } : { top }}>
      <span className="opp-waiting-dot" aria-hidden="true" />
      {line}
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

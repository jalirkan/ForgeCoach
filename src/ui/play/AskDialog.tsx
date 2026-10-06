/*
 * ForgeCoach — ui/play/AskDialog.tsx
 * Copyright (C) 2026 the mtg-table authors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The engine's blocking questions (mtg-table protocol §5), as calm, playable
 * dialogs: a centred modal on desktop that can be minimised to peek at the
 * board, a bottom sheet on phones. Adapted from mtg-table
 * web/src/render/AskModal.tsx — the answer logic lives in askModel.ts.
 *
 *   <AskDialog ask state onAnswer onPreviewCard />   — all eleven ask kinds
 *   <OpeningDialog input state seat onChoose />      — keep/mulligan, play/draw
 *                                                       (those are `input`s)
 *
 * Keyboard: Enter confirms, Esc minimises (it never declines), Tab stays inside.
 * Labels are the engine's and are printed verbatim (a concealed card's option
 * is "???"; its name is never looked up).
 */
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { AnswerValue, AnyCard, AskBody, AskOption, Card, GameStateBody, InputBody } from '../../protocol.ts';
import { isHidden } from '../../protocol.ts';
import { cardIndex } from '../../decisions.ts';
import { prefetchCards, useCardInfo } from '../cardData.ts';
import { IconCheck, IconChevronDown, IconEye, IconPlay, IconPlus, IconX, TypeGlyph } from '../Icons.tsx';
import { ManaCost, Pip, SymbolText } from '../Mana.tsx';
import { colorClass, cx, shortType, typeKind } from '../util.ts';
import { useLongPress } from '../longPress.ts';
import {
  amountCap,
  amountsTotal,
  askOptions,
  choiceBounds,
  colorSymbol,
  countPhrase,
  answerFromDraft,
  groupOptions,
  initialDraft,
  isCardList,
  isColorList,
  isNumberList,
  lookupName,
  moveItem,
  openingKind,
  orderBounds,
  removeFromGroup,
  setAmount,
  skipAction,
  tidy,
  toggleChoice,
  toggleGroup,
  validateDraft,
  type AbilityOption,
  type AskDraft,
  type DamageTarget,
  type AmountTarget,
} from './askModel.ts';
import './ask.css';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface AskDialogProps {
  ask: AskBody;
  /** The latest snapshot — used only to name cards an ask refers to by id. */
  state: GameStateBody | null;
  /** Send exactly one answer for `ask.askId`. Called at most once per ask. */
  onAnswer: (value: AnswerValue) => void;
  /** Open the card detail for a card id (option cards, revealed cards). */
  onPreviewCard?: (cardId: number) => void;
  /** Ask to concede the game (the board's confirmation); shown in the question's head when given. */
  onConcede?: (() => void) | null;
}

/**
 * The board's Concede, offered inside an engine question too: the question is
 * modal, so a keyboard or screen-reader player could not otherwise reach the
 * board's own button while it is open (the top bar is lifted above the scrim
 * for a pointer, ask.css).
 */
const ConcedeContext = createContext<(() => void) | null>(null);

export function AskDialog({ onConcede = null, ...props }: AskDialogProps) {
  // Remount per askId: a new question never inherits the last one's draft.
  return (
    <ConcedeContext.Provider value={onConcede}>
      <AskDialogInner key={props.ask.askId} {...props} />
    </ConcedeContext.Provider>
  );
}

export interface OpeningDialogProps {
  /** An `input` that {@link openingKind}`(input, state)` recognises (keep/mulligan, play/draw). */
  input: InputBody;
  state: GameStateBody | null;
  /** The viewing seat; falls back to the player whose hand is visible. */
  seat?: number | null;
  /** Answer with the engine's OK (`buttonOk`) or Cancel (`buttonCancel`) button. */
  onChoose: (button: 'ok' | 'cancel') => void;
  onPreviewCard?: (cardId: number) => void;
  /** Ask to concede the game, as {@link AskDialogProps.onConcede}. */
  onConcede?: (() => void) | null;
}

// ---------------------------------------------------------------------------
// The shell: modal / bottom sheet, minimise, keyboard, timer
// ---------------------------------------------------------------------------

interface ShellProps {
  shellKey: string;
  eyebrow: ReactNode;
  title: ReactNode;
  detail?: ReactNode;
  children?: ReactNode;
  footer: ReactNode;
  hint?: ReactNode;
  hintTone?: 'ok' | 'warn';
  /** What Enter does (null: nothing). */
  onEnter: (() => void) | null;
  timeoutMs?: number;
  wide?: boolean;
  /** Short text for the minimised pill. */
  peek: string;
}

function AskShell({ shellKey, eyebrow, title, detail, children, footer, hint, hintTone = 'warn', onEnter, timeoutMs = 0, wide, peek }: ShellProps) {
  const [minimized, setMinimized] = useState(false);
  const [started] = useState(() => Date.now());
  const box = useRef<HTMLElement>(null);
  const concede = useContext(ConcedeContext);
  const enter = useRef(onEnter);
  enter.current = onEnter;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      // Another sheet (the card detail) on top owns its own keys.
      if (t?.closest?.('.sheet')) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setMinimized((m) => !m);
        return;
      }
      if (minimized) return;
      if (e.key === 'Enter' && !e.isComposing && !e.repeat) {
        if (!box.current?.contains(t) && t !== document.body) return;
        // A focused secondary button keeps native Enter; option rows and inputs confirm.
        if (t instanceof HTMLButtonElement && !t.classList.contains('ask-opt')) return;
        if (t instanceof HTMLTextAreaElement) return;
        e.preventDefault();
        enter.current?.();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [minimized]);

  useEffect(() => {
    if (minimized) return;
    const el = box.current;
    if (!el) return;
    const prev = document.activeElement as HTMLElement | null;
    const auto = el.querySelector<HTMLElement>('[data-autofocus]');
    (auto ?? el).focus({ preventScroll: true });
    return () => {
      if (prev && document.contains(prev)) prev.focus?.({ preventScroll: true });
    };
  }, [minimized, shellKey]);

  const elapsed = Date.now() - started;
  const timer =
    timeoutMs > 0 ? (
      <div className="ask-timer" aria-hidden="true">
        <span style={{ animationDuration: `${timeoutMs}ms`, animationDelay: `-${Math.min(elapsed, timeoutMs)}ms` }} />
      </div>
    ) : null;

  if (minimized) {
    return createPortal(
      <button type="button" className="ask-peek" onClick={() => setMinimized(false)} aria-label={`Answer: ${peek}`}>
        <span className="ask-peek-dot" aria-hidden="true" />
        <span className="ask-peek-text">{peek}</span>
        <span className="ask-peek-cta">Answer</span>
      </button>,
      document.body,
    );
  }

  return createPortal(
    <div className="ask-layer">
      <section
        className={cx('ask-dialog', wide && 'ask-wide')}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`ask-title-${shellKey}`}
        tabIndex={-1}
        ref={box}
        onKeyDown={(e) => {
          if (e.key !== 'Tab') return;
          const stops = focusables(box.current);
          if (stops.length === 0) return;
          const first = stops[0]!;
          const last = stops[stops.length - 1]!;
          if (e.shiftKey && (document.activeElement === first || document.activeElement === box.current)) {
            e.preventDefault();
            last.focus();
          } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }}
      >
        <div className="ask-grip" aria-hidden="true" />
        {timer}
        <header className="ask-head">
          <div className="ask-titles">
            <div className="ask-eyebrow">{eyebrow}</div>
            <h2 className="ask-title" id={`ask-title-${shellKey}`}>
              {title}
            </h2>
            {detail && <div className="ask-detail">{detail}</div>}
          </div>
          {concede && (
            <button type="button" className="btn btn-quiet btn-sm ask-concede" onClick={concede} title="Concede this game (you are asked to confirm)">
              Concede…
            </button>
          )}
          <button type="button" className="icon-btn ask-min" onClick={() => setMinimized(true)} title="Peek at the board (Esc)" aria-label="Minimise to see the board">
            <IconChevronDown size={18} />
          </button>
        </header>
        {children && <div className="ask-body">{children}</div>}
        {(footer || hint) && (
          <footer className="ask-foot">
            {hint ? <div className={cx('ask-hint', hintTone === 'ok' ? 'is-ok' : 'is-warn')}>{hint}</div> : <div className="ask-hint" />}
            <div className="ask-actions">{footer}</div>
          </footer>
        )}
      </section>
    </div>,
    document.body,
  );
}

function focusables(root: HTMLElement | null): HTMLElement[] {
  if (!root) return [];
  return [...root.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter(
    (el) => !el.hasAttribute('disabled'),
  );
}

// ---------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------

function visibleCard(card: AnyCard | undefined | null): Card | null {
  return card && !isHidden(card) ? (card as Card) : null;
}

/** Small art square for rows. */
function Thumb({ name, card, hidden }: { name: string | null; card?: Card | null; hidden?: boolean }) {
  const info = useCardInfo(hidden ? null : name);
  const art = info?.image?.artCrop ?? info?.faces?.[0]?.image?.artCrop;
  const kind = typeKind(card?.types || info?.typeLine);
  if (hidden) return <span className="ask-thumb ask-thumb-back" aria-hidden="true" />;
  return (
    <span className={cx('ask-thumb', colorClass(info?.colors ?? []))} aria-hidden="true">
      {art ? <img src={art} alt="" loading="lazy" decoding="async" draggable={false} /> : <TypeGlyph kind={kind} size={16} />}
    </span>
  );
}

/** A whole card: Scryfall image when cached, a clean frame otherwise. */
function CardFace({ name, card, hidden, label }: { name: string | null; card?: Card | null; hidden?: boolean; label: string }) {
  const info = useCardInfo(hidden ? null : name);
  const img = info?.image?.normal ?? info?.faces?.[0]?.image?.normal;
  const [loaded, setLoaded] = useState(false);
  if (hidden) {
    return (
      <span className="ask-face ask-face-back">
        <span className="ask-face-q">?</span>
      </span>
    );
  }
  const types = card?.types || info?.typeLine || '';
  const kind = typeKind(types);
  const cost = card?.manaCost ?? info?.manaCost ?? null;
  const pt = card && card.power !== null && card.toughness !== null ? `${card.power}/${card.toughness}` : info?.power ? `${info.power}/${info.toughness}` : null;
  return (
    <span className={cx('ask-face', colorClass(info?.colors ?? []), loaded && 'is-loaded')}>
      <span className="ask-face-frame">
        <span className="ask-face-top">
          <span className="ask-face-name">{label}</span>
          <ManaCost cost={cost} size="sm" />
        </span>
        <span className="ask-face-art">
          <TypeGlyph kind={kind} size={22} />
        </span>
        <span className="ask-face-type">{shortType(types) || ' '}</span>
        {pt && <span className="ask-face-pt">{pt}</span>}
      </span>
      {img && <img src={img} alt="" loading="lazy" decoding="async" draggable={false} onLoad={() => setLoaded(true)} />}
    </span>
  );
}

function PreviewBtn({ cardId, onPreview, label }: { cardId: number | undefined; onPreview?: (id: number) => void; label: string }) {
  if (cardId === undefined || !onPreview) return null;
  return (
    <span
      role="button"
      tabIndex={0}
      className="ask-preview"
      title={`View ${label}`}
      aria-label={`View ${label}`}
      onClick={(e) => {
        e.stopPropagation();
        onPreview(cardId);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          e.stopPropagation();
          onPreview(cardId);
        }
      }}
    >
      <IconEye size={14} />
    </span>
  );
}

/**
 * A choosable option. On touch, holding it opens the card's details (like a
 * tile on the board) instead of choosing it; a tap still chooses.
 */
function OptButton({ cardId, onPreview, onClick, children, ...rest }: { cardId: number | undefined; onPreview?: (id: number) => void; onClick: () => void; children: ReactNode } & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onClick' | 'type' | 'children'>) {
  const { handlers, takeClick } = useLongPress(cardId !== undefined && onPreview ? () => onPreview(cardId) : null);
  return (
    <button
      type="button"
      {...rest}
      {...handlers}
      onClick={() => {
        if (takeClick()) return;
        onClick();
      }}
    >
      {children}
    </button>
  );
}

/** A card that is shown, not chosen: the whole card opens the preview. */
function StaticCard({ cardId, onPreview, label, className, children }: { cardId: number | undefined; onPreview?: (id: number) => void; label: string; className?: string; children: ReactNode }) {
  if (cardId === undefined || !onPreview) return <div className={cx('ask-card is-static', className)}>{children}</div>;
  return (
    <button type="button" className={cx('ask-card is-static is-previewable', className)} onClick={() => onPreview(cardId)} title={`View ${label}`} aria-label={`View ${label}`}>
      {children}
    </button>
  );
}

function optionIsHidden(o: AskOption): boolean {
  return o.label === '???' || (o.card !== undefined && isHidden(o.card));
}

/** Label with mana symbols drawn as pips (labels are verbatim). */
function Label({ text }: { text: string }) {
  return <SymbolText text={text} />;
}

// ---------------------------------------------------------------------------
// Option renderers
// ---------------------------------------------------------------------------

interface PickProps {
  options: AskOption[];
  chosen: number[];
  max: number;
  onChange: (next: number[]) => void;
  onSendNow?: (next: number[]) => void;
  onPreview?: (id: number) => void;
  disabled?: (o: AskOption) => boolean;
  /** Extra tag per option. */
  tag?: (o: AskOption) => ReactNode;
}

/** Rows with a radio/check indicator — the generic list. */
function RowPicker({ options, chosen, max, onChange, onSendNow, onPreview, disabled, tag }: PickProps) {
  const radio = max === 1;
  return (
    <ul className="ask-rows" role={radio ? 'radiogroup' : 'group'}>
      {options.map((o) => {
        const on = chosen.includes(o.id);
        const off = disabled?.(o) ?? false;
        const full = !on && !radio && max >= 0 && chosen.length >= max;
        const name = lookupName(o);
        const hidden = optionIsHidden(o);
        const card = visibleCard(o.card);
        const showThumb = o.kind === 'card' || o.card !== undefined;
        return (
          <li key={o.id}>
            <OptButton
              cardId={o.cardId}
              onPreview={onPreview}
              className={cx('ask-opt ask-row', on && 'is-on', (off || full) && 'is-off')}
              role={radio ? 'radio' : 'checkbox'}
              aria-checked={on}
              disabled={off}
              onClick={() => onChange(toggleChoice(chosen, o.id, max))}
              onDoubleClick={() => {
                if (radio && onSendNow && !off) onSendNow([o.id]);
              }}
            >
              <span className={cx('ask-mark', radio ? 'is-radio' : 'is-check')} aria-hidden="true">
                {on && (radio ? <span className="ask-mark-dot" /> : <IconCheck size={12} />)}
              </span>
              {showThumb && <Thumb name={name} card={card} hidden={hidden} />}
              <span className="ask-row-text">
                <span className="ask-row-label">
                  <Label text={o.label} />
                </span>
                {card && card.types && <span className="ask-row-meta">{shortType(card.types)}</span>}
              </span>
              {tag?.(o)}
              {card && <ManaCost cost={card.manaCost} size="sm" />}
              <PreviewBtn cardId={o.cardId} onPreview={onPreview} label={o.label} />
            </OptButton>
          </li>
        );
      })}
    </ul>
  );
}

/** Cards as cards: a grid, identical copies collapsed with a count. */
function CardPicker({ options, chosen, max, onChange, onSendNow, onPreview }: PickProps) {
  const groups = useMemo(() => groupOptions(options), [options]);
  return (
    <ul className="ask-cards">
      {groups.map((g) => {
        const picked = g.ids.filter((id) => chosen.includes(id)).length;
        const hidden = optionIsHidden(g.option);
        const card = visibleCard(g.option.card);
        const full = picked === 0 && max !== 1 && max >= 0 && chosen.length >= max;
        return (
          <li key={g.key}>
            <OptButton
              cardId={g.option.cardId}
              onPreview={onPreview}
              className={cx('ask-opt ask-card', picked > 0 && 'is-on', full && 'is-off')}
              aria-pressed={picked > 0}
              aria-label={`${g.label}${g.ids.length > 1 ? `, ${g.ids.length} copies` : ''}${picked ? `, ${picked} chosen` : ''}`}
              onClick={() => onChange(toggleGroup(chosen, g.ids, max))}
              onDoubleClick={() => {
                if (max === 1 && onSendNow) onSendNow([g.ids[0]!]);
              }}
            >
              <CardFace name={lookupName(g.option)} card={card} hidden={hidden} label={g.label} />
              {g.ids.length > 1 && <span className="ask-card-count">×{g.ids.length}</span>}
              {picked > 0 && (
                <span className="ask-card-check" aria-hidden="true">
                  {g.ids.length > 1 && max !== 1 ? picked : <IconCheck size={14} />}
                </span>
              )}
              <PreviewBtn cardId={g.option.cardId} onPreview={onPreview} label={g.label} />
            </OptButton>
            {picked > 0 && g.ids.length > 1 && max !== 1 && (
              <button type="button" className="ask-card-minus" onClick={() => onChange(removeFromGroup(chosen, g.ids))} aria-label={`One fewer ${g.label}`}>
                −
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function ChipPicker({ options, chosen, max, onChange, onSendNow, color }: PickProps & { color?: boolean }) {
  return (
    <ul className={cx('ask-chips', color && 'ask-chips-color')}>
      {options.map((o) => {
        const on = chosen.includes(o.id);
        const sym = color ? colorSymbol(o.label) : null;
        return (
          <li key={o.id}>
            <button
              type="button"
              className={cx('ask-opt ask-chip', on && 'is-on', sym && `ask-chip-${sym}`, o.kind === 'text' && 'ask-chip-other')}
              aria-pressed={on}
             
              onClick={() => onChange(toggleChoice(chosen, o.id, max))}
              onDoubleClick={() => {
                if (max === 1 && onSendNow) onSendNow([o.id]);
              }}
            >
              {sym && <Pip sym={sym} size="md" />}
              <span>{o.label}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function ListPicker(props: PickProps) {
  const { options } = props;
  if (options.length === 0) return <p className="ask-empty">Nothing to choose from.</p>;
  if (isNumberList(options)) return <ChipPicker {...props} />;
  if (isColorList(options)) return <ChipPicker {...props} color />;
  if (isCardList(options)) return <CardPicker {...props} />;
  return <RowPicker {...props} />;
}

/** Cards shown, not chosen: a reveal, or a delayedReveal's context. */
function CardStrip({ cards, onPreview }: { cards: { key: string | number; option: AskOption; count: number }[]; onPreview?: (id: number) => void }) {
  return (
    <ul className="ask-cards ask-cards-static">
      {cards.map(({ key, option, count }) => (
        <li key={key}>
          <StaticCard cardId={option.cardId} onPreview={onPreview} label={option.label}>
            <CardFace name={lookupName(option)} card={visibleCard(option.card)} hidden={optionIsHidden(option)} label={option.label} />
            {count > 1 && <span className="ask-card-count">×{count}</span>}
          </StaticCard>
        </li>
      ))}
    </ul>
  );
}

function Stepper({ value, max, min = 0, onChange, label }: { value: number; max: number; min?: number; onChange: (n: number) => void; label: string }) {
  return (
    <span className="ask-step" role="group" aria-label={label}>
      <button type="button" disabled={value <= min} onClick={() => onChange(value - 1)} aria-label={`Less to ${label}`}>
        −
      </button>
      <input
        className="ask-step-n"
        inputMode="numeric"
        value={value}
        aria-label={`Amount to ${label}`}
        onChange={(e) => {
          const n = Number.parseInt(e.target.value.replace(/\D/g, ''), 10);
          onChange(Number.isFinite(n) ? n : 0);
        }}
        onFocus={(e) => e.currentTarget.select()}
      />
      <button type="button" disabled={value >= max} onClick={() => onChange(value + 1)} aria-label={`More to ${label}`}>
        +
      </button>
    </span>
  );
}

function Meter({ value, total }: { value: number; total: number }) {
  const pct = total > 0 ? Math.min(100, (value / total) * 100) : 0;
  return (
    <div className={cx('ask-meter', value === total && 'is-full', value > total && 'is-over')}>
      <span className="ask-meter-bar">
        <span style={{ width: `${pct}%` }} />
      </span>
      <span className="ask-meter-n">
        {value} / {total}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The dialog
// ---------------------------------------------------------------------------

function namesIn(ask: AskBody): string[] {
  const out = new Set<string>();
  for (const o of askOptions(ask)) {
    const n = lookupName(o);
    if (n) out.add(n);
  }
  if (ask.kind === 'choose_entities' && ask.delayedReveal) for (const c of ask.delayedReveal.cards) if (!isHidden(c) && c.name) out.add(c.name);
  if ((ask.kind === 'confirm' || ask.kind === 'options') && ask.card && !isHidden(ask.card) && ask.card.name) out.add(ask.card.name);
  return [...out];
}

function AskDialogInner({ ask, state, onAnswer, onPreviewCard }: AskDialogProps) {
  const [draft, setDraft] = useState<AskDraft>(() => initialDraft(ask));
  const [sent, setSent] = useState(false);
  const sentRef = useRef(false);
  const index = useMemo(() => (state ? cardIndex(state) : new Map<number, AnyCard>()), [state]);
  useEffect(() => prefetchCards(namesIn(ask)), [ask]);

  const send = (value: AnswerValue) => {
    if (sentRef.current) return;
    sentRef.current = true;
    setSent(true);
    onAnswer(value);
  };
  const nameOf = (id: number | null | undefined): string | null => {
    if (id === null || id === undefined) return null;
    const c = index.get(id);
    if (!c || isHidden(c)) return null;
    return c.name || null;
  };
  const playerName = (id: number | null | undefined): string | null =>
    id === null || id === undefined ? null : (state?.players.find((p) => p.id === id)?.name ?? null);

  const v = validateDraft(ask, draft);
  const confirm = () => {
    if (v.ok) send(answerFromDraft(ask, draft));
  };
  const skip = skipAction(ask);
  const skipBtn = skip && (
    <button type="button" className="btn btn-quiet ask-btn" disabled={sent} title={skip.title} onClick={() => send(skip.value)}>
      {skip.label}
    </button>
  );
  const primary = (label: string) => (
    <button type="button" className="btn btn-primary ask-btn" disabled={!v.ok || sent} onClick={confirm}>
      {label}
    </button>
  );
  const indices = draft.shape === 'indices' ? draft.indices : [];
  const setIndices = (next: number[]) => setDraft({ shape: 'indices', indices: next });
  const sendIndices = (next: number[]) => {
    const d: AskDraft = { shape: 'indices', indices: next };
    if (validateDraft(ask, d).ok) send(answerFromDraft(ask, d));
  };
  const common = { shellKey: ask.askId, timeoutMs: ask.timeoutMs };

  switch (ask.kind) {
    case 'ability_menu': {
      const host = nameOf(ask.cardId);
      const hostCard = visibleCard(index.get(ask.cardId));
      const sel = draft.shape === 'index' ? draft.index : -1;
      return (
        <AskShell
          {...common}
          eyebrow="Choose how to play"
          title={host ?? 'this card'}
          peek={`Choose how to play ${host ?? 'this card'}`}
          onEnter={confirm}
          footer={
            <>
              {skipBtn}
              {primary('Play')}
            </>
          }
        >
          <ul className="ask-rows">
            {(ask.options as AbilityOption[]).map((o, i) => (
              <li key={o.id}>
                <button
                  type="button"
                  className={cx('ask-opt ask-row ask-ability', sel === o.id && 'is-on', !o.canPlay && 'is-off')}
                  disabled={!o.canPlay || sent}
                 
                  onFocus={() => o.canPlay && setDraft({ shape: 'index', index: o.id })}
                  onClick={() => send(o.id)}
                >
                  {i === 0 && <Thumb name={host} card={hostCard} />}
                  {i > 0 && <span className="ask-thumb ask-thumb-blank" aria-hidden="true" />}
                  <span className="ask-row-text">
                    <span className="ask-row-label">
                      <Label text={o.label} />
                    </span>
                    <span className="ask-row-meta">{!o.canPlay ? 'Can’t be played right now' : o.isSpell ? 'Cast' : 'Activate'}</span>
                  </span>
                  <span className={cx('tag', o.isSpell ? 'tag-turn' : 'tag-prio')}>{o.isSpell ? 'Spell' : 'Ability'}</span>
                </button>
              </li>
            ))}
          </ul>
        </AskShell>
      );
    }

    case 'confirm': {
      const card = visibleCard(ask.card);
      const yes = () => send(true);
      const no = () => send(false);
      return (
        <AskShell
          {...common}
          eyebrow={tidy(ask.title) || 'Confirm'}
          title={tidy(ask.prompt)}
          peek={tidy(ask.prompt)}
          onEnter={ask.defaultYes ? yes : no}
          footer={
            <>
              <button type="button" className={cx('btn ask-btn ask-btn-big', ask.defaultYes ? 'btn-quiet' : 'btn-primary')} disabled={sent} onClick={no}>
                {ask.noLabel || 'No'}
              </button>
              <button type="button" className={cx('btn ask-btn ask-btn-big', ask.defaultYes ? 'btn-primary' : 'btn-quiet')} disabled={sent} onClick={yes}>
                {ask.yesLabel || 'Yes'}
              </button>
            </>
          }
        >
          {ask.card && (
            <div className="ask-hero">
              <StaticCard className="ask-card-hero" cardId={card ? ask.card.id : undefined} onPreview={onPreviewCard} label={card?.name ?? 'Hidden card'}>
                <CardFace name={card?.name ?? null} card={card} hidden={!card} label={card?.name ?? 'Hidden card'} />
              </StaticCard>
            </div>
          )}
        </AskShell>
      );
    }

    case 'options': {
      const card = visibleCard(ask.card);
      const sel = draft.shape === 'index' ? draft.index : -1;
      return (
        <AskShell
          {...common}
          eyebrow={tidy(ask.title) || 'Choose one'}
          title={tidy(ask.prompt)}
          peek={tidy(ask.prompt)}
          hint={v.ok ? '' : v.hint}
          onEnter={confirm}
          footer={
            <>
              {skipBtn}
              {primary('Confirm')}
            </>
          }
        >
          {card && (
            <div className="ask-context">
              <Thumb name={card.name} card={card} />
              <span>{card.name}</span>
              <PreviewBtn cardId={card.id} onPreview={onPreviewCard} label={card.name} />
            </div>
          )}
          <RowPicker
            options={ask.options}
            chosen={sel >= 0 ? [sel] : []}
            max={1}
            onChange={(next) => setDraft({ shape: 'index', index: next[0] ?? -1 })}
            onSendNow={(next) => send(next[0]!)}
            onPreview={onPreviewCard}
          />
        </AskShell>
      );
    }

    case 'text': {
      const text = draft.shape === 'text' ? draft.text : '';
      return (
        <AskShell
          {...common}
          eyebrow={tidy(ask.title) || (ask.numeric ? 'Choose a number' : 'Your answer')}
          title={tidy(ask.prompt)}
          peek={tidy(ask.prompt)}
          hint={v.hint}
          hintTone={v.ok ? 'ok' : 'warn'}
          onEnter={confirm}
          footer={
            <>
              {skipBtn}
              {primary('Confirm')}
            </>
          }
        >
          <input
            className="ask-text"
            type="text"
            inputMode={ask.numeric ? 'numeric' : 'text'}
            autoComplete="off"
            spellCheck={false}
            placeholder={ask.numeric ? '0' : 'Type here'}
            value={text}
            data-autofocus=""
            onChange={(e) => setDraft({ shape: 'text', text: e.target.value })}
          />
          {ask.suggestions.length > 0 && (
            <ul className="ask-chips ask-suggest">
              {ask.suggestions.map((s) => (
                <li key={s}>
                  <button
                    type="button"
                    className={cx('ask-chip', text === s && 'is-on')}
                    onClick={() => setDraft({ shape: 'text', text: s })}
                    onDoubleClick={() => send(s)}
                  >
                    {s}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </AskShell>
      );
    }

    case 'choose_list': {
      if (ask.reveal) {
        const groups = groupOptions(ask.options).map((g) => ({ key: g.key, option: g.option, count: g.ids.length }));
        return (
          <AskShell
            {...common}
            eyebrow="Revealed"
            title={tidy(ask.prompt)}
            peek={tidy(ask.prompt)}
            onEnter={() => send([])}
            footer={
              <button type="button" className="btn btn-primary ask-btn" disabled={sent} onClick={() => send([])} data-autofocus="">
                OK
              </button>
            }
          >
            <CardStrip cards={groups} onPreview={onPreviewCard} />
          </AskShell>
        );
      }
      const { lo, hi } = choiceBounds(ask);
      return (
        <AskShell
          {...common}
          eyebrow={countPhrase(lo, hi)}
          title={tidy(ask.prompt)}
          peek={tidy(ask.prompt)}
          hint={v.hint}
          hintTone={v.ok ? 'ok' : 'warn'}
          onEnter={confirm}
          wide={isCardList(ask.options) && ask.options.length > 3}
          footer={
            <>
              {skipBtn}
              {primary('Confirm')}
            </>
          }
        >
          <ListPicker
            options={ask.options}
            chosen={indices}
            max={hi === 1 ? 1 : ask.max}
            onChange={setIndices}
            onSendNow={sendIndices}
            onPreview={onPreviewCard}
            tag={(o) => (ask.preselected.includes(o.id) ? <span className="tag tag-muted">suggested</span> : null)}
          />
        </AskShell>
      );
    }

    case 'choose_entities': {
      const { lo, hi } = choiceBounds(ask);
      const dr = ask.delayedReveal;
      return (
        <AskShell
          {...common}
          eyebrow={countPhrase(lo, hi)}
          title={tidy(ask.prompt)}
          detail={dr ? <RevealSummary reveal={dr} owner={playerName(dr.owner)} onPreview={onPreviewCard} /> : undefined}
          peek={tidy(ask.prompt)}
          hint={v.hint}
          hintTone={v.ok ? 'ok' : 'warn'}
          onEnter={confirm}
          wide={isCardList(ask.options) && groupOptions(ask.options).length > 3}
          footer={
            <>
              {skipBtn}
              {primary('Confirm')}
            </>
          }
        >
          <ListPicker options={ask.options} chosen={indices} max={hi === 1 ? 1 : ask.max} onChange={setIndices} onSendNow={sendIndices} onPreview={onPreviewCard} />
        </AskShell>
      );
    }

    case 'order':
      return (
        <AskShell
          {...common}
          eyebrow={ask.sideboardMode ? 'Sideboard' : 'Order'}
          title={tidy(ask.prompt)}
          detail={ask.referenceCardId !== null && nameOf(ask.referenceCardId) ? `For ${nameOf(ask.referenceCardId)}` : undefined}
          peek={tidy(ask.prompt)}
          hint={v.ok ? '' : v.hint}
          onEnter={confirm}
          footer={
            <>
              {skipBtn}
              {primary('Confirm')}
            </>
          }
        >
          <OrderBody ask={ask} draft={draft} setDraft={setDraft} onPreview={onPreviewCard} />
        </AskShell>
      );

    case 'manipulate_list': {
      const order = draft.shape === 'indices' ? draft.indices : [];
      return (
        <AskShell
          {...common}
          eyebrow="Arrange"
          title={tidy(ask.prompt)}
          peek={tidy(ask.prompt)}
          hint={v.ok ? '' : v.hint}
          onEnter={confirm}
          footer={
            <>
              {skipBtn}
              {primary('Confirm')}
            </>
          }
        >
          {ask.toTop && <div className="ask-end">Top</div>}
          <ol className="ask-rows ask-ordered">
            {order.map((id, i) => {
              const o = ask.cards.find((c) => c.id === id);
              if (!o) return null;
              const movable = ask.manipulable.includes(id);
              return (
                <li key={id}>
                  <div className={cx('ask-row ask-order-row', !movable && 'is-fixed')}>
                    <span className="ask-pos">{i + 1}</span>
                    <Thumb name={lookupName(o)} card={visibleCard(o.card)} hidden={optionIsHidden(o)} />
                    <span className="ask-row-text">
                      <span className="ask-row-label">{o.label}</span>
                      {!movable && <span className="ask-row-meta">Stays in place</span>}
                    </span>
                    <PreviewBtn cardId={o.cardId} onPreview={onPreviewCard} label={o.label} />
                    <MoveBtns
                      disabled={!movable}
                      first={i === 0}
                      last={i === order.length - 1}
                      label={o.label}
                      onMove={(d) => setDraft({ shape: 'indices', indices: moveItem(order, i, i + d) })}
                    />
                  </div>
                </li>
              );
            })}
          </ol>
          {ask.toBottom && <div className="ask-end">Bottom</div>}
        </AskShell>
      );
    }

    case 'sideboard':
      return (
        <AskShell
          {...common}
          eyebrow="Between games"
          title="Sideboard for the next game"
          // Forge's sideboard prompt is often just the player's name ("Human").
          detail={/\s/.test(tidy(ask.prompt)) && !state?.players.some((p) => p.name === tidy(ask.prompt)) ? tidy(ask.prompt) : undefined}
          peek="Sideboard for the next game"
          hint={v.hint}
          hintTone={v.ok ? 'ok' : 'warn'}
          onEnter={confirm}
          wide
          footer={
            <>
              {skipBtn}
              {primary('Use this deck')}
            </>
          }
        >
          <SideboardBody ask={ask} chosen={indices} onChange={setIndices} />
        </AskShell>
      );

    case 'assign_damage': {
      const attacker = nameOf(ask.attackerId);
      const amounts = draft.shape === 'amounts' ? draft.amounts : {};
      const sum = amountsTotal(amounts);
      return (
        <AskShell
          {...common}
          eyebrow="Combat damage"
          title={`Assign ${ask.total} damage${attacker ? ` from ${attacker}` : ''}`}
          detail={ask.targets.length > 2 ? 'Split it between the blockers' : undefined}
          peek={`Assign ${ask.total} combat damage`}
          hint={v.hint}
          hintTone={v.ok ? 'ok' : 'warn'}
          onEnter={confirm}
          footer={
            <>
              {skipBtn}
              {primary('Assign')}
            </>
          }
        >
          <Meter value={sum} total={ask.total} />
          <ul className="ask-rows">
            {(ask.targets as DamageTarget[]).map((t) => {
              const n = amounts[String(t.id)] ?? 0;
              const lethal = typeof t.lethal === 'number' ? t.lethal : null;
              const room = Math.min(ask.total, n + (ask.total - sum));
              return (
                <li key={t.id}>
                  <div className={cx('ask-row ask-amount-row', n > 0 && 'is-on')}>
                    {t.defender && t.kind === 'player' ? (
                      <span className="ask-thumb ask-thumb-player" aria-hidden="true">
                        {(playerName(t.playerId) ?? t.label).slice(0, 1)}
                      </span>
                    ) : (
                      <Thumb name={lookupName(t)} card={visibleCard(t.card)} hidden={optionIsHidden(t)} />
                    )}
                    <span className="ask-row-text">
                      <span className="ask-row-label">{t.label}</span>
                      <span className="ask-row-meta">
                        {t.defender ? 'Defending' : 'Blocker'}
                        {lethal !== null && (
                          <>
                            {' · '}
                            <span className={cx(n >= lethal && 'ask-lethal-ok')}>lethal {lethal}</span>
                          </>
                        )}
                      </span>
                    </span>
                    <PreviewBtn cardId={t.cardId} onPreview={onPreviewCard} label={t.label} />
                    {lethal !== null && n < lethal && room >= lethal && (
                      <button type="button" className="btn btn-quiet btn-sm" onClick={() => setDraft({ shape: 'amounts', amounts: setAmount(ask, amounts, t.id, lethal) })}>
                        Lethal
                      </button>
                    )}
                    <Stepper value={n} max={Math.min(amountCap(ask, t.id), n + Math.max(0, ask.total - sum))} label={t.label} onChange={(x) => setDraft({ shape: 'amounts', amounts: setAmount(ask, amounts, t.id, x) })} />
                  </div>
                </li>
              );
            })}
          </ul>
        </AskShell>
      );
    }

    case 'assign_amount': {
      const source = nameOf(ask.sourceCardId);
      const amounts = draft.shape === 'amounts' ? draft.amounts : {};
      const sum = amountsTotal(amounts);
      const what = tidy(ask.label) || 'points';
      return (
        <AskShell
          {...common}
          eyebrow="Distribute"
          title={`Assign ${ask.total} ${what}`}
          detail={[source && `from ${source}`, ask.atLeastOne && 'each gets at least 1'].filter(Boolean).join(' · ') || undefined}
          peek={`Assign ${ask.total} ${what}`}
          hint={v.hint}
          hintTone={v.ok ? 'ok' : 'warn'}
          onEnter={confirm}
          footer={
            <>
              {skipBtn}
              {primary('Confirm')}
            </>
          }
        >
          <Meter value={sum} total={ask.total} />
          <ul className="ask-rows">
            {(ask.targets as AmountTarget[]).map((t) => {
              const n = amounts[String(t.id)] ?? 0;
              const sym = t.kind === 'color' ? colorSymbol(t.label) : null;
              return (
                <li key={t.id}>
                  <div className={cx('ask-row ask-amount-row', n > 0 && 'is-on')}>
                    {sym ? (
                      <span className="ask-thumb ask-thumb-pip">
                        <Pip sym={sym} size="lg" />
                      </span>
                    ) : t.kind === 'player' ? (
                      <span className="ask-thumb ask-thumb-player" aria-hidden="true">
                        {t.label.slice(0, 1)}
                      </span>
                    ) : (
                      <Thumb name={lookupName(t)} card={visibleCard(t.card)} hidden={optionIsHidden(t)} />
                    )}
                    <span className="ask-row-text">
                      <span className="ask-row-label">{t.label}</span>
                      {typeof t.max === 'number' && t.max < ask.total && <span className="ask-row-meta">up to {t.max}</span>}
                    </span>
                    <PreviewBtn cardId={t.cardId} onPreview={onPreviewCard} label={t.label} />
                    <Stepper
                      value={n}
                      min={0}
                      max={Math.min(amountCap(ask, t.id), n + Math.max(0, ask.total - sum))}
                      label={t.label}
                      onChange={(x) => setDraft({ shape: 'amounts', amounts: setAmount(ask, amounts, t.id, x) })}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        </AskShell>
      );
    }
  }
}

function MoveBtns({ disabled, first, last, label, onMove }: { disabled?: boolean; first: boolean; last: boolean; label: string; onMove: (d: -1 | 1) => void }) {
  return (
    <span className="ask-move">
      <button type="button" className="icon-btn" disabled={disabled || first} onClick={() => onMove(-1)} aria-label={`Move ${label} up`}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="m6 15 6-6 6 6" />
        </svg>
      </button>
      <button type="button" className="icon-btn" disabled={disabled || last} onClick={() => onMove(1)} aria-label={`Move ${label} down`}>
        <IconChevronDown size={16} />
      </button>
    </span>
  );
}

function OrderBody({
  ask,
  draft,
  setDraft,
  onPreview,
}: {
  ask: Extract<AskBody, { kind: 'order' }>;
  draft: AskDraft;
  setDraft: (d: AskDraft) => void;
  onPreview?: (id: number) => void;
}) {
  const all = askOptions(ask);
  const ordered = draft.shape === 'order' ? draft.ordered : [];
  const remember = draft.shape === 'order' && draft.remember;
  const pool = all.filter((o) => !ordered.includes(o.id));
  const { lo, hi } = orderBounds(ask);
  const put = (next: number[], rem = remember) => setDraft({ shape: 'order', ordered: next, remember: rem });
  const pureOrder = lo === all.length && hi === all.length;
  const destLabel = tidy(ask.destLabel) || 'Chosen';
  return (
    <>
      <div className="ask-section-label">
        {destLabel}
        <span className="muted"> · first at the top</span>
      </div>
      {ordered.length === 0 ? (
        <p className="ask-empty">{lo > 0 ? `Add ${lo === hi ? lo : `at least ${lo}`} from below` : 'Nothing yet'}</p>
      ) : (
        <ol className="ask-rows ask-ordered">
          {ordered.map((id, i) => {
            const o = all.find((x) => x.id === id);
            if (!o) return null;
            return (
              <li key={id}>
                <div className="ask-row ask-order-row is-on">
                  <span className="ask-pos">{i + 1}</span>
                  {(o.kind === 'card' || o.card) && <Thumb name={lookupName(o)} card={visibleCard(o.card)} hidden={optionIsHidden(o)} />}
                  <span className="ask-row-text">
                    <span className="ask-row-label">
                      <Label text={o.label} />
                    </span>
                  </span>
                  <PreviewBtn cardId={o.cardId} onPreview={onPreview} label={o.label} />
                  <MoveBtns first={i === 0} last={i === ordered.length - 1} label={o.label} onMove={(d) => put(moveItem(ordered, i, i + d))} />
                  {!pureOrder && (
                    <button type="button" className="icon-btn" onClick={() => put(ordered.filter((x) => x !== id))} aria-label={`Remove ${o.label}`}>
                      <IconX size={15} />
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}
      {pool.length > 0 && (
        <>
          <div className="ask-section-label">Not chosen</div>
          <ul className="ask-rows">
            {pool.map((o) => (
              <li key={o.id}>
                <button
                  type="button"
                  className="ask-opt ask-row ask-pool-row"
                  disabled={ordered.length >= hi}
                 
                  onClick={() => put([...ordered, o.id])}
                >
                  <span className="ask-pos ask-pos-add" aria-hidden="true">
                    <IconPlus size={13} />
                  </span>
                  {(o.kind === 'card' || o.card) && <Thumb name={lookupName(o)} card={visibleCard(o.card)} hidden={optionIsHidden(o)} />}
                  <span className="ask-row-text">
                    <span className="ask-row-label">
                      <Label text={o.label} />
                    </span>
                  </span>
                  <PreviewBtn cardId={o.cardId} onPreview={onPreview} label={o.label} />
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {ask.showRemember && (
        <label className="ask-check">
          <input type="checkbox" className="ask-check-box" checked={remember} onChange={(e) => put(ordered, e.target.checked)} />
          <span>Remember this order</span>
        </label>
      )}
    </>
  );
}

function SideboardBody({ ask, chosen, onChange }: { ask: Extract<AskBody, { kind: 'sideboard' }>; chosen: number[]; onChange: (next: number[]) => void }) {
  const all = useMemo(() => askOptions(ask), [ask]);
  const groups = useMemo(() => groupOptions(all), [all]);
  const mainCount = ask.main.length;
  const inDeck = chosen.length;
  const rows = groups.map((g) => {
    const deck = g.ids.filter((id) => chosen.includes(id)).length;
    const orig = g.ids.filter((id) => id < mainCount).length;
    return { g, deck, orig };
  });
  const deckRows = rows.filter((r) => r.orig > 0);
  const sideRows = rows.filter((r) => r.orig === 0);
  const row = ({ g, deck, orig }: (typeof rows)[number]) => (
    <li key={g.key}>
      <div className={cx('ask-row ask-amount-row', deck !== orig && 'is-changed')}>
        <Thumb name={lookupName(g.option)} />
        <span className="ask-row-text">
          <span className="ask-row-label">{lookupName(g.option) ?? g.label}</span>
          <span className="ask-row-meta">
            {g.ids.length} owned
            {deck !== orig && (
              <span className={deck > orig ? 'ask-delta-up' : 'ask-delta-down'}>
                {' · '}
                {deck > orig ? '+' : ''}
                {deck - orig}
              </span>
            )}
          </span>
        </span>
        <Stepper
          value={deck}
          max={g.ids.length}
          label={g.label}
          onChange={(n) => {
            let next = [...chosen];
            while (n > next.filter((id) => g.ids.includes(id)).length) {
              const add = g.ids.find((id) => !next.includes(id));
              if (add === undefined) break;
              next = [...next, add];
            }
            while (n < next.filter((id) => g.ids.includes(id)).length) next = removeFromGroup(next, g.ids);
            onChange(next.sort((a, b) => a - b));
          }}
        />
      </div>
    </li>
  );
  return (
    <>
      <div className="ask-section-label">
        Deck <span className="muted">· {inDeck} cards</span>
      </div>
      <ul className="ask-rows ask-rows-dense">{deckRows.map(row)}</ul>
      {sideRows.length > 0 && (
        <>
          <div className="ask-section-label">
            Sideboard <span className="muted">· {ask.side.length} cards</span>
          </div>
          <ul className="ask-rows ask-rows-dense">{sideRows.map(row)}</ul>
        </>
      )}
    </>
  );
}

function RevealSummary({
  reveal,
  owner,
  onPreview,
}: {
  reveal: { cards: AnyCard[]; zones: string[]; messagePrefix: string };
  owner: string | null;
  onPreview?: (id: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const groups = useMemo(() => {
    const m = new Map<string, { key: string; option: AskOption; count: number }>();
    for (const c of reveal.cards) {
      const name = isHidden(c) ? '???' : c.name || 'Face-down card';
      const g = m.get(name);
      if (g) g.count++;
      else m.set(name, { key: name, option: { id: c.id, label: name, kind: 'card', cardId: c.id, card: c }, count: 1 });
    }
    return [...m.values()];
  }, [reveal.cards]);
  const zone = reveal.zones.join(' and ') || 'zone';
  return (
    <div className="ask-reveal">
      <button type="button" className="ask-reveal-toggle" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <IconEye size={14} />
        <span>
          Looking at {reveal.cards.length} card{reveal.cards.length === 1 ? '' : 's'} in {owner ? `${owner}’s ` : ''}
          {zone}
        </span>
        <IconChevronDown size={14} className={cx('ask-caret', open && 'is-open')} />
      </button>
      {open && <CardStrip cards={groups} onPreview={onPreview} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Keep / mulligan and play / draw — `input`s, raised as first-class dialogs
// ---------------------------------------------------------------------------

function handOf(state: GameStateBody | null, seat: number | null | undefined): Card[] {
  if (!state) return [];
  const p =
    (seat !== null && seat !== undefined ? state.players.find((x) => x.id === seat) : undefined) ??
    state.players.find((x) => x.zones.hand.cards.some((c) => !isHidden(c)));
  return (p?.zones.hand.cards ?? []).filter((c): c is Card => !isHidden(c));
}

export function OpeningDialog({ onConcede = null, ...props }: OpeningDialogProps) {
  return (
    <ConcedeContext.Provider value={onConcede}>
      <OpeningDialogInner {...props} />
    </ConcedeContext.Provider>
  );
}

function OpeningDialogInner({ input, state, seat, onChoose, onPreviewCard }: OpeningDialogProps) {
  const kind = openingKind(input, state);
  const hand = useMemo(() => handOf(state, seat), [state, seat]);
  const [sent, setSent] = useState(false);
  const sentRef = useRef(false);
  useEffect(() => prefetchCards(hand.map((c) => c.name).filter(Boolean)), [hand]);
  const choose = (b: 'ok' | 'cancel') => {
    if (sentRef.current) return;
    sentRef.current = true;
    setSent(true);
    onChoose(b);
  };
  const focus = input.buttons.focus === 'cancel' ? 'cancel' : 'ok';
  const lines = input.prompt
    .split(/\n+/)
    .map((l) => tidy(l))
    .filter(Boolean);
  const key = `${kind ?? 'input'}-${input.buttons.ok.label}-${input.prompt}`;
  // 1 = the engine's OK (Keep / Play), 2 = its other button (Mulligan / Draw), endstep-style.
  const chooseRef = useRef(choose);
  chooseRef.current = choose;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest?.('.sheet') || t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement) return;
      if (e.key === '1' || e.key === '2') {
        e.preventDefault();
        e.stopPropagation();
        chooseRef.current(e.key === '1' ? 'ok' : 'cancel');
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  if (kind === 'play_draw') {
    const question = lines[lines.length - 1] ?? 'Play or draw?';
    const context = lines.length > 1 ? lines.slice(0, -1).join(' ') : undefined;
    return (
      <AskShell
        shellKey={key}
        eyebrow="Before the game"
        detail={context}
        title={question}
        peek={question}
        onEnter={() => choose(focus)}
        footer={null}
      >
        <div className="ask-big-choices">
          <button type="button" className={cx('ask-opt ask-big', focus === 'ok' && 'is-default')} disabled={sent} onClick={() => choose('ok')} data-autofocus={focus === 'ok' ? '' : undefined}>
            <span className="ask-big-icon">
              <IconPlay size={22} />
            </span>
            <span className="ask-big-label">
              {input.buttons.ok.label} <kbd className="ask-kbd">1</kbd>
            </span>
            <span className="ask-big-sub">Take the first turn</span>
          </button>
          <button type="button" className={cx('ask-opt ask-big', focus === 'cancel' && 'is-default')} disabled={sent} onClick={() => choose('cancel')} data-autofocus={focus === 'cancel' ? '' : undefined}>
            <span className="ask-big-icon">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="6" y="3" width="12" height="16" rx="2" />
                <path d="M12 8v6M9 11l3 3 3-3" />
              </svg>
            </span>
            <span className="ask-big-label">
              {input.buttons.cancel.label} <kbd className="ask-kbd">2</kbd>
            </span>
            <span className="ask-big-sub">Go second, draw on your first turn</span>
          </button>
        </div>
      </AskShell>
    );
  }

  // Keep / mulligan (and any other two-button opening input, verbatim).
  const lands = hand.filter((c) => typeKind(c.types) === 'land').length;
  const n = hand.length;
  const okLabel = kind === 'mulligan' && n > 0 ? `${input.buttons.ok.label} ${n}` : input.buttons.ok.label;
  const mull = kind === 'mulligan';
  // endstep: "Opening Hand / Keep this 7-card hand, or mulligan?"
  const title = mull ? 'Opening hand' : lines[lines.length - 1] ?? 'Choose';
  const context = lines.length > 1 ? lines.slice(0, -1).join(' ').replace(/^Human,\s*/i, '').replace(/^you are/i, 'You are') : '';
  return (
    <AskShell
      shellKey={key}
      eyebrow={mull ? (n > 0 ? `${n} cards · ${lands} land${lands === 1 ? '' : 's'}${context ? ` · ${context}` : ''}` : context || 'Before the game') : 'Decide'}
      title={<span className={cx(mull && 'ask-title-serif')}>{title}</span>}
      detail={mull ? (n > 0 ? `Keep this ${n}-card hand, or mulligan?` : 'Keep this hand, or mulligan?') : undefined}
      peek={mull ? 'Keep or mulligan?' : title}
      onEnter={() => choose(focus)}
      wide
      footer={
        <>
          <button type="button" className={cx('btn ask-btn ask-btn-big ask-btn-second', mull ? 'btn-outline' : focus === 'cancel' ? 'btn-primary' : 'btn-quiet')} disabled={sent} onClick={() => choose('cancel')}>
            {input.buttons.cancel.label} <kbd className="ask-kbd">2</kbd>
          </button>
          <button type="button" className={cx('btn ask-btn ask-btn-big', mull ? 'btn-keep' : focus === 'cancel' ? 'btn-quiet' : 'btn-primary')} disabled={sent} onClick={() => choose('ok')} data-autofocus="">
            {okLabel} <kbd className="ask-kbd">1</kbd>
          </button>
        </>
      }
    >
      {hand.length > 0 ? (
        <ul className="ask-cards ask-cards-static ask-hand">
          {hand.map((c) => (
            <li key={c.id}>
              <StaticCard cardId={c.id} onPreview={onPreviewCard} label={c.name || 'Card'}>
                <CardFace name={c.name} card={c} label={c.name || 'Card'} />
              </StaticCard>
            </li>
          ))}
        </ul>
      ) : (
        <p className="ask-empty">Your hand will appear here.</p>
      )}
    </AskShell>
  );
}

export { openingKind };

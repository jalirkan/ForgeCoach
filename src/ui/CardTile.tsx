/*
 * ForgeCoach — ui/CardTile.tsx
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Compact, readable card tiles. Memoised on the fields they draw, so scrubbing
 * between states only re-renders tiles whose card actually changed.
 */
import { memo, useCallback, useRef, type KeyboardEvent, type MouseEvent, type PointerEvent } from 'react';
import type { AnyCard, Card } from '../protocol.ts';
import { isHidden, keywordsOf } from '../protocol.ts';
import { useCardInfo } from './cardData.ts';
import { useBoardStateRef, useCardActions, usePlay, type PlayMark } from './cardContext.ts';
import { ManaCost } from './Mana.tsx';
import { IconInfo, IconMoon, IconShield, IconSword, IconTapped, TypeGlyph } from './Icons.tsx';
import { cardColors, colorClass, counterLabel, cx, shortType, typeKind } from './util.ts';

export function displayName(card: Card): string {
  if (card.name) return card.name;
  if (card.alt?.name) return `${card.alt.name} (face down)`;
  return 'Face-down card';
}

/** Everything a tile draws, as one comparable string. */
export function tileSig(c: AnyCard | undefined): string {
  if (!c) return '';
  if (isHidden(c)) return `h${c.id}`;
  return [
    c.id,
    c.name,
    c.tapped ? 1 : 0,
    c.sick ? 1 : 0,
    c.attacking ? 1 : 0,
    c.blocking ? 1 : 0,
    c.damage,
    c.power,
    c.toughness,
    c.loyalty,
    c.types,
    JSON.stringify(c.counters),
    c.attachmentIds.join(','),
    (c.keywords ?? []).join(','),
  ].join('|');
}

function useOpen(card: AnyCard) {
  const actions = useCardActions();
  const stateRef = useBoardStateRef();
  const play = usePlay();
  const cardRef = useRef(card);
  cardRef.current = card;
  const open = useCallback(() => actions.open(cardRef.current, stateRef.current), [actions, stateRef]);
  const mark: PlayMark = play ? play.mark(card) : null;
  const chosen = play ? play.chosen(card) : null;
  const hint = play && !mark ? false : play ? play.hint(card) : false;
  // Long-press (touch) opens details without acting; the click that follows is swallowed.
  const pressTimer = useRef<number | null>(null);
  const longPressed = useRef(false);
  const activate = useCallback(() => {
    if (longPressed.current) {
      longPressed.current = false;
      return;
    }
    if (play && mark) play.click(cardRef.current);
    else open();
  }, [play, mark, open]);
  // Enter activates a focused tile. In play, Space is left to the table's
  // primary button (click a land, then Space = OK); in replay it opens too.
  const onKey = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Enter' || (e.key === ' ' && !play)) {
        e.preventDefault();
        e.stopPropagation();
        activate();
      }
    },
    [activate, play],
  );
  const name = !isHidden(card) ? (card as Card).name || (card as Card).alt?.name || null : null;
  const onEnter = useCallback(
    (e: PointerEvent<HTMLElement>) => {
      if (e.pointerType === 'mouse' && name) actions.hover(name, e.currentTarget.getBoundingClientRect());
    },
    [actions, name],
  );
  const clearPress = useCallback(() => {
    if (pressTimer.current !== null) window.clearTimeout(pressTimer.current);
    pressTimer.current = null;
  }, []);
  const onLeave = useCallback(() => {
    clearPress();
    actions.hover(null);
  }, [actions, clearPress]);
  const onDown = useCallback(
    (e: PointerEvent<HTMLElement>) => {
      longPressed.current = false;
      if (!play || e.pointerType === 'mouse') return;
      clearPress();
      pressTimer.current = window.setTimeout(() => {
        longPressed.current = true;
        open();
      }, 480);
    },
    [play, open, clearPress],
  );
  const onContext = useCallback(
    (e: MouseEvent<HTMLElement>) => {
      if (!play) return;
      e.preventDefault();
      clearPress();
      open();
    },
    [play, open, clearPress],
  );
  return { open, activate, onKey, onEnter, onLeave, onDown, onUp: clearPress, onContext, mark, hint, chosen, playing: !!play };
}

function ptClass(now: string | null, printed: string | undefined): string {
  if (!now || !printed) return '';
  const a = Number(now);
  const b = Number(printed);
  if (Number.isNaN(a) || Number.isNaN(b) || a === b) return '';
  return a > b ? 'up' : 'down';
}

interface TileProps {
  card: Card;
  attachments?: Card[];
  /** Hand tiles skip battlefield-only badges. */
  inHand?: boolean;
}

function TileInner({ card, attachments, inHand }: TileProps) {
  const name = card.name || card.alt?.name || '';
  const info = useCardInfo(name || null);
  const { open, activate, onKey, onEnter, onLeave, onDown, onUp, onContext, mark, hint, chosen, playing } = useOpen(card);
  const attacking = card.attacking || chosen === 'attack';
  const blocking = card.blocking || chosen === 'block';
  const kind = typeKind(card.types || info?.typeLine);
  const colors = cardColors(card, info?.producedMana, info?.colors);
  const art = info?.image?.artCrop;
  const isCreature = kind === 'creature' || (card.power !== null && card.toughness !== null && !inHand);
  const kw = keywordsOf(card);
  const counters = Object.entries(card.counters ?? {}).filter(([, n]) => n > 0);
  const label = `${displayName(card)}${card.tapped ? ', tapped' : ''}${card.sick && !inHand ? ', summoning sick' : ''}`;
  return (
    <div
      className={cx(
        'tile',
        colorClass(colors),
        !inHand && card.tapped && 'is-tapped',
        attacking && 'is-attacking',
        blocking && 'is-blocking',
        card.token && 'is-token',
        mark === 'select' && 'is-select',
        mark === 'act' && 'is-act',
        hint && 'is-hint',
      )}
      role="button"
      tabIndex={0}
      aria-label={label}
      data-card-id={card.id}
      data-mark={mark ?? undefined}
      onClick={activate}
      onKeyDown={onKey}
      onPointerEnter={onEnter}
      onPointerLeave={onLeave}
      onPointerDown={onDown}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      onContextMenu={onContext}
    >
      {playing && (
        <button
          type="button"
          className="tile-info"
          aria-label={`Details: ${displayName(card)}`}
          tabIndex={-1}
          onClick={(e) => {
            e.stopPropagation();
            open();
          }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <IconInfo size={12} />
        </button>
      )}
      <div className="tile-art">
        <span className="tile-art-fallback">
          <TypeGlyph kind={kind} size={22} />
        </span>
        {art && (
          <img
            src={art}
            alt=""
            loading="lazy"
            decoding="async"
            draggable={false}
            onError={(e) => {
              e.currentTarget.style.display = 'none';
            }}
          />
        )}
        <span className="tile-cost">
          <ManaCost cost={card.manaCost} size="sm" />
        </span>
        {attacking && (
          <span className="tile-flag flag-attack" title="Attacking">
            <IconSword size={11} /> Attacking
          </span>
        )}
        {blocking && (
          <span className="tile-flag flag-block" title="Blocking">
            <IconShield size={11} /> Blocking
          </span>
        )}
        {!inHand && card.tapped && !attacking && !blocking && (
          <span className="tile-flag flag-tapped" title="Tapped">
            <IconTapped size={11} /> Tapped
          </span>
        )}
      </div>
      <div className="tile-body">
        <div className="tile-name">{displayName(card)}</div>
        <div className="tile-type">
          <TypeGlyph kind={kind} size={10} />
          <span>{shortType(card.types || info?.typeLine) || '—'}</span>
        </div>
        <div className="tile-foot">
          <span className="tile-badges">
            {!inHand && card.sick && isCreature && (
              <span className="badge badge-sick" title="Summoning sick: can't attack or use {T} abilities">
                <IconMoon size={10} /> Sick
              </span>
            )}
            {card.damage > 0 && (
              <span className="badge badge-dmg" title={`${card.damage} damage marked`}>
                {card.damage} dmg
              </span>
            )}
            {counters.map(([k, n]) => (
              <span key={k} className="badge badge-counter" title={`${n} ${counterLabel(k)} counter${n > 1 ? 's' : ''}`}>
                {k === 'P1P1' || k === 'M1M1' ? `${n}× ${counterLabel(k)}` : `${counterLabel(k)} ${n}`}
              </span>
            ))}
            {card.token && <span className="badge badge-muted">Token</span>}
            {kw.slice(0, 2).map((k) => (
              <span key={k} className="badge badge-kw">
                {k.toLowerCase().replace(/_/g, ' ')}
              </span>
            ))}
          </span>
          {card.loyalty !== null && kind === 'planeswalker' ? (
            <span className="pt pt-loyalty">{card.loyalty}</span>
          ) : card.power !== null && card.toughness !== null ? (
            <span className={cx('pt', card.damage > 0 && 'pt-hurt')}>
              <span className={ptClass(card.power, info?.power)}>{card.power}</span>/
              <span className={ptClass(card.toughness, info?.toughness)}>{card.toughness}</span>
            </span>
          ) : null}
        </div>
      </div>
      {attachments && attachments.length > 0 && (
        <div className="tile-attach">
          {attachments.map((a) => (
            <AttachmentChip key={a.id} card={a} />
          ))}
        </div>
      )}
    </div>
  );
}

export const CardTile = memo(TileInner, (a, b) => {
  if (a.inHand !== b.inHand) return false;
  if (tileSig(a.card) !== tileSig(b.card)) return false;
  const aa = a.attachments ?? [];
  const bb = b.attachments ?? [];
  if (aa.length !== bb.length) return false;
  for (let i = 0; i < aa.length; i++) if (tileSig(aa[i]) !== tileSig(bb[i])) return false;
  return true;
});

const AttachmentChip = memo(function AttachmentChip({ card }: { card: Card }) {
  const { open, onKey, onEnter, onLeave } = useOpen(card);
  return (
    <span
      className={cx('attach-chip', card.tapped && 'is-tapped')}
      role="button"
      tabIndex={0}
      onClick={(e) => {
        e.stopPropagation();
        open();
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
        onKey(e);
      }}
      onPointerEnter={onEnter}
      onPointerLeave={onLeave}
    >
      <span className="attach-link" aria-hidden="true">↳</span>
      <span className="attach-name">{displayName(card)}</span>
      {card.tapped && <IconTapped size={10} />}
    </span>
  );
}, (a, b) => tileSig(a.card) === tileSig(b.card));

/** Lands: identical name + tapped state collapse into one chip with a count. */
export const LandChip = memo(
  function LandChip({ cards }: { cards: Card[] }) {
    const first = cards[0]!;
    const info = useCardInfo(first.name || null);
    const { activate, onKey, onEnter, onLeave, onDown, onUp, onContext, mark } = useOpen(first);
    const colors = cardColors(first, info?.producedMana, info?.colors);
    const tapped = first.tapped;
    return (
      <div
        className={cx(
          'land-chip',
          colorClass(colors),
          tapped && 'is-tapped',
          first.attacking && 'is-attacking',
          mark === 'select' && 'is-select',
          mark === 'act' && 'is-act',
        )}
        role="button"
        tabIndex={0}
        aria-label={`${cards.length} ${displayName(first)}${tapped ? ', tapped' : ', untapped'}`}
        data-card-id={first.id}
        data-mark={mark ?? undefined}
        onClick={activate}
        onKeyDown={onKey}
        onPointerEnter={onEnter}
        onPointerLeave={onLeave}
        onPointerDown={onDown}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onContextMenu={onContext}
      >
        <span className="land-dot" aria-hidden="true" />
        <span className="land-name">{displayName(first)}</span>
        {cards.length > 1 && <span className="land-count">×{cards.length}</span>}
        {tapped && (
          <span className="land-tapped" title="Tapped">
            <IconTapped size={11} />
          </span>
        )}
        {first.sick && typeKind(first.types) === 'creature' && <IconMoon size={11} />}
      </div>
    );
  },
  (a, b) => a.cards.length === b.cards.length && a.cards.every((c, i) => tileSig(c) === tileSig(b.cards[i])),
);

/** A face-down card back (opponent hand, hidden cards). */
export function CardBack({ small }: { small?: boolean }) {
  return <span className={cx('card-back', small && 'card-back-sm')} aria-hidden="true" />;
}

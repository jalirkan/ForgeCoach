/*
 * ForgeCoach — ui/CardTile.tsx
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Cards on the table and in the hand, drawn as the real card (Scryfall image)
 * with the live state on top: P/T, counters, damage, loyalty, summoning
 * sickness, combat, tapped (rotated a quarter turn in a slot that already has
 * room for it, so nothing reflows). Until the image arrives — or when there is
 * none (unknown name, face-down, most tokens) — the same card-sized box shows
 * a text face. Memoised on the fields they draw, so scrubbing between states
 * only re-renders tiles whose card actually changed.
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent, type PointerEvent } from 'react';
import type { AnyCard, Card } from '../protocol.ts';
import { isHidden } from '../protocol.ts';
import type { CardInfo } from '../cards.ts';
import { useCardInfo } from './cardData.ts';
import { createLongPress, pressBuzz, pressTimers } from './longPress.ts';
import { useBoardStateRef, useCardActions, usePlay, type PlayInteraction, type PlayMark } from './cardContext.ts';
import { PILE_SHOWN, pilePlan } from './landPiles.ts';
import { ManaCost } from './Mana.tsx';
import { IconInfo, IconShield, IconSword, TypeGlyph } from './Icons.tsx';
import { cardColors, colorClass, counterLabel, cx, shortType, typeKind } from './util.ts';

import './cards.css';

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
    c.controller,
    JSON.stringify(c.counters),
    c.attachmentIds.join(','),
    (c.keywords ?? []).join(','),
  ].join('|');
}

/** Whose side a permanent is drawn on: framed gold (yours) or crimson (theirs). */
export type TileSide = 'me' | 'opp';

/**
 * What a click (or Enter) on a card does: in play, a card the play context
 * marks (`act`: a click plausibly drives it; `select`: the engine is asking
 * for it) sends `act: clickCard` through the context; everything else, and
 * every card in a replay or a watch view (no play context), opens its
 * details. Tiles, land piles and the aura / equipment chips under a host all
 * go through here.
 */
export function activateCard(
  card: AnyCard,
  play: PlayInteraction | null,
  open: () => void,
  onClicked?: (card: AnyCard) => void,
): 'act' | 'open' {
  if (play && play.mark(card)) {
    onClicked?.(card);
    play.click(card);
    return 'act';
  }
  open();
  return 'open';
}

function useOpen(card: AnyCard, onClicked?: (card: AnyCard) => void) {
  const actions = useCardActions();
  const stateRef = useBoardStateRef();
  const play = usePlay();
  const cardRef = useRef(card);
  cardRef.current = card;
  const open = useCallback(() => actions.open(cardRef.current, stateRef.current), [actions, stateRef]);
  const mark: PlayMark = play ? play.mark(card) : null;
  const chosen = play ? play.chosen(card) : null;
  const hint = play && !mark ? false : play ? play.hint(card) : false;
  // Long-press (touch) opens details without acting; the click that follows is
  // swallowed. A finger that moves (scrolling the hand) is not a long-press (ui/longPress.ts).
  const openRef = useRef(open);
  openRef.current = open;
  const press = useMemo(() => createLongPress({ onLong: () => openRef.current(), timers: pressTimers, haptic: pressBuzz }), []);
  useEffect(() => () => press.cancel(), [press]);
  const activate = useCallback(() => {
    if (press.takeClick()) return;
    activateCard(cardRef.current, play, open, onClicked);
  }, [play, open, onClicked, press]);
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
  const clearPress = useCallback(() => press.cancel(), [press]);
  const onLeave = useCallback(
    (e: PointerEvent<HTMLElement>) => {
      // A touch that slides off the tile cancels; the mouse only ends its hover.
      if (e.pointerType !== 'mouse') press.cancel();
      actions.hover(null);
    },
    [actions, press],
  );
  const onDown = useCallback(
    (e: PointerEvent<HTMLElement>) => {
      if (play) press.down(e.clientX, e.clientY, e.pointerType, e.isPrimary);
    },
    [play, press],
  );
  const onMove = useCallback((e: PointerEvent<HTMLElement>) => press.move(e.clientX, e.clientY), [press]);
  const onContext = useCallback(
    (e: MouseEvent<HTMLElement>) => {
      if (!play) return;
      e.preventDefault();
      // Touch browsers fire contextmenu on their own long-press; the timer already opened it.
      if (press.context((e.nativeEvent as globalThis.PointerEvent).pointerType)) open();
    },
    [play, open, press],
  );
  const handlers = {
    onClick: activate,
    onKeyDown: onKey,
    onPointerEnter: onEnter,
    onPointerLeave: onLeave,
    onPointerDown: onDown,
    onPointerMove: onMove,
    onPointerUp: clearPress,
    onPointerCancel: clearPress,
    onContextMenu: onContext,
  };
  return { open, activate, onKey, onEnter, onLeave, handlers, mark, hint, chosen, playing: !!play };
}

/** "up" / "down" against the printed value; '' when equal or not numeric. */
function ptClass(now: string | null, printed: string | undefined): '' | 'up' | 'down' {
  if (!now || !printed) return '';
  const a = Number(now);
  const b = Number(printed);
  if (Number.isNaN(a) || Number.isNaN(b) || a === b) return '';
  return a > b ? 'up' : 'down';
}

// ---------------------------------------------------------------------------
// The card itself: the Scryfall image over a text face of the same size.

/** Image URLs for a visible, face-up card (none for face-down cards). */
function imageOf(card: Card, info: CardInfo | undefined): { src: string; srcSet?: string } | null {
  if (!card.name || card.faceDown || !info?.found) return null;
  const img = info.image;
  if (!img) return null;
  const src = img.normal ?? img.small ?? img.large;
  if (!src) return null;
  const set = [img.small && `${img.small} 146w`, img.normal && `${img.normal} 488w`, img.large && `${img.large} 672w`].filter(Boolean).join(', ');
  return { src, srcSet: set || undefined };
}

/**
 * The card face: a text face (name, cost, art crop, type) that is always there
 * and sized like a card, and the full card image on top of it once it loads.
 */
export function CardFace({ card, info, kind, eager }: { card: Card; info: CardInfo | undefined; kind: ReturnType<typeof typeKind>; eager?: boolean }) {
  const img = imageOf(card, info);
  const [state, setState] = useState<{ src: string; ok: boolean | null } | null>(null);
  const status = state && img && state.src === img.src ? state.ok : null;
  const art = info?.image?.artCrop;
  return (
    <div className={cx('tile-card', status === true && 'has-img')}>
      <div className="tile-face">
        <div className="tile-head">
          <span className="tile-name">{displayName(card)}</span>
          <span className="tile-cost">
            <ManaCost cost={card.manaCost} size="sm" />
          </span>
        </div>
        <div className="tile-art">
          <span className="tile-art-fallback">
            <TypeGlyph kind={kind} size={18} />
          </span>
          {art && !card.faceDown && card.name && (
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
        </div>
        <div className="tile-type">
          <TypeGlyph kind={kind} size={9} />
          <span>{shortType(card.types || info?.typeLine) || '—'}</span>
        </div>
      </div>
      {img && status !== false && (
        <img
          className="tile-img"
          src={img.src}
          srcSet={img.srcSet}
          sizes="(max-width: 560px) 90px, 170px"
          alt=""
          loading={eager ? 'eager' : 'lazy'}
          decoding="async"
          draggable={false}
          ref={(el) => {
            // A cached image can finish before React attaches onLoad.
            if (el && el.complete && el.naturalWidth > 0 && status !== true) setState({ src: img.src, ok: true });
          }}
          onLoad={() => setState({ src: img.src, ok: true })}
          onError={() => setState({ src: img.src, ok: false })}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

interface TileProps {
  card: Card;
  attachments?: Card[];
  /** Hand tiles skip battlefield-only badges. */
  inHand?: boolean;
  /** Ownership frame on the battlefield (gold for yours, crimson for theirs). */
  side?: TileSide;
}

function counterText(k: string, n: number): string {
  if (k === 'P1P1') return `+${n}/+${n}`;
  if (k === 'M1M1') return `−${n}/−${n}`;
  if (/^[+-]\d+\/[+-]\d+$/.test(k)) return n > 1 ? `${n}× ${k}` : k;
  return `${counterLabel(k)} ${n}`;
}

function TileInner({ card, attachments, inHand, side }: TileProps) {
  const name = card.name || card.alt?.name || '';
  const info = useCardInfo(name || null);
  const { open, handlers, mark, hint, chosen, playing } = useOpen(card);
  const attacking = card.attacking || chosen === 'attack';
  const blocking = card.blocking || chosen === 'block';
  const kind = typeKind(card.types || info?.typeLine);
  const colors = cardColors(card, info?.producedMana, info?.colors);
  const isCreature = kind === 'creature' || (card.power !== null && card.toughness !== null && !inHand);
  const counters = Object.entries(card.counters ?? {}).filter(([k, n]) => n > 0 && !(k === 'LOYALTY' && card.loyalty !== null));
  const tapped = !inHand && card.tapped;
  const label = `${displayName(card)}${tapped ? ', tapped' : ''}${card.sick && !inHand && isCreature ? ', summoning sick' : ''}${attacking ? ', attacking' : ''}${blocking ? ', blocking' : ''}`;
  const pUp = ptClass(card.power, info?.power);
  const tUp = ptClass(card.toughness, info?.toughness);
  const ptTone = card.damage > 0 || pUp === 'down' || tUp === 'down' ? 'down' : pUp === 'up' || tUp === 'up' ? 'up' : '';
  const showPt = card.power !== null && card.toughness !== null && isCreature;
  const showLoyalty = card.loyalty !== null && kind === 'planeswalker';
  return (
    <div
      className={cx(
        'tile',
        colorClass(colors),
        side && `own-${side}`,
        inHand && 'is-hand',
        tapped && 'is-tapped',
        attacking && 'is-attacking',
        blocking && 'is-blocking',
        card.token && 'is-token',
        mark === 'select' && 'is-select',
        mark === 'act' && 'is-act',
        hint && 'is-hint',
        attachments && attachments.length > 0 && 'has-attach',
      )}
      role="button"
      tabIndex={0}
      aria-label={label}
      data-card-id={card.id}
      data-mark={mark ?? undefined}
      {...handlers}
    >
      <div className="tile-slot">
        <CardFace card={card} info={info} kind={kind} eager={inHand} />
        <div className="tile-ovl">
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
          {(attacking || blocking) && (
            <span className={cx('tile-flag', attacking ? 'flag-attack' : 'flag-block')} title={attacking ? 'Attacking' : 'Blocking'}>
              {attacking ? <IconSword size={11} /> : <IconShield size={11} />}
              <span className="flag-text">{attacking ? 'Attack' : 'Block'}</span>
            </span>
          )}
          {counters.length > 0 && (
            <span className="tile-marks">
              {counters.map(([k, n]) => (
                <span key={k} className={cx('mk', k === 'M1M1' ? 'mk-minus' : 'mk-counter')} title={`${n} ${counterLabel(k)} counter${n > 1 ? 's' : ''}`}>
                  {counterText(k, n)}
                </span>
              ))}
            </span>
          )}
          {/* Summoning sick: a big "Zz" over the art (endstep-style). */}
          {!inHand && card.sick && isCreature && (
            <span className="tile-zz" title="Summoning sick: can't attack or use {T} abilities" aria-hidden="true">
              Zz
            </span>
          )}
          {showLoyalty ? (
            <span className="tile-pt pt-loyalty" title="Loyalty">
              {card.loyalty}
            </span>
          ) : showPt ? (
            <span className={cx('tile-pt', ptTone && `pt-${ptTone}`)} title={`${card.power}/${card.toughness}${card.damage > 0 ? `, ${card.damage} damage` : ''}`}>
              <span className={pUp}>{card.power}</span>/<span className={tUp}>{card.toughness}</span>
            </span>
          ) : null}
          {!inHand && card.damage > 0 && (
            <span className="tile-dmg" title={`${card.damage} damage marked`}>
              {card.damage}
            </span>
          )}
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
  if (a.inHand !== b.inHand || a.side !== b.side) return false;
  if (tileSig(a.card) !== tileSig(b.card)) return false;
  const aa = a.attachments ?? [];
  const bb = b.attachments ?? [];
  if (aa.length !== bb.length) return false;
  for (let i = 0; i < aa.length; i++) if (tileSig(aa[i]) !== tileSig(bb[i])) return false;
  return true;
});

/** "Equipped creature gets +1/+2." — the line of an attachment that says what it does to its host. */
function hostEffect(info: CardInfo | undefined): string | null {
  const text = info?.oracleText ?? '';
  const m = /(?:^|\n)((?:Equipped|Enchanted|Fortified) [a-z]+[^.\n]*\.)/.exec(text);
  return m ? m[1]! : null;
}

/**
 * An aura or equipment, tucked under its host: the edge of the card showing
 * below it, labelled with its name and what it does to the host.
 *
 * It is a card of its own for clicks: the same play context as a tile decides
 * what a click does (`activateCard`), so in play an equipment you control can
 * be clicked to Equip or to use its ability, and an attached card the engine
 * asks for (a target, "choose an artifact to sacrifice") can be chosen; it then
 * carries the same `is-act` / `is-select` marks as a tile. Long-press (touch)
 * and right-click always open its details; Enter acts like a click. With no
 * play context (replay, watch) a click opens details, as before. Its own
 * events never reach the host tile.
 */
const AttachmentChip = memo(
  function AttachmentChip({ card }: { card: Card }) {
    const info = useCardInfo(card.name || null);
    const { handlers, mark, playing } = useOpen(card);
    const colors = cardColors(card, info?.producedMana, info?.colors);
    const effect = hostEffect(info);
    // The host tile must not see the chip's click, press or context menu (its
    // own long-press would start). Keys: in replay none leaves the chip (as
    // before); in play Enter is stopped by the shared key handler and other
    // keys (Space = OK) bubble on as from a tile.
    const stop =
      <E extends { stopPropagation(): void }>(h: (e: E) => void) =>
      (e: E) => {
        e.stopPropagation();
        h(e);
      };
    const what = mark === 'select' ? ', selectable' : '';
    return (
      <span
        className={cx('attach-chip', colorClass(colors), card.tapped && 'is-tapped', mark === 'select' && 'is-select', mark === 'act' && 'is-act')}
        role="button"
        tabIndex={0}
        aria-label={`Attached: ${displayName(card)}${card.tapped ? ', tapped' : ''}${what}${effect ? ` — ${effect}` : ''}`}
        title={`${displayName(card)}${effect ? ` — ${effect}` : ''}`}
        data-card-id={card.id}
        data-mark={mark ?? undefined}
        onClick={stop(handlers.onClick)}
        onKeyDown={playing ? handlers.onKeyDown : stop(handlers.onKeyDown)}
        onPointerEnter={handlers.onPointerEnter}
        onPointerLeave={handlers.onPointerLeave}
        onPointerDown={stop(handlers.onPointerDown)}
        onPointerMove={stop(handlers.onPointerMove)}
        onPointerUp={stop(handlers.onPointerUp)}
        onPointerCancel={stop(handlers.onPointerCancel)}
        onContextMenu={stop(handlers.onContextMenu)}
      >
        <span className="attach-name">{displayName(card)}</span>
        {effect && <span className="attach-effect">{effect}</span>}
      </span>
    );
  },
  (a, b) => tileSig(a.card) === tileSig(b.card),
);

// ---------------------------------------------------------------------------
// Lands: identical lands as one fanned pile.

/**
 * Identical lands (basics of one name and tapped state, nothing on them) as
 * one fanned pile with a count. They are interchangeable, so the pile never
 * opens up: a click acts on one of them (landPiles.ts `pilePlan`).
 * - The engine asks you to choose lands (sacrifice, target, a cost): each tap
 *   selects one more selectable land from the pile; the badge shows how many
 *   of the pile you have sent.
 * - Paying mana: a tap taps one untapped land of the pile.
 * - Otherwise a tap (or a long-press, always) opens the land's details.
 * Every land keeps its own id: the pile lists them in `data-card-ids`, and
 * `data-card-id` is the land the next tap goes to.
 */
export const LandPile = memo(
  function LandPile({ cards, side }: { cards: Card[]; side?: TileSide }) {
    if (cards.length === 1) return <CardTile card={cards[0]!} side={side} />;
    return <PileStack cards={cards} side={side} />;
  },
  (a, b) => a.side === b.side && a.cards.length === b.cards.length && a.cards.every((c, i) => tileSig(c) === tileSig(b.cards[i])),
);

function PileStack({ cards, side }: { cards: Card[]; side?: TileSide }) {
  const play = usePlay();
  const ids = cards.map((c) => c.id);
  const marks = cards.map((c) => (play ? play.mark(c) : null));
  // The lands this pile has sent while the engine's selectable set stayed the same.
  const selKey = ids.filter((_, i) => marks[i] === 'select').join(',');
  const tried = useRef<{ key: string; ids: Set<number> }>({ key: '', ids: new Set() });
  if (tried.current.key !== selKey) tried.current = { key: selKey, ids: new Set() };
  const plan = pilePlan(ids, marks, tried.current.ids);
  const top = cards[plan.top]!;
  const restart = useRef(plan.restart);
  restart.current = plan.restart;
  const onClicked = useCallback((c: AnyCard) => {
    const t = tried.current;
    if (!t.key) return;
    if (restart.current) t.ids = new Set();
    t.ids.add(c.id);
  }, []);
  const info = useCardInfo(top.name || null);
  const { handlers, mark } = useOpen(top, onClicked);
  const kind = typeKind(top.types || info?.typeLine);
  const colors = cardColors(top, info?.producedMana, info?.colors);
  const shown = Math.min(cards.length, PILE_SHOWN);
  const tapped = top.tapped;
  const sent = plan.select ? ids.filter((id) => tried.current.ids.has(id)).length : 0;
  return (
    <div
      className={cx('tile', 'land-pile', colorClass(colors), side && `own-${side}`, tapped && 'is-tapped', mark === 'select' && 'is-select', mark === 'act' && 'is-act')}
      role="button"
      tabIndex={0}
      aria-label={`${cards.length} ${displayName(top)}${tapped ? ', tapped' : ', untapped'}${plan.select ? `, ${plan.selectable} selectable: tap to select one` : ''}`}
      data-card-id={top.id}
      data-card-ids={ids.join(',')}
      data-mark={mark ?? undefined}
      style={{ '--pile': shown - 1 } as CSSProperties}
      {...handlers}
    >
      <div className="tile-slot">
        {Array.from({ length: shown }, (_, i) => (
          <div key={i} className="pile-item" style={{ '--i': i } as CSSProperties}>
            <CardFace card={top} info={info} kind={kind} />
          </div>
        ))}
        <div className="tile-ovl">
          <span className="pile-count" title={`${cards.length} ${displayName(top)}`}>
            ×{cards.length}
          </span>
          {plan.select && sent > 0 && (
            <span className="pile-sent" title={`${sent} of these sent as a choice`}>
              {sent} picked
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

/** Kept for callers of the old chip name. */
export const LandChip = LandPile;

/** A face-down card back (opponent hand, hidden cards). */
export function CardBack({ small }: { small?: boolean }) {
  return <span className={cx('card-back', small && 'card-back-sm')} aria-hidden="true" />;
}

/*
 * ForgeCoach — ui/Board.tsx
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The table at one state: opponent on top, you at the bottom, with the turn
 * header, stack and combat between them.
 */
import { memo, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { AnyCard, Card, GameStateBody, PlayerState } from '../protocol.ts';
import { isHidden, MANA_COLORS } from '../protocol.ts';
import type { GameLog } from '../log.ts';
import { cardIndex, cardName, phaseLabel } from '../decisions.ts';
import { chosenColors, manaSummary, turnFacts, type ManaSource } from '../state.ts';
import { cachedMap, useCardsVersion } from './cardData.ts';
import { useCardActions, usePlay } from './cardContext.ts';
import { CardBack, CardTile, LandPile, displayName } from './CardTile.tsx';
import { IconHeart, IconLayers, IconShield, IconSword } from './Icons.tsx';
import { Pip } from './Mana.tsx';
import { ZoneViewer, type ViewableZone } from './ZoneViewer.tsx';
import { groupLands, pileWeight } from './landPiles.ts';
import { edgeFade, phoneSideFit } from './boardFit.ts';
import { cx, stateCardNames, typeKind } from './util.ts';
import { seatDisplayName } from '../play/aiName.ts';

interface BoardProps {
  log: GameLog;
  state: GameStateBody;
  frameIndex: number;
  seat: number;
  /** Play mode draws the hand in its own dock. */
  hideHand?: boolean;
  /** Drawn over the table, scrolling with it (play: the combat lines). */
  overlay?: ReactNode;
}

export function Board({ log, state, frameIndex, seat, hideHand, overlay }: BoardProps) {
  const me = state.players.find((p) => p.id === seat) ?? state.players[0];
  const opps = state.players.filter((p) => p !== me);
  const byId = useMemo(() => {
    const m = new Map<number, Card>();
    for (const p of state.players) for (const c of p.zones.battlefield.cards) if (!isHidden(c)) m.set(c.id, c as Card);
    return m;
  }, [state]);

  if (!me) {
    return (
      <div className="board board-empty">
        <p className="muted">No players in this state yet — the game hasn't started.</p>
      </div>
    );
  }
  return (
    <div className="board">
      {opps.map((p) => (
        <PlayerArea key={p.id} player={p} state={state} log={log} frameIndex={frameIndex} seat={seat} byId={byId} top />
      ))}
      <Midline state={state} seat={seat} />
      <PlayerArea player={me} state={state} log={log} frameIndex={frameIndex} seat={seat} byId={byId} hideHand={hideHand} />
      {overlay}
    </div>
  );
}

// ---------------------------------------------------------------------------

function groupBattlefield(player: PlayerState, byId: Map<number, Card>) {
  const landCards: { card: Card; attachments: number }[] = [];
  const creatures: { card: Card; att: Card[] }[] = [];
  const other: { card: Card; att: Card[] }[] = [];
  for (const any of player.zones.battlefield.cards) {
    if (isHidden(any)) continue;
    const c = any as Card;
    if (c.attachedToId !== null && byId.has(c.attachedToId)) continue; // drawn on its host
    const att = c.attachmentIds.map((id) => byId.get(id)).filter((x): x is Card => !!x);
    const kind = typeKind(c.types);
    if (kind === 'land') landCards.push({ card: c, attachments: att.length });
    else if (kind === 'creature') creatures.push({ card: c, att });
    else other.push({ card: c, att });
  }
  return { lands: groupLands(landCards), creatures, other };
}

/** How crowded a row is, in card widths (a tapped card is a card lying down, ~1.4 wide). */
function rowWeight(cards: Card[]): number {
  return cards.reduce((n, c) => n + (c.tapped ? 1.4 : 1), 0);
}
function density(weight: number): string | undefined {
  if (weight > 11) return 'is-crowded';
  if (weight > 7) return 'is-dense';
  return undefined;
}

const PlayerArea = memo(function PlayerArea({
  player,
  state,
  log,
  frameIndex,
  seat,
  byId,
  top,
  hideHand,
}: {
  player: PlayerState;
  state: GameStateBody;
  log: GameLog;
  frameIndex: number;
  seat: number;
  byId: Map<number, Card>;
  top?: boolean;
  hideHand?: boolean;
}) {
  const { lands, creatures, other } = useMemo(() => groupBattlefield(player, byId), [player, byId]);
  const mine = player.id === seat;
  const side = mine ? 'me' : 'opp';
  const permanents = [...creatures, ...other];
  const landWeight = lands.reduce((n, g) => n + pileWeight(g), 0);
  const permWeight = rowWeight(permanents.map((p) => p.card)) + (creatures.length && other.length ? 0.15 : 0);
  const rows = [
    permanents.length > 0 && (
      <Row
        key="p"
        kind="permanents"
        label={other.length && creatures.length ? 'Creatures and other permanents' : creatures.length ? 'Creatures' : 'Other permanents'}
        count={permanents.length}
        dense={density(permWeight)}
      >
        {creatures.map(({ card, att }) => (
          <CardTile key={card.id} card={card} attachments={att} side={side} />
        ))}
        {creatures.length > 0 && other.length > 0 && <span className="bf-gap" aria-hidden="true" />}
        {other.map(({ card, att }) => (
          <CardTile key={card.id} card={card} attachments={att} side={side} />
        ))}
      </Row>
    ),
    lands.length > 0 && (
      <Row key="l" kind="lands" label="Lands" count={lands.reduce((n, g) => n + g.length, 0)} dense={density(landWeight)}>
        {lands.map((g) => (
          <LandPile key={g[0]!.id} cards={g} side={side} />
        ))}
      </Row>
    ),
  ].filter(Boolean);
  if (top) rows.reverse();
  const empty = rows.length === 0;
  // Portrait phones: the rows' height and the side's floor (ui/boardFit.ts, play.css).
  const fit = phoneSideFit({ permanents: permanents.length > 0, lands: lands.length > 0, maxAttach: Math.max(0, ...permanents.map((p) => p.att.length)) });
  return (
    <section
      className={cx('player', top ? 'player-top' : 'player-me', mine && 'is-me')}
      aria-label={`${player.name}'s side`}
      style={{ '--fit-rows': fit.rowsH.toFixed(2), '--fit-pad': `${fit.padPx}px` } as CSSProperties}
    >
      {top && <PlayerHeader player={player} state={state} log={log} frameIndex={frameIndex} seat={seat} />}
      <div
        className="battlefield"
        style={
          {
            // Card widths in the widest row (lands are ~0.8 of a card), and which rows there are
            // (desktop play sizing, ui/cards.css).
            '--slots-row': Math.max(5, permWeight, landWeight * 0.8).toFixed(2),
            // Both rows side by side (a short side on desktop).
            '--slots': Math.max(5, permWeight + landWeight * 0.8 + (permanents.length && lands.length ? 0.6 : 0)).toFixed(2),
            '--ch-lands': lands.length ? 1 : 0,
            '--ch-perm': permanents.length ? 1 : 0,
            '--attach-h': permanents.some((p) => p.att.length > 0) ? '34px' : '0px',
          } as CSSProperties
        }
      >
        {empty ? <div className="bf-empty">No permanents</div> : rows}
      </div>
      {!top && <PlayerHeader player={player} state={state} log={log} frameIndex={frameIndex} seat={seat} />}
      {mine && !hideHand && <Hand player={player} />}
    </section>
  );
});

function Row({ kind, label, count, dense, children }: { kind: 'permanents' | 'lands'; label: string; count: number; dense?: string; children: React.ReactNode }) {
  const fade = useEdgeFade();
  return (
    <div className={cx('bf-row', `bf-row-${kind}`, dense)}>
      <div className="bf-label">
        {label} <span className="bf-count">{count}</span>
      </div>
      {/* bf-chips / bf-tiles: kept class names (the play screen scrolls to the lands row by it). */}
      <div ref={fade.ref} data-fade={fade.edges || undefined} className={cx('bf-cards', kind === 'lands' ? 'bf-chips' : 'bf-tiles')} role="group" aria-label={`${label}: ${count}`}>
        {children}
      </div>
    </div>
  );
}

/** A row that scrolls sideways fades at the edge(s) with more cards past them. */
function useEdgeFade() {
  const ref = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState<ReturnType<typeof edgeFade>>('');
  const update = useRef(() => {
    const el = ref.current;
    if (el) setEdges(edgeFade(el.scrollLeft, el.clientWidth, el.scrollWidth));
  }).current;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.addEventListener('scroll', update, { passive: true });
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    ro?.observe(el);
    return () => {
      el.removeEventListener('scroll', update);
      ro?.disconnect();
    };
  }, [update]);
  // The cards change with every state (a tap lays a card down): measure again after each render.
  useEffect(update);
  return { ref, edges };
}

function Hand({ player }: { player: PlayerState }) {
  const cards = player.zones.hand.cards;
  return (
    <div className="hand">
      <div className="bf-label">
        Your hand <span className="bf-count">{player.zones.hand.count}</span>
      </div>
      {cards.length === 0 ? (
        <div className="bf-empty">Empty hand</div>
      ) : (
        <div className="hand-tiles">
          {cards.map((c) => (isHidden(c) ? <CardBack key={c.id} /> : <CardTile key={c.id} card={c as Card} inHand />))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function PlayerHeader({
  player,
  state,
  log,
  frameIndex,
  seat,
}: {
  player: PlayerState;
  state: GameStateBody;
  log: GameLog;
  frameIndex: number;
  seat: number;
}) {
  const v = useCardsVersion();
  const play = usePlay();
  const targetable = play ? play.playerMark(player.id) : false;
  const [zone, setZone] = useState<ViewableZone | null>(null);
  const mine = player.id === seat;
  const sources = useMemo(() => {
    try {
      const cards = cachedMap(stateCardNames(state));
      // A Thriving land counts for the colour chosen as it entered (the seat's own answer), not every colour.
      return manaSummary(state, player.id, cards, chosenColors(log, frameIndex, seat, cards)).sources;
    } catch {
      return [] as ManaSource[];
    }
  }, [state, player.id, v, log, frameIndex, seat]);
  const facts = useMemo(() => {
    try {
      return turnFacts(log, frameIndex, player.id);
    } catch {
      return null;
    }
  }, [log, frameIndex, player.id]);
  const pool = MANA_COLORS.flatMap((c) => Array.from({ length: player.manaPool[c] }, () => c));
  const active = state.activePlayer === player.id;
  const priority = state.priority === player.id;
  const z = player.zones;
  const otherCounters = Object.entries(player.counters ?? {}).filter(([k, n]) => n > 0 && k !== 'POISON');
  return (
    <div className={cx('phead', active && 'is-active', targetable && 'is-targetable')} data-phead-player={player.id}>
      <div className="phead-id">
        {play ? (
          <button
            type="button"
            className={cx('avatar', mine ? 'avatar-me' : 'avatar-opp', targetable && 'is-select')}
            aria-label={`Choose ${mine ? 'yourself' : player.name}`}
            data-player-id={player.id}
            onClick={() => play.clickPlayer(player.id)}
          >
            {(player.name || '?').charAt(0)}
          </button>
        ) : (
          <span className={cx('avatar', mine ? 'avatar-me' : 'avatar-opp')}>{(player.name || '?').charAt(0)}</span>
        )}
        <div className="phead-names">
          <div className="phead-name">
            {mine ? 'You' : seatDisplayName(log.hello, player, player.name)}
            {mine && <span className="muted phead-real"> · {player.name}</span>}
          </div>
          <div className="phead-tags">
            {active && <span className="tag tag-turn">{mine ? 'Your turn' : 'Their turn'}</span>}
            {priority && <span className="tag tag-prio">Priority</span>}
            {facts && mine && active && facts.landPlayed !== null && (
              <span className={cx('tag', facts.landPlayed ? 'tag-muted' : 'tag-ok')}>
                {facts.landPlayed ? 'Land played' : 'Land drop open'}
              </span>
            )}
          </div>
        </div>
        <div className={cx('life', player.life <= 5 && 'is-low')} title="Life">
          <IconHeart size={14} />
          <span className="life-n">{player.life}</span>
          {player.poison > 0 && <span className="poison">☠ {player.poison}</span>}
        </div>
      </div>
      <div className="phead-zones">
        {mine ? (
          <ZonePill label="Hand" n={z.hand.count} />
        ) : (
          <span className="zone-pill zone-static" title={`${z.hand.count} cards in hand`}>
            Hand <OppHand n={z.hand.count} /> <b>{z.hand.count}</b>
          </span>
        )}
        <ZonePill label="Library" short="Lib" n={z.library.count} onClick={z.library.cards.length > 0 ? () => setZone('library') : undefined} />
        <ZonePill label="Graveyard" short="GY" n={z.graveyard.count} onClick={() => setZone('graveyard')} />
        <ZonePill label="Exile" short="Ex" n={z.exile.count} onClick={() => setZone('exile')} />
        {z.command.count > 0 && <ZonePill label="Command" n={z.command.count} onClick={() => setZone('command')} />}
        {otherCounters.map(([k, n]) => (
          <span key={k} className="zone-pill zone-static">
            {k.toLowerCase()} <b>{n}</b>
          </span>
        ))}
      </div>
      {(sources.length > 0 || pool.length > 0) && (
        <div className="phead-mana">
          {sources.length > 0 && (
            <span className="mana-avail" title={sources.map((s) => s.name).join(', ')}>
              <span className="muted">Untapped mana</span>
              <span className="pip-row">
                {sortSources(sources).map((s) => (
                  <Pip key={s.cardId} sym={sourceSym(s)} size="sm" />
                ))}
              </span>
              <b>{sources.length}</b>
            </span>
          )}
          {pool.length > 0 && (
            <span className="mana-pool">
              <span className="muted">Pool</span>
              <span className="pip-row">
                {pool.map((c, i) => (
                  <Pip key={i} sym={c} size="sm" />
                ))}
              </span>
            </span>
          )}
        </div>
      )}
      <ZoneViewer player={player} zone={zone} onClose={() => setZone(null)} mine={mine} />
    </div>
  );
}

function sourceSym(s: ManaSource): string {
  if (s.colors.length === 0) return '?';
  if (s.colors.length === 1) return s.colors[0]!;
  return s.colors.join('/');
}
function sortSources(s: ManaSource[]): ManaSource[] {
  const order = 'WUBRGC';
  return [...s].sort((a, b) => a.colors.length - b.colors.length || order.indexOf(a.colors[0] ?? 'C') - order.indexOf(b.colors[0] ?? 'C'));
}

function ZonePill({ label, short, n, onClick }: { label: string; short?: string; n: number; onClick?: () => void }) {
  // Narrow screens show the short label (Lib, GY); the long one stays for screen readers.
  const text = short ? (
    <>
      <span className="zl-long">{label}</span>
      <span className="zl-short" aria-hidden="true">
        {short}
      </span>
    </>
  ) : (
    label
  );
  if (!onClick) {
    return (
      <span className="zone-pill zone-static" title={label}>
        {text} <b>{n}</b>
      </span>
    );
  }
  return (
    <button className="zone-pill" onClick={onClick} disabled={n === 0} title={label}>
      {text} <b>{n}</b>
    </button>
  );
}

function OppHand({ n }: { n: number }) {
  return (
    <div className="opp-hand" aria-label={`${n} cards in hand`}>
      {Array.from({ length: Math.min(n, 7) }, (_, i) => (
        <CardBack key={i} small />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The line between the two sides: turn/phase, stack, combat.

const STEPS: { label: string; phases: string[] }[] = [
  { label: 'Upkeep', phases: ['UNTAP', 'UPKEEP'] },
  { label: 'Draw', phases: ['DRAW'] },
  { label: 'Main 1', phases: ['MAIN1'] },
  { label: 'Combat', phases: ['COMBAT_BEGIN', 'COMBAT_DECLARE_ATTACKERS', 'COMBAT_DECLARE_BLOCKERS', 'COMBAT_FIRST_STRIKE_DAMAGE', 'COMBAT_DAMAGE', 'COMBAT_END'] },
  { label: 'Main 2', phases: ['MAIN2'] },
  { label: 'End', phases: ['END_OF_TURN', 'CLEANUP'] },
];

function Midline({ state, seat }: { state: GameStateBody; seat: number }) {
  return (
    <div className="midline">
      <PhaseHeader state={state} seat={seat} />
      {state.stack.length > 0 && <StackPanel state={state} seat={seat} />}
      {state.combat && state.combat.bands.length > 0 && <CombatPanel state={state} seat={seat} />}
    </div>
  );
}

export function PhaseHeader({ state, seat }: { state: GameStateBody; seat: number }) {
  if (!state.phase) {
    return (
      <div className="phase-head">
        <span className="phase-turn">Pre-game</span>
        <span className="muted">Mulligans and opening hands</span>
      </div>
    );
  }
  const whose = state.activePlayer === seat ? 'Your turn' : `${state.players.find((p) => p.id === state.activePlayer)?.name ?? 'Opponent'}'s turn`;
  const step = STEPS.findIndex((s) => s.phases.includes(state.phase!));
  const prio = state.priority === null ? null : state.priority === seat ? 'You' : state.players.find((p) => p.id === state.priority)?.name;
  return (
    <div className={cx('phase-head', state.activePlayer === seat ? 'is-mine' : 'is-theirs')}>
      <div className="phase-turn">
        <span className="phase-round">Round {state.round}</span>
        <span className="phase-whose">{whose}</span>
      </div>
      <ol className="phase-steps" aria-label={`Phase: ${phaseLabel(state.phase)}`}>
        {STEPS.map((s, i) => (
          <li key={s.label} className={cx(i === step && 'is-now', i < step && 'is-past')}>
            {s.label}
          </li>
        ))}
      </ol>
      <div className="phase-now">
        <span className="phase-label">{phaseLabel(state.phase)}</span>
        {prio && <span className="muted"> · priority: {prio}</span>}
      </div>
    </div>
  );
}

function CardRef({ card, state }: { card: AnyCard | undefined; state: GameStateBody }) {
  const actions = useCardActions();
  if (!card) return <span className="card-ref muted">a card</span>;
  if (isHidden(card)) return <span className="card-ref muted">{cardName(card)}</span>;
  const c = card as Card;
  return (
    <button className="card-ref" onClick={() => actions.open(c, state)}>
      {displayName(c)}
      {c.power !== null && c.toughness !== null && typeKind(c.types) === 'creature' && (
        <span className="card-ref-pt">
          {c.power}/{c.toughness}
        </span>
      )}
    </button>
  );
}

function StackPanel({ state, seat }: { state: GameStateBody; seat: number }) {
  const idx = useMemo(() => cardIndex(state), [state]);
  const items = [...state.stack].reverse();
  const playerName = (id: number | null) => (id === null ? 'someone' : id === seat ? 'You' : state.players.find((p) => p.id === id)?.name ?? 'Opponent');
  return (
    <div className="mid-panel stack-panel">
      <div className="mid-title">
        <IconLayers size={14} /> Stack <span className="bf-count">{items.length}</span>
        <span className="muted mid-hint">top resolves first</span>
      </div>
      <StackTargets items={items} seat={seat} />
      <ol className="stack-list">
        {items.map((it, i) => {
          const src = it.sourceCardId !== null ? idx.get(it.sourceCardId) : undefined;
          const targets = [
            ...it.targetPlayerIds.map((id) => playerName(id)),
            ...it.targetCardIds.map((id) => cardName(idx.get(id))),
          ];
          return (
            <li key={it.id} className={cx('stack-item', i === 0 && 'is-top', it.controller === seat ? 'is-mine' : 'is-theirs')}>
              <div className="stack-line">
                <CardRef card={src} state={state} />
                <span className="muted">· {playerName(it.controller)}</span>
              </div>
              {it.text && <div className="stack-text">{it.text}</div>}
              {targets.length > 0 && <div className="stack-targets">→ {targets.join(', ')}</div>}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/**
 * The Stack skin outlines each permanent a stack item targets, dashed, in its
 * caster's colour (the topmost item wins). Only public stack data; the rules
 * match nothing in the other skins.
 */
function StackTargets({ items, seat }: { items: GameStateBody['stack']; seat: number }) {
  const css = useMemo(() => {
    const seen = new Set<number>();
    const rules: string[] = [];
    for (const it of items) {
      for (const id of it.targetCardIds) {
        if (!Number.isInteger(id) || seen.has(id)) continue;
        seen.add(id);
        const who = it.controller === seat ? 'you' : 'them';
        rules.push(`:root[data-skin='stack'] .board [data-card-id="${id}"] .tile-card{outline:2px dashed var(--skin-${who});outline-offset:3px}`);
      }
    }
    return rules.join('\n');
  }, [items, seat]);
  return css ? <style>{css}</style> : null;
}

function CombatPanel({ state, seat }: { state: GameStateBody; seat: number }) {
  const idx = useMemo(() => cardIndex(state), [state]);
  const play = usePlay();
  // In play, blockers you have clicked but not yet confirmed (the engine reports them on confirm).
  const blockersOf = (b: { attackerIds: number[]; blockerIds: number[] }) => {
    const extra = play ? b.attackerIds.flatMap((a) => play.blockersFor(a)).filter((id) => !b.blockerIds.includes(id)) : [];
    return [...b.blockerIds, ...extra];
  };
  const defenderName = (d: { kind: 'player' | 'card'; id: number } | null) => {
    if (!d) return 'someone';
    if (d.kind === 'player') return d.id === seat ? 'You' : state.players.find((p) => p.id === d.id)?.name ?? 'Opponent';
    return cardName(idx.get(d.id));
  };
  return (
    <div className="mid-panel combat-panel">
      <div className="mid-title">
        <IconSword size={14} /> Combat
      </div>
      <ul className="combat-list">
        {state.combat!.bands.map((b, i) => (
          <li key={i} className="combat-band">
            <div className="combat-side combat-att">
              {b.attackerIds.map((id) => (
                <CardRef key={id} card={idx.get(id)} state={state} />
              ))}
            </div>
            <div className="combat-arrow">
              <span>→</span> <b>{defenderName(b.defender)}</b>
            </div>
            <div className="combat-side combat-blk">
              {blockersOf(b).length === 0 ? (
                <span className="muted">unblocked</span>
              ) : (
                <>
                  <IconShield size={12} />
                  {blockersOf(b).map((id) => (
                    <CardRef key={id} card={idx.get(id)} state={state} />
                  ))}
                </>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

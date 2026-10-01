/*
 * ForgeCoach — ui/Board.tsx
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The table at one state: opponent on top, you at the bottom, with the turn
 * header, stack and combat between them.
 */
import { memo, useMemo, useState } from 'react';
import type { AnyCard, Card, GameStateBody, PlayerState } from '../protocol.ts';
import { isHidden, MANA_COLORS } from '../protocol.ts';
import type { GameLog } from '../log.ts';
import { cardIndex, cardName, phaseLabel } from '../decisions.ts';
import { manaSummary, turnFacts, type ManaSource } from '../state.ts';
import { cachedMap, useCardsVersion } from './cardData.ts';
import { useCardActions } from './cardContext.ts';
import { CardBack, CardTile, LandChip, displayName } from './CardTile.tsx';
import { IconHeart, IconLayers, IconShield, IconSword } from './Icons.tsx';
import { Pip } from './Mana.tsx';
import { Sheet } from './Sheet.tsx';
import { cx, stateCardNames, typeKind } from './util.ts';

interface BoardProps {
  log: GameLog;
  state: GameStateBody;
  frameIndex: number;
  seat: number;
}

export function Board({ log, state, frameIndex, seat }: BoardProps) {
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
      <PlayerArea player={me} state={state} log={log} frameIndex={frameIndex} seat={seat} byId={byId} />
    </div>
  );
}

// ---------------------------------------------------------------------------

function groupBattlefield(player: PlayerState, byId: Map<number, Card>) {
  const lands: Card[][] = [];
  const landKey = new Map<string, Card[]>();
  const creatures: { card: Card; att: Card[] }[] = [];
  const other: { card: Card; att: Card[] }[] = [];
  for (const any of player.zones.battlefield.cards) {
    if (isHidden(any)) continue;
    const c = any as Card;
    if (c.attachedToId !== null && byId.has(c.attachedToId)) continue; // drawn on its host
    const att = c.attachmentIds.map((id) => byId.get(id)).filter((x): x is Card => !!x);
    const kind = typeKind(c.types);
    if (kind === 'land' && att.length === 0 && !c.attacking && !c.blocking) {
      const key = `${c.name}|${c.tapped}|${JSON.stringify(c.counters)}|${c.damage}`;
      let g = landKey.get(key);
      if (!g) {
        g = [];
        landKey.set(key, g);
        lands.push(g);
      }
      g.push(c);
    } else if (kind === 'creature') creatures.push({ card: c, att });
    else other.push({ card: c, att });
  }
  // Untapped lands first, then by name, so the mana you have reads left to right.
  lands.sort((a, b) => Number(a[0]!.tapped) - Number(b[0]!.tapped) || a[0]!.name.localeCompare(b[0]!.name));
  return { lands, creatures, other };
}

const PlayerArea = memo(function PlayerArea({
  player,
  state,
  log,
  frameIndex,
  seat,
  byId,
  top,
}: {
  player: PlayerState;
  state: GameStateBody;
  log: GameLog;
  frameIndex: number;
  seat: number;
  byId: Map<number, Card>;
  top?: boolean;
}) {
  const { lands, creatures, other } = useMemo(() => groupBattlefield(player, byId), [player, byId]);
  const mine = player.id === seat;
  const rows = [
    creatures.length > 0 && (
      <Row key="c" label="Creatures" count={creatures.length}>
        {creatures.map(({ card, att }) => (
          <CardTile key={card.id} card={card} attachments={att} />
        ))}
      </Row>
    ),
    other.length > 0 && (
      <Row key="o" label="Other permanents" count={other.length}>
        {other.map(({ card, att }) => (
          <CardTile key={card.id} card={card} attachments={att} />
        ))}
      </Row>
    ),
    lands.length > 0 && (
      <Row key="l" label="Lands" count={lands.reduce((n, g) => n + g.length, 0)} chips>
        {lands.map((g) => (
          <LandChip key={g[0]!.id} cards={g} />
        ))}
      </Row>
    ),
  ].filter(Boolean);
  if (top) rows.reverse();
  const empty = rows.length === 0;
  return (
    <section className={cx('player', top ? 'player-top' : 'player-me', mine && 'is-me')} aria-label={`${player.name}'s side`}>
      {top && <PlayerHeader player={player} state={state} log={log} frameIndex={frameIndex} seat={seat} />}
      <div className="battlefield">
        {empty ? <div className="bf-empty">No permanents</div> : rows}
      </div>
      {!top && <PlayerHeader player={player} state={state} log={log} frameIndex={frameIndex} seat={seat} />}
      {mine && <Hand player={player} />}
    </section>
  );
});

function Row({ label, count, chips, children }: { label: string; count: number; chips?: boolean; children: React.ReactNode }) {
  return (
    <div className="bf-row">
      <div className="bf-label">
        {label} <span className="bf-count">{count}</span>
      </div>
      <div className={chips ? 'bf-chips' : 'bf-tiles'}>{children}</div>
    </div>
  );
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
  const [zone, setZone] = useState<'graveyard' | 'exile' | 'command' | null>(null);
  const mine = player.id === seat;
  const sources = useMemo(() => {
    try {
      return manaSummary(state, player.id, cachedMap(stateCardNames(state))).sources;
    } catch {
      return [] as ManaSource[];
    }
  }, [state, player.id, v]);
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
    <div className={cx('phead', active && 'is-active')}>
      <div className="phead-id">
        <span className={cx('avatar', mine ? 'avatar-me' : 'avatar-opp')}>{(player.name || '?').charAt(0)}</span>
        <div className="phead-names">
          <div className="phead-name">
            {mine ? 'You' : player.name}
            {mine && <span className="muted phead-real"> · {player.name}</span>}
          </div>
          <div className="phead-tags">
            {active && <span className="tag tag-turn">{mine ? 'Your turn' : 'Their turn'}</span>}
            {priority && <span className="tag tag-prio">Priority</span>}
            {facts && mine && facts.landPlayed !== null && (
              <span className={cx('tag', facts.landPlayed ? 'tag-muted' : 'tag-ok')}>
                {facts.landPlayed ? 'Land played' : 'Land drop open'}
              </span>
            )}
          </div>
        </div>
        <div className="life" title="Life">
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
        <ZonePill label="Library" n={z.library.count} />
        <ZonePill label="Graveyard" n={z.graveyard.count} onClick={() => setZone('graveyard')} />
        <ZonePill label="Exile" n={z.exile.count} onClick={() => setZone('exile')} />
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
      <ZoneSheet player={player} zone={zone} onClose={() => setZone(null)} mine={mine} />
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

function ZonePill({ label, n, onClick }: { label: string; n: number; onClick?: () => void }) {
  if (!onClick) {
    return (
      <span className="zone-pill zone-static">
        {label} <b>{n}</b>
      </span>
    );
  }
  return (
    <button className="zone-pill" onClick={onClick} disabled={n === 0}>
      {label} <b>{n}</b>
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

function ZoneSheet({
  player,
  zone,
  onClose,
  mine,
}: {
  player: PlayerState;
  zone: 'graveyard' | 'exile' | 'command' | null;
  onClose: () => void;
  mine: boolean;
}) {
  const cards = zone ? [...player.zones[zone].cards].reverse() : [];
  const title = zone ? `${mine ? 'Your' : `${player.name}'s`} ${zone}` : '';
  return (
    <Sheet open={zone !== null} onClose={onClose} title={title} subtitle={zone ? `${cards.length} card${cards.length === 1 ? '' : 's'} · most recent first` : ''}>
      {cards.length === 0 ? (
        <p className="muted">Nothing here.</p>
      ) : (
        <div className="zone-grid">
          {cards.map((c) =>
            isHidden(c) ? (
              <CardBack key={c.id} />
            ) : (
              <CardTile key={c.id} card={c as Card} inHand />
            ),
          )}
        </div>
      )}
    </Sheet>
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

function CombatPanel({ state, seat }: { state: GameStateBody; seat: number }) {
  const idx = useMemo(() => cardIndex(state), [state]);
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
              {b.blockerIds.length === 0 ? (
                <span className="muted">unblocked</span>
              ) : (
                <>
                  <IconShield size={12} />
                  {b.blockerIds.map((id) => (
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

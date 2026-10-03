/*
 * ForgeCoach — ambience/sim.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Made-up game states for the scenery preview page (#ambience) and the tests:
 * two players and the lands, creatures and attacks the page's buttons "play".
 * Never sent anywhere; the preview page has no engine and opens no socket.
 */
import type { Card, GameEvent, GameStateBody, PlayerState } from '../protocol.ts';
import type { GameLog, LoggedFrame } from '../log.ts';

export const SIM_LANDS = {
  Island: 'Basic Land - Island',
  Swamp: 'Basic Land - Swamp',
  Mountain: 'Basic Land - Mountain',
  Forest: 'Basic Land - Forest',
  Plains: 'Basic Land - Plains',
  Wastes: 'Basic Land',
  'Watery Grave': 'Land - Island Swamp',
  'Command Tower': 'Land',
} as const;
export type SimLandName = keyof typeof SIM_LANDS;

export type SimPlay =
  | { kind: 'land'; player: number; name: SimLandName }
  | { kind: 'creature'; player: number }
  | { kind: 'attack'; player: number };

export const SIM_PLAYERS = [1, 2] as const;

export function simCard(id: number, player: number, name: string, types: string, extra: Partial<Card> = {}): Card {
  return {
    id,
    name,
    setCode: null,
    manaCost: null,
    types,
    power: null,
    toughness: null,
    loyalty: null,
    damage: 0,
    counters: {},
    tapped: false,
    sick: false,
    attacking: false,
    blocking: false,
    faceDown: false,
    token: false,
    alt: null,
    attachedToId: null,
    attachmentIds: [],
    controller: player,
    owner: player,
    zone: 'battlefield',
    abilities: name === 'Command Tower' ? [{ id: 1, text: '{T}: Add one mana of any color in your commander’s color identity.', canPlay: false, isSpell: false }] : [],
    ...extra,
  };
}

function player(id: number, cards: Card[]): PlayerState {
  const zone = (cs: Card[]) => ({ count: cs.length, cards: cs });
  return {
    id,
    name: id === SIM_PLAYERS[0] ? 'You' : 'Opponent',
    isAi: id !== SIM_PLAYERS[0],
    life: 20,
    poison: 0,
    counters: {},
    manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 } as PlayerState['manaPool'],
    zones: {
      hand: zone([]),
      library: { count: 30, cards: [] },
      graveyard: zone([]),
      exile: zone([]),
      command: zone([]),
      battlefield: zone(cards),
    } as unknown as PlayerState['zones'],
  };
}

export function simState(byPlayer: Map<number, Card[]>, events: GameEvent[], turn: number): GameStateBody {
  return {
    gameId: 'preview',
    turn,
    round: Math.ceil(turn / 2),
    phase: 'MAIN1',
    activePlayer: SIM_PLAYERS[0],
    priority: SIM_PLAYERS[0],
    gameOver: null,
    players: SIM_PLAYERS.map((p) => player(p, byPlayer.get(p) ?? [])),
    stack: [],
    stackCards: [],
    combat: null,
    events,
  };
}

/** A log with one state frame per play (plus the empty start), as the preview page replays it. */
export function simLog(plays: SimPlay[]): GameLog {
  const byPlayer = new Map<number, Card[]>(SIM_PLAYERS.map((p) => [p, []]));
  const frames: LoggedFrame[] = [];
  let id = 100;
  let seq = 0;
  const push = (events: GameEvent[]) => {
    const body = simState(new Map([...byPlayer].map(([k, v]) => [k, [...v]])), events, frames.length + 1);
    frames.push({ v: 1, type: 'state', seq: seq++, body, dir: 's2c' } as unknown as LoggedFrame);
  };
  push([]);
  for (const p of plays) {
    const mine = byPlayer.get(p.player)!;
    if (p.kind === 'land') {
      const c = simCard(id++, p.player, p.name, SIM_LANDS[p.name]);
      mine.push(c);
      push([{ kind: 'land', player: p.player, cardId: c.id }, { kind: 'zone', cardId: c.id, from: { zone: 'hand', player: p.player }, to: { zone: 'battlefield', player: p.player } }]);
    } else if (p.kind === 'creature') {
      const colors = ['{G}', '{U}', '{R}', '{W}', '{B}'];
      const c = simCard(id++, p.player, 'Preview Creature', 'Creature - Beast', { manaCost: `{1}${colors[id % colors.length]}`, power: '2', toughness: '2', sick: true });
      mine.push(c);
      push([{ kind: 'zone', cardId: c.id, from: { zone: 'stack', player: null }, to: { zone: 'battlefield', player: p.player } }]);
    } else {
      const attackers = mine.filter((c) => /Creature/.test(c.types)).map((c) => c.id);
      const other = SIM_PLAYERS.find((x) => x !== p.player)!;
      push([
        { kind: 'attackers', player: p.player, bands: [{ defender: { kind: 'player', id: other }, attackerIds: attackers }] },
        ...(attackers.length ? [{ kind: 'damage' as const, target: { kind: 'player' as const, id: other }, sourceCardId: attackers[0]!, amount: 2 * attackers.length, combat: true, damageType: null }] : []),
      ]);
    }
  }
  return {
    header: { kind: 'session', seat: SIM_PLAYERS[0] } as unknown as GameLog['header'],
    frames,
    hello: null,
    over: null,
    seat: SIM_PLAYERS[0],
  };
}

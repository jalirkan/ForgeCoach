/*
 * ForgeCoach — ui/play/combatLayout.test.tsx
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The combat lanes (combatLayout.ts, CombatLane.tsx, laneMotion.ts): who is
 * in the attack lane and in what order, the target as one label or a chip per
 * card, blockers placed in front of their attacker (confirmed and still being
 * declared), the few lines that remain, hidden information (a concealed id is
 * never placed; a face-down attacker's hidden face is never read), the cards'
 * own selectable attributes inside the lane, and a server render of a lane.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { AnyCard, Card, CombatBand, GameStateBody } from '../../protocol.ts';
import { BoardMarksContext, PlayContext, type PlayInteraction } from '../cardContext.ts';
import { combatMarks } from './combatLines.ts';
import { combatLayout, hideSickMark, laneRole, shortName, type LayoutNames } from './combatLayout.ts';
import { CombatLane } from './CombatLane.tsx';
import { movedIds, placementKeys } from './laneMotion.ts';

function card(id: number, controller: number, extra: Partial<Card> = {}): Card {
  return {
    id, name: `C${id}`, setCode: null, manaCost: '{1}', types: 'Creature - Bear', power: '2', toughness: '2', loyalty: null, damage: 0, counters: {},
    tapped: false, sick: false, attacking: false, blocking: false, faceDown: false, token: false, alt: null, attachedToId: null, attachmentIds: [],
    controller, owner: controller, zone: 'battlefield', abilities: [], keywords: [], ...extra,
  } as unknown as Card;
}
const hidden = (id: number, controller: number): AnyCard => ({ id, zone: 'battlefield', controller, owner: controller, hidden: true });
const band = (attackerIds: number[], blockerIds: number[], defender: CombatBand['defender'] = { kind: 'player', id: 0 }): CombatBand => ({ attackerIds, defender, blockerIds, damageOrder: blockerIds });

function state(bf0: AnyCard[], bf1: AnyCard[], bands: CombatBand[] | null, extra: Partial<GameStateBody> = {}): GameStateBody {
  const zones = (bf: AnyCard[]) => ({
    hand: { count: 0, cards: [] }, battlefield: { count: bf.length, cards: bf }, graveyard: { count: 0, cards: [] },
    exile: { count: 0, cards: [] }, command: { count: 0, cards: [] }, library: { count: 30, cards: [] },
  });
  return {
    turn: 3, round: 2, phase: 'COMBAT_DECLARE_BLOCKERS', activePlayer: 1, priority: 0,
    players: [
      { id: 0, name: 'Justin', life: 20, zones: zones(bf0) },
      { id: 1, name: 'Forge AI', life: 20, zones: zones(bf1) },
    ],
    stack: [], stackCards: [], combat: bands ? { bands } : null, events: [], ...extra,
  } as unknown as GameStateBody;
}
const names: LayoutNames = { player: (id) => (id === 0 ? 'You' : 'The bot'), avatar: (id) => (id === 0 ? 'Justin' : 'Forge AI') };
const lay = (s: GameStateBody, marks = combatMarks(s)) => combatLayout(s, names, marks);

describe('the attack lane', () => {
  it('holds every attacker the engine lists, in its order, and nothing outside combat', () => {
    const s = state([card(1, 0)], [card(9, 1, { tapped: true }), card(7, 1, { tapped: true }), card(8, 1)], [band([9], []), band([7, 8], [])]);
    const l = lay(s);
    expect(l.columns.map((c) => c.attackerId)).toEqual([9, 7, 8]);
    expect(l.columns.every((c) => c.controller === 1)).toBe(true);
    expect([...l.placed].sort()).toEqual([7, 8, 9]);
    expect(lay(state([card(1, 0)], [card(9, 1)], null)).columns).toEqual([]);
    expect(lay(state([card(1, 0)], [card(9, 1)], [])).placed.size).toBe(0);
  });

  it('sizes columns: a lying attacker is wider than an upright one, and an upright one makes the lane tall', () => {
    const l = lay(state([], [card(9, 1, { tapped: true }), card(8, 1)], [band([9, 8], [])]));
    expect(l.columns.map((c) => c.weight)).toEqual([1.4, 1]);
    expect(l.upright).toBe(true);
    expect(lay(state([], [card(9, 1, { tapped: true })], [band([9], [])])).upright).toBe(false);
  });

  it('never places an id the viewer cannot see, and never reads a face-down attacker’s hidden face', () => {
    const fd = card(9, 1, { name: '', faceDown: true, alt: { name: 'Secret Morph' } as never, tapped: true });
    const s = state([card(1, 0)], [hidden(8, 1), fd], [band([8, 9], [])]);
    const l = lay(s);
    expect(l.columns.map((c) => c.attackerId)).toEqual([9]);
    expect(JSON.stringify(l)).not.toContain('Secret Morph');
    // The board never holds the opponent's in-play face-down `alt` (faceDown.ts drops it on read): the lane draws a nameless card.
    const asRead = { ...fd, alt: null } as Card;
    const html = renderToStaticMarkup(<CombatLane layout={lay(state([card(1, 0)], [asRead], [band([9], [])]))} kind="attack" playerId={1} side="opp" byId={new Map([[9, asRead]])} />);
    expect(html).not.toContain('Secret Morph');
    expect(html).toContain('Face-down card');
  });
});

describe('the target', () => {
  it('collapses to one label at the lane’s edge when every attacker has the same target', () => {
    const l = lay(state([card(1, 0)], [card(9, 1), card(8, 1)], [band([9], []), band([8], [])]));
    expect(l.laneTarget).toMatchObject({ kind: 'player', id: 0, label: 'You', initial: 'J' });
    expect(l.columns.every((c) => !c.chip)).toBe(true);
    expect(l.lines).toEqual([]);
  });

  it('puts a chip on each card when targets differ, and a thin line to a planeswalker', () => {
    const karn = card(5, 0, { name: 'Karn, Scion of Urza', types: 'Legendary Planeswalker - Karn', power: null, toughness: null });
    const l = lay(state([karn], [card(9, 1), card(8, 1)], [band([9], [], { kind: 'card', id: 5 }), band([8], [])]));
    expect(l.laneTarget).toBe(null);
    expect(l.columns.map((c) => [c.attackerId, c.chip, c.target?.label, c.target?.initial])).toEqual([
      [9, true, 'Karn', 'K'],
      [8, true, 'You', 'J'],
    ]);
    expect(l.lines).toEqual([{ kind: 'target', from: { card: 9 }, to: { card: 5 }, pending: false }]);
  });

  it('one planeswalker for the whole lane: one label and one line from it, not a line per attacker', () => {
    const karn = card(5, 0, { name: 'Karn, Scion of Urza', types: 'Legendary Planeswalker - Karn' });
    const l = lay(state([karn], [card(9, 1), card(8, 1)], [band([9, 8], [], { kind: 'card', id: 5 })]));
    expect(l.laneTarget?.label).toBe('Karn');
    expect(l.lines).toEqual([{ kind: 'target', from: { lane: 1 }, to: { card: 5 }, pending: false }]);
  });

  it('a face-down defender is "a permanent", and a null defender gets no chip', () => {
    const fd = card(5, 0, { name: '', faceDown: true });
    const l = lay(state([fd], [card(9, 1), card(8, 1)], [band([9], [], { kind: 'card', id: 5 }), band([8], [], null)]));
    expect(l.columns[0]!.target).toMatchObject({ label: 'a permanent', initial: '?' });
    expect(l.columns[1]).toMatchObject({ target: null, chip: false });
    expect(shortName('Jace Beleren')).toBe('Jace Beleren');
  });

  it('an attacker still being declared against a planeswalker gets a chip and a line (M65 chosen.attacks)', () => {
    const pw = card(7, 1, { name: 'Elspeth, Sun’s Champion', types: 'Legendary Planeswalker - Elspeth' });
    const s = state([card(1, 0)], [pw], null, { activePlayer: 0, phase: 'COMBAT_DECLARE_ATTACKERS' });
    const marks = combatMarks(s, new Map(), new Set([1]), null, [{ attackerId: 1, defender: { kind: 'card', id: 7 } }]);
    const l = combatLayout(s, names, marks);
    expect(l.columns).toEqual([]);
    expect(l.pendingChips.get(1)).toMatchObject({ label: 'Elspeth', initial: 'E' });
    expect(l.lines).toEqual([{ kind: 'target', from: { card: 1 }, to: { card: 7 }, pending: true }]);
  });
});

describe('blocks by placement', () => {
  it('puts each blocker in front of its attacker, several fanned in front of one', () => {
    const s = state([card(1, 0), card(2, 0), card(3, 0)], [card(9, 1, { tapped: true }), card(8, 1, { tapped: true })], [band([9], [1, 2]), band([8], [3])]);
    const l = lay(s);
    expect(l.columns.map((c) => [c.attackerId, c.blockers.map((b) => b.id)])).toEqual([
      [9, [1, 2]],
      [8, [3]],
    ]);
    expect(l.columns[0]!.weight).toBe(1.55);
    expect(l.lines).toEqual([]);
    expect(laneRole(l, 1, 0)).toEqual({ attack: true, block: false });
    expect(laneRole(l, 0, 0)).toEqual({ attack: false, block: true });
  });

  it('places blocks still being declared (marked pending), the engine’s own word first', () => {
    const s = state([card(1, 0), card(2, 0)], [card(9, 1), card(8, 1)], [band([9], []), band([8], [])]);
    const l = lay(s, combatMarks(s, new Map([[1, 8], [2, null]]), new Set(), 8));
    expect(l.columns.map((c) => [c.attackerId, c.current, c.blockers])).toEqual([
      [9, false, []],
      [8, true, [{ id: 1, pending: true, tapped: false, controller: 0 }]],
    ]);
    // A pick with no attacker named is not placed anywhere.
    expect(l.placed.has(2)).toBe(false);
  });

  it('a blocker of two attackers sits in front of the first and gets a line to the second', () => {
    const l = lay(state([card(1, 0)], [card(9, 1), card(8, 1)], [band([9], [1]), band([8], [1])]));
    expect(l.columns[0]!.blockers.map((b) => b.id)).toEqual([1]);
    expect(l.columns[1]!.blockers).toEqual([]);
    expect(l.lines).toEqual([{ kind: 'block', from: { card: 1 }, to: { card: 8 }, pending: false }]);
  });

  it('while you declare blocks, your side shows the empty place in front of the named attacker', () => {
    const s = state([card(1, 0)], [card(9, 1)], [band([9], [])]);
    const l = lay(s, combatMarks(s, new Map(), new Set(), 9));
    expect(laneRole(l, 0, 0)).toEqual({ attack: false, block: true });
    const html = renderToStaticMarkup(<CombatLane layout={l} kind="block" playerId={0} side="me" byId={new Map()} />);
    expect(html).toContain('lane-ghost');
  });

  it('never places a concealed blocker', () => {
    const l = lay(state([hidden(1, 0)], [card(9, 1)], [band([9], [1])]));
    expect(l.placed.has(1)).toBe(false);
  });
});

describe('the lane, rendered', () => {
  const atk = [card(9, 1, { tapped: true, attacking: true }), card(8, 1, { tapped: true, attacking: true })];
  const blk = card(1, 0, { blocking: true });
  const s = state([blk, card(2, 0)], atk, [band([9], [1]), band([8], [])]);
  const l = lay(s);
  const byId = new Map<number, Card>([...atk, blk].map((c) => [c.id, c]));

  it('an attack lane: the cards in the engine’s order, one target label, no list words', () => {
    const html = renderToStaticMarkup(<CombatLane layout={l} kind="attack" playerId={1} side="opp" byId={byId} />);
    expect(html).toContain('data-combat-lane="attack"');
    expect([...html.matchAll(/data-lane-col="(\d+)"/g)].map((m) => m[1])).toEqual(['9', '8']);
    expect(html).toMatch(/data-lane-label="1"[^>]*>.*→.* You</);
    expect(html).not.toMatch(/unblocked|Combat</i);
    expect(html).not.toContain('lane-chip');
  });

  it('a block lane: the blocker in its attacker’s column, the same columns, its pair number', () => {
    const html = renderToStaticMarkup(
      <BoardMarksContext.Provider value={{ stack: new Map(), combat: combatMarks(s) }}>
        <CombatLane layout={l} kind="block" playerId={0} side="me" byId={byId} />
      </BoardMarksContext.Provider>,
    );
    expect([...html.matchAll(/data-lane-col="(\d+)"/g)].map((m) => m[1])).toEqual(['9', '8']);
    expect(html).toMatch(/data-blocks="9"[^>]*>.*data-card-id="1"/);
    expect(html).toMatch(/tile-pair pair-blocker[^>]*>1</);
    // The lane keeps the label's room on both sides of the centre line, so the columns line up.
    expect(html).toContain('combat-lane is-block has-label');
  });

  it('the cards keep their own clicks: the engine’s selectable outline and data-mark, and a × only when the play screen offers it', () => {
    const play: PlayInteraction = {
      mark: (c) => (c.id === 9 || c.id === 8 ? 'act' : null),
      hint: () => false,
      click: () => undefined,
      chosen: () => null,
      blockersFor: () => [],
      playerMark: () => false,
      clickPlayer: () => undefined,
      unblock: () => undefined,
    };
    const atkHtml = renderToStaticMarkup(
      <PlayContext.Provider value={play}>
        <CombatLane layout={l} kind="attack" playerId={1} side="opp" byId={byId} />
      </PlayContext.Provider>,
    );
    expect(atkHtml.match(/data-mark="act"/g)?.length).toBe(2);
    const blkHtml = renderToStaticMarkup(
      <PlayContext.Provider value={play}>
        <CombatLane layout={l} kind="block" playerId={0} side="me" byId={byId} />
      </PlayContext.Provider>,
    );
    expect(blkHtml).toContain('aria-label="Take C1 off the block"');
    const noPlay = renderToStaticMarkup(<CombatLane layout={l} kind="block" playerId={0} side="me" byId={byId} />);
    expect(noPlay).not.toContain('lane-unblock');
  });
});

describe('motion and marks', () => {
  it('knows which cards changed place (into a lane, between columns, back to the row)', () => {
    const a = placementKeys(lay(state([card(1, 0)], [card(9, 1), card(8, 1)], [band([9], [1]), band([8], [])])));
    const b = placementKeys(lay(state([card(1, 0)], [card(9, 1), card(8, 1)], [band([9], []), band([8], [1])])));
    expect(movedIds(a, b)).toEqual([1]);
    expect(movedIds(b, new Map())).toEqual([1, 8, 9]);
    expect(movedIds(new Map(), a)).toEqual([1, 8, 9]);
  });

  it('hides the summoning-sick mark in the other player’s combat only', () => {
    const s = (activePlayer: number, phase: string) => state([], [], null, { activePlayer, phase });
    expect(hideSickMark(s(1, 'COMBAT_DECLARE_BLOCKERS'), 0)).toBe(true);
    expect(hideSickMark(s(1, 'COMBAT_DECLARE_ATTACKERS'), 0)).toBe(true);
    expect(hideSickMark(s(1, 'MAIN1'), 0)).toBe(false);
    expect(hideSickMark(s(0, 'COMBAT_DECLARE_ATTACKERS'), 0)).toBe(false);
    expect(hideSickMark(null, 0)).toBe(false);
  });
});

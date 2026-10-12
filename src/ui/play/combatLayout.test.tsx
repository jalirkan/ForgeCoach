/*
 * ForgeCoach — ui/play/combatLayout.test.tsx
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The attack lane and the block lines (combatLayout.ts, CombatLane.tsx,
 * laneMotion.ts): who is in the attack lane and in what order, the target as
 * one label or a chip per card, a line from each attacker to each blocker
 * (confirmed and still being declared) while the blockers stay in their rows,
 * hidden information (a concealed id is never placed or joined; a face-down
 * attacker's hidden face is never read), the cards' own selectable attributes
 * inside the lane, and a server render of a lane.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { AnyCard, Card, CombatBand, GameStateBody } from '../../protocol.ts';
import { BoardMarksContext, PlayContext, type PlayInteraction } from '../cardContext.ts';
import { combatMarks } from './combatLines.ts';
import { combatLayout, hasAttackLane, hideSickMark, shortName, type LayoutNames } from './combatLayout.ts';
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
    const html = renderToStaticMarkup(<CombatLane layout={lay(state([card(1, 0)], [asRead], [band([9], [])]))} playerId={1} side="opp" byId={new Map([[9, asRead]])} />);
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
    const marks = combatMarks(s, new Map(), new Set([1]), [{ attackerId: 1, defender: { kind: 'card', id: 7 } }]);
    const l = combatLayout(s, names, marks);
    expect(l.columns).toEqual([]);
    expect(l.pendingChips.get(1)).toMatchObject({ label: 'Elspeth', initial: 'E' });
    expect(l.lines).toEqual([{ kind: 'target', from: { card: 1 }, to: { card: 7 }, pending: true }]);
  });
});

describe('blocks as lines', () => {
  it('joins each attacker to each of its blockers; the blockers stay in their rows', () => {
    const s = state([card(1, 0), card(2, 0), card(3, 0)], [card(9, 1, { tapped: true }), card(8, 1, { tapped: true })], [band([9], [1, 2]), band([8], [3])]);
    const l = lay(s);
    expect(l.lines).toEqual([
      { kind: 'block', from: { card: 9 }, to: { card: 1 }, pending: false },
      { kind: 'block', from: { card: 9 }, to: { card: 2 }, pending: false },
      { kind: 'block', from: { card: 8 }, to: { card: 3 }, pending: false },
    ]);
    expect([...l.placed].sort()).toEqual([8, 9]);
    expect(l.columns[0]!.weight).toBe(1.4);
    expect(hasAttackLane(l, 1)).toBe(true);
    expect(hasAttackLane(l, 0)).toBe(false);
  });

  it('draws the blocks being declared too (marked pending); a pick with no attacker is not joined', () => {
    const s = state([card(1, 0), card(2, 0)], [card(9, 1), card(8, 1)], [band([9], []), band([8], [])]);
    const l = lay(s, combatMarks(s, new Map([[1, 8], [2, null]])));
    expect(l.lines).toEqual([{ kind: 'block', from: { card: 8 }, to: { card: 1 }, pending: true }]);
    expect(l.placed.has(1)).toBe(false);
  });

  it('a blocker of two attackers gets a line from each', () => {
    const l = lay(state([card(1, 0)], [card(9, 1), card(8, 1)], [band([9], [1]), band([8], [1])]));
    expect(l.lines).toEqual([
      { kind: 'block', from: { card: 9 }, to: { card: 1 }, pending: false },
      { kind: 'block', from: { card: 8 }, to: { card: 1 }, pending: false },
    ]);
  });

  it('never joins a concealed blocker, nor an attacker listed as blocking itself', () => {
    expect(lay(state([hidden(1, 0)], [card(9, 1)], [band([9], [1])])).lines).toEqual([]);
    expect(lay(state([], [card(9, 1)], [band([9], [9])])).lines).toEqual([]);
  });
});

describe('the lane, rendered', () => {
  const atk = [card(9, 1, { tapped: true, attacking: true }), card(8, 1, { tapped: true, attacking: true })];
  const blk = card(1, 0, { blocking: true });
  const s = state([blk, card(2, 0)], atk, [band([9], [1]), band([8], [])]);
  const l = lay(s);
  const byId = new Map<number, Card>([...atk, blk].map((c) => [c.id, c]));

  it('an attack lane: the cards in the engine’s order, one target label, no list words, no blocker', () => {
    const html = renderToStaticMarkup(<CombatLane layout={l} playerId={1} side="opp" byId={byId} />);
    expect(html).toContain('data-combat-lane="attack"');
    expect([...html.matchAll(/data-lane-col="(\d+)"/g)].map((m) => m[1])).toEqual(['9', '8']);
    expect(html).toMatch(/data-lane-label="1"[^>]*>.*→.* You</);
    expect(html).not.toMatch(/unblocked|Combat</i);
    expect(html).not.toContain('lane-chip');
    expect(html).not.toContain('data-card-id="1"');
  });

  it('the attacker with a blocker wears its pair number; the other none', () => {
    const html = renderToStaticMarkup(
      <BoardMarksContext.Provider value={{ stack: new Map(), combat: combatMarks(s) }}>
        <CombatLane layout={l} playerId={1} side="opp" byId={byId} />
      </BoardMarksContext.Provider>,
    );
    expect(html.match(/tile-pair pair-attacker[^>]*>1</g)?.length).toBe(1);
    expect(html.match(/tile-pair/g)?.length).toBe(1);
  });

  it('the cards keep their own clicks: the engine’s selectable outline and data-mark', () => {
    const play: PlayInteraction = {
      mark: (c) => (c.id === 9 || c.id === 8 ? 'act' : null),
      hint: () => false,
      click: () => undefined,
      chosen: () => null,
      blockersFor: () => [],
      playerMark: () => false,
      clickPlayer: () => undefined,
    };
    const atkHtml = renderToStaticMarkup(
      <PlayContext.Provider value={play}>
        <CombatLane layout={l} playerId={1} side="opp" byId={byId} />
      </PlayContext.Provider>,
    );
    expect(atkHtml.match(/data-mark="act"/g)?.length).toBe(2);
  });
});

describe('motion and marks', () => {
  it('knows which cards changed place (into the lane, back to the row); a blocker never moves', () => {
    const a = placementKeys(lay(state([card(1, 0)], [card(9, 1), card(8, 1)], [band([9], [1]), band([8], [])])));
    const b = placementKeys(lay(state([card(1, 0)], [card(9, 1), card(8, 1)], [band([9], []), band([8], [1])])));
    expect(movedIds(a, b)).toEqual([]);
    expect(movedIds(b, new Map())).toEqual([8, 9]);
    expect(movedIds(new Map(), a)).toEqual([8, 9]);
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

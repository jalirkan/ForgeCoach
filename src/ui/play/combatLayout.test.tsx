/*
 * ForgeCoach — ui/play/combatLayout.test.tsx
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Combat on the board (combatLayout.ts, Board.tsx): attackers stay in their
 * own rows (Justin's play test, 2026-10-17: the attack lane is gone), tapped
 * with the attacking outline, with a line to what each attacks — the
 * defending player's portrait or the planeswalker — and a chip only when the
 * targets differ; a line from each attacker to each blocker (confirmed and
 * still being declared) while the blockers stay in their rows; hidden
 * information (a concealed id is never joined; a face-down attacker's hidden
 * face is never read); and a server render of the board in combat.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { AnyCard, Card, CombatBand, GameStateBody } from '../../protocol.ts';
import { combatMarks } from './combatLines.ts';
import { combatLayout, hideSickMark, shortName, type LayoutNames } from './combatLayout.ts';
import { Board } from '../Board.tsx';

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
      { id: 0, name: 'Justin', life: 20, poison: 0, manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 }, zones: zones(bf0) },
      { id: 1, name: 'Forge AI', life: 20, poison: 0, manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 }, zones: zones(bf1) },
    ],
    stack: [], stackCards: [], combat: bands ? { bands } : null, events: [], ...extra,
  } as unknown as GameStateBody;
}
const names: LayoutNames = { player: (id) => (id === 0 ? 'You' : 'The bot'), avatar: (id) => (id === 0 ? 'Justin' : 'Forge AI') };
const lay = (s: GameStateBody, marks = combatMarks(s)) => combatLayout(s, names, marks);

describe('attackers stay in their rows', () => {
  it('lists every attacker the engine lists, in its order, and nothing outside combat', () => {
    const s = state([card(1, 0)], [card(9, 1, { tapped: true }), card(7, 1, { tapped: true }), card(8, 1)], [band([9], []), band([7, 8], [])]);
    const l = lay(s);
    expect(l.attackers.map((c) => c.attackerId)).toEqual([9, 7, 8]);
    expect(l.attackers.every((c) => c.controller === 1)).toBe(true);
    expect(lay(state([card(1, 0)], [card(9, 1)], null)).attackers).toEqual([]);
    expect(lay(state([card(1, 0)], [card(9, 1)], [])).lines).toEqual([]);
  });

  it('never joins an id the viewer cannot see, and never reads a face-down attacker’s hidden face', () => {
    const fd = card(9, 1, { name: '', faceDown: true, alt: { name: 'Secret Morph' } as never, tapped: true });
    const s = state([card(1, 0)], [hidden(8, 1), fd], [band([8, 9], [])]);
    const l = lay(s);
    expect(l.attackers.map((c) => c.attackerId)).toEqual([9]);
    expect(JSON.stringify(l)).not.toContain('Secret Morph');
  });
});

describe('what each attacks', () => {
  it('a line from each attacker to the player’s portrait; no chip when they all attack the same', () => {
    const l = lay(state([card(1, 0)], [card(9, 1), card(8, 1)], [band([9], []), band([8], [])]));
    expect(l.lines).toEqual([
      { kind: 'target', from: { card: 9 }, to: { player: 0 }, pending: false },
      { kind: 'target', from: { card: 8 }, to: { player: 0 }, pending: false },
    ]);
    expect(l.chips.size).toBe(0);
    expect(l.attackers[0]!.target).toMatchObject({ kind: 'player', id: 0, label: 'You', initial: 'J' });
  });

  it('targets that differ: a chip on each card as well, and a line to the planeswalker', () => {
    const karn = card(5, 0, { name: 'Karn, Scion of Urza', types: 'Legendary Planeswalker - Karn', power: null, toughness: null });
    const l = lay(state([karn], [card(9, 1), card(8, 1)], [band([9], [], { kind: 'card', id: 5 }), band([8], [])]));
    expect([...l.chips].map(([id, t]) => [id, t.label, t.initial])).toEqual([
      [9, 'Karn', 'K'],
      [8, 'You', 'J'],
    ]);
    expect(l.lines).toEqual([
      { kind: 'target', from: { card: 9 }, to: { card: 5 }, pending: false },
      { kind: 'target', from: { card: 8 }, to: { player: 0 }, pending: false },
    ]);
  });

  it('a face-down defender is "a permanent", and a null defender gets no line or chip', () => {
    const fd = card(5, 0, { name: '', faceDown: true });
    const l = lay(state([fd], [card(9, 1), card(8, 1)], [band([9], [], { kind: 'card', id: 5 }), band([8], [], null)]));
    expect(l.attackers[0]!.target).toMatchObject({ label: 'a permanent', initial: '?' });
    expect(l.attackers[1]!.target).toBe(null);
    expect(l.chips.has(8)).toBe(false);
    expect(l.lines.filter((x) => x.from.card === 8)).toEqual([]);
    expect(shortName('Jace Beleren')).toBe('Jace Beleren');
  });

  it('an attacker still being declared gets its line, pending — and a chip at a planeswalker (M65 chosen.attacks)', () => {
    const pw = card(7, 1, { name: 'Elspeth, Sun’s Champion', types: 'Legendary Planeswalker - Elspeth' });
    const s = state([card(1, 0), card(2, 0)], [pw], null, { activePlayer: 0, phase: 'COMBAT_DECLARE_ATTACKERS' });
    const marks = combatMarks(s, new Map(), new Set([1, 2]), [{ attackerId: 1, defender: { kind: 'card', id: 7 } }, { attackerId: 2, defender: { kind: 'player', id: 1 } }]);
    const l = combatLayout(s, names, marks);
    expect(l.attackers).toEqual([]);
    expect(l.chips.get(1)).toMatchObject({ label: 'Elspeth', initial: 'E' });
    expect(l.chips.has(2)).toBe(false);
    expect(l.lines).toEqual([
      { kind: 'target', from: { card: 1 }, to: { card: 7 }, pending: true },
      { kind: 'target', from: { card: 2 }, to: { player: 1 }, pending: true },
    ]);
  });
});

describe('blocks as lines', () => {
  const blocks = (l: ReturnType<typeof lay>) => l.lines.filter((x) => x.kind === 'block');
  it('joins each attacker to each of its blockers', () => {
    const s = state([card(1, 0), card(2, 0), card(3, 0)], [card(9, 1, { tapped: true }), card(8, 1, { tapped: true })], [band([9], [1, 2]), band([8], [3])]);
    expect(blocks(lay(s))).toEqual([
      { kind: 'block', from: { card: 9 }, to: { card: 1 }, pending: false },
      { kind: 'block', from: { card: 9 }, to: { card: 2 }, pending: false },
      { kind: 'block', from: { card: 8 }, to: { card: 3 }, pending: false },
    ]);
  });

  it('draws the blocks being declared too (marked pending); a pick with no attacker is not joined', () => {
    const s = state([card(1, 0), card(2, 0)], [card(9, 1), card(8, 1)], [band([9], []), band([8], [])]);
    expect(blocks(lay(s, combatMarks(s, new Map([[1, 8], [2, null]]))))).toEqual([{ kind: 'block', from: { card: 8 }, to: { card: 1 }, pending: true }]);
  });

  it('a blocker of two attackers gets a line from each', () => {
    expect(blocks(lay(state([card(1, 0)], [card(9, 1), card(8, 1)], [band([9], [1]), band([8], [1])])))).toEqual([
      { kind: 'block', from: { card: 9 }, to: { card: 1 }, pending: false },
      { kind: 'block', from: { card: 8 }, to: { card: 1 }, pending: false },
    ]);
  });

  it('never joins a concealed blocker, nor an attacker listed as blocking itself', () => {
    expect(blocks(lay(state([hidden(1, 0)], [card(9, 1)], [band([9], [1])])))).toEqual([]);
    expect(blocks(lay(state([], [card(9, 1)], [band([9], [9])])))).toEqual([]);
  });
});

describe('the board in combat, rendered', () => {
  const log = { frames: [], hello: null, header: null, over: null, seat: 0 } as never;
  const atk = [card(9, 1, { tapped: true, attacking: true }), card(8, 1, { tapped: true, attacking: true }), card(6, 1)];
  const blk = card(1, 0, { blocking: true });
  const s = state([blk, card(2, 0)], atk, [band([9], [1]), band([8], [])]);
  let cached: string | null = null;
  const board = () => (cached ??= renderToStaticMarkup(<Board log={log} state={s} frameIndex={0} seat={0} />));
  /** The markup of one player's side. */
  const side = (cls: string) => {
    const html = board();
    return html.slice(html.indexOf(`class="player ${cls}`), html.indexOf('</section>', html.indexOf(`class="player ${cls}`)));
  };
  const tileOf = (h: string, id: number) => h.slice(h.lastIndexOf('<div class="tile', h.indexOf(`data-card-id="${id}"`)), h.indexOf(`data-card-id="${id}"`));

  it('has no attack lane: each attacker is in its own side’s creature row, tapped, with the attacking outline', () => {
    expect(board()).not.toMatch(/combat-lane|data-combat-lane|data-lane/);
    const theirs = side('player-top');
    const row = theirs.slice(theirs.indexOf('bf-row-permanents'));
    for (const id of [9, 8]) {
      expect(row).toContain(`data-card-id="${id}"`);
      expect(tileOf(theirs, id)).toMatch(/is-tapped/);
      expect(tileOf(theirs, id)).toMatch(/is-attacking/);
    }
    // In the engine's row order, with the one that stayed home beside them.
    expect([...row.matchAll(/class="tile [^"]*"[^>]*data-card-id="(\d+)"/g)].map((m) => m[1])).toEqual(['9', '8', '6']);
    expect(tileOf(theirs, 6)).not.toMatch(/is-attacking/);
  });

  it('the blocker stays in its row, and the attacker and its blocker wear the same badge, joined by a line', () => {
    const mine = side('player-me');
    expect(mine.slice(mine.indexOf('bf-row-permanents'))).toContain('data-card-id="1"');
    expect(board()).toMatch(/is-pair-attacker[\s\S]*tile-pair pair-attacker[^>]*>1</);
    expect(board()).toMatch(/is-pair-blocker[\s\S]*tile-pair pair-blocker[^>]*>1</);
    expect(lay(s).lines).toContainEqual({ kind: 'block', from: { card: 9 }, to: { card: 1 }, pending: false });
  });

  it('a line from each attacker to your portrait, which the arrows find by its player id', () => {
    expect(lay(s).lines.filter((x) => x.kind === 'target')).toEqual([
      { kind: 'target', from: { card: 9 }, to: { player: 0 }, pending: false },
      { kind: 'target', from: { card: 8 }, to: { player: 0 }, pending: false },
    ]);
    expect(side('player-me')).toMatch(/class="avatar avatar-me"[^>]*data-player-id="0"/);
  });
});

describe('marks', () => {
  it('hides the summoning-sick mark in the other player’s combat only', () => {
    const s = (activePlayer: number, phase: string) => state([], [], null, { activePlayer, phase });
    expect(hideSickMark(s(1, 'COMBAT_DECLARE_BLOCKERS'), 0)).toBe(true);
    expect(hideSickMark(s(1, 'COMBAT_DECLARE_ATTACKERS'), 0)).toBe(true);
    expect(hideSickMark(s(1, 'MAIN1'), 0)).toBe(false);
    expect(hideSickMark(s(0, 'COMBAT_DECLARE_ATTACKERS'), 0)).toBe(false);
    expect(hideSickMark(null, 0)).toBe(false);
  });
});

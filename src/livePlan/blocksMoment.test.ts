/*
 * ForgeCoach — livePlan/blocksMoment.test.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Auto-coach's blocks moment (common-sense pass, "auto-coach missed the blocks
 * moment", 2026-10-10 turn 24: ten attackers at 5 life, the block
 * declaration came and went with no plan). The moment is due from the
 * attack declaration on — while the bot still holds priority — so the plan is
 * there by the block input; the block input still asks it if that did not,
 * and it is one moment (`blocks:<turn>`), asked once.
 */
import { describe, expect, it } from 'vitest';
import type { GameStateBody, InputBody } from '../protocol.ts';
import { blocksDueEarly, dueMoment, momentAt } from './moments.ts';

const ME = 0;
const BOT = 1;

function c(id: number, name: string, controller: number, extra: Record<string, unknown> = {}) {
  return { id, name, controller, owner: controller, zone: 'battlefield', types: 'Creature — Construct', power: '4', toughness: '4', tapped: false, sick: false, attacking: false, blocking: false, counters: {}, keywords: [], abilities: [], attachmentIds: [], attachedToId: null, damage: 0, token: true, faceDown: false, ...extra };
}

function state(phase: string, opts: { blockers?: number[]; mineTapped?: boolean } = {}): GameStateBody {
  const zone = (cards: unknown[] = []) => ({ count: cards.length, cards });
  return {
    gameId: 'g', turn: 24, round: 12, phase, activePlayer: BOT, priority: BOT, gameOver: null,
    players: [
      { id: ME, name: 'Justin', life: 5, poison: 0, counters: {}, manaPool: {}, zones: { hand: zone(), battlefield: zone([c(10, 'Phyrexian Myr Token', ME, { power: '1', toughness: '1', tapped: !!opts.mineTapped })]), graveyard: zone(), exile: zone(), command: zone(), library: { count: 20, cards: [] } } },
      { id: BOT, name: 'Search AI', life: 20, poison: 0, counters: {}, manaPool: {}, zones: { hand: { count: 3, cards: [] }, battlefield: zone([c(297, 'Construct Token', BOT, { attacking: true }), c(298, 'Construct Token', BOT, { attacking: true })]), graveyard: zone(), exile: zone(), command: zone(), library: { count: 20, cards: [] } } },
    ],
    stack: [], stackCards: [], events: [],
    combat: { bands: [{ attackerIds: [297, 298], defender: { kind: 'player', id: ME }, blockerIds: opts.blockers ?? [], damageOrder: [] }] },
  } as unknown as GameStateBody;
}

const waiting = { prompt: 'Waiting for Search AI...', buttons: { ok: { label: 'OK', enabled: false }, cancel: { label: 'Cancel', enabled: false } }, selectable: { cardIds: [], min: 0, max: 0, mode: 'none' } } as unknown as InputBody;
const blockInput = { prompt: 'Select creatures to block Construct Token (297) or select another attacker to declare blockers for.', buttons: { ok: { label: 'OK', enabled: true }, cancel: { label: '', enabled: false } }, selectable: { cardIds: [10, 297, 298], min: 0, max: 0, mode: 'none' } } as unknown as InputBody;
const at = (s: GameStateBody, input: InputBody | null) => ({ frames: [], state: s, input, ask: null, me: ME, oracle: null });

describe('the blocks moment', () => {
  it('is due as soon as the attack is declared, while the bot holds priority', () => {
    const s = state('COMBAT_DECLARE_ATTACKERS');
    expect(blocksDueEarly(s, ME, waiting)).toBe(true);
    const m = momentAt(at(s, waiting));
    expect(m?.kind).toBe('blocks');
    expect(m?.id).toBe('blocks:24');
    expect(m?.question).toMatch(/Declare your blockers/);
  });

  it('the block input is the same moment: asked early, not asked again', () => {
    const m = momentAt(at(state('COMBAT_DECLARE_BLOCKERS'), blockInput));
    expect(m?.id).toBe('blocks:24');
    expect(dueMoment(at(state('COMBAT_DECLARE_BLOCKERS'), blockInput), new Set(['blocks:24']))).toBeNull();
  });

  it('not when nothing of yours can block, blocks are declared, or it is your own turn', () => {
    expect(blocksDueEarly(state('COMBAT_DECLARE_ATTACKERS', { mineTapped: true }), ME, waiting)).toBe(false);
    expect(blocksDueEarly(state('COMBAT_DECLARE_BLOCKERS', { blockers: [10] }), ME, waiting)).toBe(false);
    expect(blocksDueEarly({ ...state('COMBAT_DECLARE_ATTACKERS'), activePlayer: ME } as GameStateBody, ME, waiting)).toBe(false);
    expect(blocksDueEarly(state('COMBAT_DAMAGE'), ME, waiting)).toBe(false);
  });
});

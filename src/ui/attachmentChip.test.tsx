/*
 * ForgeCoach — ui/attachmentChip.test.tsx
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * An aura or equipment drawn on its host (CardTile's attachment chip) is a card
 * of its own for clicks: the play context decides, as for a tile. The test
 * environment is node (no DOM), so the click path is tested through
 * `activateCard` — the one function a tile's and a chip's onClick / Enter run —
 * and the chip's marks through the server renderer.
 */
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { AnyCard, Card } from '../protocol.ts';
import { activateCard, CardTile } from './CardTile.tsx';
import { PlayContext, type PlayInteraction, type PlayMark } from './cardContext.ts';

function card(id: number, name: string, extra: Partial<Card> = {}): Card {
  return {
    id,
    name,
    manaCost: null,
    types: 'Creature - Bear',
    power: '2',
    toughness: '2',
    loyalty: null,
    tapped: false,
    sick: false,
    attacking: false,
    blocking: false,
    damage: 0,
    counters: {},
    token: false,
    faceDown: false,
    alt: null,
    attachedToId: null,
    attachmentIds: [],
    controller: 0,
    owner: 0,
    zone: 'battlefield',
    abilities: [],
    keywords: [],
    ...extra,
  } as unknown as Card;
}

const host = card(10, 'Grizzly Bears', { attachmentIds: [11] });
const clamp = card(11, 'Skullclamp', { types: 'Artifact - Equipment', power: null, toughness: null, attachedToId: 10 });

function playWith(marks: Record<number, PlayMark>, click = vi.fn<(c: AnyCard) => void>()): PlayInteraction {
  return {
    mark: (c) => marks[c.id] ?? null,
    hint: () => false,
    click,
    chosen: () => null,
    blockersFor: () => [],
    playerMark: () => false,
    clickPlayer: () => undefined,
  };
}

function chipHtml(play: PlayInteraction | null): string {
  const tile = <CardTile card={host} attachments={[clamp]} side="me" />;
  const html = renderToStaticMarkup(play ? <PlayContext.Provider value={play}>{tile}</PlayContext.Provider> : tile);
  const m = /<span class="attach-chip[^>]*>/.exec(html);
  expect(m).not.toBeNull();
  return m![0];
}

describe('attachment chip: a click', () => {
  it('in play, on an attached card the context marks playable, sends the click with that card', () => {
    const click = vi.fn<(c: AnyCard) => void>();
    const open = vi.fn();
    const play = playWith({ 11: 'act' }, click);
    expect(activateCard(clamp, play, open)).toBe('act');
    expect(click).toHaveBeenCalledTimes(1);
    expect(click.mock.calls[0]![0].id).toBe(11);
    expect(open).not.toHaveBeenCalled();
  });

  it('in play, on an attached card the engine asks for (a sacrifice, a target), sends the click', () => {
    const click = vi.fn<(c: AnyCard) => void>();
    const open = vi.fn();
    expect(activateCard(clamp, playWith({ 11: 'select' }, click), open)).toBe('act');
    expect(click.mock.calls.map(([c]) => c.id)).toEqual([11]);
    expect(open).not.toHaveBeenCalled();
  });

  it('in play, on an attached card nothing drives, opens details', () => {
    const click = vi.fn<(c: AnyCard) => void>();
    const open = vi.fn();
    // The host may be clickable; the chip answers for its own card.
    expect(activateCard(clamp, playWith({ 10: 'act' }, click), open)).toBe('open');
    expect(click).not.toHaveBeenCalled();
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('without a play context (replay, watch), opens details', () => {
    const open = vi.fn();
    expect(activateCard(clamp, null, open)).toBe('open');
    expect(open).toHaveBeenCalledTimes(1);
  });
});

describe('attachment chip: marks', () => {
  it('a playable attached card is marked as a tile is', () => {
    const tag = chipHtml(playWith({ 11: 'act' }));
    expect(tag).toMatch(/class="attach-chip[^"]*\bis-act\b/);
    expect(tag).toContain('data-mark="act"');
    expect(tag).toContain('data-card-id="11"');
  });

  it('a selectable attached card pulses as selectable and says so', () => {
    const tag = chipHtml(playWith({ 11: 'select' }));
    expect(tag).toMatch(/class="attach-chip[^"]*\bis-select\b/);
    expect(tag).toContain('data-mark="select"');
    expect(tag).toMatch(/aria-label="Attached: Skullclamp, selectable/);
  });

  it('carries no mark when the context marks only the host, or without a play context', () => {
    for (const tag of [chipHtml(playWith({ 10: 'act' })), chipHtml(null)]) {
      expect(tag).not.toMatch(/\bis-(act|select)\b/);
      expect(tag).not.toContain('data-mark');
      expect(tag).toContain('tabindex="0"');
      expect(tag).toContain('role="button"');
    }
  });
});

/*
 * ForgeCoach — ui/tokenPlaceholder.test.tsx
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * A token with no art draws a compact, translucent label (the .is-ph card);
 * a real card, or a token whose art is on hand, is unchanged. Server render.
 */
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Card } from '../protocol.ts';
import { emptyCard, type CardInfo } from '../cards.ts';
import { CardFace } from './CardTile.tsx';

function card(over: Partial<Card>): Card {
  return {
    id: 1, name: 'Bird Token', setCode: null, manaCost: null, types: 'Creature - Bird', power: '1', toughness: '1', loyalty: null, damage: 0, counters: {},
    tapped: false, sick: false, attacking: false, blocking: false, faceDown: false, token: true, alt: null, attachedToId: null, attachmentIds: [],
    controller: 0, owner: 0, zone: 'battlefield', abilities: [], keywords: [], ...over,
  } as unknown as Card;
}
const face = (c: Card, info?: CardInfo) => renderToStaticMarkup(<CardFace card={c} info={info} kind="creature" />);

describe('the token placeholder', () => {
  it('a token with no art is the compact placeholder: name, type and the token glyph', () => {
    const html = face(card({}));
    expect(html).toContain('tile-card is-ph');
    expect(html).toContain('tile-token-mark');
    expect(html).toContain('>Bird Token<');
    expect(html).toContain('Creature');
  });
  it('a token Scryfall had no art for is the same placeholder', () => {
    expect(face(card({}), emptyCard('Bird Token'))).toContain('is-ph');
  });
  it('a real card, with or without art, is not a placeholder', () => {
    const html = face(card({ name: 'Grizzly Bears', token: false, types: 'Creature - Bear', power: '2', toughness: '2' }));
    expect(html).not.toContain('is-ph');
    expect(html).not.toContain('tile-token-mark');
    expect(html).toContain('tile-face');
  });
  it('a face-down token is not labelled with a name it does not show', () => {
    expect(face(card({ faceDown: true, name: '' }))).not.toContain('is-ph');
  });
  it('the CSS keeps it translucent and card-sized: no opaque fill, display only inside .is-ph', () => {
    const css = readFileSync(new URL('./cards.css', import.meta.url), 'utf8');
    const rule = (sel: string) => css.slice(css.indexOf(sel)).match(/\{[^}]*\}/)![0];
    expect(rule('.tile .tile-card.is-ph .tile-face {')).toMatch(/background:[^;]*55%, transparent/);
    expect(rule('.tile .tile-card.is-ph {')).toMatch(/background: transparent/);
    expect(rule('.tile-token-mark {')).toMatch(/display: none/);
    expect(rule('.tile .tile-card.is-ph .tile-face {')).not.toMatch(/width|height/); // sized by .tile-card, as before
  });
});

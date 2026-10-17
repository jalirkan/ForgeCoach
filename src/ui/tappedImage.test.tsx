/*
 * ForgeCoach — ui/tappedImage.test.tsx
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * A card whose image this page has shown keeps it on a fresh mount. Tapping
 * remounts a tile (a land leaves its untapped pile for a tapped one, an
 * attacker moves into the combat lane); the new tile used to start with its
 * image at opacity 0 and lazy, so a tapped card went blank until the image
 * loaded again (Justin's watch, 2026-10-17).
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { mapScryfallCard, type ScryfallCard } from '../cards.ts';
import type { Card } from '../protocol.ts';
import { CardFace, noteImageShown } from './CardTile.tsx';

const img = (p: string) => ({ small: `${p}-s`, normal: `${p}-n`, large: `${p}-l`, art_crop: `${p}-a` });
const card = (name: string, extra: Partial<Card> = {}): Card =>
  ({
    id: 7, name, setCode: null, manaCost: null, types: 'Basic Land - Island', power: null, toughness: null, loyalty: null, damage: 0, counters: {},
    tapped: false, sick: false, attacking: false, blocking: false, faceDown: false, token: false, alt: null, attachedToId: null, attachmentIds: [],
    controller: 0, owner: 0, zone: 'battlefield', abilities: [], keywords: [], ...extra,
  }) as unknown as Card;

describe('a tile that remounts keeps its image', () => {
  it('a card never shown starts on its text face, its image lazy', () => {
    const info = mapScryfallCard('Swamp', { object: 'card', name: 'Swamp', type_line: 'Basic Land — Swamp', image_uris: img('swamp') } as ScryfallCard);
    const html = renderToStaticMarkup(<CardFace card={card('Swamp', { tapped: true })} info={info} kind="land" />);
    expect(html).not.toContain('has-img');
    expect(html).toContain('loading="lazy"');
  });
  it('once shown, a fresh mount of the tapped card draws the image at once, eagerly', () => {
    const info = mapScryfallCard('Island', { object: 'card', name: 'Island', type_line: 'Basic Land — Island', image_uris: img('island') } as ScryfallCard);
    noteImageShown('island-n');
    const html = renderToStaticMarkup(<CardFace card={card('Island', { tapped: true })} info={info} kind="land" />);
    expect(html).toMatch(/class="tile-card has-img"/);
    expect(html).toContain('loading="eager"');
  });
});

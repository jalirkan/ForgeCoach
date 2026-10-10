/*
 * ForgeCoach — cardFaceArt.test.tsx
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * A double-faced card draws the face the wire names (Forge's current face), not
 * the front; a face-down card draws no face at all.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { imageForCard, imageForFace, mapScryfallCard, type ScryfallCard } from './cards.ts';
import type { Card } from './protocol.ts';
import { CardFace } from './ui/CardTile.tsx';
import { typeKind } from './ui/util.ts';

const img = (p: string) => ({ small: `${p}-s`, normal: `${p}-n`, large: `${p}-l`, art_crop: `${p}-a` });

const veteran: ScryfallCard = {
  object: 'card',
  name: 'Lunarch Veteran // Luminous Phantom',
  layout: 'transform',
  card_faces: [
    { name: 'Lunarch Veteran', mana_cost: '{W}', type_line: 'Creature — Human Cleric', oracle_text: 'front', image_uris: img('front') },
    { name: 'Luminous Phantom', mana_cost: '', type_line: 'Creature — Spirit Cleric', oracle_text: 'back', image_uris: img('back') },
  ],
} as ScryfallCard;
const meld: ScryfallCard = { object: 'card', name: 'Gisela, the Broken Blade', layout: 'meld', mana_cost: '{2}{W}{W}', type_line: 'Legendary Creature — Angel Horror', image_uris: img('gisela') } as ScryfallCard;
const plain: ScryfallCard = { object: 'card', name: 'Shock', mana_cost: '{R}', type_line: 'Instant', image_uris: img('shock') };
const adventure: ScryfallCard = {
  object: 'card',
  name: 'Bonecrusher Giant // Stomp',
  layout: 'adventure',
  image_uris: img('bone'),
  card_faces: [
    { name: 'Bonecrusher Giant', type_line: 'Creature — Giant' },
    { name: 'Stomp', type_line: 'Instant — Adventure' },
  ],
} as ScryfallCard;

describe('imageForFace', () => {
  const info = mapScryfallCard('Lunarch Veteran', veteran);
  it('keeps every face image, art crop included', () => {
    expect(info.faces?.map((f) => f.image?.artCrop)).toEqual(['front-a', 'back-a']);
  });
  it('picks the face the wire names, in either order', () => {
    expect(imageForFace(info, 'Lunarch Veteran')?.normal).toBe('front-n');
    expect(imageForFace(info, 'Luminous Phantom')?.normal).toBe('back-n');
    expect(imageForFace(info, 'luminous phantom')?.artCrop).toBe('back-a');
    const swapped = mapScryfallCard('x', { ...veteran, card_faces: [...veteran.card_faces!].reverse() });
    expect(imageForFace(swapped, 'Luminous Phantom')?.normal).toBe('back-n');
    expect(imageForFace(swapped, 'Lunarch Veteran')?.normal).toBe('front-n');
  });
  it('tries each half of an "A // B" name, and Forge\'s single slash', () => {
    expect(imageForFace(info, 'Lunarch Veteran // Luminous Phantom')?.normal).toBe('front-n');
    expect(imageForFace(info, 'Foo // Luminous Phantom')?.normal).toBe('back-n');
    expect(imageForFace(info, 'Foo / Luminous Phantom')?.normal).toBe('back-n');
  });
  it('falls back to the first face with an image, then the card\'s own', () => {
    expect(imageForFace(info, 'Something Else')?.normal).toBe('front-n');
    expect(imageForFace(info, null)?.normal).toBe('front-n');
    expect(imageForFace(undefined, 'x')).toBeUndefined();
  });
  it('a meld card, a plain card and an adventure keep their one image', () => {
    expect(imageForFace(mapScryfallCard('Gisela, the Broken Blade', meld), 'Gisela, the Broken Blade')?.normal).toBe('gisela-n');
    expect(imageForFace(mapScryfallCard('Brisela', meld), 'Brisela, Voice of Nightmares')?.normal).toBe('gisela-n');
    expect(imageForFace(mapScryfallCard('Shock', plain), 'Shock')?.artCrop).toBe('shock-a');
    expect(imageForFace(mapScryfallCard('Bonecrusher Giant', adventure), 'Stomp')?.normal).toBe('bone-n');
  });
  it('a face-down card gets no image, whatever its name or alt', () => {
    expect(imageForCard(info, { name: 'Luminous Phantom', faceDown: true })).toBeUndefined();
    expect(imageForCard(info, { name: '', faceDown: true })).toBeUndefined();
    expect(imageForCard(info, { name: 'Luminous Phantom', faceDown: false })?.normal).toBe('back-n');
  });
});

function card(name: string, extra: Partial<Card> = {}): Card {
  return {
    id: 1, name, setCode: null, manaCost: null, types: 'Creature', power: '1', toughness: '1', loyalty: null, damage: 0, counters: {},
    tapped: false, sick: false, attacking: false, blocking: false, faceDown: false, token: false, alt: null, attachedToId: null, attachmentIds: [],
    controller: 0, owner: 0, zone: 'battlefield', abilities: [], keywords: [], ...extra,
  } as unknown as Card;
}

describe('CardFace on a double-faced card', () => {
  const info = mapScryfallCard('Luminous Phantom', veteran);
  const draw = (c: Card) => renderToStaticMarkup(<CardFace card={c} info={info} kind={typeKind(c.types)} />);
  it('a transformed card tile uses the back image and art crop', () => {
    const html = draw(card('Luminous Phantom'));
    expect(html).toContain('back-n');
    expect(html).toContain('back-a');
    expect(html).not.toContain('front-');
  });
  it('the front face still uses the front image', () => {
    const html = draw(card('Lunarch Veteran'));
    expect(html).toContain('front-n');
    expect(html).not.toContain('back-');
  });
  it('a face-down card draws no image at all', () => {
    const html = draw(card('', { faceDown: true, alt: { name: 'Lunarch Veteran' } as unknown as Card['alt'] }));
    expect(html).not.toContain('front-');
    expect(html).not.toContain('back-');
    expect(html).not.toContain('<img');
  });
});

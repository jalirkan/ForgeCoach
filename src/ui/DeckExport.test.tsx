/*
 * ForgeCoach — ui/DeckExport.test.tsx
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The export is one tap from the deck editor (Draft vs AI and Draft with a
 * friend) whether the deck was picked by hand or suggested, and its count is
 * the deck on screen. The test environment is node: the server renderer.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { buildDecks } from '../cube/builder.ts';
import { context, samplePool } from '../cube/testdata/load.ts';
import { deckCount, deckFromBuild, exportList, initialDeck, moveCard, setBasic } from '../draft/deck.ts';
import { countLine } from '../cube/deckExport.ts';
import { DeckEditor } from './draft/DeckEditor.tsx';
import { DeckExport } from './DeckExport.tsx';

const ctx = context('synergy');
const pool = samplePool(ctx.cube, 'UR', 45, 7);
const noop = () => {};

function editor(deck: ReturnType<typeof initialDeck>) {
  return renderToStaticMarkup(<DeckEditor ctx={ctx} pool={pool} deck={deck} onDeck={noop} onSubmit={noop} onBack={noop} deckName="Test deck" />);
}
const copyButtons = (html: string) => html.match(/data-testid="copy-deck"/g)?.length ?? 0;

describe('deck export in the deck editor', () => {
  it('after Suggest a build: Copy list in the stat bar and the dock, and the panel with the count', () => {
    const deck = deckFromBuild(buildDecks(ctx, pool)[0]!, pool);
    const html = editor(deck);
    expect(copyButtons(html)).toBe(3); // stat bar, phone dock, panel
    expect(html).toContain('Copy deck list');
    expect(html).toContain(`>${countLine(exportList('Test deck', deck))}<`);
    expect(countLine(exportList('Test deck', deck))).toMatch(/^40 cards \+ \d+ sideboard$/);
  });

  it('after picking by hand: the same buttons, the count following the deck on screen', () => {
    let deck = initialDeck(pool);
    deck = moveCard(moveCard(deck, deck.main[0]!, 'side'), deck.main[1]!, 'side');
    deck = setBasic(deck, 'U', 9);
    const html = editor(deck);
    expect(copyButtons(html)).toBe(3);
    expect(html).toContain(`>${deckCount(deck)} cards + 2 sideboard<`);
  });

  it('the panel offers the downloads and shows no list until asked', () => {
    const html = renderToStaticMarkup(<DeckExport list={exportList('x', initialDeck(pool))} />);
    for (const t of ['.txt', 'Forge .dck', 'Cockatrice .cod', 'Show list']) expect(html).toContain(t);
    expect(html).not.toContain('<textarea');
  });
});

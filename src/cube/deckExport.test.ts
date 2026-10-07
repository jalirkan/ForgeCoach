// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { codFileText, countLine, countNames, deckListText, deckSlug, dckFileText, exportName, makeDeckList } from './deckExport.ts';
import { buildDecks, listFromBuild, mainDeck } from './builder.ts';
import { deckFromBuild, exportList, initialDeck, moveCard, setBasic } from '../draft/deck.ts';
import { context, loadCube, samplePool } from './testdata/load.ts';

describe('deck list text', () => {
  it('writes Deck, the counts, a blank line, Sideboard — basics last with their counts', () => {
    const l = makeDeckList('Test', [[1, 'Lightning Bolt'], [9, 'Mountain'], [2, 'Counterspell'], [8, 'Island'], [1, 'Lightning Bolt']], [[1, 'Opt'], [1, 'Abrade']]);
    expect(deckListText(l)).toBe(['Deck', '2 Counterspell', '2 Lightning Bolt', '8 Island', '9 Mountain', '', 'Sideboard', '1 Abrade', '1 Opt', ''].join('\n'));
    expect(countLine(l)).toBe('21 cards + 2 sideboard');
  });

  it('leaves the Sideboard section out when the sideboard is empty', () => {
    const l = makeDeckList('Test', [[17, 'Forest'], [23, 'Grizzly Bears']], []);
    expect(deckListText(l)).toBe('Deck\n23 Grizzly Bears\n17 Forest\n');
    expect(countLine(l)).toBe('40 cards, no sideboard');
    expect(dckFileText(l)).toBe('[metadata]\nName=Test\n[Main]\n23 Grizzly Bears\n17 Forest\n[Sideboard]\n');
  });

  // The portable form (Arena's own export; MTGO, Moxfield, Cockatrice, untap.in
  // and Forge read it): a split card as "A // B", a DFC / adventure / flip card
  // by its front face — the cube documents already name them so, and the
  // export keeps the names as given, only tidying what a paste brings in.
  it('names split cards "A // B" and double-faced and adventure cards by their front face', () => {
    expect(exportName('Fire // Ice')).toBe('Fire // Ice');
    expect(exportName('Fire / Ice')).toBe('Fire // Ice');
    expect(exportName('Delver of Secrets')).toBe('Delver of Secrets');
    expect(exportName('Bonecrusher Giant')).toBe('Bonecrusher Giant');
    expect(exportName('Man-o’-War')).toBe("Man-o'-War");
    expect(exportName('Lightning Bolt|M10')).toBe('Lightning Bolt');
    // The cube's own names for those cards are already the portable ones.
    const names = new Set(loadCube('fair-fight').cards.map((c) => c.name));
    for (const n of ['Fire // Ice', 'Delver of Secrets', 'Brazen Borrower', 'Bonecrusher Giant', 'Murderous Rider']) {
      expect(names.has(n), n).toBe(true);
      expect(exportName(n)).toBe(n);
    }
  });

  it('writes a Cockatrice .cod with escaped names', () => {
    const cod = codFileText(makeDeckList('R&D <test>', [[1, 'Fire // Ice'], [16, 'Mountain']], [[1, 'Opt']]));
    expect(cod).toContain('<deckname>R&amp;D &lt;test&gt;</deckname>');
    expect(cod).toContain('<zone name="main">\n    <card number="1" name="Fire // Ice"/>\n    <card number="16" name="Mountain"/>\n  </zone>');
    expect(cod).toContain('<zone name="side">\n    <card number="1" name="Opt"/>');
    expect(codFileText(makeDeckList('x', [[1, 'Opt']]))).not.toContain('name="side"');
  });

  it('slugs file names', () => {
    expect(deckSlug('Justin’s Vintage Cube deck')).toBe('justin-s-vintage-cube-deck');
    expect(countNames(['Opt', 'Opt', 'Island'])).toEqual([[2, 'Opt'], [1, 'Island']]);
  });
});

describe('the deck on screen, exported', () => {
  const ctx = context('synergy');
  const pool = samplePool(ctx.cube, 'UR', 45, 7);
  const b = buildDecks(ctx, pool)[0]!;

  it('the builder: the 40 and the rest of the pool', () => {
    const l = listFromBuild(b, pool, 'Pool — UR');
    expect(countLine(l)).toBe(`40 cards + ${pool.length - b.spells.length - b.nonbasics.length} sideboard`);
    expect(l.main.reduce((s, [q]) => s + q, 0)).toBe(mainDeck(b).reduce((s, [q]) => s + q, 0));
  });

  it('Suggest a build (Draft vs AI / with a friend): the same deck as the builder', () => {
    const d = deckFromBuild(b, pool);
    expect(deckListText(exportList('x', d))).toBe(deckListText(listFromBuild(b, pool, 'x')));
  });

  it('a deck picked by hand: exactly what is on screen, basics counted, the rest on the side', () => {
    let d = initialDeck(pool);
    d = moveCard(d, d.main[0]!, 'side');
    d = setBasic(setBasic(d, 'U', 8), 'R', 7);
    const l = exportList('x', d);
    const text = deckListText(l);
    expect(text).toContain('\n8 Island\n7 Mountain\n');
    expect(countLine(l)).toBe(`${d.main.length + 15} cards + 1 sideboard`);
    expect(text.trimEnd().endsWith(`1 ${d.side[0]}`)).toBe(true);
  });
});

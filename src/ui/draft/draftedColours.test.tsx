/*
 * ForgeCoach — ui/draft/draftedColours.test.tsx
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The cube page's "Drafted colours (real drafts)" panel (mtg-table D455): none
 * yet, a helper that cannot say, and three real Omega decks — counts, intervals,
 * and never a card name (the helper sends none).
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { parseDraftDecks } from '../../cube/draftShares.ts';
import { DraftedColoursView } from './DraftedColours.tsx';

const OMEGA = parseDraftDecks(
  {
    ok: true,
    v: 1,
    cube: 'omega',
    scripts: true,
    decks: [
      { source: 'room', day: '2026-10-17', format: 'grid', spells: { W: 3, U: 9, B: 5, R: 5, G: 6 }, colourless: 2, lands: 17, unread: 0 },
      { source: 'room', day: '2026-10-17', format: 'grid', spells: { W: 9, U: 0, B: 0, R: 12, G: 0 }, colourless: 3, lands: 17, unread: 0 },
      { source: 'solo', day: '2026-11-02', format: 'grid', spells: { W: 0, U: 0, B: 11, R: 10, G: 0 }, colourless: 3, lands: 17, unread: 1 },
    ],
  },
  'omega',
)!;

describe('Drafted colours (real drafts)', () => {
  it('reading: a quiet line', () => {
    expect(renderToStaticMarkup(<DraftedColoursView res={null} />)).toContain('Reading the drafts');
  });
  it('no engine on this PC at all (a visitor): nothing at all', () => {
    expect(renderToStaticMarkup(<DraftedColoursView res={{ state: 'none' }} />)).toBe('');
  });
  it('none yet', () => {
    const html = renderToStaticMarkup(<DraftedColoursView res={{ state: 'ok', data: { cube: 'omega', scripts: true, decks: [] } }} />);
    expect(html).toContain('Drafted colours (real drafts)');
    expect(html).toContain('None yet');
    expect(html).not.toContain('dshare-row');
  });
  it('a helper that cannot say: its words', () => {
    const html = renderToStaticMarkup(<DraftedColoursView res={{ state: 'unavailable', message: 'The engine on your PC is older and doesn’t record drafts yet: update mtg-table.' }} />);
    expect(html).toContain('update mtg-table');
  });
  it('three decks: each colour with its count and interval, the exact colours, the months, the unread card', () => {
    const html = renderToStaticMarkup(<DraftedColoursView res={{ state: 'ok', data: OMEGA }} />);
    expect(html).toContain('3 decks');
    expect(html).toContain('2 from drafts with a friend · 1 against the bot · 2026-10-17 to 2026-11-02');
    expect(html).toMatch(/Red.*?<b>100%<\/b> 3 of 3 · 44–100%/);
    expect(html).toContain('Boros (WR)');
    expect(html).toContain('Rakdos (BR)');
    expect(html).toContain('Four or five colours');
    expect(html).toContain('None yet: W, U, B, R, G, WU');
    expect(html).toContain('2026-10');
    expect(html).toContain('2026-11');
    expect(html).toContain('1 card in 1 deck had no Forge card script');
  });
});

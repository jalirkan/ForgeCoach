/*
 * ForgeCoach — cube/deckExport.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * A deck as other games take it: the one place every deck screen (the deck
 * assistant's builder, Draft vs AI, Draft with a friend) turns the deck on
 * screen into text. Pure, tested in node; the button row is ui/DeckExport.tsx.
 *
 *   deckListText   "Deck / <qty> <name> … / blank / Sideboard / …" — the form
 *                  Arena, MTGO, Moxfield, Cockatrice and untap.in all import
 *   dckFileText    Forge's .dck
 *   codFileText    Cockatrice's .cod
 *
 * Names: the cube documents already name cards the portable way, and this
 * keeps it: a split card (both halves on one face: Fire // Ice) as "A // B",
 * a double-faced, adventure or flip card by its front face (Delver of Secrets,
 * Bonecrusher Giant). That is what Arena's own export writes, and MTGO,
 * Moxfield, Cockatrice and Forge read both. `exportName` only tidies what a
 * paste can bring in: curly quotes, Forge's "Fire / Ice" and "|SET" suffixes.
 *
 * Only the player's own deck and pool ever reach here (never the AI's list,
 * never a friend's deck): the callers pass the deck on this player's screen.
 */

/** A count and a card name. */
export type DeckLine = [number, string];

export interface DeckList {
  /** The deck's name (file names, .dck/.cod metadata). */
  name: string;
  main: DeckLine[];
  /** The rest of this player's pool. */
  side: DeckLine[];
}

const BASIC_ORDER = ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest', 'Wastes'];
const basicRank = (n: string) => {
  const s = n.replace(/^Snow-Covered /, '');
  const i = BASIC_ORDER.indexOf(s);
  return i < 0 ? -1 : i;
};

/** One card name as other games read it (see the header). */
export function exportName(name: string): string {
  let n = name.split('|')[0] ?? name;
  n = n.replace(/[‘’]/g, "'").replace(/[“”]/g, '"');
  n = n.replace(/\s+\/\/?\s+/g, ' // ');
  return n.replace(/\s+/g, ' ').trim();
}

/** Merge repeats, tidy names, drop empties; spells and nonbasic lands by name, then basics in WUBRG order. */
export function normaliseLines(lines: ReadonlyArray<DeckLine>): DeckLine[] {
  const m = new Map<string, number>();
  for (const [q, raw] of lines) {
    const n = exportName(raw);
    if (!n || !(q > 0)) continue;
    m.set(n, (m.get(n) ?? 0) + Math.round(q));
  }
  return [...m.entries()]
    .map(([n, q]): DeckLine => [q, n])
    .sort((a, b) => {
      const ra = basicRank(a[1]);
      const rb = basicRank(b[1]);
      if (ra !== rb) return ra < 0 ? -1 : rb < 0 ? 1 : ra - rb;
      return a[1].localeCompare(b[1], 'en');
    });
}

/** Names (one per copy) as counted lines. */
export function countNames(names: ReadonlyArray<string>): DeckLine[] {
  return normaliseLines(names.map((n): DeckLine => [1, n]));
}

export function makeDeckList(name: string, main: ReadonlyArray<DeckLine>, side: ReadonlyArray<DeckLine> = []): DeckList {
  return { name: name.trim() || 'Cube deck', main: normaliseLines(main), side: normaliseLines(side) };
}

export const cardTotal = (lines: ReadonlyArray<DeckLine>) => lines.reduce((s, [q]) => s + q, 0);

/** "40 cards + 5 sideboard", so the player can check the export against the screen. */
export function countLine(l: DeckList): string {
  const main = cardTotal(l.main);
  const side = cardTotal(l.side);
  const m = `${main} card${main === 1 ? '' : 's'}`;
  return side ? `${m} + ${side} sideboard` : `${m}, no sideboard`;
}

/** The plain list: Arena / MTGO / Moxfield / Cockatrice / untap.in. */
export function deckListText(l: DeckList): string {
  const lines = ['Deck', ...l.main.map(([q, n]) => `${q} ${n}`)];
  if (l.side.length) lines.push('', 'Sideboard', ...l.side.map(([q, n]) => `${q} ${n}`));
  return `${lines.join('\n')}\n`;
}

/** Forge's .dck (names only: Forge picks the printing). */
export function dckFileText(l: DeckList): string {
  const lines = ['[metadata]', `Name=${l.name.replace(/[\r\n]+/g, ' ')}`, '[Main]', ...l.main.map(([q, n]) => `${q} ${n}`), '[Sideboard]', ...l.side.map(([q, n]) => `${q} ${n}`)];
  return `${lines.join('\n')}\n`;
}

const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Cockatrice's .cod. */
export function codFileText(l: DeckList): string {
  const zone = (z: string, lines: DeckLine[]) =>
    lines.length ? [`  <zone name="${z}">`, ...lines.map(([q, n]) => `    <card number="${q}" name="${xml(n)}"/>`), '  </zone>'] : [];
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<cockatrice_deck version="1">',
    `  <deckname>${xml(l.name)}</deckname>`,
    '  <comments></comments>',
    ...zone('main', l.main),
    ...zone('side', l.side),
    '</cockatrice_deck>',
    '',
  ].join('\n');
}

/** A file-name-safe slug for a deck name. */
export function deckSlug(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 48) || 'deck'
  );
}

/*
 * ForgeCoach — cube/parseCube.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Reads one of Justin's cube design documents (markdown) into a card list.
 * The format, as all four files in public/cubes/ use it:
 *
 *   # <title>
 *   | Code | Theme | Core idea | Connects to |      <- the theme table (optional)
 *   | SAC  | Sacrifice | …         | TOK, ART  |
 *   | Pair | Plan | Signposts |                     <- an archetype table (optional)
 *   ## The list (name — themes)                     <- opens the list
 *   ### White (24)                                  <- a section and the count it promises
 *   Thraben Inspector — ART ETB SAC · Opt — SPL · … <- items separated by " · "
 *   WU: Reflector Mage — ETB removal · …            <- a gold pair prefix
 *   Shocklands: Hallowed Fountain, Watery Grave.    <- a lands group line ("," or " · ")
 *   Fetchlands (LND GY): Flooded Strand, …          <- group tags for every card on the line
 *   Pathways: Hengegate 4.85 · …                    <- a Pathway by its first word
 *
 * After a name, " — " starts its tags. UPPER-CASE codes are themes (only the
 * theme table's codes when the file has one); lower-case words and "(hoser)"
 * are extra tags (removal, counter, discard, ramp, hoser). A trailing number is
 * the card's price (the Modern-era and Pauper documents carry one).
 *
 * Archetypes come from any table with a Pair/Colours column (signposts are the
 * cube cards its cells name), or from the "Decks this cube wants you to find"
 * bullets ("**Rakdos or Mardu sacrifice:** Viscera Seer, …").
 */
import { guildColours, wubrg } from './colors.ts';

export type SectionKind = 'colour' | 'gold' | 'colorless' | 'lands';

export interface CubeCard {
  /** The name as Scryfall and Forge look it up (a Pathway's front face). */
  name: string;
  /** The section it was listed under ("White", "Gold", "Lands", …). */
  section: string;
  sectionKind: SectionKind;
  /** Colours the document implies: the section's colour, the gold pair, '' for colourless and lands. */
  colorHint: string;
  land: boolean;
  /** Theme codes (SAC, TOK, …), as listed. */
  themes: string[];
  /** Lower-case extra tags: removal, counter, discard, ramp, hoser… */
  tags: string[];
  /** Price in USD, when the document lists one. */
  price?: number;
  /** The gold pair prefix (WUBRG order) when the line had one. */
  pair?: string;
  /** The lands group label ("Shocklands"). */
  group?: string;
}

export interface CubeSection {
  name: string;
  kind: SectionKind;
  expected: number;
  parsed: number;
}

export interface CubeTheme {
  code: string;
  name: string;
  idea: string;
  connects: string[];
}

export interface CubeArchetype {
  /** Main colours, WUBRG order ('' when the document says "any colours"). */
  colors: string;
  name: string;
  plan: string;
  /** Cube cards the archetype names (signposts first, then key cards). */
  signposts: string[];
}

export interface Cube {
  title: string;
  cards: CubeCard[];
  sections: CubeSection[];
  themes: CubeTheme[];
  archetypes: CubeArchetype[];
  hasPrices: boolean;
  warnings: string[];
}

const COLOUR_PAIR = /^[WUBRG]{2}$/;
const SECTION_COLOUR: Record<string, string> = { white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G' };

function sectionKind(name: string): SectionKind {
  const n = name.toLowerCase();
  if (n in SECTION_COLOUR) return 'colour';
  if (/gold|multi/.test(n)) return 'gold';
  if (/land/.test(n)) return 'lands';
  return 'colorless';
}

interface ItemTags {
  name: string;
  themes: string[];
  tags: string[];
  price?: number;
}

/** Split one list item into a name, its tags and an optional trailing price. */
export function splitItem(item: string): ItemTags {
  const trimmed = item.trim().replace(/\.$/, '').trim();
  const m = /^(.*?)\s+—\s+(.*)$/.exec(trimmed);
  let name = (m ? m[1] : trimmed) ?? '';
  let rest = (m ? m[2] : '') ?? '';
  let price: number | undefined;
  const pn = /\s+(\d+\.\d{1,2})$/.exec(name);
  if (pn?.[1]) {
    price = Number(pn[1]);
    name = name.slice(0, pn.index);
  }
  const pr = /(?:^|\s)(\d+\.\d{1,2})$/.exec(rest);
  if (pr?.[1]) {
    price = Number(pr[1]);
    rest = rest.slice(0, pr.index);
  }
  const themes: string[] = [];
  const tags: string[] = [];
  for (const raw of rest.split(/\s+/).filter(Boolean)) {
    const t = raw.replace(/^\(|\)$/g, '').replace(/,$/, '');
    if (/^[A-Z]{2,6}$/.test(t) && !COLOUR_PAIR.test(t)) themes.push(t);
    else if (/^[a-z][a-z-]*$/.test(t)) tags.push(t);
  }
  const out: ItemTags = { name: name.trim(), themes, tags };
  if (price !== undefined) out.price = price;
  return out;
}

/** Table cells of a markdown row, or null when the line is not a table row. */
function cells(line: string): string[] | null {
  const t = line.trim();
  if (!t.startsWith('|') || !t.endsWith('|')) return null;
  return t
    .slice(1, -1)
    .split('|')
    .map((c) => c.trim());
}

const plain = (s: string) =>
  s
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/[,*]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

/** Cube card names mentioned in a text, in order of first mention (longest names win overlaps). */
export function mentionedCards(text: string, names: string[]): string[] {
  const hay = plain(text);
  // Each name, and the short form before its comma ("Grist" for "Grist, the Hunger Tide").
  const needles: Array<[string, string]> = [];
  for (const n of names) {
    needles.push([plain(n), n]);
    const short = n.split(',')[0] ?? '';
    if (short !== n && short.length >= 3) needles.push([plain(short), n]);
  }
  needles.sort((a, b) => b[0].length - a[0].length);
  const taken: Array<[number, number]> = [];
  const first = new Map<string, number>();
  for (const [needle, n] of needles) {
    if (needle.length < 3) continue;
    let from = 0;
    for (;;) {
      const at = hay.indexOf(needle, from);
      if (at < 0) break;
      from = at + needle.length;
      const before = hay[at - 1];
      const after = hay[at + needle.length];
      if ((before && /[a-z0-9]/.test(before)) || (after && /[a-z0-9]/.test(after))) continue;
      if (taken.some(([s, e]) => at < e && at + needle.length > s)) continue;
      taken.push([at, at + needle.length]);
      if (!first.has(n) || at < (first.get(n) ?? 0)) first.set(n, at);
    }
  }
  return [...first.entries()].sort((a, b) => a[1] - b[1]).map(([n]) => n);
}

/** Main colours from a document's colour text: "BR", "W + R (or B)", "U R (+ Ancient Tomb)", "Rakdos or Mardu". */
export function coloursFromText(text: string): string {
  const head = text.split('(')[0] ?? '';
  const guild = /\b([A-Z][a-z]+)\b/.exec(head);
  if (guild?.[1]) {
    const g = guildColours(guild[1]);
    if (g) return g;
  }
  const letters = head.replace(/[^WUBRG/ +]/g, ' ');
  // "G + R/U/B": the slash group is a choice, not the main colours.
  const main = letters
    .split(/[\s+]+/)
    .filter((t) => t && !t.includes('/'))
    .join('');
  return wubrg(main);
}

export function parseCube(text: string): Cube {
  const cards: CubeCard[] = [];
  const sections: CubeSection[] = [];
  const themes: CubeTheme[] = [];
  const rawArchetypes: Array<{ colors: string; name: string; plan: string; text: string; from: 'table' | 'bullets' }> = [];
  const warnings: string[] = [];
  let title = '';
  let h2 = '';
  let inList = false;
  let section: CubeSection | null = null;
  let table: { header: string[] } | null = null;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (!title) {
      const t = /^#\s+(.+)$/.exec(line);
      if (t?.[1]) {
        title = t[1].trim();
        continue;
      }
    }

    // Tables: the theme table and archetype tables.
    const row = cells(line);
    if (row) {
      if (!table) {
        table = { header: row.map((c) => c.toLowerCase()) };
        continue;
      }
      if (row.every((c) => /^:?-{2,}:?$/.test(c))) continue;
      const h = table.header;
      const col = (re: RegExp) => h.findIndex((x) => re.test(x));
      if (h[0] === 'code') {
        const [code = '', name = '', idea = '', connects = ''] = row;
        if (/^[A-Z]{2,6}$/.test(code)) themes.push({ code, name, idea, connects: connects.match(/\b[A-Z]{2,6}\b/g) ?? [] });
      } else {
        const ci = col(/^(pair|colou?rs)$/);
        const si = col(/signpost/);
        if (ci >= 0 && si >= 0) {
          const di = col(/^deck$/);
          const pi = col(/^(plan|engine)$/);
          const colors = coloursFromText(row[ci] ?? '');
          const plan = pi >= 0 ? (row[pi] ?? '') : '';
          const name = di >= 0 ? (row[di] ?? '') : plan;
          const extra = h.map((x, i) => (/key|signpost|engine/.test(x) ? (row[i] ?? '') : '')).join(' · ');
          rawArchetypes.push({ colors, name, plan, text: `${row[si] ?? ''} · ${extra}`, from: 'table' });
        }
      }
      continue;
    }
    table = null;

    const h2m = /^##\s+(?!#)(.*)$/.exec(line);
    if (h2m) {
      h2 = (h2m[1] ?? '').trim();
      inList = /^the list/i.test(h2);
      section = null;
      continue;
    }

    // "## Decks this cube wants you to find" bullets.
    if (/^decks this cube/i.test(h2)) {
      const b = /^\s*[-*]\s+\*\*(.+?):?\*\*:?\s*(.*)$/.exec(line);
      if (b?.[1]) rawArchetypes.push({ colors: coloursFromText(b[1]), name: b[1].replace(/:$/, ''), plan: b[2] ?? '', text: b[2] ?? '', from: 'bullets' });
      continue;
    }

    const h3 = /^###\s+(.+?)\s*\((\d+)\)\s*$/.exec(line);
    if (h3?.[1] && inList) {
      section = { name: h3[1], kind: sectionKind(h3[1]), expected: Number(h3[2]), parsed: 0 };
      sections.push(section);
      continue;
    }
    if (!inList || !section || !line.trim()) continue;

    const pairM = /^([WUBRG]{2}):\s*/.exec(line);
    let body = pairM ? line.slice(pairM[0].length) : line;
    let group: string | undefined;
    let groupTags: ItemTags = { name: '', themes: [], tags: [] };
    const groupM = /^([A-Z][A-Za-z ]*?)(?:\s*\(([^)]*)\))?:\s*(.*)$/.exec(body);
    if (!pairM && section.kind === 'lands' && groupM?.[1] && groupM[3] !== undefined) {
      group = groupM[1];
      groupTags = splitItem(`x — ${groupM[2] ?? ''}`);
      body = groupM[3];
    }
    const items = body.includes(' · ') ? body.split(' · ') : group ? body.split(',') : [body];
    for (const item of items) {
      const own = splitItem(item);
      if (!own.name) continue;
      let name = own.name;
      if (group && /^pathways?$/i.test(group) && !/Pathway$/.test(name)) name = `${name} Pathway`;
      const kind = section.kind;
      const card: CubeCard = {
        name,
        section: section.name,
        sectionKind: kind,
        colorHint: kind === 'colour' ? (SECTION_COLOUR[section.name.toLowerCase()] ?? '') : kind === 'gold' ? (pairM?.[1] ? wubrg(pairM[1]) : '') : '',
        land: kind === 'lands',
        themes: [...new Set([...groupTags.themes, ...own.themes])],
        tags: [...new Set([...groupTags.tags, ...own.tags])],
      };
      if (own.price !== undefined) card.price = own.price;
      if (pairM?.[1]) card.pair = wubrg(pairM[1]);
      if (group) card.group = group;
      cards.push(card);
      section.parsed++;
    }
  }

  // A theme table names the file's own codes: anything else upper-case is not a theme.
  if (themes.length > 0) {
    const known = new Set(themes.map((t) => t.code));
    const unknown = new Set<string>();
    for (const c of cards) {
      for (const t of c.themes) if (!known.has(t)) unknown.add(t);
      c.themes = c.themes.filter((t) => known.has(t));
    }
    if (unknown.size) warnings.push(`tags not in the theme table, ignored: ${[...unknown].sort().join(', ')}`);
  }
  for (const s of sections) if (s.parsed !== s.expected) warnings.push(`${s.name}: parsed ${s.parsed}, the heading says ${s.expected}`);
  const seen = new Set<string>();
  for (const c of cards) {
    if (seen.has(c.name)) warnings.push(`listed twice: ${c.name}`);
    seen.add(c.name);
  }
  if (sections.length === 0) warnings.push('no "## The list" section with "### Section (N)" headings');

  const names = cards.map((c) => c.name);
  const archetypes: CubeArchetype[] = [];
  const fromTable = new Map<CubeArchetype, true>();
  for (const a of rawArchetypes) {
    const signposts = mentionedCards(a.text, names);
    // A bullet that describes a colour pair one table row already has: one archetype, the bullet's name.
    const same = a.from === 'bullets' && a.colors ? archetypes.filter((x) => fromTable.has(x) && x.colors === a.colors) : [];
    if (same.length === 1 && same[0]) {
      same[0].name = a.name;
      same[0].signposts = [...new Set([...same[0].signposts, ...signposts])];
      continue;
    }
    const arch: CubeArchetype = { colors: a.colors, name: a.name, plan: a.plan, signposts };
    if (a.from === 'table') fromTable.set(arch, true);
    archetypes.push(arch);
  }
  return { title, cards, sections, themes, archetypes, hasPrices: cards.some((c) => c.price !== undefined), warnings };
}

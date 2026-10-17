// SPDX-License-Identifier: GPL-3.0-or-later
// Writes public/cubes/library.json: the library of cards ForgeCoach knows — the
// union of the cube documents (public/cubes/*.md, the registry's) and the two
// big proxy lists (docs/proxies/mtgo-vintage-cube-540.txt,
// old-school-93-94-360.txt) — one row a card, for the cube builder
// (src/cube/library.ts reads it; #cube/new).
//
// Per card: printed colours, type line, mana value, what a land makes (from the
// Scryfall snapshots in src/cube/testdata/), the cubes and lists it comes from,
// the documents' lower-case tags, whether Forge lacks it (each document's
// "## Not in Forge" section), Forge's AI:RemoveDeck flag (each document's
// "Forge AI flags" prose and a meta card's remAIDeck), and the cube lab's
// numbers from every shipped <cube>.meta.json that played it (games summed,
// winRateShrunk averaged with those games as weights).
//
// The proxy lists' own cards are in no document, so the documents say nothing
// of Forge for them. `--engine-facts <mtg-table cubes/library/library-pool.tsv>`
// adds the engine's own facts (its forge_supported and forge_ai_flag columns)
// for every card; the file's header then names it. Without it, those cards are
// written as unknown to Forge, never as supported.
//
// Run: node --experimental-transform-types scripts/library/build.ts [--fetch] [--engine-facts <tsv>]
//   --fetch   asks Scryfall (POST /cards/collection, 75 a request) for every card
//             no snapshot has, and writes them to src/cube/testdata/scryfall-library.json.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { CUBES } from '../../src/cube/cubes.ts';
import { parseCube } from '../../src/cube/parseCube.ts';
import { parseMeta } from '../../src/cube/meta.ts';
import { aiFlagsFromDoc, withMetaFlags } from '../../src/draft/aiFlags.ts';
import { manaValueOf, producesOf, wubrg } from '../../src/cube/colors.ts';
import { LIBRARY_LISTS, type LibraryCard, type LibraryFile } from '../../src/cube/library.ts';

type Face = { name?: string; mana_cost?: string; type_line?: string; oracle_text?: string; colors?: string[]; power?: string; toughness?: string; loyalty?: string };
type Sf = Face & { produced_mana?: string[]; card_faces?: Face[] };

const root = new URL('../../', import.meta.url);
const read = (p: string) => readFileSync(new URL(p, root), 'utf8');
const sha = (t: string) => createHash('sha256').update(t, 'utf8').digest('hex').slice(0, 12);
const args = process.argv.slice(2);
const flag = (k: string) => args.includes(k);
const opt = (k: string) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : undefined;
};

// ---- the names, and where each comes from
const sources: LibraryFile['sources'] = [];
const from = new Map<string, Set<string>>();
const tags = new Map<string, Set<string>>();
const missing = new Set<string>();
const aiAll = new Set<string>();
const aiRandom = new Set<string>();
const lab = new Map<string, { games: number; wsum: number; cubes: string[] }>();
const add = (name: string, src: string) => {
  let s = from.get(name);
  if (!s) from.set(name, (s = new Set()));
  s.add(src);
};

for (const info of CUBES) {
  const path = `public/cubes/${info.file}.md`;
  const text = read(path);
  const cube = parseCube(text);
  sources.push({ id: info.id, path, cards: cube.cards.length, sha256: sha(text) });
  for (const c of cube.cards) {
    add(c.name, info.id);
    if (c.tags.length) {
      let t = tags.get(c.name);
      if (!t) tags.set(c.name, (t = new Set()));
      for (const x of c.tags) t.add(x);
    }
  }
  for (const n of cube.forgeMissing ?? []) missing.add(n);
  const metaPath = new URL(`public/cubes/${info.file}.meta.json`, root);
  const meta = info.labData !== false && existsSync(metaPath) ? parseMeta(JSON.parse(readFileSync(metaPath, 'utf8'))) : null;
  const flags = withMetaFlags(
    aiFlagsFromDoc(
      text,
      cube.cards.map((c) => c.name),
    ),
    meta,
  );
  for (const n of flags.all) aiAll.add(n);
  for (const n of flags.random) aiRandom.add(n);
  if (meta) {
    for (const [name, st] of Object.entries(meta.cards)) {
      if (!st.games || typeof st.winRateShrunk !== 'number') continue;
      const l = lab.get(name) ?? { games: 0, wsum: 0, cubes: [] };
      l.games += st.games;
      l.wsum += st.games * st.winRateShrunk;
      l.cubes.push(info.id);
      lab.set(name, l);
    }
  }
}
for (const l of LIBRARY_LISTS) {
  const path = `docs/proxies/${l.file}.txt`;
  const text = read(path);
  let n = 0;
  for (const line of text.split(/\r?\n/)) {
    const m = /^\d+\s+(.+?)\s*$/.exec(line);
    if (!m?.[1]) continue;
    add(m[1], l.id);
    n++;
  }
  sources.push({ id: l.id, path, cards: n, sha256: sha(text) });
}

// ---- the card facts, from the Scryfall snapshots
const snaps = new Map<string, Sf>();
const index = (c: Sf) => {
  if (c.name && !snaps.has(c.name)) snaps.set(c.name, c);
  for (const f of c.card_faces ?? []) if (f.name && !snaps.has(f.name)) snaps.set(f.name, c);
};
for (const info of CUBES) for (const c of JSON.parse(read(`src/cube/testdata/scryfall-${info.id}.json`)) as Sf[]) index(c);
const EXTRA = 'src/cube/testdata/scryfall-library.json';
let extra: Sf[] = existsSync(new URL(EXTRA, root)) ? (JSON.parse(read(EXTRA)) as Sf[]) : [];
extra.forEach(index);

const trim = (c: Sf): Sf => {
  const keep = (f: Face): Face => {
    const o: Face = {};
    for (const k of ['name', 'mana_cost', 'type_line', 'oracle_text', 'colors', 'power', 'toughness', 'loyalty'] as const) if (f[k] !== undefined) (o as Record<string, unknown>)[k] = f[k];
    return o;
  };
  const o: Sf = keep(c);
  if (c.produced_mana) o.produced_mana = c.produced_mana;
  if (c.card_faces) o.card_faces = c.card_faces.map(keep);
  return o;
};

if (flag('--fetch')) {
  const want = [...from.keys()].filter((n) => !snaps.has(n));
  console.log(`asking Scryfall for ${want.length} cards`);
  const got: Sf[] = [];
  for (let i = 0; i < want.length; i += 75) {
    const res = await fetch('https://api.scryfall.com/cards/collection', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': 'ForgeCoach-library/1' },
      body: JSON.stringify({ identifiers: want.slice(i, i + 75).map((name) => ({ name })) }),
    });
    if (!res.ok) throw new Error(`Scryfall answered HTTP ${res.status}`);
    const j = (await res.json()) as { data: Sf[]; not_found: Array<{ name: string }> };
    got.push(...j.data.map(trim));
    // A split card by its full name, or a card printed under another name (Universes Within):
    // Scryfall's fuzzy lookup of the front face, kept under the library's own spelling.
    for (const { name } of j.not_found) {
      await new Promise((r) => setTimeout(r, 120));
      const r = await fetch(`https://api.scryfall.com/cards/named?fuzzy=${encodeURIComponent(name.split(' // ')[0] ?? name)}`, { headers: { Accept: 'application/json', 'User-Agent': 'ForgeCoach-library/1' } });
      if (!r.ok) {
        console.log(`not found: ${name}`);
        continue;
      }
      const c = trim((await r.json()) as Sf);
      console.log(`${name}: Scryfall's ${c.name}`);
      got.push({ ...c, name });
    }
    await new Promise((r) => setTimeout(r, 120));
  }
  extra = [...extra, ...got].sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));
  writeFileSync(new URL(EXTRA, root), JSON.stringify(extra, null, 0) + '\n');
  got.forEach(index);
}

// ---- the engine's own facts (optional)
let engine: { path: string; sha256: string; rows: Map<string, { supported: boolean; ai: 'All' | 'Random' | null }> } | null = null;
const ef = opt('--engine-facts');
if (ef) {
  const text = readFileSync(ef, 'utf8');
  const rows = new Map<string, { supported: boolean; ai: 'All' | 'Random' | null }>();
  let head: string[] | null = null;
  for (const line of text.split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue;
    const cols = line.split('\t');
    if (!head) {
      head = cols;
      continue;
    }
    const at = (k: string) => cols[head!.indexOf(k)] ?? '';
    const ai = at('forge_ai_flag');
    rows.set(at('name'), { supported: at('forge_supported') === 'yes', ai: ai === 'All' || ai === 'Random' ? ai : null });
  }
  engine = { path: 'mtg-table cubes/library/library-pool.tsv', sha256: sha(text), rows };
}

// ---- the rows
const nameFirst = (n: string) => n.split(' // ')[0] ?? n;
const cards: LibraryCard[] = [];
const noFacts: string[] = [];
for (const name of [...from.keys()].sort((a, b) => a.localeCompare(b))) {
  const sf = snaps.get(name) ?? snaps.get(nameFirst(name));
  if (!sf) noFacts.push(name);
  const faces = sf?.card_faces ?? [];
  const type = sf?.type_line ?? faces.map((f) => f.type_line ?? '').join(' // ');
  const front = type.split(' // ')[0] ?? type;
  const land = /\bLand\b/.test(front) && !/\bCreature\b/.test(front);
  const cost = sf?.mana_cost && sf.mana_cost !== '' ? sf.mana_cost : (faces[0]?.mana_cost ?? '');
  const colorList = sf?.colors ?? [...new Set(faces.flatMap((f) => f.colors ?? []))];
  const oracle = sf ? (faces.length ? faces.map((f) => f.oracle_text ?? '').join('\n') : (sf.oracle_text ?? '')) : '';
  const row: LibraryCard = {
    name,
    colors: land ? '' : wubrg(colorList),
    type,
    mv: land ? 0 : manaValueOf(cost.split(' // ')[0] ?? ''),
    sources: [...(from.get(name) ?? [])],
  };
  if (land) row.produces = producesOf(oracle, sf?.produced_mana ?? []);
  const t = tags.get(name);
  if (t?.size) row.tags = [...t].sort();
  const e = engine?.rows.get(name);
  if (missing.has(name) || (e && !e.supported)) row.forge = false;
  else if (!e && ![...(from.get(name) ?? [])].some((s) => CUBES.some((c) => c.id === s))) row.forge = null;
  const ai = aiAll.has(name) || e?.ai === 'All' ? 'All' : aiRandom.has(name) || e?.ai === 'Random' ? 'Random' : null;
  if (ai) row.ai = ai;
  const l = lab.get(name);
  if (l) row.lab = { games: l.games, winRate: Math.round((l.wsum / l.games) * 10000) / 10000, cubes: l.cubes };
  if (!sf) row.noFacts = true;
  cards.push(row);
}

const out: LibraryFile = {
  schema: 1,
  note: 'Generated by scripts/library/build.ts from the cube documents, the proxy lists, the Scryfall snapshots and the shipped lab metas; do not edit by hand, run it again.',
  sources,
  engineFacts: engine ? { path: engine.path, sha256: engine.sha256 } : null,
  cards,
};
writeFileSync(new URL('public/cubes/library.json', root), JSON.stringify(out) + '\n');
const count = (f: (c: LibraryCard) => boolean) => cards.filter(f).length;
console.log(
  `${cards.length} cards · not in Forge ${count((c) => c.forge === false)} · Forge unknown ${count((c) => c.forge === null)} · AI All ${count((c) => c.ai === 'All')} · Random ${count((c) => c.ai === 'Random')} · lab numbers ${count((c) => !!c.lab)} · no card facts ${noFacts.length}${noFacts.length ? `: ${noFacts.join('; ')}` : ''}`,
);

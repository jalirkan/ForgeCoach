#!/usr/bin/env node
// SPDX-License-Identifier: GPL-3.0-or-later
//
// altart-picker — choose an alternate-art / full-art version of every card in a
// MakePlayingCards proxy order from MPC Autofill's database (mpcfill.com), and
// write what the Autofill desktop tool reads plus a sheet to approve by eye.
//
//   node tools/proxies/altart-picker.mjs <list.txt> [<list2.txt> ...]
//        [--name <base>] [--out docs/proxies/altart] [--cache <dir>]
//        [--delay <ms>] [--budget-min <minutes>] [--batch] [--no-sheet]
//
// Pace: one request at a time, --delay apart (1500 ms by default: mpcfill.com
// answered 429 with Retry-After: 10 after 15 requests in 5 s at 350 ms). A 429 is
// honoured (wait Retry-After, slow down); four on one call stop the run. Default
// is a search and a cards request per card name (twice for a two-sided card).
// --batch asks the way the editor itself does when a list is pasted: all queries
// in /2/editorSearch/ requests of up to 300, card records in /2/cards/ pages of
// up to 1000 ids, so a 612-card list is a few dozen requests, not ~1300.
//
// Several lists go into ONE project, slots numbered in order (0..n-1). Outputs,
// under --out, with <base> = --name or the single list's file name:
//   <base>-altart.xml          the order XML (S33, non-foil, the project bracket)
//   <base>-picks.tsv           per card: the version chosen, its source, DPI,
//                              why it won, how many versions / alternates existed
//   <base>-altart-contact.jpg  the chosen fronts (and DFC backs), labelled, 8 a
//                              row; split into -p1, -p2, ... above 96 tiles
//
// The owner's rule (2026-10-12): "alternate art and full-art versions; ... they're
// proxies so I don't care about original printings; maximise fun."
//
// API (read from github.com/chilli-axe/mpc-autofill, frontend/src/store/api.ts and
// MPCAutofill/cardpicker/urls.py + views.py), at the backend https://mpcfill.com:
//   GET  /2/sources/      every source; the editor's default search settings
//                         enable all of them in Object.values() order
//   GET  /2/DFCPairs/     {dfcPairs: {front name: back name}}
//   POST /2/editorSearch/ {searchSettings, queries: [{query, cardType}]}
//                         -> {results: {query: {CARD: [id, ...]}}}, ids in the
//                         editor's order (priority, then source order). The
//                         editor tries /3/editorSearch/ first and falls back to
//                         this one; mpcfill.com answers /3/ with a 404 today.
//   POST /2/cards/        {cardIdentifiers: [...]} (<= 1000) -> {results: {id: card}}
// Thumbnails: card.smallThumbnailUrl (a Google Drive thumbnail URL, no auth), the
// same URL the editor's Card.tsx renders.
//
// Needs node 24 and ImageMagick's `montage` for the sheet (skipped without it).
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const API = 'https://mpcfill.com';
const UA = 'ForgeCoach-altart-picker/1.0 (+https://github.com/jalirkan/ForgeCoach; personal proxy order, one request at a time)';
const STOCK = '(S33) Superior Smooth';
// Copied from today's hand-built test order (~/mpc-autofill/cards.xml).
const DEFAULT_CARDBACK = '1LrVX0pUcye9n_0RtaDNVl2xPrQgn7CYf';
const BRACKETS = [18, 36, 55, 72, 90, 108, 126, 144, 162, 180, 198, 216, 234, 396, 504, 612];
// MTGO-only names whose paper printing Autofill may know instead (README).
const ALIASES = {
  'Makdee and Itla, Skysnarers': 'Spider-Woman, Stunning Savior',
  'Kavaero, Mind-Bitten': 'Superior Spider-Man',
};
const SHEET_PAGE = 96;
const MIN_GOOD_DPI = 600;

// ---------- arguments ----------
const args = process.argv.slice(2);
const opt = { out: 'docs/proxies/altart', cache: join(tmpdir(), 'forgecoach-altart-cache'), delay: 1500, batch: false, budgetMin: 20, sheet: true, name: null };
const lists = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--out') opt.out = args[++i];
  else if (a === '--cache') opt.cache = args[++i];
  else if (a === '--delay') opt.delay = Number(args[++i]);
  else if (a === '--budget-min') opt.budgetMin = Number(args[++i]);
  else if (a === '--name') opt.name = args[++i];
  else if (a === '--no-sheet') opt.sheet = false;
  else if (a === '--batch') opt.batch = true;
  else if (a.startsWith('--')) die(`unknown flag ${a}`);
  else lists.push(a);
}
if (!lists.length) die('usage: altart-picker.mjs <list.txt> [...] [--name base] [--out dir] [--cache dir] [--delay ms] [--budget-min m] [--batch] [--no-sheet]');
const base = opt.name ?? basename(lists[0]).replace(/\.txt$/, '');
mkdirSync(opt.out, { recursive: true });
mkdirSync(join(opt.cache, 'api'), { recursive: true });
mkdirSync(join(opt.cache, 'thumbs'), { recursive: true });

function die(msg, code = 1) { console.error(msg); process.exit(code); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- text normalisation (mirrors the editor and the backend) ----------
// frontend/src/common/processing.ts processQuery: what the editor sends.
function processQuery(q) {
  return q.toLowerCase().trim().replace(/[~`!@#$%^&*(){}\[\];:"'’<,.>?/\\|_+=]/g, '').replace(/ +(?= )/g, '').trim();
}
// Close to the backend's searchq (cardpicker/search/sanitisation.py to_searchable;
// the live build also drops "the"), plus accents folded, for "is this the same card".
function sameCardKey(s) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[([{].*?[)\]}]/g, '').replace(/[-’]/g, (c) => (c === '-' ? ' ' : "'"))
    .replace(/[!"#$%&'()*+,./:;<=>?@[\\\]^_`{|}~]/g, '').replace(/[0-9]/g, '')
    .split(/\s+/).filter((w) => w && w !== 'the').join(' ');
}

// ---------- HTTP, cached and paced ----------
let apiCalls = 0;
let rateLimits = 0;
let lastCall = 0;
class RateLimited extends Error {}
async function api(method, path, body) {
  const key = createHash('sha1').update(method + path + JSON.stringify(body ?? null)).digest('hex');
  const file = join(opt.cache, 'api', key + '.json');
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'));
  const wait = lastCall + opt.delay - Date.now();
  if (wait > 0) await sleep(wait);
  for (let attempt = 1; ; attempt++) {
    lastCall = Date.now();
    apiCalls++;
    let res;
    try {
      res = await fetch(API + path, {
        method, headers: { 'User-Agent': UA, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(60_000),
      });
    } catch (e) {
      if (attempt < 3) { await sleep(3000 * attempt); continue; }
      throw e;
    }
    if (res.status === 429 || res.status === 503) {
      // Honour the server's pace: wait what it asks, slow the whole run down,
      // and give up (stop the run) after four refusals of one call.
      rateLimits++;
      const after = Number(res.headers.get('retry-after')) || 10;
      if (attempt >= 4) throw new RateLimited(`${path} answered ${res.status} four times running (retry-after: ${after})`);
      opt.delay = Math.min(5000, Math.round(opt.delay * 1.5));
      console.log(`  ${res.status} from ${path}: waiting ${after + 1} s, pace now ${opt.delay} ms`);
      await sleep((after + 1) * 1000);
      continue;
    }
    const text = await res.text();
    if (!res.ok) {
      if (res.status >= 500 && attempt < 3) { await sleep(3000 * attempt); continue; }
      throw new Error(`${method} ${path} -> ${res.status}: ${text.slice(0, 200)}`);
    }
    const json = JSON.parse(text);
    writeFileSync(file, JSON.stringify(json));
    return json;
  }
}

// ---------- the database ----------
const sources = (await api('GET', '/2/sources/')).results;
// getDefaultSearchSettings (frontend/src/store/slices/searchSettingsSlice.ts):
// every source on, in Object.values order; fuzzy off; DPI 0..1500; 30 MB; NSFW out.
const searchSettings = {
  searchTypeSettings: { fuzzySearch: false, filterCardbacks: false },
  sourceSettings: { sources: Object.values(sources).map((s) => [s.pk, true]) },
  filterSettings: { minimumDPI: 0, maximumDPI: 1500, maximumSize: 30, languages: [], includesTags: [], excludesTags: ['NSFW'] },
};
const dfcRaw = (await api('GET', '/2/DFCPairs/')).dfcPairs;
const dfc = new Map();
for (const [front, back] of Object.entries(dfcRaw)) {
  // Meld halves ("... Top" / "... Bottom") are not second faces: the README
  // prints the meld cards one-sided, their partners are not in the cube.
  if (/\s(top|bottom)$/i.test(back)) continue;
  dfc.set(processQuery(front), back);
}

const prefetched = new Map(); // query -> ids (--batch)
const cardCache = new Map(); // id -> card record (--batch)
async function prefetch(queryNames) {
  const queries = [...new Set(queryNames.map(processQuery))];
  for (let i = 0; i < queries.length; i += 300) {
    const chunk = queries.slice(i, i + 300);
    const r = await api('POST', '/2/editorSearch/', { searchSettings, queries: chunk.map((query) => ({ query, cardType: 'CARD' })) });
    for (const q of chunk) prefetched.set(q, r.results?.[q]?.CARD ?? []);
  }
  const ids = [...new Set([...prefetched.values()].flat())];
  for (let i = 0; i < ids.length; i += 1000) {
    const r = await api('POST', '/2/cards/', { cardIdentifiers: ids.slice(i, i + 1000) });
    for (const [id, c] of Object.entries(r.results)) cardCache.set(id, c);
  }
  console.log(`batch: ${queries.length} queries, ${ids.length} card records, ${apiCalls} requests`);
}
async function versionsOf(name) {
  const query = processQuery(name);
  if (prefetched.has(query)) return { query, versions: prefetched.get(query).map((id) => cardCache.get(id)).filter(Boolean) };
  const r = await api('POST', '/2/editorSearch/', { searchSettings, queries: [{ query, cardType: 'CARD' }] });
  const ids = r.results?.[query]?.CARD ?? [];
  const cards = {};
  for (let i = 0; i < ids.length; i += 1000) {
    Object.assign(cards, (await api('POST', '/2/cards/', { cardIdentifiers: ids.slice(i, i + 1000) })).results);
  }
  return { query, versions: ids.map((id) => cards[id]).filter(Boolean) };
}

// ---------- the pick rule ----------
const tagSet = (c) => new Set((c.tags ?? []).map((t) => t.toLowerCase()));
const TIERS = [
  ['borderless', (n, t) => /borderless/.test(n) || t.has('borderless')],
  ['full art', (n, t) => /full[\s-]?art|\bfullart\b|\bfa\b|\(full\)/.test(n) || t.has('full-art')],
  ['extended', (n, t) => /extended/.test(n) || t.has('extended-art')],
  ['showcase', (n, t) => /showcase/.test(n) || t.has('showcase')],
  ['textless', (n) => /textless/.test(n)],
  ['secret lair', (n, t) => /secret lair|\bsld\b/.test(n) || t.has('secret lair')],
  ['alt art', (n) => /\balt\b|alt[\s-]?art|alternate art/.test(n)],
  // The live database marks no artist sets on a card (its records carry no
  // canonicalArtist); its "Art" tag family (Altered Art, Custom Art) is the
  // nearest thing it does mark.
  ['art tag', (n, t) => t.has('altered art') || t.has('custom art')],
];
function excludedWhy(c, wantKey, face) {
  const n = c.name.toLowerCase();
  if (/\btokens?\b/.test(n)) return 'token';
  if (/card ?back/.test(n)) return 'cardback';
  if (face === 'front' && /\bback\b/.test(n)) return 'back';
  if (/\bhelper\b|\bchecklist\b|\bssdfc\b|\bemblem\b|art (card|series)/.test(n)) return 'helper';
  if (sameCardKey(c.searchq ?? c.name) !== wantKey) return 'different card';
  return null;
}
// Kept only when nothing else qualifies (not in the owner's rule; see the report).
function demotedWhy(c, t) {
  if (t.has('ai art') || /\bai art\b/i.test(c.name)) return 'AI art';
  if (t.has('alternate name')) return 'alternate name';
  if (c.language && c.language.toUpperCase() !== 'EN') return `language ${c.language}`;
  return null;
}
const dateOf = (c) => Date.parse(String(c.dateCreated ?? '').replace(/(\d+)(st|nd|rd|th)/, '$1').replace(',', '')) || 0;
const parenOf = (name) => (name.match(/\(([^)]*)\)/)?.[1] ?? '').toLowerCase();

function pick(versions, cardName, face, match = null) {
  const wantKey = sameCardKey(cardName);
  const eligible = [];
  let firstExcluded = null;
  versions.forEach((c, order) => {
    const why = excludedWhy(c, wantKey, face);
    if (why) { if (order === 0) firstExcluded = why; return; }
    const n = c.name.toLowerCase(), t = tagSet(c);
    const tier = TIERS.findIndex(([, test]) => test(n, t));
    eligible.push({ c, order, tier: tier < 0 ? TIERS.length : tier, demoted: demotedWhy(c, t) });
  });
  const alternates = eligible.filter((e) => e.tier < TIERS.length && !e.demoted);
  const stats = { versions: versions.length, eligible: eligible.length, alternates: alternates.length };
  if (!eligible.length) {
    return versions.length ? { c: versions[0], why: `default (no eligible version; #1 is ${firstExcluded})`, ...stats } : null;
  }
  // A back face goes with its front: the same source, and the same "(b)" style suffix.
  let pool = alternates;
  let pairNote = '';
  if (match && pool.length) {
    const same = pool.filter((e) => e.c.sourceName === match.sourceName);
    if (same.length) {
      pool = same; pairNote = ', same source as the front';
      const sameSuffix = same.filter((e) => parenOf(e.c.name) && parenOf(e.c.name) === parenOf(match.name));
      if (sameSuffix.length) pool = sameSuffix;
    }
  }
  if (!pool.length) {
    const d = eligible.find((e) => !e.demoted) ?? eligible[0];
    const why = d.order === 0 ? 'default (first result; no alternate art)' : `default (first eligible result #${d.order + 1}; #1 was ${firstExcluded ?? d.demoted}; no alternate art)`;
    return { c: d.c, why, ...stats };
  }
  pool.sort((a, b) =>
    (a.c.dpi >= MIN_GOOD_DPI ? 0 : 1) - (b.c.dpi >= MIN_GOOD_DPI ? 0 : 1)
    || a.tier - b.tier || b.c.dpi - a.c.dpi || dateOf(b.c) - dateOf(a.c) || a.order - b.order);
  const w = pool[0];
  const lowDpi = w.c.dpi < MIN_GOOD_DPI ? ` (only alternates below ${MIN_GOOD_DPI} dpi)` : '';
  return { c: w.c, why: `${TIERS[w.tier][0]}${lowDpi}; best of ${pool.length} at that rank by dpi/date${pairNote}`, tierName: TIERS[w.tier][0], ...stats };
}

// ---------- read the lists ----------
const slots = []; // {name}
for (const file of lists) {
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const s = line.trim();
    if (!s || s.startsWith('#') || s.startsWith('//')) continue;
    const m = s.match(/^(\d+)x?\s+(.+)$/);
    const n = m ? Number(m[1]) : 1;
    const name = (m ? m[2] : s).trim();
    for (let k = 0; k < n; k++) slots.push({ name });
  }
}
const names = [...new Set(slots.map((s) => s.name))];
console.log(`${slots.length} slots, ${names.length} distinct cards, from ${lists.join(' + ')}`);

// ---------- pick every card ----------
const picks = new Map();
const started = Date.now();
let stopped = null;
if (opt.batch) {
  try {
    await prefetch([...names, ...names.map((n) => dfc.get(processQuery(n))).filter(Boolean)]);
  } catch (e) {
    if (!(e instanceof RateLimited)) throw e;
    die(`STOPPED: rate-limited during the batch fetch: ${e.message}. Nothing written.`, 2);
  }
}
for (let i = 0; i < names.length; i++) {
  const name = names[i];
  try {
    let searchedAs = name;
    let { versions } = await versionsOf(name);
    if (!versions.length && ALIASES[name]) { searchedAs = ALIASES[name]; ({ versions } = await versionsOf(searchedAs)); }
    const front = pick(versions, searchedAs, 'front');
    const entry = { name, searchedAs, front, back: null, backName: null };
    const backName = dfc.get(processQuery(name));
    if (backName && front) {
      entry.backName = backName;
      entry.back = pick((await versionsOf(backName)).versions, backName, 'back', front.c);
    }
    picks.set(name, entry);
    const tag = front ? (front.tierName ? `ALT  ${front.tierName}` : 'DEF') : 'NONE';
    console.log(`[${i + 1}/${names.length}] ${tag.padEnd(16)} ${name}${front ? ` -> ${front.c.name} (${front.c.sourceName}, ${front.c.dpi})` : ' -> NOT FOUND'}${entry.back ? ` // ${entry.back.c.name}` : ''}`);
  } catch (e) {
    if (e instanceof RateLimited) { stopped = `rate-limited at card ${i + 1} (${name}): ${e.message}`; break; }
    throw e;
  }
  // Budget: after 15 cards, project the whole run's API time and stop early.
  if (i === 14 && names.length > 40 && apiCalls > 0) {
    const perCard = (Date.now() - started) / 15;
    const projectedMin = (perCard * names.length) / 60000;
    console.log(`projected API time for ${names.length} cards: ${projectedMin.toFixed(1)} min (budget ${opt.budgetMin})`);
    if (projectedMin > opt.budgetMin) { stopped = `projected ${projectedMin.toFixed(1)} min > budget ${opt.budgetMin} min; stopped after 15 cards`; break; }
  }
}
console.log(`API calls this run: ${apiCalls} (429s honoured: ${rateLimits}), ${((Date.now() - started) / 1000).toFixed(0)} s`);
if (stopped) die(`STOPPED: ${stopped}. Nothing written; re-run later (responses so far are cached in ${opt.cache}).`, 2);

// ---------- the TSV ----------
const tsvEsc = (s) => String(s ?? '').replace(/[\t\r\n]+/g, ' ');
const rows = [['card', 'chosen', 'source', 'dpi', 'why', 'versions', 'eligible', 'alternates', 'id', 'back_face', 'back_chosen', 'back_source', 'back_dpi', 'back_id'].join('\t')];
for (const name of names) {
  const p = picks.get(name);
  const f = p.front;
  rows.push([
    name + (p.searchedAs !== name ? ` (as ${p.searchedAs})` : ''),
    f ? `${f.c.name}.${f.c.extension}` : 'NOT FOUND', f?.c.sourceName ?? '', f?.c.dpi ?? '', f?.why ?? 'no result in the database',
    f?.versions ?? 0, f?.eligible ?? 0, f?.alternates ?? 0, f?.c.identifier ?? '',
    p.backName ?? '', p.back ? `${p.back.c.name}.${p.back.c.extension}` : '', p.back?.c.sourceName ?? '', p.back?.c.dpi ?? '', p.back?.c.identifier ?? '',
  ].map(tsvEsc).join('\t'));
}
const tsvPath = join(opt.out, `${base}-picks.tsv`);
writeFileSync(tsvPath, rows.join('\n') + '\n');

// ---------- the order XML (the shape of the editor's export, as cards.xml) ----------
const xmlEsc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const fronts = new Map(), backs = new Map();
slots.forEach((s, slot) => {
  const p = picks.get(s.name);
  if (p.front) { const k = p.front.c.identifier; if (!fronts.has(k)) fronts.set(k, { c: p.front.c, slots: [] }); fronts.get(k).slots.push(slot); }
  if (p.back) { const k = p.back.c.identifier; if (!backs.has(k)) backs.set(k, { c: p.back.c, slots: [] }); backs.get(k).slots.push(slot); }
});
const cardXml = ({ c, slots: sl }) =>
  `        <card><id>${xmlEsc(c.identifier)}</id><slots>${sl.join(',')}</slots><name>${xmlEsc(`${c.name}.${c.extension}`)}</name><query>${xmlEsc(c.searchq)}</query></card>`;
const missing = names.filter((n) => !picks.get(n).front);
const quantity = slots.length;
const bracket = BRACKETS.find((b) => b >= quantity) ?? BRACKETS.at(-1);
const xml = [
  '<order>', '    <details>', `        <quantity>${quantity}</quantity>`, `        <bracket>${bracket}</bracket>`,
  `        <stock>${STOCK}</stock>`, '        <foil>false</foil>', '    </details>',
  '    <fronts>', ...[...fronts.values()].map(cardXml), '    </fronts>',
  ...(backs.size ? ['    <backs>', ...[...backs.values()].map(cardXml), '    </backs>'] : []),
  `    <cardback>${DEFAULT_CARDBACK}</cardback>`, '</order>', '',
].join('\n');
const xmlPath = join(opt.out, `${base}-altart.xml`);
writeFileSync(xmlPath, xml);

// ---------- the contact sheet ----------
const sheetPaths = [];
if (opt.sheet) {
  const hasMontage = spawnSync('montage', ['-version']).status === 0;
  if (!hasMontage) console.log('no ImageMagick `montage` on PATH: contact sheet skipped');
  else {
    const tiles = [];
    for (const name of names) {
      const p = picks.get(name);
      if (p.front) tiles.push({ c: p.front.c, label: `${name}\n${p.front.tierName ?? 'default'} · ${p.front.c.sourceName}` });
      if (p.back) tiles.push({ c: p.back.c, label: `back: ${p.backName}\n${p.back.tierName ?? 'default'} · ${p.back.c.sourceName}` });
    }
    let thumbFails = 0;
    let lastThumb = 0;
    for (const t of tiles) {
      t.file = join(opt.cache, 'thumbs', `${t.c.identifier}.jpg`);
      if (existsSync(t.file)) continue;
      const wait = lastThumb + 150 - Date.now();
      if (wait > 0) await sleep(wait);
      lastThumb = Date.now();
      try {
        const res = await fetch(t.c.smallThumbnailUrl, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30_000) });
        const type = res.headers.get('content-type') ?? '';
        if (!res.ok || !type.startsWith('image/')) throw new Error(`${res.status} ${type}`);
        writeFileSync(t.file, Buffer.from(await res.arrayBuffer()));
      } catch (e) {
        thumbFails++;
        t.file = null;
        console.log(`thumbnail failed for ${t.c.name}: ${e.message}`);
      }
    }
    if (thumbFails === tiles.length) console.log('no thumbnail could be fetched (auth?): contact sheet skipped, the TSV stands alone');
    else {
      const placeholder = join(opt.cache, 'thumbs', '_missing.jpg');
      if (!existsSync(placeholder)) spawnSync('convert', ['-size', '294x400', 'xc:#444', '-fill', 'white', '-gravity', 'center', '-pointsize', '28', '-annotate', '0', 'no thumbnail', placeholder]);
      const pages = Math.ceil(tiles.length / SHEET_PAGE);
      for (let pg = 0; pg < pages; pg++) {
        const chunk = tiles.slice(pg * SHEET_PAGE, (pg + 1) * SHEET_PAGE);
        const out = join(opt.out, `${base}-altart-contact${pages > 1 ? `-p${pg + 1}` : ''}.jpg`);
        const margs = [];
        for (const t of chunk) margs.push('-label', t.label.replace(/%/g, '%%').replace(/\\/g, '\\\\'), t.file ?? placeholder);
        const r = spawnSync('montage', [
          ...margs, '-tile', '8x', '-geometry', '184x250+6+6', '-pointsize', '11', '-background', '#f4f1ea',
          '-title', `${base} — alternate-art picks${pages > 1 ? ` (page ${pg + 1}/${pages})` : ''}`, '-quality', '78', out,
        ], { stdio: ['ignore', 'inherit', 'inherit'] });
        if (r.status !== 0) die(`montage failed for ${out}`);
        sheetPaths.push(out);
      }
    }
  }
}

// ---------- summary ----------
const all = names.map((n) => picks.get(n));
const alt = all.filter((p) => p.front?.tierName).length;
const def = all.filter((p) => p.front && !p.front.tierName).length;
const byTier = {};
for (const p of all) if (p.front?.tierName) byTier[p.front.tierName] = (byTier[p.front.tierName] ?? 0) + 1;
console.log(`\n${names.length} cards: ${alt} alternate, ${def} default, ${missing.length} not found${missing.length ? ` (${missing.join('; ')})` : ''}`);
console.log(`by rank: ${JSON.stringify(byTier)}`);
console.log(`two-sided: ${all.filter((p) => p.back).map((p) => p.name).join('; ') || 'none'}`);
console.log(`wrote ${resolve(xmlPath)} (${quantity} cards, bracket ${bracket})`);
console.log(`wrote ${resolve(tsvPath)}`);
for (const s of sheetPaths) console.log(`wrote ${resolve(s)}`);

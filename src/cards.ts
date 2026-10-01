/*
 * ForgeCoach — cards.ts
 * Card data from Scryfall (https://scryfall.com/docs/api), with an in-memory
 * cache backed by IndexedDB (or localStorage as a fallback).
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
export interface CardFace {
  name: string;
  manaCost: string;
  typeLine: string;
  oracleText: string;
  power?: string;
  toughness?: string;
  loyalty?: string;
  image?: CardImages;
}
export interface CardImages {
  small?: string;
  normal?: string;
  large?: string;
  artCrop?: string;
}
export interface CardInfo {
  /** The name we asked for (Forge's spelling). */
  name: string;
  /** False when Scryfall had no match; the other fields are then empty. */
  found: boolean;
  manaCost: string;
  typeLine: string;
  /** Full oracle text; for multi-face cards, the faces joined with "\n//\n". */
  oracleText: string;
  power?: string;
  toughness?: string;
  loyalty?: string;
  /** Scryfall produced_mana, e.g. ["U","B"]. Empty when it makes no mana. */
  producedMana: string[];
  colors: string[];
  image?: CardImages;
  faces?: CardFace[];
  scryfallUri?: string;
  /** Scryfall's canonical name, when it differs from (or matches) `name`. */
  scryfallName?: string;
}

// ---------------------------------------------------------------------------
// Constants

const API = 'https://api.scryfall.com';
const BATCH_SIZE = 75; // Scryfall /cards/collection limit
const CACHE_VERSION = 1;
const LS_KEY = `forgecoach.cards.v${CACHE_VERSION}`;
const IDB_NAME = 'forgecoach-cards';
const IDB_STORE = `cards-v${CACHE_VERSION}`;
const DAY = 24 * 60 * 60 * 1000;
const TTL_FOUND = 30 * DAY;
const TTL_NOT_FOUND = 1 * DAY;

/** Minimum spacing between Scryfall requests (Scryfall asks for 50–100 ms). */
let requestSpacingMs = 100;

// ---------------------------------------------------------------------------
// Name handling

/**
 * Cleans a Forge card name for lookup: drops Forge's "|SET" / "|SET|art" suffixes
 * and a trailing " (SET)" edition tag, normalises curly quotes and whitespace,
 * and turns Forge's single-slash split names ("Fire / Ice") into "Fire // Ice".
 */
export function cleanCardName(name: string): string {
  let n = name.split('|')[0];
  n = n.replace(/\s*\([A-Z0-9]{2,6}\)\s*$/, '');
  n = n.replace(/[‘’]/g, "'").replace(/[“”]/g, '"');
  n = n.replace(/\s+\/\/?\s+/g, ' // ');
  return n.replace(/\s+/g, ' ').trim();
}

/** Cache / matching key: cleaned, lower-cased, diacritics stripped. */
function keyOf(name: string): string {
  return cleanCardName(name)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

// ---------------------------------------------------------------------------
// Scryfall → CardInfo

interface SfImages {
  small?: string;
  normal?: string;
  large?: string;
  art_crop?: string;
}
interface SfFace {
  name?: string;
  mana_cost?: string;
  type_line?: string;
  oracle_text?: string;
  power?: string;
  toughness?: string;
  loyalty?: string;
  colors?: string[];
  image_uris?: SfImages;
}
export interface ScryfallCard extends SfFace {
  object?: string;
  produced_mana?: string[];
  card_faces?: SfFace[];
  scryfall_uri?: string;
}

function mapImages(i: SfImages | undefined): CardImages | undefined {
  if (!i) return undefined;
  const out: CardImages = {};
  if (i.small) out.small = i.small;
  if (i.normal) out.normal = i.normal;
  if (i.large) out.large = i.large;
  if (i.art_crop) out.artCrop = i.art_crop;
  return Object.keys(out).length ? out : undefined;
}

export function emptyCard(name: string): CardInfo {
  return { name, found: false, manaCost: '', typeLine: '', oracleText: '', producedMana: [], colors: [] };
}

/** Maps a Scryfall card object to CardInfo under the requested (Forge) name. */
export function mapScryfallCard(requestedName: string, c: ScryfallCard): CardInfo {
  const sfFaces = c.card_faces ?? [];
  const faces: CardFace[] = sfFaces.map((f) => {
    const face: CardFace = {
      name: f.name ?? '',
      manaCost: f.mana_cost ?? '',
      typeLine: f.type_line ?? '',
      oracleText: f.oracle_text ?? '',
    };
    if (f.power !== undefined) face.power = f.power;
    if (f.toughness !== undefined) face.toughness = f.toughness;
    if (f.loyalty !== undefined) face.loyalty = f.loyalty;
    const img = mapImages(f.image_uris);
    if (img) face.image = img;
    return face;
  });
  const multi = faces.length > 0;
  const first = sfFaces[0];

  const manaCost = c.mana_cost !== undefined && c.mana_cost !== '' ? c.mana_cost : multi ? faces.map((f) => f.manaCost).filter(Boolean).join(' // ') : '';
  const typeLine = c.type_line ?? (multi ? faces.map((f) => f.typeLine).join(' // ') : '');
  const oracleText = multi ? faces.map((f) => f.oracleText).join('\n//\n') : (c.oracle_text ?? '');
  let colors = c.colors;
  if (!colors) {
    const set = new Set<string>();
    for (const f of sfFaces) for (const col of f.colors ?? []) set.add(col);
    colors = [...set];
  }

  const info: CardInfo = {
    name: requestedName,
    found: true,
    manaCost,
    typeLine,
    oracleText,
    producedMana: c.produced_mana ?? [],
    colors,
  };
  const power = c.power ?? first?.power;
  const toughness = c.toughness ?? first?.toughness;
  const loyalty = c.loyalty ?? first?.loyalty;
  if (power !== undefined) info.power = power;
  if (toughness !== undefined) info.toughness = toughness;
  if (loyalty !== undefined) info.loyalty = loyalty;
  const image = mapImages(c.image_uris) ?? faces.find((f) => f.image)?.image;
  if (image) info.image = image;
  if (multi) info.faces = faces;
  if (c.scryfall_uri) info.scryfallUri = c.scryfall_uri;
  if (c.name) info.scryfallName = c.name;
  return info;
}

// ---------------------------------------------------------------------------
// Cache

interface Entry {
  info: CardInfo;
  /** Time stored (ms since epoch). */
  t: number;
}

const memory = new Map<string, Entry>();
const inflight = new Map<string, Promise<CardInfo>>();

function fresh(e: Entry | undefined, now = Date.now()): e is Entry {
  if (!e) return false;
  const ttl = e.info.found ? TTL_FOUND : TTL_NOT_FOUND;
  return now - e.t < ttl;
}

type Store = {
  loadAll(): Promise<Array<[string, Entry]>>;
  put(entries: Array<[string, Entry]>): Promise<void>;
};

function idbAvailable(): boolean {
  try {
    return typeof indexedDB !== 'undefined' && indexedDB !== null;
  } catch {
    return false;
  }
}
function lsAvailable(): Storage | null {
  try {
    if (typeof localStorage === 'undefined' || localStorage === null) return null;
    return localStorage;
  } catch {
    return null;
  }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

function idbStore(): Store {
  let dbp: Promise<IDBDatabase> | null = null;
  const open = () =>
    (dbp ??= new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(IDB_NAME, CACHE_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const n of Array.from(db.objectStoreNames)) if (n !== IDB_STORE) db.deleteObjectStore(n);
        if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('IndexedDB blocked'));
    }));
  return {
    async loadAll() {
      const db = await open();
      return new Promise((resolve, reject) => {
        const out: Array<[string, Entry]> = [];
        const tx = db.transaction(IDB_STORE, 'readonly');
        const cur = tx.objectStore(IDB_STORE).openCursor();
        cur.onsuccess = () => {
          const c = cur.result;
          if (c) {
            out.push([String(c.key), c.value as Entry]);
            c.continue();
          } else resolve(out);
        };
        cur.onerror = () => reject(cur.error);
      });
    },
    async put(entries) {
      const db = await open();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(IDB_STORE, 'readwrite');
        const st = tx.objectStore(IDB_STORE);
        for (const [k, e] of entries) st.put(e, k);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
    },
  };
}

function lsStore(ls: Storage): Store {
  const read = (): Record<string, Entry> => {
    try {
      const raw = ls.getItem(LS_KEY);
      return raw ? (JSON.parse(raw) as Record<string, Entry>) : {};
    } catch {
      return {};
    }
  };
  return {
    async loadAll() {
      return Object.entries(read());
    },
    async put(entries) {
      const all = read();
      const now = Date.now();
      for (const k of Object.keys(all)) if (!fresh(all[k], now)) delete all[k];
      for (const [k, e] of entries) all[k] = e;
      try {
        ls.setItem(LS_KEY, JSON.stringify(all));
      } catch {
        /* quota exceeded or storage disabled — memory cache still works */
      }
    },
  };
}

let store: Store | null | undefined;
function getStore(): Store | null {
  if (store !== undefined) return store;
  try {
    if (idbAvailable()) store = idbStore();
    else {
      const ls = lsAvailable();
      store = ls ? lsStore(ls) : null;
    }
  } catch {
    store = null;
  }
  return store;
}

let initPromise: Promise<void> | null = null;

/** Hydrates the in-memory cache from the persistent store (idempotent, never rejects). */
export function initCardCache(): Promise<void> {
  return (initPromise ??= (async () => {
    let s = getStore();
    if (!s) return;
    let rows: Array<[string, Entry]>;
    try {
      rows = await withTimeout(s.loadAll(), 3000);
    } catch {
      // IndexedDB unusable (private mode, blocked): fall back to localStorage.
      const ls = lsAvailable();
      store = s = ls ? lsStore(ls) : null;
      if (!s) return;
      try {
        rows = await s.loadAll();
      } catch {
        return;
      }
    }
    const now = Date.now();
    for (const [k, e] of rows) {
      if (!e || !e.info || typeof e.t !== 'number' || !fresh(e, now)) continue;
      const cur = memory.get(k);
      if (!cur || cur.t < e.t) memory.set(k, e);
    }
  })());
}

function remember(results: Array<[string, CardInfo]>, persist: boolean): void {
  const t = Date.now();
  const entries: Array<[string, Entry]> = results.map(([k, info]) => [k, { info, t }]);
  for (const [k, e] of entries) memory.set(k, e);
  if (!persist || entries.length === 0) return;
  const s = getStore();
  if (s) s.put(entries).catch(() => undefined);
}

/** Synchronous cache read, for render paths. */
export function getCachedCard(name: string): CardInfo | undefined {
  if (!initPromise) void initCardCache();
  const e = memory.get(keyOf(name));
  if (!e) return undefined;
  return e.info.name === name ? e.info : { ...e.info, name };
}

// ---------------------------------------------------------------------------
// Rate-limited fetch

let queue: Promise<unknown> = Promise.resolve();
let lastRequestAt = 0;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Serialises Scryfall requests with at least `requestSpacingMs` between them. */
function scryfall(url: string, init?: RequestInit): Promise<Response> {
  const run = async () => {
    const wait = lastRequestAt + requestSpacingMs - Date.now();
    if (wait > 0) await sleep(wait);
    lastRequestAt = Date.now();
    let res = await fetch(url, { ...init, headers: { Accept: 'application/json', ...(init?.headers ?? {}) } });
    if (res.status === 429) {
      // Back off once, as Scryfall asks.
      await sleep(Math.max(1000, requestSpacingMs * 10));
      lastRequestAt = Date.now();
      res = await fetch(url, { ...init, headers: { Accept: 'application/json', ...(init?.headers ?? {}) } });
    }
    return res;
  };
  const p = queue.then(run, run);
  queue = p.catch(() => undefined);
  return p;
}

/** Index a Scryfall card under its full name and each face name. */
function indexCard(idx: Map<string, ScryfallCard>, c: ScryfallCard) {
  if (c.name) idx.set(keyOf(c.name), c);
  for (const f of c.card_faces ?? []) if (f.name && !idx.has(keyOf(f.name))) idx.set(keyOf(f.name), c);
}

type Lookup = { info: CardInfo; persist: boolean };

async function fuzzy(name: string): Promise<Lookup> {
  const cleaned = cleanCardName(name);
  const tries = [cleaned];
  if (cleaned.includes(' // ')) tries.push(cleaned.split(' // ')[0]);
  for (const q of tries) {
    let res: Response;
    try {
      res = await scryfall(`${API}/cards/named?fuzzy=${encodeURIComponent(q)}`);
    } catch {
      return { info: emptyCard(name), persist: false }; // network: don't cache the miss
    }
    if (res.ok) {
      const c = (await res.json()) as ScryfallCard;
      return { info: mapScryfallCard(name, c), persist: true };
    }
    if (res.status !== 404) return { info: emptyCard(name), persist: false };
  }
  return { info: emptyCard(name), persist: true };
}

/** Fetches one batch (≤75 names) via /cards/collection, then fuzzy-retries misses. */
async function fetchBatch(names: string[]): Promise<Map<string, Lookup>> {
  const out = new Map<string, Lookup>();
  const idx = new Map<string, ScryfallCard>();
  let collectionOk = false;
  try {
    const res = await scryfall(`${API}/cards/collection`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifiers: names.map((n) => ({ name: cleanCardName(n) })) }),
    });
    if (res.ok) {
      collectionOk = true;
      const body = (await res.json()) as { data?: ScryfallCard[] };
      for (const c of body.data ?? []) indexCard(idx, c);
    }
  } catch {
    /* network failure: fall through to per-name lookups below */
  }
  for (const n of names) {
    const c = idx.get(keyOf(n));
    if (c) out.set(n, { info: mapScryfallCard(n, c), persist: true });
  }
  const missing = names.filter((n) => !out.has(n));
  if (!collectionOk && missing.length === names.length) {
    // The whole batch failed (offline/CORS/5xx) — don't hammer Scryfall with fuzzy calls.
    for (const n of missing) out.set(n, { info: emptyCard(n), persist: false });
    return out;
  }
  for (const n of missing) out.set(n, await fuzzy(n));
  return out;
}

function abortable<T>(p: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return p;
  if (signal.aborted) return Promise.reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
    signal.addEventListener('abort', onAbort, { once: true });
    p.then(
      (v) => {
        signal.removeEventListener('abort', onAbort);
        resolve(v);
      },
      (e) => {
        signal.removeEventListener('abort', onAbort);
        reject(e);
      },
    );
  });
}

/**
 * Fetch (or read from cache) every name; never rejects for unknown names.
 * Rejects only if `signal` aborts (the underlying requests still complete and fill the cache).
 * The returned map is keyed by the names exactly as passed in.
 */
export async function getCards(names: string[], opts?: { signal?: AbortSignal }): Promise<Map<string, CardInfo>> {
  const signal = opts?.signal;
  await abortable(initCardCache(), signal);

  const result = new Map<string, CardInfo>();
  const waits: Array<Promise<void>> = [];
  const toFetch = new Map<string, string>(); // key → representative name
  const now = Date.now();

  for (const name of new Set(names)) {
    if (!name || !name.trim()) continue;
    const k = keyOf(name);
    const e = memory.get(k);
    if (fresh(e, now)) {
      result.set(name, e.info.name === name ? e.info : { ...e.info, name });
      continue;
    }
    const pending = inflight.get(k);
    if (pending) {
      waits.push(pending.then((info) => void result.set(name, { ...info, name })));
      continue;
    }
    if (!toFetch.has(k)) toFetch.set(k, name);
  }

  if (toFetch.size) {
    const keys = [...toFetch.keys()];
    const reps = [...toFetch.values()];
    const resolvers = new Map<string, (i: CardInfo) => void>();
    for (const k of keys) {
      const p = new Promise<CardInfo>((r) => resolvers.set(k, r));
      inflight.set(k, p);
    }
    const work = (async () => {
      for (let i = 0; i < reps.length; i += BATCH_SIZE) {
        const chunk = reps.slice(i, i + BATCH_SIZE);
        let got: Map<string, Lookup>;
        try {
          got = await fetchBatch(chunk);
        } catch {
          got = new Map(chunk.map((n) => [n, { info: emptyCard(n), persist: false }]));
        }
        const persisted: Array<[string, CardInfo]> = [];
        for (const n of chunk) {
          const k = keyOf(n);
          const l = got.get(n) ?? { info: emptyCard(n), persist: false };
          // Transient failures answer this caller but are not cached, so the next call retries.
          if (l.persist) persisted.push([k, l.info]);
          inflight.delete(k);
          resolvers.get(k)?.(l.info);
          resolvers.delete(k);
        }
        remember(persisted, true);
      }
    })().finally(() => {
      // Never leave a waiter hanging, whatever happened above.
      for (const [k, r] of resolvers) {
        inflight.delete(k);
        r(emptyCard(toFetch.get(k)!));
      }
    });
    for (const [k, name] of toFetch) {
      const p = inflight.get(k)!;
      waits.push(p.then((info) => void result.set(name, info)));
    }
    // Names that share a key with a representative (e.g. different spellings).
    for (const name of new Set(names)) {
      if (!name || !name.trim() || result.has(name)) continue;
      const k = keyOf(name);
      if (toFetch.has(k) && toFetch.get(k) !== name) {
        waits.push(inflight.get(k)!.then((info) => void result.set(name, { ...info, name })));
      }
    }
    work.catch(() => undefined);
  }

  await abortable(Promise.all(waits), signal);
  return result;
}

// ---------------------------------------------------------------------------
// Test hooks

/** For tests: clears all in-memory state and optionally changes the request spacing. */
export function __resetCardCacheForTests(opts?: { spacingMs?: number }): void {
  memory.clear();
  inflight.clear();
  initPromise = null;
  store = undefined;
  queue = Promise.resolve();
  lastRequestAt = 0;
  requestSpacingMs = opts?.spacingMs ?? 100;
}

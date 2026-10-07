/*
 * ForgeCoach — play/tableLog.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * A table seat's frames, kept in this browser while its game runs, so a page
 * that comes back to the same seat mid-game still has the game's history.
 *
 * Why: everything that reads a game's history — the Game Log drawer
 * (eventLog.ts), the coach's "this turn" facts and chosen colours (state.ts),
 * the win chance's history (winChance.ts), the post-game summary (review.ts),
 * the film room, "Your record" — is built from the frames this page received.
 * The bridge's catch-up on a connect is a snapshot, not a history: `hello_ok`,
 * the latest `state` (whose §3.6 `events` are only its own batch), `table`,
 * the current `input` and any open `ask` (mtg-table §2.1, M10, M59). A page
 * that joins a table of two mid-game — a reload, a phone that discarded the
 * tab while the friend was thinking, Back to the room and then the seat again,
 * a second tab taking the seat (M59's 4002) — therefore started its log at that
 * state: "T9 · Your turn · Nothing yet", 0 events, the first eight turns gone.
 *
 * So a table session (play/session.ts with `table: true`) appends every frame
 * its log takes to this store, keyed by its seat URL (a seat token is one seat
 * of one game, D402/D403), and a new session on that URL reads them back
 * before it connects; the catch-up's frames are then the same frames again
 * (same type and seq, M10), which the log builder skips as on any reconnect.
 * Play against Forge keeps nothing here and is unchanged.
 *
 * The frames are this seat's own, already redacted for it by the bridge and
 * through faceDown.ts's guard; they never leave the browser. Tables older than
 * TABLE_LOG_MAX_AGE_MS, and all but the TABLE_LOG_MAX_TABLES newest, are
 * dropped when the store opens. Storage is injected: IndexedDB in the browser,
 * memory in tests (and where IndexedDB is missing). DOM-free.
 */
import type { LoggedFrame } from '../log.ts';

export interface TableLogStore {
  /** Every frame kept for `key`, in the order appended ([] when none, or on any failure). */
  load(key: string): Promise<LoggedFrame[]>;
  /** Appends frames for `key`. Calls take effect in the order made, loads included. Never rejects. */
  append(key: string, frames: LoggedFrame[]): Promise<void>;
  /** Forgets `key`. Never rejects. */
  clear(key: string): Promise<void>;
}

/** Kept tables older than this are dropped. */
export const TABLE_LOG_MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;
/** At most this many tables are kept (the newest). */
export const TABLE_LOG_MAX_TABLES = 12;

/**
 * The storage key of a seat URL. The URL carries the seat token, so it is
 * hashed (cyrb53) rather than kept as is.
 */
export function tableLogKey(url: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < url.length; i++) {
    const c = url.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `t${(h2 >>> 0).toString(16).padStart(8, '0')}${(h1 >>> 0).toString(16).padStart(8, '0')}`;
}

/** In memory: tests, and a browser without IndexedDB (it then lasts as long as the page). */
export function memoryTableLog(): TableLogStore {
  const m = new Map<string, string[]>();
  return {
    // Stored as text, as IndexedDB keeps a copy: a later change to a frame object is not the stored frame.
    load: async (k) => (m.get(k) ?? []).flatMap((t) => JSON.parse(t) as LoggedFrame[]),
    append: async (k, frames) => {
      if (frames.length) m.set(k, [...(m.get(k) ?? []), JSON.stringify(frames)]);
    },
    clear: async (k) => void m.delete(k),
  };
}

const DB_NAME = 'forgecoach-table-log';
/** One record per append: key [tableKey, n], value the frames as JSON text. */
const CHUNKS = 'chunks';
/** One record per table: key tableKey, value {at: last write (ms), n: next chunk number}. */
const TABLES = 'tables';

interface TableMeta {
  at: number;
  n: number;
}

/**
 * IndexedDB. Every operation runs after the previous one has finished, so a
 * load never misses an append made before it and a clear is never overtaken.
 * Every failure resolves quietly: a log that cannot be kept must not disturb play.
 */
export function indexedDbTableLog(
  idb: IDBFactory | undefined = (globalThis as { indexedDB?: IDBFactory }).indexedDB,
  now: () => number = () => Date.now(),
): TableLogStore | null {
  if (!idb || typeof IDBKeyRange === 'undefined') return null;
  const chunksOf = (k: string) => IDBKeyRange.bound([k, 0], [k, Number.MAX_SAFE_INTEGER]);
  const finished = (tx: IDBTransaction) =>
    new Promise<void>((resolve) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    });
  const result = <T>(req: IDBRequest<T>, fallback: T) =>
    new Promise<T>((resolve) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(fallback);
    });

  let dbp: Promise<IDBDatabase | null> | null = null;
  const open = () =>
    (dbp ??= new Promise<IDBDatabase | null>((resolve) => {
      try {
        const req = idb.open(DB_NAME, 1);
        req.onupgradeneeded = () => {
          req.result.createObjectStore(CHUNKS);
          req.result.createObjectStore(TABLES);
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
        req.onblocked = () => resolve(null);
      } catch {
        resolve(null);
      }
    }).then(async (db) => {
      if (db) await prune(db).catch(() => {});
      return db;
    }));

  async function prune(db: IDBDatabase): Promise<void> {
    const keys = (await result(db.transaction(TABLES, 'readonly').objectStore(TABLES).getAllKeys(), [] as IDBValidKey[])).map(String);
    const metas = await result(db.transaction(TABLES, 'readonly').objectStore(TABLES).getAll(), [] as unknown[]);
    const rows = keys.map((k, i) => ({ k, at: (metas[i] as TableMeta | undefined)?.at ?? 0 })).sort((a, b) => b.at - a.at);
    const drop = rows.filter((r, i) => i >= TABLE_LOG_MAX_TABLES || !(now() - r.at <= TABLE_LOG_MAX_AGE_MS));
    if (!drop.length) return;
    const tx = db.transaction([CHUNKS, TABLES], 'readwrite');
    for (const r of drop) {
      tx.objectStore(CHUNKS).delete(chunksOf(r.k));
      tx.objectStore(TABLES).delete(r.k);
    }
    await finished(tx);
  }

  let chain: Promise<unknown> = Promise.resolve();
  const serial = <T>(f: (db: IDBDatabase) => Promise<T>, fallback: T): Promise<T> => {
    const p = chain.then(async () => {
      const db = await open();
      return db ? await f(db) : fallback;
    }).catch(() => fallback);
    chain = p;
    return p;
  };

  return {
    load: (k) =>
      serial(async (db) => {
        const texts = await result(db.transaction(CHUNKS, 'readonly').objectStore(CHUNKS).getAll(chunksOf(k)), [] as unknown[]);
        const out: LoggedFrame[] = [];
        for (const t of texts) {
          if (typeof t !== 'string') continue;
          try {
            const fs = JSON.parse(t) as unknown;
            if (Array.isArray(fs)) out.push(...(fs as LoggedFrame[]));
          } catch {
            /* a damaged chunk is skipped */
          }
        }
        return out;
      }, [] as LoggedFrame[]),
    append: (k, frames) =>
      serial(async (db) => {
        if (!frames.length) return;
        const meta = await result(db.transaction(TABLES, 'readonly').objectStore(TABLES).get(k) as IDBRequest<TableMeta | undefined>, undefined);
        const n = typeof meta?.n === 'number' ? meta.n : 0;
        const tx = db.transaction([CHUNKS, TABLES], 'readwrite');
        tx.objectStore(CHUNKS).put(JSON.stringify(frames), [k, n]);
        tx.objectStore(TABLES).put({ at: now(), n: n + 1 } satisfies TableMeta, k);
        await finished(tx);
      }, undefined),
    clear: (k) =>
      serial(async (db) => {
        const tx = db.transaction([CHUNKS, TABLES], 'readwrite');
        tx.objectStore(CHUNKS).delete(chunksOf(k));
        tx.objectStore(TABLES).delete(k);
        await finished(tx);
      }, undefined),
  };
}

let browserStore: TableLogStore | undefined;
/** The browser's store: IndexedDB, else memory. */
export function defaultTableLog(): TableLogStore {
  if (browserStore === undefined) {
    let s: TableLogStore | null = null;
    try {
      s = indexedDbTableLog();
    } catch {
      s = null;
    }
    browserStore = s ?? memoryTableLog();
  }
  return browserStore;
}

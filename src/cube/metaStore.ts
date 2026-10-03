/*
 * ForgeCoach — cube/metaStore.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Cube-lab meta files the user imported (file picker or drag and drop), kept
 * in IndexedDB per cube id; they win over the meta shipped with the page.
 * Falls back to memory when IndexedDB is unavailable (private mode).
 */
import type { CubeMeta } from './meta.ts';

const DB = 'forgecoach-cube-meta';
const STORE = 'meta-v1';
const memory = new Map<string, CubeMeta>();

function open(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null);
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

function run<T>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>): Promise<T | undefined> {
  return open().then(
    (db) =>
      new Promise<T | undefined>((resolve) => {
        if (!db) return resolve(undefined);
        try {
          const req = f(db.transaction(STORE, mode).objectStore(STORE));
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => resolve(undefined);
        } catch {
          resolve(undefined);
        }
      }),
  );
}

export async function getImportedMeta(cubeId: string): Promise<CubeMeta | null> {
  if (memory.has(cubeId)) return memory.get(cubeId) ?? null;
  const v = await run<CubeMeta>('readonly', (s) => s.get(cubeId) as IDBRequest<CubeMeta>);
  if (v) memory.set(cubeId, v);
  return v ?? null;
}

export async function setImportedMeta(cubeId: string, meta: CubeMeta | null): Promise<void> {
  if (meta) memory.set(cubeId, meta);
  else memory.delete(cubeId);
  await run<unknown>('readwrite', (s) => (meta ? s.put(meta, cubeId) : s.delete(cubeId)) as IDBRequest<unknown>);
}

/*
 * ForgeCoach — lab/source.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Where the #lab pages read from. On Justin's PC the lab runner (mtg-table
 * `tools/runner/serve.ts`) serves the same public, sanitised status.json and
 * ladder.json it pushes to the lab-status branch, on http://127.0.0.1:8645,
 * fresh to the second; everywhere else the page reads lab-status on GitHub,
 * which the runner pushes about once a minute while a job runs and every five
 * minutes otherwise.
 *
 * So the default source tries the PC first with a short timeout and falls back
 * to GitHub. Which one worked is remembered for the session (a sessionStorage
 * hint, every access in try/catch), so a phone or another machine does not wait
 * on the timeout at every refresh: once the PC has failed, it is tried again
 * only every few minutes (or at a manual Refresh after half a minute). A
 * `?src=` in the hash still overrides all of this (lab/status.ts `hashSource`).
 * DOM-free; `fetch`, the storage and the clock are injected.
 */

export const LOCAL_STATUS_URL = 'http://127.0.0.1:8645/public-status.json';
export const LOCAL_LADDER_URL = 'http://127.0.0.1:8645/public-ladder.json';
/** How long the PC may take before the page goes to GitHub. */
export const LOCAL_TIMEOUT_MS = 800;
/** After the PC failed, how long until an automatic refresh tries it again. */
export const LOCAL_RETRY_MS = 5 * 60_000;
/** After the PC failed, how long until a manual Refresh tries it again. */
export const LOCAL_RETRY_MANUAL_MS = 30_000;
/** Auto-refresh periods for the status page, by where the data came from. */
export const REFRESH_LOCAL_MS = 15_000;
export const REFRESH_REMOTE_MS = 60_000;

export const HINT_KEYS = { status: 'forgecoach.lab.source.status', ladder: 'forgecoach.lab.source.ladder' } as const;

/** Where a shown document came from. */
export type Origin = 'local' | 'github' | 'custom' | 'sample';

export interface SourceHint {
  /** The PC answered last time. */
  local: boolean;
  /** When the PC was last tried (ms). */
  triedAt: number;
}

export type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

/** The session's storage, or null where there is none (private mode, sandbox, node). */
export function sessionStore(): StorageLike | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
}

export function readHint(storage: StorageLike | null, key: string): SourceHint | null {
  try {
    const v = JSON.parse(storage?.getItem(key) ?? 'null') as unknown;
    if (typeof v === 'object' && v !== null && typeof (v as SourceHint).local === 'boolean' && Number.isFinite((v as SourceHint).triedAt)) {
      return { local: (v as SourceHint).local, triedAt: (v as SourceHint).triedAt };
    }
  } catch {
    /* unreadable: no hint */
  }
  return null;
}

export function writeHint(storage: StorageLike | null, key: string, hint: SourceHint): void {
  try {
    storage?.setItem(key, JSON.stringify(hint));
  } catch {
    /* full or blocked: the next load just tries again */
  }
}

/** Whether to try the PC now: no hint yet, it worked last time, or the last failure is old enough. */
export function shouldTryLocal(hint: SourceHint | null, now: number, manual = false): boolean {
  if (!hint || hint.local) return true;
  return now - hint.triedAt >= (manual ? LOCAL_RETRY_MANUAL_MS : LOCAL_RETRY_MS);
}

export interface PreferLocalOptions<T> {
  localUrl: string;
  remoteUrl: string;
  /** Fetch and parse one URL; it must honour the signal. */
  get: (url: string, signal: AbortSignal) => Promise<T>;
  storage: StorageLike | null;
  hintKey: string;
  /** The caller's own abort (a newer load). */
  signal?: AbortSignal;
  /** A manual Refresh: retry the PC sooner after a failure. */
  manual?: boolean;
  timeoutMs?: number;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (t: unknown) => void;
}

const aborted = (): Error => Object.assign(new Error('aborted'), { name: 'AbortError' });

/**
 * The PC's copy if it answers within the timeout, else GitHub's. Remembers which
 * one worked. A failure of GitHub's is thrown as `get` threw it; an abort of the
 * caller's signal is thrown as an AbortError.
 */
export async function fetchPreferLocal<T>(o: PreferLocalOptions<T>): Promise<{ value: T; origin: 'local' | 'github' }> {
  const now = o.now ?? Date.now;
  const setTimer = o.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = o.clearTimer ?? ((t) => clearTimeout(t as ReturnType<typeof setTimeout>));
  if (shouldTryLocal(readHint(o.storage, o.hintKey), now(), o.manual)) {
    const c = new AbortController();
    const onAbort = () => c.abort();
    o.signal?.addEventListener('abort', onAbort);
    const timer = setTimer(() => c.abort(), o.timeoutMs ?? LOCAL_TIMEOUT_MS);
    try {
      const value = await Promise.race([
        o.get(o.localUrl, c.signal),
        new Promise<never>((_, reject) => c.signal.addEventListener('abort', () => reject(aborted()))),
      ]);
      writeHint(o.storage, o.hintKey, { local: true, triedAt: now() });
      return { value, origin: 'local' };
    } catch {
      if (o.signal?.aborted) throw aborted();
      writeHint(o.storage, o.hintKey, { local: false, triedAt: now() });
    } finally {
      clearTimer(timer);
      o.signal?.removeEventListener('abort', onAbort);
    }
  }
  if (o.signal?.aborted) throw aborted();
  return { value: await o.get(o.remoteUrl, o.signal ?? new AbortController().signal), origin: 'github' };
}

/** The status page's auto-refresh period: quick while the PC answers, a minute otherwise. */
export function refreshPeriod(origin: Origin | null): number {
  return origin === 'local' ? REFRESH_LOCAL_MS : REFRESH_REMOTE_MS;
}

/** "from your PC", "from GitHub", "from <host>", "sample". */
export function originLabel(origin: Origin, customUrl?: string): string {
  if (origin === 'local') return 'from your PC';
  if (origin === 'github') return 'from GitHub';
  if (origin === 'sample') return 'sample data';
  let host = '';
  try {
    host = customUrl ? new URL(customUrl).host : '';
  } catch {
    /* not a URL: no host */
  }
  return host ? `from ${host}` : 'from a custom source';
}

/** "updated 12 s ago" under a minute, then "updated 3 min ago" (a clock a little ahead reads 0 s). */
export function updatedAgo(updated: Date | null, now: Date): string {
  if (!updated) return 'no update time';
  const s = Math.max(0, Math.round((now.getTime() - updated.getTime()) / 1000));
  if (s < 60) return `updated ${s} s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `updated ${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return m % 60 ? `updated ${h} h ${m % 60} min ago` : `updated ${h} h ago`;
  const d = Math.floor(h / 24);
  return h % 24 ? `updated ${d} d ${h % 24} h ago` : `updated ${d} d ago`;
}

/** The freshness line: "updated 12 s ago · from your PC". */
export function freshnessLine(updated: Date | null, now: Date, origin: Origin, customUrl?: string): string {
  return `${updatedAgo(updated, now)} · ${originLabel(origin, customUrl)}`;
}

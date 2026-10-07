/*
 * ForgeCoach — bug/consoleRing.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The page's recent console errors and warnings, for a bug report (mtg-table
 * D410): a ring of the last RING_SIZE, each cut to a few hundred characters.
 * `installConsoleRing` wraps `console.error` / `console.warn` (the originals
 * still run) and listens for uncaught errors and unhandled rejections. Nothing
 * leaves the page unless the player sends a report; the report scrubs secrets.
 *
 * DOM-free apart from the target passed in.
 */
import type { ConsoleEntry } from './report.ts';

export const RING_SIZE = 50;
const TEXT_MAX = 600;

export interface ConsoleRing {
  push(level: ConsoleEntry['level'], parts: unknown[]): void;
  entries(): ConsoleEntry[];
  clear(): void;
}

/** One argument as text: an Error by its name, message and first stack lines; anything else as JSON or String. */
export function partText(x: unknown): string {
  if (x instanceof Error) {
    const stack = (x.stack ?? '').split('\n').slice(1, 4).map((l) => l.trim()).join(' | ');
    return `${x.name}: ${x.message}${stack ? ` (${stack})` : ''}`;
  }
  if (typeof x === 'string') return x;
  try {
    const j = JSON.stringify(x);
    return j === undefined ? String(x) : j;
  } catch {
    return String(x);
  }
}

export function createConsoleRing(size = RING_SIZE, now: () => number = Date.now): ConsoleRing {
  const ring: ConsoleEntry[] = [];
  return {
    push(level, parts) {
      const text = parts.map(partText).join(' ').slice(0, TEXT_MAX);
      ring.push({ t: now(), level, text });
      if (ring.length > size) ring.splice(0, ring.length - size);
    },
    entries: () => ring.slice(),
    clear: () => void ring.splice(0),
  };
}

/** The page's one ring (main.tsx installs it). */
export const pageConsole: ConsoleRing = createConsoleRing();
let installed = false;

interface ConsoleTarget {
  console: Pick<Console, 'error' | 'warn'>;
  addEventListener(type: string, cb: (e: Event) => void): void;
}

/** Wraps console.error/warn and listens for uncaught errors; once per page. */
export function installConsoleRing(target: ConsoleTarget, ring: ConsoleRing = pageConsole): void {
  if (installed && ring === pageConsole) return;
  if (ring === pageConsole) installed = true;
  const c = target.console;
  for (const level of ['error', 'warn'] as const) {
    const orig = c[level].bind(c);
    c[level] = (...args: unknown[]) => {
      try {
        ring.push(level, args);
      } catch {
        /* never break the console */
      }
      orig(...args);
    };
  }
  target.addEventListener('error', (e) => {
    const ev = e as ErrorEvent;
    ring.push('unhandled', [ev.error ?? `${ev.message} at ${ev.filename ?? '?'}:${ev.lineno ?? '?'}`]);
  });
  target.addEventListener('unhandledrejection', (e) => {
    ring.push('unhandled', ['unhandled rejection:', (e as PromiseRejectionEvent).reason]);
  });
}

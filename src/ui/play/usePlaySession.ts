/*
 * ForgeCoach — ui/play/usePlaySession.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * React binding for play/session.ts: one seat connection per URL, shared by
 * every component that asks for it, read with useSyncExternalStore.
 *
 * Why the connection is not simply opened in an effect and closed in its
 * cleanup: the bridge admits ONE seat (protocol amendment M13). StrictMode
 * mounts, unmounts and remounts every effect in development, and a close
 * followed at once by a new connect can reach the bridge before it has
 * processed the close — the new socket is refused with 4001 and the page
 * sits on "Another window is the player". A disconnect also cancels any ask
 * the engine is parked on (M19), spending the player's decision on Forge's
 * default. So a release is deferred: the socket closes only when nobody
 * re-acquires it within RELEASE_GRACE_MS. (mtg-table's board solves the same
 * problem by never closing its page-scoped socket — web/src/main.tsx.)
 */
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { connectSeat, DEFAULT_SEAT_URL, type PlaySession, type PlaySnapshot } from '../../play/session.ts';

const RELEASE_GRACE_MS = 1_000;

interface Held {
  session: PlaySession;
  refs: number;
  closeTimer: ReturnType<typeof setTimeout> | null;
}
const held = new Map<string, Held>();

function acquire(url: string): PlaySession {
  let h = held.get(url);
  if (!h) {
    // A table of two (mtg-table D402) is reached with a seat token in `?seat=`.
    h = { session: connectSeat(url, /[?&]seat=/.test(url) ? { table: true } : {}), refs: 0, closeTimer: null };
    held.set(url, h);
  }
  if (h.closeTimer !== null) {
    clearTimeout(h.closeTimer);
    h.closeTimer = null;
  }
  h.refs += 1;
  return h.session;
}

function release(url: string): void {
  const h = held.get(url);
  if (!h) return;
  h.refs -= 1;
  if (h.refs > 0) return;
  h.closeTimer = setTimeout(() => {
    if (held.get(url) === h && h.refs <= 0) {
      held.delete(url);
      h.session.close();
    }
  }, RELEASE_GRACE_MS);
}

const noop = () => {};
const nothing = (): null => null;

export interface UsePlaySession {
  /** null until the effect has run, and while `url` is null. Use `reconnect()`, not `close()`, for a retry. */
  session: PlaySession | null;
  snapshot: PlaySnapshot | null;
}

/**
 * Be the player's seat at `url` (default ws://127.0.0.1:8642/ws) while the
 * calling component is mounted; `null` connects nothing. Re-renders at most
 * once per animation frame as frames arrive.
 */
export function usePlaySession(url: string | null = DEFAULT_SEAT_URL): UsePlaySession {
  const [session, setSession] = useState<PlaySession | null>(null);

  useEffect(() => {
    if (url === null) {
      setSession(null);
      return;
    }
    const s = acquire(url);
    setSession(s);
    return () => release(url);
  }, [url]);

  const subscribe = useCallback(
    (cb: () => void) => (session ? session.subscribe(() => cb()) : noop),
    [session],
  );
  const getSnapshot = useCallback(() => (session ? session.snapshot() : null), [session]);
  const snapshot = useSyncExternalStore(subscribe, session ? getSnapshot : nothing, session ? getSnapshot : nothing);
  return { session, snapshot };
}

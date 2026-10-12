/*
 * ForgeCoach — play/seatStatus.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The one line that says what the seat connection is doing, DOM-free so node
 * tests it. A page the engine is believed to have served (seatUrl.ts's
 * `servedByEngine`: any origin that is not a known dev port) dials its own
 * origin's /ws; a page that is really something else (a dev server on an
 * unlisted port) never answers, the socket sits in "connecting" for good, and
 * the line used to say "Connecting to the engine…" forever. After
 * CONNECT_SLOW_MS without an open, an engine-served page says what address it
 * is dialling (through `redactSeatUrl`: never the pairing token) and that the
 * page's own origin did not answer the seat.
 */
import { redactSeatUrl } from './seatUrl.ts';
import type { SeatStatus } from './session.ts';

/** How long a first connect may take before an engine-served page says so. */
export const CONNECT_SLOW_MS = 8_000;

export interface SeatStatusInput {
  status: SeatStatus;
  detail: string | null;
  /** The try in flight (1 for the first), as the session counts it. */
  attempts: number;
  /** POST /engine/start is waking a sleeping engine before the seat connects. */
  waking?: boolean;
}

export interface SeatStatusContext {
  /** The page believes the engine served it, so the seat is its own origin's /ws. */
  engineServed?: boolean;
  /** The socket has been connecting for CONNECT_SLOW_MS or more with no open. */
  slow?: boolean;
}

/** Whether `play` is a connection still under way (the socket has not given up, refused or failed). */
export function seatBusy(play: SeatStatusInput | null): boolean {
  return play !== null && (play.status === 'connecting' || play.status === 'idle' || play.status === 'open');
}

/** Whether the "still dialling" line applies: engine-served, no open yet, and slow. */
export function seatHang(play: SeatStatusInput | null, ctx: SeatStatusContext): boolean {
  return !!ctx.engineServed && !!ctx.slow && !!play && !play.waking && (play.status === 'connecting' || play.status === 'idle');
}

/** What the seat status means, in words (never showing the pairing token). */
export function seatStatusText(play: SeatStatusInput | null, url: string, ctx: SeatStatusContext = {}): string | null {
  if (!play) return null;
  if (play.waking) return 'Waking the engine…';
  if (play.status === 'open') return 'Connected — waiting for the engine to deal…';
  if (play.status === 'connecting' || play.status === 'idle') {
    const secs = Math.round(CONNECT_SLOW_MS / 1000);
    const tries = play.attempts > 1 ? ` (attempt ${play.attempts})` : '';
    if (seatHang(play, ctx)) {
      return `Still dialling ${redactSeatUrl(url)} after ${secs} s${tries}. This page’s origin did not answer the seat — it may not be the engine. Cancel to stop.`;
    }
    return play.attempts > 1 ? `Looking for the engine… (attempt ${play.attempts})` : 'Connecting to the engine…';
  }
  if (play.status === 'refused') return 'Another window has your seat. Close it, then try again.';
  return `Couldn’t reach the engine at ${redactSeatUrl(url)}.`;
}

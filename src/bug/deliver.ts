/*
 * ForgeCoach — bug/deliver.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Where a bug report goes (mtg-table D410), in order:
 *
 *   1. a page that holds a seat in a room (a friend's draft or table, or the
 *      owner's own) → that room: `POST <room>/room/<id>/bug` with the seat's
 *      `X-Room-Token`. It lands on the room owner's machine (Justin's PC) with
 *      the room and seat recorded. Such a page never falls back to the coach
 *      helper on 127.0.0.1: on a friend's computer that is not Justin's.
 *   2. otherwise → the coach helper (`POST /bug`, 8643; on an engine-served
 *      phone page the page's host, with the pairing token), Justin's own
 *      machine.
 *   3. neither answers (GitHub Pages with no helper, an old helper or room
 *      without the route, a full folder) → the panel offers "Download report":
 *      the same JSON as a file.
 *
 * DOM-free: `fetch` is injected; the download builds a Blob only when asked.
 */
import type { BugReport } from './report.ts';
import { TOKEN_HEADER, type HelperTarget } from '../coachHelper.ts';
import { FRIEND_ROOMS_KEY } from '../play/friendTable.ts';

export const ROOM_TOKEN_HEADER = 'X-Room-Token';
export const SEND_TIMEOUT_MS = 45_000;
const ROOM_ID = /^r[A-Za-z0-9_-]{8}$/;

export type BugRoute =
  | { kind: 'room'; base: string; id: string; seat: 0 | 1; token: string }
  | { kind: 'helper'; baseUrl: string; token: string | null; tunnel?: boolean };

export type SendResult =
  | { ok: true; id: string; via: 'room' | 'helper'; screenshot: boolean }
  | { ok: false; via: 'room' | 'helper'; status: number; code: string; message: string };

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/** A saved room seat (draft/room.ts SavedRoom's fields this needs). */
export interface RoomSeatLike {
  id: string;
  seat: 0 | 1;
  base: string;
  token: string;
}

/** The room seats this browser holds (draft/room.ts's saved rooms, read here so the main bundle need not load the draft code). */
export function savedRoomSeats(storage: Pick<Storage, 'getItem'> | null): RoomSeatLike[] {
  try {
    const raw = JSON.parse(storage?.getItem(FRIEND_ROOMS_KEY) ?? '[]') as unknown;
    if (!Array.isArray(raw)) return [];
    return raw.filter((r): r is RoomSeatLike => {
      const o = r as Partial<RoomSeatLike> | null;
      return !!o && typeof o.id === 'string' && ROOM_ID.test(o.id) && (o.seat === 0 || o.seat === 1) && typeof o.base === 'string' && typeof o.token === 'string' && /^[A-Za-z0-9_-]{22,64}$/.test(o.token);
    });
  } catch {
    return [];
  }
}

/** The room of the table this browser sits at (#play/friend), from play/friendTable.ts's saved table. */
export function tableRoom(t: { room: string; seat: 0 | 1 } | null): { id: string; seat: 0 | 1 } | null {
  return t && ROOM_ID.test(t.room) ? { id: t.room, seat: t.seat } : null;
}

/**
 * The route for a report from a page in `room` (or none), given the rooms this
 * browser holds a seat in and the helper this page would use.
 */
export function chooseRoute(room: { id: string; seat: 0 | 1 } | null, rooms: readonly RoomSeatLike[], helper: HelperTarget): BugRoute | null {
  if (room) {
    const r = rooms.find((x) => x.id === room.id && x.seat === room.seat) ?? rooms.find((x) => x.id === room.id);
    if (r && ROOM_ID.test(r.id) && /^https?:\/\//.test(r.base)) return { kind: 'room', base: r.base.replace(/\/+$/, ''), id: r.id, seat: r.seat, token: r.token };
    // A room page whose seat this browser no longer holds: no route but the download (never a helper on the friend's machine).
    return null;
  }
  // A tunnel page's helper is the visitor's own 127.0.0.1 (mtg-table D408): not the room owner's machine either.
  if (helper.tunnel) return null;
  return { kind: 'helper', baseUrl: helper.baseUrl, token: helper.token, tunnel: false };
}

/** Plain words for where a route goes, for the panel. */
export function routeWords(r: BugRoute | null, friend: boolean): string {
  if (!r) return 'No coach helper or room to send it to from this page: download the report and send the file.';
  if (r.kind === 'room') return friend ? 'Sent to the computer running the room (your friend’s), with what your screen shows — your own hand included.' : 'Sent to this room’s computer (yours), saved in mtg-table’s var/bugs/.';
  return 'Sent to the coach helper on this computer, saved in mtg-table’s var/bugs/.';
}

function messageFor(status: number, code: string, body: Record<string, unknown>, via: 'room' | 'helper'): string {
  const said = typeof body.message === 'string' ? body.message.slice(0, 300) : '';
  if (status === 404) return via === 'room' ? 'This room does not take bug reports yet (mtg-table needs updating). Download the report instead.' : 'This coach helper does not take bug reports yet (update mtg-table, then restart play.sh). Download the report instead.';
  if (status === 413) return 'The report is too large to send. Download it instead.';
  if (status === 429) return said || 'Too many reports just now — wait a few minutes, or download this one.';
  if (status === 507) return said || 'The bug folder on that computer is full. Download the report instead.';
  if (status === 403) return code === 'token' ? 'The room no longer knows this seat’s link. Download the report instead.' : `Refused (${said || 'HTTP 403'}). Download the report instead.`;
  return said ? `${said} (HTTP ${status})` : `HTTP ${status}`;
}

/** POST the report along `route`. Never throws: an unreachable server is {ok: false, status: 0, code: 'offline'}. */
export async function sendReport(report: BugReport, route: BugRoute, opts: { fetch?: FetchLike; timeoutMs?: number } = {}): Promise<SendResult> {
  const f: FetchLike = opts.fetch ?? ((u, i) => fetch(u, i));
  const via = route.kind;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  let url: string;
  if (route.kind === 'room') {
    url = `${route.base}/room/${encodeURIComponent(route.id)}/bug`;
    headers[ROOM_TOKEN_HEADER] = route.token;
  } else {
    url = `${route.baseUrl.replace(/\/+$/, '')}/bug`;
    if (route.token) headers[TOKEN_HEADER] = route.token;
  }
  const ac = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ac ? setTimeout(() => ac.abort(), opts.timeoutMs ?? SEND_TIMEOUT_MS) : null;
  let r: Response;
  try {
    r = await f(url, { method: 'POST', headers, body: JSON.stringify(report), ...(ac ? { signal: ac.signal } : {}) });
  } catch {
    return { ok: false, via, status: 0, code: 'offline', message: via === 'room' ? 'The room’s computer cannot be reached.' : 'No coach helper answered on this computer (is play.sh running?).' };
  } finally {
    if (timer) clearTimeout(timer);
  }
  let body: Record<string, unknown> = {};
  try {
    body = (await r.json()) as Record<string, unknown>;
  } catch {
    /* not JSON */
  }
  if (r.status === 201 && body.ok === true && typeof body.id === 'string') return { ok: true, id: body.id, via, screenshot: body.screenshot === true };
  const code = typeof body.code === 'string' ? body.code : String(r.status);
  return { ok: false, via, status: r.status, code, message: messageFor(r.status, code, body, via) };
}

/** The download's file name. */
export function downloadName(report: Pick<BugReport, 'clientId'>): string {
  return `forgecoach-bug-${report.clientId.replace(/[^A-Za-z0-9_-]/g, '')}.json`;
}

/** The download's text: the report as it would have been sent (screenshot included). */
export function downloadText(report: BugReport): string {
  return `${JSON.stringify(report, null, 1)}\n`;
}

/*
 * ForgeCoach — play/friendReview.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * A game with a friend (mtg-table D406/D407): THIS player's own engine review
 * of one finished game, and this seat's own frame log of it, from the draft
 * room that ran the game — behind this seat's room token, so the room hands
 * each seat its own and never the other's (whose log holds that player's hand).
 *
 *   GET /room/<id>/review/<matchId> → {ok, matchId, match, game, state, stage?, why?, report?}
 *   GET /room/<id>/log/<matchId>    → this seat's frame log (application/x-ndjson)
 *
 * Kept apart from draft/room.ts so the play screen (the main bundle) can read
 * it without the draft code. DOM-free: `fetch` is injected for tests.
 */
import { FRIEND_ROOMS_KEY } from './friendTable.ts';

export type RoomReviewState = 'off' | 'waiting' | 'queued' | 'running' | 'done' | 'failed';
export const REVIEW_STATES: readonly RoomReviewState[] = ['off', 'waiting', 'queued', 'running', 'done', 'failed'];

/** D407: GET /room/<id>/review/<matchId>. */
export interface RoomReview {
  matchId: string;
  match: number;
  game: number;
  state: RoomReviewState;
  stage: string | null;
  why: string | null;
  /** The engine's report (gameReview.ts parses it), only when `done`. */
  report: unknown;
}

export class SeatReviewError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
  }
}

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;
const realFetch: FetchLike = (u, i) => fetch(u, i);
const isStr = (x: unknown): x is string => typeof x === 'string';
const isInt = (x: unknown): x is number => Number.isInteger(x);

/** Where this browser reaches a room it holds a seat in, and that seat's token (draft/room.ts's saved list). */
export interface SeatHandle {
  base: string;
  id: string;
  token: string;
}

export function savedRoomSeat(id: string, seat: 0 | 1, s?: Pick<Storage, 'getItem'> | null): SeatHandle | null {
  let st: Pick<Storage, 'getItem'> | null = s ?? null;
  if (!st) {
    try {
      st = globalThis.localStorage ?? null;
    } catch {
      st = null;
    }
  }
  if (!st) return null;
  try {
    const raw = JSON.parse(st.getItem(FRIEND_ROOMS_KEY) ?? '[]') as unknown;
    if (!Array.isArray(raw)) return null;
    for (const r of raw as Array<Record<string, unknown>>) {
      if (r && r.id === id && r.seat === seat && isStr(r.base) && isStr(r.token)) return { base: r.base, id, token: r.token };
    }
  } catch {
    /* none */
  }
  return null;
}

const url = (h: SeatHandle, p: string) => `${h.base.replace(/\/+$/, '')}/room/${encodeURIComponent(h.id)}${p}`;

async function get(h: SeatHandle, p: string, what: string, f: FetchLike): Promise<Response> {
  let r: Response;
  try {
    r = await f(url(h, p), { headers: { 'X-Room-Token': h.token }, cache: 'no-store' });
  } catch {
    throw new SeatReviewError('The room’s computer cannot be reached.', 0, 'offline');
  }
  if (!r.ok) {
    let body: Record<string, unknown> = {};
    try {
      body = (await r.json()) as Record<string, unknown>;
    } catch {
      /* not JSON */
    }
    throw new SeatReviewError(isStr(body.message) ? body.message : `${what} failed (HTTP ${r.status})`, r.status, isStr(body.code) ? body.code : String(r.status));
  }
  return r;
}

/** This seat's own review of a finished game (state, and the report when done). */
export async function fetchSeatReview(h: SeatHandle, matchId: string, f: FetchLike = realFetch): Promise<RoomReview> {
  const r = await get(h, `/review/${encodeURIComponent(matchId)}`, 'Reading your review', f);
  const j = (await r.json()) as Record<string, unknown>;
  const st = j.state as RoomReviewState;
  if (j.ok !== true || !REVIEW_STATES.includes(st) || !isStr(j.matchId) || !isInt(j.game)) throw new SeatReviewError('The room answered something that is not a review.', r.status, 'bad');
  return {
    matchId: j.matchId,
    match: isInt(j.match) ? j.match : 1,
    game: j.game,
    state: st,
    stage: isStr(j.stage) ? j.stage.slice(0, 20) : null,
    why: isStr(j.why) ? j.why.slice(0, 300) : null,
    report: st === 'done' ? (j.report ?? null) : null,
  };
}

/** This seat's own frame log of a recorded game, as the bridge wrote it (the frames the review numbers). */
export async function fetchSeatLog(h: SeatHandle, matchId: string, f: FetchLike = realFetch): Promise<string> {
  return (await get(h, `/log/${encodeURIComponent(matchId)}`, 'Reading your game', f)).text();
}

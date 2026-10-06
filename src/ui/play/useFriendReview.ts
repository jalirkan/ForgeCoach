/*
 * ForgeCoach — ui/play/useFriendReview.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * A game with a friend is over: where is THIS player's engine review of it?
 * (mtg-table D407.) The owner's computer reviews each seat whose player agreed
 * to recording, at idle priority, and the draft room hands each seat its own —
 * never the other's, whose log holds that player's hand. This hook asks the room
 * every few seconds until the review is done, failed or off, and opens it with
 * this seat's own log as the room keeps it (the frames the report numbers),
 * else the log this browser played.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { parseLog, type GameLog } from '../../log.ts';
import type { FriendTable } from '../../play/friendTable.ts';
import { fetchSeatLog, fetchSeatReview, savedRoomSeat, SeatReviewError, type RoomReviewState, type SeatHandle } from '../../play/friendReview.ts';

export interface FriendReviewView {
  state: RoomReviewState;
  stage: string | null;
  why: string | null;
  /** Open the review (done only). */
  open: (() => void) | null;
  opening: boolean;
}

export const FRIEND_REVIEW_POLL_MS = 4000;

/** Fetch this seat's review and its log from the room: {log, report} or a reason. */
export async function loadFriendReview(seat: SeatHandle, matchId: string, fallback: GameLog | null): Promise<{ log: GameLog; report: unknown } | { error: string }> {
  try {
    const r = await fetchSeatReview(seat, matchId);
    if (r.state !== 'done' || !r.report) return { error: r.why ?? 'The review is not ready yet.' };
    let log: GameLog | null = null;
    try {
      log = parseLog(await fetchSeatLog(seat, matchId));
    } catch {
      log = fallback;
    }
    if (!log) return { error: 'The game’s log could not be read from the room.' };
    return { log, report: r.report };
  } catch (e) {
    return { error: e instanceof SeatReviewError ? e.message : 'The room could not be reached.' };
  }
}

export function useFriendReview(
  friend: FriendTable | null,
  over: boolean,
  played: GameLog | null,
  onOpen: (log: GameLog, report: unknown) => void,
): FriendReviewView | null {
  const client = useMemo(() => (friend ? savedRoomSeat(friend.room, friend.seat) : null), [friend]);
  const matchId = friend?.matchId ?? null;
  const [view, setView] = useState<{ state: RoomReviewState; stage: string | null; why: string | null } | null>(null);
  const [opening, setOpening] = useState(false);

  useEffect(() => {
    setView(null);
    if (!client || !matchId || !over) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const ask = async () => {
      try {
        const r = await fetchSeatReview(client, matchId);
        if (!live) return;
        setView({ state: r.state, stage: r.stage, why: r.why });
        if (r.state === 'done' || r.state === 'failed' || r.state === 'off') return;
      } catch (e) {
        if (!live) return;
        // 404 "game": the room has not scored this game yet (it looks every 2 s).
        setView((v) => v ?? { state: 'waiting', stage: null, why: e instanceof SeatReviewError && e.code !== 'game' ? e.message : null });
      }
      timer = setTimeout(() => void ask(), FRIEND_REVIEW_POLL_MS);
    };
    void ask();
    return () => {
      live = false;
      if (timer) clearTimeout(timer);
    };
  }, [client, matchId, over]);

  const open = useCallback(() => {
    if (!client || !matchId) return;
    setOpening(true);
    void loadFriendReview(client, matchId, played).then((r) => {
      setOpening(false);
      if ('error' in r) setView((v) => (v ? { ...v, why: r.error } : v));
      else onOpen(r.log, r.report);
    });
  }, [client, matchId, played, onOpen]);

  if (!friend || !over || !client || !matchId || !view) return null;
  return { ...view, open: view.state === 'done' ? open : null, opening };
}

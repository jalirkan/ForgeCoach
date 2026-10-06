/*
 * ForgeCoach — play/friendTable.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * A game between two people (mtg-table D402/D404): the room that started it
 * hands each player a seat token for that one game, in that player's own room
 * stream. The room screen keeps the seat here — the room, this seat, the
 * table's URL with the token, the opponent's name — and the play screen
 * (`#play/friend`) takes it from here, so a reload or a dropped phone comes
 * back to the same seat (the bridge resumes a seat by its token, D403).
 *
 * One table at a time per browser (the latest game). The token is spent when
 * the game ends; it is never shown on screen (`redactSeatUrl`) and never
 * becomes the remembered "seat URL" of Play vs Forge.
 *
 * DOM-free: storage is injected for tests.
 */
import { tableSeatUrl } from './seatUrl.ts';

/** The rooms this browser holds a seat in (draft/room.ts's list; the key lives here so the main bundle can read the bases). */
export const FRIEND_ROOMS_KEY = 'forgecoach.friendRooms.v1';
export const FRIEND_TABLE_KEY = 'forgecoach.friendTable.v1';
/** The play screen's route for the table this browser holds. */
export const FRIEND_TABLE_HASH = '#play/friend';

export interface FriendTable {
  /** The room id (mtg-table D400). */
  room: string;
  /** This browser's seat in the room (0 made it, 1 joined). */
  seat: 0 | 1;
  /** The game's number in the room (`game.n`): a rematch is a new table. */
  game: number;
  /** The seat socket on the room's origin: `ws(s)://<room host>/ws?seat=<token>`. */
  url: string;
  /** What the opponent called themselves in the room. */
  opponent: string;
  /** Where Leave goes back to: the room's screen. */
  back: string;
  savedAt: number;
  /** This browser saw the game end: the token is spent, the room screen offers no seat for it. */
  over?: boolean;
  /** mtg-table D406/D407: the game's match id (its review and its log in the room), and its number in the match. */
  matchId?: string | null;
  gameNo?: number | null;
}

type KV = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function kv(s?: KV | null): KV | null {
  if (s) return s;
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

const isStr = (x: unknown): x is string => typeof x === 'string';

/** The table this browser holds, or null. */
export function loadFriendTable(s?: KV | null): FriendTable | null {
  const st = kv(s);
  if (!st) return null;
  try {
    const o = JSON.parse(st.getItem(FRIEND_TABLE_KEY) ?? 'null') as Partial<FriendTable> | null;
    if (!o || typeof o !== 'object') return null;
    if (!isStr(o.room) || !(o.seat === 0 || o.seat === 1) || !Number.isInteger(o.game) || !isStr(o.url) || !/^wss?:\/\/[^\s]+\/ws\?seat=[A-Za-z0-9_%-]+$/.test(o.url)) return null;
    return {
      room: o.room,
      seat: o.seat,
      game: o.game!,
      url: o.url,
      opponent: isStr(o.opponent) ? o.opponent : 'your friend',
      back: isStr(o.back) && o.back.startsWith('#draft/friend') ? o.back : '#draft/friend',
      savedAt: typeof o.savedAt === 'number' ? o.savedAt : 0,
      ...(o.over === true ? { over: true } : {}),
      matchId: isStr(o.matchId) && /^m[0-9]{13}$/.test(o.matchId) ? o.matchId : null,
      gameNo: Number.isInteger(o.gameNo) ? o.gameNo! : null,
    };
  } catch {
    return null;
  }
}

export function saveFriendTable(t: FriendTable, s?: KV | null): void {
  const st = kv(s);
  if (!st) return;
  try {
    st.setItem(FRIEND_TABLE_KEY, JSON.stringify(t));
  } catch {
    /* quota or private mode */
  }
}

export function clearFriendTable(s?: KV | null): void {
  const st = kv(s);
  if (!st) return;
  try {
    st.removeItem(FRIEND_TABLE_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * The table a room state offers this seat, or null: the game is `ready` and
 * carries this seat's token. `roomBase` is the room listener as this browser
 * reaches it: the seat is `/ws` on that origin (the room passes it through to
 * the table, D404; a tunnel routes it there, D405).
 */
export function tableFromRoom(
  roomBase: string,
  room: { id: string; you: 0 | 1; seats: Array<{ name: string }>; game?: { n: number; state: string; tablePort: number | null; token?: string | null; matchId?: string | null; game?: number | null } | null },
  back: string,
  now = Date.now(),
): FriendTable | null {
  const g = room.game;
  if (!g || g.state !== 'ready' || !g.token) return null;
  const url = tableSeatUrl(roomBase, g.token);
  if (!url) return null;
  return { room: room.id, seat: room.you, game: g.n, url, opponent: room.seats[1 - room.you]?.name || 'your friend', back, savedAt: now,
    matchId: g.matchId ?? null, gameNo: g.game ?? null };
}

/** The room listeners this browser holds a seat on (their `base`), for telling a room page from the bridge's. */
export function savedRoomBases(s?: Pick<Storage, 'getItem'> | null): string[] {
  let st: Pick<Storage, 'getItem'> | null = s ?? null;
  if (!st) {
    try {
      st = globalThis.localStorage ?? null;
    } catch {
      st = null;
    }
  }
  if (!st) return [];
  try {
    const raw = JSON.parse(st.getItem(FRIEND_ROOMS_KEY) ?? '[]') as unknown;
    if (!Array.isArray(raw)) return [];
    return raw.map((r) => (r && typeof r === 'object' ? (r as { base?: unknown }).base : null)).filter(isStr);
  } catch {
    return [];
  }
}

/*
 * ForgeCoach — play/seatUrl.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Where the seat socket lives. When the mtg-table bridge serves ForgeCoach
 * itself (`play.sh --engine-only --lan`, opened from a phone as
 * http://<desktop-ip>:<port>/?token=<T>), the seat is on the same origin:
 * ws://<host>/ws?token=<T>. Otherwise it is the local default.
 *
 * mtg-table's draft room serves the same site on its own port (8644,
 * `--room-site-dir`, D400) — a page that is NOT the bridge: no seat lives on
 * its origin, and its coach helper is the viewer's own (127.0.0.1:8643), never
 * the room owner's. `servedByRoom` tells the two apart; `servedByEngine` is
 * false for a room page. A game between two people (mtg-table D402/D404) has
 * its seats behind a seat token per player per game, on the room's own origin
 * (`tableSeatUrl`): `ws(s)://<room host>/ws?seat=<token>`, never the table's
 * port by number. The room listener passes `/ws` through to the table on a
 * LAN; a Cloudflare tunnel routes `/ws` on its one hostname to it (D405).
 *
 * A tunnel page (mtg-table D408, `servedByTunnel`): the bridge serves its site
 * over plain http only (`--lan`), so an `https:` page that is neither GitHub
 * Pages, a dev server nor loopback came through a tunnel — and a tunnel
 * carries only the draft room (mtg-table docs/cloudflare.md). Such a page is
 * the room's, never the engine's, from its very first load (before this
 * browser holds a seat there).
 */

export const DEFAULT_SEAT_URL = 'ws://127.0.0.1:8642/ws';

/** localStorage key remembering the pairing token of an engine-served page (this origin only). */
export const SEAT_TOKEN_KEY = 'forgecoach.seatToken';

export interface PageLocation {
  protocol: string;
  /** hostname plus port, like `location.host`. */
  host: string;
  /** like `location.search`, with or without the leading `?`. */
  search: string;
}

/** The draft room's default port (mtg-table D400); a page served there is the room's, not the bridge's. */
export const DEFAULT_ROOM_PORT = 8644;

/** Ports where Vite's dev server / preview run; never the bridge. */
const DEV_PORTS = new Set(['5173', '5174', '4173']);

function splitHost(host: string): { name: string; port: string } {
  const m = /^(.*?)(?::(\d+))?$/.exec(host);
  return { name: (m?.[1] ?? host).toLowerCase(), port: m?.[2] ?? '' };
}

function isLoopbackName(name: string): boolean {
  return name === 'localhost' || name.endsWith('.localhost') || /^127\./.test(name) || name === '[::1]' || name === '::1';
}

/**
 * True when this page came through a tunnel (mtg-table D405/D408): `https:`,
 * not GitHub Pages, not a dev server port, not loopback. The bridge never
 * serves https, so this is the draft room's site on the tunnel's hostname.
 */
export function servedByTunnel(loc: Pick<PageLocation, 'protocol' | 'host'>): boolean {
  if (loc.protocol !== 'https:') return false;
  const { name, port } = splitHost(loc.host);
  if (name === 'jalirkan.github.io' || name.endsWith('.github.io')) return false;
  if (DEV_PORTS.has(port) || isLoopbackName(name)) return false;
  return name.includes('.');
}

/**
 * True when this page was served by mtg-table's draft room (D400): the room's
 * default port, or an origin this browser holds a room seat on (`roomBases`,
 * the saved rooms' `base`, for a room on another port or behind a tunnel).
 */
export function servedByRoom(loc: PageLocation, roomBases: readonly string[] = []): boolean {
  if (loc.protocol !== 'http:' && loc.protocol !== 'https:') return false;
  if (splitHost(loc.host).port === String(DEFAULT_ROOM_PORT)) return true;
  if (servedByTunnel(loc)) return true;
  const origin = `${loc.protocol}//${loc.host}`.toLowerCase();
  return roomBases.some((b) => b.replace(/\/+$/, '').toLowerCase() === origin);
}

/**
 * True when this page was served by something other than GitHub Pages, a
 * Vite dev server, a tunnel or the draft room over http(s) — i.e. by the
 * mtg-table bridge, whose own origin therefore answers the seat socket.
 */
export function servedByEngine(loc: PageLocation, roomBases: readonly string[] = []): boolean {
  if (loc.protocol !== 'http:' && loc.protocol !== 'https:') return false;
  const { name, port } = splitHost(loc.host);
  if (name === 'jalirkan.github.io' || name.endsWith('.github.io')) return false;
  if (DEV_PORTS.has(port)) return false;
  if (servedByRoom(loc, roomBases)) return false;
  return true;
}

/**
 * The seat of a game between two people (mtg-table D402/D404): `/ws` on the
 * room's own origin — `roomBase`, the room listener as this browser reaches
 * it (the page's origin when the room served it, or a tunnel's `https://` name)
 * — with the token as `?seat=` (a browser websocket sets no header). The room
 * passes it through to the table port; a tunnel routes it there (D405).
 */
export function tableSeatUrl(roomBase: string, token: string): string | null {
  let u: URL;
  try {
    u = new URL(roomBase);
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  const scheme = u.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${scheme}//${u.host}/ws?seat=${encodeURIComponent(token)}`;
}

/** The pairing token in the page URL, or null. */
export function tokenFromSearch(search: string): string | null {
  const t = new URLSearchParams(search).get('token');
  return t ? t : null;
}

export function defaultSeatUrl(loc: PageLocation): string {
  if (!servedByEngine(loc)) return DEFAULT_SEAT_URL;
  const scheme = loc.protocol === 'https:' ? 'wss:' : 'ws:';
  const token = tokenFromSearch(loc.search);
  return `${scheme}//${loc.host}/ws${token === null ? '' : `?token=${encodeURIComponent(token)}`}`;
}

/** The URL with any `token` (pairing) or `seat` (a table's seat token) value replaced, safe to show on screen. */
export function redactSeatUrl(url: string): string {
  return url.replace(/([?&](?:token|seat)=)[^&#\s]*/gi, '$1…');
}

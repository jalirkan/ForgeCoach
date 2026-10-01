/*
 * ForgeCoach — play/seatUrl.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Where the seat socket lives. When the mtg-table bridge serves ForgeCoach
 * itself (`play.sh --engine-only --lan`, opened from a phone as
 * http://<desktop-ip>:<port>/?token=<T>), the seat is on the same origin:
 * ws://<host>/ws?token=<T>. Otherwise it is the local default.
 */

export const DEFAULT_SEAT_URL = 'ws://127.0.0.1:8642/ws';

export interface PageLocation {
  protocol: string;
  /** hostname plus port, like `location.host`. */
  host: string;
  /** like `location.search`, with or without the leading `?`. */
  search: string;
}

/** Ports where Vite's dev server / preview run; never the bridge. */
const DEV_PORTS = new Set(['5173', '5174', '4173']);

function splitHost(host: string): { name: string; port: string } {
  const m = /^(.*?)(?::(\d+))?$/.exec(host);
  return { name: (m?.[1] ?? host).toLowerCase(), port: m?.[2] ?? '' };
}

/**
 * True when this page was served by something other than GitHub Pages or a
 * Vite dev server over http(s) — i.e. by the mtg-table bridge, whose own
 * origin therefore answers the seat socket.
 */
export function servedByEngine(loc: PageLocation): boolean {
  if (loc.protocol !== 'http:' && loc.protocol !== 'https:') return false;
  const { name, port } = splitHost(loc.host);
  if (name === 'jalirkan.github.io' || name.endsWith('.github.io')) return false;
  if (DEV_PORTS.has(port)) return false;
  return true;
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

/** The URL with any `token` value replaced, safe to show on screen. */
export function redactSeatUrl(url: string): string {
  return url.replace(/([?&]token=)[^&#\s]*/gi, '$1…');
}

/*
 * ForgeCoach — pwa/icons.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The home-screen icons, made in code from the favicon's motif (a gold anvil
 * on a dark rounded square, index.html's inline SVG), with some room around
 * the anvil as an app icon: the SVG text, and PNGs
 * from a small scanline rasterizer (supersampled, even-odd, over the anvil,
 * which is all straight lines) and a minimal PNG encoder. No image
 * files are committed; pwa/vitePlugin.ts emits these at build time (and serves
 * them in dev). Pure: the caller passes zlib's deflate.
 */

/** The anvil, in the favicon's 24×24 box. */
export const ANVIL_PATH = 'M3 9h13l2-3h3v3l-3 2v2H8l-1 2h4v3H5v-3l1-2-3-1z';
export const ICON_BG = '#0e1014';
export const ICON_FG = '#e3b25f';

/** The same outline as points (ANVIL_PATH, walked by hand: only h, v, l, H and z). */
export const ANVIL_POINTS: ReadonlyArray<readonly [number, number]> = anvilPoints(ANVIL_PATH);

/** Walks an SVG path of M/h/v/l/H/V/z commands (the anvil's) into polygon points. */
export function anvilPoints(d: string): Array<[number, number]> {
  const tokens = d.match(/[A-Za-z]|-?\d*\.?\d+/g) ?? [];
  const pts: Array<[number, number]> = [];
  let x = 0;
  let y = 0;
  let cmd = '';
  let i = 0;
  const num = () => Number(tokens[i++]);
  while (i < tokens.length) {
    if (/[A-Za-z]/.test(tokens[i]!)) cmd = tokens[i++]!;
    switch (cmd) {
      case 'M':
        x = num();
        y = num();
        cmd = 'L';
        break;
      case 'L':
        x = num();
        y = num();
        break;
      case 'l':
        x += num();
        y += num();
        break;
      case 'h':
        x += num();
        break;
      case 'H':
        x = num();
        break;
      case 'v':
        y += num();
        break;
      case 'V':
        y = num();
        break;
      case 'z':
      case 'Z':
        continue;
      default:
        throw new Error(`anvilPoints: unsupported command ${cmd}`);
    }
    pts.push([x, y]);
  }
  return pts;
}

export type IconKind = 'any' | 'maskable' | 'apple';

/**
 * The anvil's scale for each kind, around the box's centre. `maskable` keeps
 * the whole anvil inside the safe zone (the centre circle of radius 40% the
 * platforms may crop to); `apple` is a full square that iOS rounds itself.
 */
const SCALE: Record<IconKind, number> = { any: 0.8, maskable: 0.7, apple: 0.76 };

/** The SVG for one kind: `any` is the favicon, rounded corners and all. */
export function iconSvg(kind: IconKind): string {
  const s = SCALE[kind];
  const rx = kind === 'any' ? 6 : 0;
  const t = s === 1 ? '' : ` transform="translate(${round(12 - 12 * s)} ${round(12 - 12 * s)}) scale(${s})"`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">` +
    `<rect width="24" height="24"${rx ? ` rx="${rx}"` : ''} fill="${ICON_BG}"/>` +
    `<path d="${ANVIL_PATH}" fill="${ICON_FG}"${t}/>` +
    `</svg>\n`
  );
}

const round = (n: number) => Math.round(n * 1000) / 1000;

/** True when (x, y) is inside the polygon (even-odd). */
export function inPolygon(x: number, y: number, pts: ReadonlyArray<readonly [number, number]>): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i]!;
    const [xj, yj] = pts[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** The x where each edge crosses the row y, sorted (the half-open rule inPolygon uses). */
function crossings(y: number, pts: ReadonlyArray<readonly [number, number]>): number[] {
  const xs: number[] = [];
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i]!;
    const [xj, yj] = pts[j]!;
    if (yi > y !== yj > y) xs.push(((xj - xi) * (y - yi)) / (yj - yi) + xi);
  }
  return xs.sort((p, q) => p - q);
}

function inRoundedSquare(x: number, y: number, rx: number): boolean {
  if (x < 0 || y < 0 || x > 24 || y > 24) return false;
  if (rx <= 0) return true;
  const cx = Math.min(Math.max(x, rx), 24 - rx);
  const cy = Math.min(Math.max(y, rx), 24 - rx);
  return (x - cx) ** 2 + (y - cy) ** 2 <= rx * rx;
}

const hex = (c: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)) as [number, number, number];

/** RGBA pixels (`size`×`size`) of one kind, antialiased with `ss`×`ss` samples per pixel. */
export function rasterIcon(kind: IconKind, size: number, ss = 4): Uint8Array {
  const s = SCALE[kind];
  const rx = kind === 'any' ? 6 : 0;
  const pts = ANVIL_POINTS.map(([x, y]) => [12 + (x - 12) * s, 12 + (y - 12) * s] as const);
  const bg = hex(ICON_BG);
  const fg = hex(ICON_FG);
  const out = new Uint8Array(size * size * 4);
  const n = ss * ss;
  const cover = new Uint16Array(size);
  const ink = new Uint16Array(size);
  for (let py = 0; py < size; py++) {
    cover.fill(0);
    ink.fill(0);
    for (let sy = 0; sy < ss; sy++) {
      const y = ((py + (sy + 0.5) / ss) * 24) / size;
      // Scanline: where this sample row crosses the outline (even-odd, as inPolygon).
      const xs = crossings(y, pts);
      let k = 0;
      for (let px = 0; px < size; px++) {
        for (let sx = 0; sx < ss; sx++) {
          const x = ((px + (sx + 0.5) / ss) * 24) / size;
          if (!inRoundedSquare(x, y, rx)) continue;
          cover[px]!++;
          while (k < xs.length && xs[k]! <= x) k++;
          if (k % 2 === 1) ink[px]!++;
        }
      }
    }
    for (let px = 0; px < size; px++) {
      const o = (py * size + px) * 4;
      if (cover[px] === 0) continue;
      const f = ink[px]! / cover[px]!;
      for (let c = 0; c < 3; c++) out[o + c] = Math.round(bg[c]! * (1 - f) + fg[c]! * f);
      out[o + 3] = Math.round((cover[px]! / n) * 255);
    }
  }
  return out;
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** A truecolour-with-alpha PNG of `rgba` (8 bits a channel, filter 0 on every row). */
export function encodePng(width: number, height: number, rgba: Uint8Array, deflate: (b: Uint8Array) => Uint8Array): Uint8Array {
  const raw = new Uint8Array((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    raw.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * (width * 4 + 1) + 1);
  }
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, width);
  dv.setUint32(4, height);
  ihdr.set([8, 6, 0, 0, 0], 8);
  const parts = [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflate(raw)), chunk('IEND', new Uint8Array(0))];
  const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** Every icon the site serves, by its path under the base: what the manifest and index.html name. */
export const ICONS: ReadonlyArray<{ path: string; kind: IconKind; size: number | 'svg' }> = [
  { path: 'icons/icon.svg', kind: 'any', size: 'svg' },
  { path: 'icons/maskable.svg', kind: 'maskable', size: 'svg' },
  { path: 'icons/icon-192.png', kind: 'any', size: 192 },
  { path: 'icons/icon-512.png', kind: 'any', size: 512 },
  { path: 'icons/maskable-192.png', kind: 'maskable', size: 192 },
  { path: 'icons/maskable-512.png', kind: 'maskable', size: 512 },
  { path: 'icons/apple-touch-icon.png', kind: 'apple', size: 180 },
];

/** The bytes of one icon, and its content type. */
export function renderIcon(icon: (typeof ICONS)[number], deflate: (b: Uint8Array) => Uint8Array): { body: Uint8Array; type: string } {
  if (icon.size === 'svg') return { body: new TextEncoder().encode(iconSvg(icon.kind)), type: 'image/svg+xml' };
  return { body: encodePng(icon.size, icon.size, rasterIcon(icon.kind, icon.size), deflate), type: 'image/png' };
}

/*
 * ForgeCoach — ui/ambience/overlayArt.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The built-in board accents (spec 1.3 placeholders), drawn in code as small
 * SVG documents and used as `data:` images, so a built-in piece is drawn the
 * same way as a pack's picture (an <img> in a corner, a background along an
 * edge). Original, abstract and subtle: vines for forest, frost and spray for
 * island, ash and embers for mountain, moss and mist for swamp, petals and
 * motes for plains, dust for wastes.
 *
 * Corners are drawn for the bottom-left (200 × 200, hugging the left and
 * bottom edges, transparent elsewhere); the renderer flips them for the other
 * corners. Edge tiles are drawn for the bottom edge (160 × 40), seamless
 * left to right. These are generated here, never fetched: a pack's own URLs
 * still go through the manifest's URL rules.
 */
import type { BuiltinOverlay } from '../../ambience/manifest.ts';

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const r1 = (n: number) => Math.round(n * 10) / 10;

const LEAF = 'M0 0 C 5 -5.5, 14 -5.5, 19 0 C 14 5.5, 5 5.5, 0 0 Z';

function leaves(points: [number, number, number, number][], fill: string, vein: string): string {
  return points
    .map(([x, y, rot, s]) => `<g transform="translate(${x} ${y}) rotate(${rot}) scale(${s})"><path d="${LEAF}" fill="${fill}"/><path d="M1 0 L17 0" stroke="${vein}" stroke-width="0.7" fill="none"/></g>`)
    .join('');
}

function specks(seed: number, n: number, colors: string[], area: (r: () => number) => [number, number], rMin: number, rMax: number, opMin = 0.35, opMax = 0.9): string {
  const r = rng(seed);
  let out = '';
  for (let i = 0; i < n; i++) {
    const [x, y] = area(r);
    out += `<circle cx="${r1(x)}" cy="${r1(y)}" r="${r1(rMin + r() * (rMax - rMin))}" fill="${colors[i % colors.length]}" opacity="${r1(opMin + r() * (opMax - opMin))}"/>`;
  }
  return out;
}

/** Points biased toward the bottom-left corner (radius from the corner shrinks the density). */
const cornerArea = (reach: number) => (r: () => number): [number, number] => {
  const d = Math.pow(r(), 1.6) * reach;
  const a = r() * (Math.PI / 2);
  return [Math.cos(a) * d + 2, 200 - Math.sin(a) * d - 2];
};

const svg = (w: number, h: number, body: string, defs = '') => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">${defs ? `<defs>${defs}</defs>` : ''}${body}</svg>`;

const CORNERS: Record<string, () => string> = {
  vine: () =>
    svg(
      200,
      200,
      `<g fill="none" stroke-linecap="round">
        <path d="M-4 204 C 26 176, 8 140, 26 112 S 16 60, 40 30 S 52 10, 46 0" stroke="#3f6a35" stroke-width="3.2"/>
        <path d="M-4 204 C 38 192, 70 204, 100 188 S 150 194, 190 176" stroke="#3f6a35" stroke-width="3"/>
        <path d="M26 112 C 44 106, 52 92, 48 80 C 44 72, 36 76, 40 84" stroke="#4f7d3e" stroke-width="1.8"/>
        <path d="M100 188 C 104 170, 118 162, 128 166 C 136 170, 132 178, 124 176" stroke="#4f7d3e" stroke-width="1.8"/>
        <path d="M14 160 C 0 150, 2 136, 10 132" stroke="#4f7d3e" stroke-width="1.4"/>
      </g>
      ${leaves(
        [
          [20, 150, -70, 1.1],
          [28, 126, -120, 1],
          [22, 96, -60, 1.05],
          [36, 62, -110, 0.95],
          [42, 32, -70, 0.85],
          [48, 84, 10, 0.8],
          [50, 194, -20, 1.1],
          [82, 194, 200, 1],
          [118, 186, -30, 0.95],
          [150, 188, 190, 0.9],
          [176, 178, -40, 0.8],
          [128, 168, -80, 0.75],
        ],
        '#5c8f45',
        '#2e4f27',
      )}
      ${specks(7, 6, ['#e9d98a'], cornerArea(120), 1.4, 2.4, 0.7, 0.95)}`,
    ),
  frost: () =>
    svg(
      200,
      200,
      `<g stroke="#d8f0ff" stroke-linecap="round" fill="none" opacity="0.9">
        <path d="M0 200 L70 130 M0 200 L36 96 M0 200 L104 164 M0 200 L20 140 M0 200 L140 190" stroke-width="1.6"/>
        <path d="M30 170 l-10 -14 M30 170 l14 -8 M52 148 l-6 -16 M52 148 l16 -4 M24 130 l-10 -6 M24 130 l8 -10 M60 182 l4 -14 M60 182 l14 4 M96 166 l2 -10 M96 166 l10 6 M14 160 l-8 -4 M110 190 l6 -8" stroke-width="1.1"/>
      </g>
      <circle cx="0" cy="200" r="70" fill="url(#g)"/>
      ${specks(11, 26, ['#e8f7ff', '#bfe3ff'], cornerArea(150), 0.8, 2.2)}`,
      `<radialGradient id="g" cx="0" cy="1" r="1"><stop offset="0" stop-color="#cfeaff" stop-opacity="0.35"/><stop offset="1" stop-color="#cfeaff" stop-opacity="0"/></radialGradient>`,
    ),
  ash: () =>
    svg(
      200,
      200,
      `<circle cx="0" cy="200" r="120" fill="url(#g)"/>
      ${specks(23, 34, ['#8d8a88', '#6f6b69', '#b7b2ad'], cornerArea(170), 0.8, 2.4, 0.3, 0.8)}
      ${specks(29, 7, ['#ff9a4a', '#ffbf6b'], cornerArea(110), 0.9, 1.6, 0.6, 0.95)}`,
      `<radialGradient id="g" cx="0" cy="1" r="1"><stop offset="0" stop-color="#3a3533" stop-opacity="0.55"/><stop offset="0.6" stop-color="#3a3533" stop-opacity="0.15"/><stop offset="1" stop-color="#3a3533" stop-opacity="0"/></radialGradient>`,
    ),
  moss: () =>
    svg(
      200,
      200,
      `<path d="M0 200 L0 120 C 10 118, 14 130, 10 140 C 20 138, 24 150, 16 158 C 28 160, 30 172, 40 170 C 46 182, 62 178, 70 186 C 82 182, 96 190, 104 200 Z" fill="#2f4a2c" opacity="0.85"/>
      <path d="M0 200 L0 150 C 8 152, 10 162, 6 168 C 16 170, 18 182, 28 182 C 34 192, 50 190, 58 200 Z" fill="#46663b"/>
      <g stroke="#3d5a35" stroke-width="1.2" fill="none" stroke-linecap="round"><path d="M10 140 C 12 116, 8 100, 12 84"/><path d="M16 158 C 22 140, 20 126, 26 112"/></g>
      ${specks(31, 10, ['#9fc58a', '#cfe3b5'], cornerArea(90), 0.8, 1.8, 0.4, 0.85)}`,
    ),
  petals: () => {
    const r = rng(41);
    let body = '';
    for (let i = 0; i < 16; i++) {
      const [x, y] = cornerArea(160)(r);
      const rot = Math.round(r() * 360);
      const s = r1(0.6 + r() * 0.7);
      const fill = ['#f6d7df', '#fbeacb', '#f2c6d3'][i % 3];
      body += `<path transform="translate(${r1(x)} ${r1(y)}) rotate(${rot}) scale(${s})" d="M0 0 C 3 -5, 9 -5, 10 0 C 9 4, 3 4, 0 0 Z" fill="${fill}" opacity="${r1(0.55 + r() * 0.4)}"/>`;
    }
    return svg(200, 200, `<circle cx="0" cy="200" r="90" fill="url(#g)"/>${body}`, `<radialGradient id="g" cx="0" cy="1" r="1"><stop offset="0" stop-color="#ffe9b0" stop-opacity="0.22"/><stop offset="1" stop-color="#ffe9b0" stop-opacity="0"/></radialGradient>`);
  },
  dust: () =>
    svg(
      200,
      200,
      `<circle cx="0" cy="200" r="130" fill="url(#g)"/>${specks(53, 28, ['#b9ab95', '#8f8574'], cornerArea(170), 0.6, 1.8, 0.25, 0.7)}`,
      `<radialGradient id="g" cx="0" cy="1" r="1"><stop offset="0" stop-color="#7d715f" stop-opacity="0.35"/><stop offset="1" stop-color="#7d715f" stop-opacity="0"/></radialGradient>`,
    ),
};

/** Edge tiles: 160 × 40, ground at the bottom, seamless left to right. */
const bottomArea = (r: () => number): [number, number] => [4 + r() * 152, 40 - Math.pow(r(), 1.5) * 30];

const EDGES: Record<string, () => string> = {
  leaves: () =>
    svg(
      160,
      40,
      `<path d="M0 38 C 30 32, 50 40, 80 35 S 130 32, 160 38" stroke="#3f6a35" stroke-width="2" fill="none"/>${leaves(
        [
          [10, 36, -40, 0.7],
          [34, 34, 200, 0.65],
          [62, 37, -30, 0.7],
          [92, 34, 190, 0.6],
          [120, 34, -50, 0.7],
          [144, 37, 200, 0.6],
        ],
        '#5c8f45',
        '#2e4f27',
      )}`,
    ),
  spray: () =>
    svg(
      160,
      40,
      `<path d="M0 34 C 20 28, 40 38, 60 32 S 100 26, 120 33 S 150 36, 160 34" stroke="#d8f0ff" stroke-width="1.4" fill="none" opacity="0.8"/>${specks(61, 22, ['#e8f7ff', '#bfe3ff'], bottomArea, 0.6, 1.6)}`,
    ),
  embers: () => svg(160, 40, `${specks(67, 20, ['#8d8a88', '#6f6b69'], bottomArea, 0.6, 1.6, 0.3, 0.7)}${specks(71, 4, ['#ff9a4a'], bottomArea, 0.8, 1.3, 0.6, 0.9)}`),
  mist: () =>
    svg(
      160,
      40,
      `<rect x="0" y="0" width="160" height="40" fill="url(#g)"/>${specks(73, 8, ['#9fc58a'], bottomArea, 0.6, 1.4, 0.3, 0.6)}`,
      `<linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7f9b78" stop-opacity="0"/><stop offset="1" stop-color="#7f9b78" stop-opacity="0.35"/></linearGradient>`,
    ),
  motes: () => svg(160, 40, specks(79, 14, ['#fff1c4', '#ffe0a0'], bottomArea, 0.6, 1.4, 0.35, 0.8)),
};

const cache = new Map<string, string>();

/** A built-in accent as a `data:` URL: a corner picture, or an edge tile. */
export function builtinOverlaySrc(kind: BuiltinOverlay, corner: boolean): string {
  const key = `${kind}|${corner}`;
  let url = cache.get(key);
  if (!url) {
    const draw = (corner ? CORNERS[kind] : EDGES[kind]) ?? (corner ? CORNERS.dust! : EDGES.motes!);
    url = `data:image/svg+xml,${encodeURIComponent(draw().replace(/\s+/g, ' '))}`;
    cache.set(key, url);
  }
  return url;
}

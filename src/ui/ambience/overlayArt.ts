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
 * left to right, and turned for the left edge (40 × 160; flipped for the
 * right). These are generated here, never fetched: a pack's own URLs
 * still go through the manifest's URL rules.
 *
 * The full-area placeholder (spec 1.4, `#ambience` preview) is one
 * 2048 × 745 picture of sparse marks scattered over the area, thicker at the
 * rim and thin in the middle where cards sit, denser at each stage: inked
 * vines (forest), dead branches (swamp), grass tufts (plains), sand and shells
 * (island), lava cracks (mountain), grit (wastes).
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

/** A soft dark halo, so pale art (frost, spray, petals, motes) still reads over a bright sky or a light skin. */
const HALO = '<filter id="h" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="0" stdDeviation="1.4" flood-color="#0b1622" flood-opacity="0.6"/></filter>';

const svg = (w: number, h: number, body: string, defs = '', halo = false) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">${defs || halo ? `<defs>${defs}${halo ? HALO : ''}</defs>` : ''}${halo ? `<g filter="url(#h)">${body}</g>` : body}</svg>`;

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
      true,
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
    return svg(200, 200, `<circle cx="0" cy="200" r="90" fill="url(#g)"/>${body}`, `<radialGradient id="g" cx="0" cy="1" r="1"><stop offset="0" stop-color="#ffe9b0" stop-opacity="0.22"/><stop offset="1" stop-color="#ffe9b0" stop-opacity="0"/></radialGradient>`, true);
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
      '',
      true,
    ),
  embers: () => svg(160, 40, `${specks(67, 20, ['#8d8a88', '#6f6b69'], bottomArea, 0.6, 1.6, 0.3, 0.7)}${specks(71, 4, ['#ff9a4a'], bottomArea, 0.8, 1.3, 0.6, 0.9)}`),
  mist: () =>
    svg(
      160,
      40,
      `<rect x="0" y="0" width="160" height="40" fill="url(#g)"/>${specks(73, 8, ['#9fc58a'], bottomArea, 0.6, 1.4, 0.3, 0.6)}`,
      `<linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7f9b78" stop-opacity="0"/><stop offset="1" stop-color="#7f9b78" stop-opacity="0.35"/></linearGradient>`,
    ),
  motes: () => svg(160, 40, specks(79, 14, ['#fff1c4', '#ffe0a0'], bottomArea, 0.6, 1.4, 0.35, 0.8), '', true),
};

/** An edge tile turned for the left edge: 40 × 160, the ground at the left (the renderer flips it for the right edge). */
const vertical = (tile: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 160" width="40" height="160"><g transform="translate(40 0) rotate(90)">${tile}</g></svg>`;

// ---------------------------------------------------------------------------
// The full-area placeholder (spec 1.4).

const AW = 2048;
const AH = 745;

/** A point over the area, mostly in the rim: the middle (where cards sit) is kept thin. */
function rimPoint(r: () => number): [number, number] {
  for (let i = 0; i < 6; i++) {
    const x = r() * AW;
    const y = r() * AH;
    const inner = x > AW * 0.12 && x < AW * 0.88 && y > AH * 0.2 && y < AH * 0.78;
    if (!inner || r() < 0.12) return [x, y];
  }
  return [r() * AW, r() < 0.5 ? r() * AH * 0.18 : AH - r() * AH * 0.2];
}

type Mark = (r: () => number, x: number, y: number, level: number) => string;

const INK = '#141a12';

const AREA_MARKS: Record<string, { n: number; mark: Mark; halo?: boolean; defs?: string }> = {
  // Forest: heavily inked vines with a few leaves; thicker with the stage.
  vine: {
    n: 9,
    mark: (r, x, y, lv) => {
      const len = 60 + r() * 90;
      const a = r() * 360;
      const w = r1(2 + lv * 0.9);
      const leafs = [0.35, 0.7, 1].map((t) => [t * len, (r() - 0.5) * 18, r() * 120 - 60, 0.9 + lv * 0.15] as [number, number, number, number]);
      return `<g transform="translate(${r1(x)} ${r1(y)}) rotate(${Math.round(a)})"><path d="M0 0 C ${r1(len * 0.3)} ${r1(-20 - r() * 20)}, ${r1(len * 0.6)} ${r1(20 + r() * 20)}, ${r1(len)} 0" fill="none" stroke="${INK}" stroke-width="${r1(w + 2)}" stroke-linecap="round"/><path d="M0 0 C ${r1(len * 0.3)} -24, ${r1(len * 0.6)} 24, ${r1(len)} 0" fill="none" stroke="#3f6a35" stroke-width="${w}" stroke-linecap="round"/>${leaves(leafs, '#5c8f45', INK)}</g>`;
    },
  },
  // Swamp: dead branches, forked, inked.
  moss: {
    n: 8,
    mark: (r, x, y, lv) => {
      const len = 50 + r() * 70 + lv * 10;
      const w = r1(1.6 + lv * 0.6);
      const f1 = r1(len * (0.4 + r() * 0.2));
      const f2 = r1(len * (0.65 + r() * 0.2));
      return `<g transform="translate(${r1(x)} ${r1(y)}) rotate(${Math.round(r() * 360)})" fill="none" stroke-linecap="round"><path d="M0 0 L${r1(len)} ${r1((r() - 0.5) * 14)} M${f1} 0 l${r1(18 + r() * 14)} ${r1(-14 - r() * 12)} M${f2} 0 l${r1(14 + r() * 10)} ${r1(10 + r() * 10)}" stroke="${INK}" stroke-width="${r1(+w + 2)}"/><path d="M0 0 L${r1(len)} 0" stroke="#4a4237" stroke-width="${w}"/></g>`;
    },
  },
  // Plains: grass tufts, a fan of inked blades.
  petals: {
    n: 12,
    mark: (r, x, y, lv) => {
      const blades = 3 + lv;
      let d = '';
      for (let i = 0; i < blades; i++) {
        const a = (-60 + (120 * i) / (blades - 1) + (r() - 0.5) * 12) * (Math.PI / 180);
        const h = 18 + r() * 16 + lv * 3;
        d += `M0 0 Q ${r1(Math.sin(a) * h * 0.4)} ${r1(-h * 0.6)} ${r1(Math.sin(a) * h)} ${r1(-Math.cos(a) * h)} `;
      }
      return `<g transform="translate(${r1(x)} ${r1(y)})" fill="none" stroke-linecap="round"><path d="${d}" stroke="${INK}" stroke-width="3.6"/><path d="${d}" stroke="#c9b45a" stroke-width="1.6"/></g>`;
    },
  },
  // Island: soft sand drifts and a few shells.
  frost: {
    n: 10,
    halo: true,
    mark: (r, x, y, lv) => {
      const sand = specks(Math.floor(r() * 1e6), 6 + lv * 3, ['#e9dcb8', '#d8c79c'], (q) => [x + (q() - 0.5) * 70, y + (q() - 0.5) * 26], 0.8, 2 + lv * 0.3, 0.35, 0.8);
      const shell = r() < 0.35 + lv * 0.08 ? `<path transform="translate(${r1(x)} ${r1(y)}) rotate(${Math.round(r() * 360)}) scale(${r1(0.8 + lv * 0.15)})" d="M0 0 C -6 -2, -7 -9, 0 -11 C 7 -9, 6 -2, 0 0 Z M0 0 L-3 -9 M0 0 L0 -10 M0 0 L3 -9" fill="#f3e6cf" stroke="#b99f7a" stroke-width="0.8" opacity="0.9"/>` : '';
      return sand + shell;
    },
  },
  // Mountain: lava cracks, brighter with the stage.
  ash: {
    n: 8,
    defs: '<filter id="lv" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="3"/></filter>',
    mark: (r, x, y, lv) => {
      let d = 'M0 0';
      let cx = 0;
      let cy = 0;
      for (let i = 0; i < 4 + lv; i++) {
        cx += 10 + r() * 16;
        cy += (r() - 0.5) * 18;
        d += ` L${r1(cx)} ${r1(cy)}`;
      }
      const glow = ['#7a2a10', '#c2471a', '#ff7a2a', '#ffb347'][Math.min(lv, 4) - 1];
      return `<g transform="translate(${r1(x)} ${r1(y)}) rotate(${Math.round(r() * 360)})" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="${d}" stroke="${glow}" stroke-width="${4 + lv}" opacity="0.5" filter="url(#lv)"/><path d="${d}" stroke="${INK}" stroke-width="3"/><path d="${d}" stroke="${glow}" stroke-width="${r1(0.8 + lv * 0.35)}"/></g>`;
    },
  },
  // Wastes: grit.
  dust: {
    n: 10,
    mark: (r, x, y, lv) => specks(Math.floor(r() * 1e6), 5 + lv * 2, ['#b9ab95', '#8f8574'], (q) => [x + (q() - 0.5) * 60, y + (q() - 0.5) * 30], 0.8, 2.2, 0.3, 0.75),
  },
};

const areaCache = new Map<string, string>();

/** The built-in full-area placeholder for a biome's accent kind at a density level (2–4), as a `data:` URL (2048 × 745). */
export function builtinAreaSrc(kind: BuiltinOverlay, level: number): string {
  const lv = Math.max(2, Math.min(4, Math.round(level)));
  const key = `${kind}|${lv}`;
  let url = areaCache.get(key);
  if (!url) {
    const spec = AREA_MARKS[kind] ?? AREA_MARKS.dust!;
    const r = rng(kind.length * 977 + 13);
    let body = '';
    // Denser, thicker and brighter at each level: the same place, grown.
    const n = Math.round(spec.n * (1 + (lv - 2) * 0.8));
    for (let i = 0; i < n; i++) {
      const [x, y] = rimPoint(r);
      body += spec.mark(r, x, y, lv);
    }
    url = `data:image/svg+xml,${encodeURIComponent(svg(AW, AH, body, spec.defs ?? '', spec.halo ?? false).replace(/\s+/g, ' '))}`;
    areaCache.set(key, url);
  }
  return url;
}

/** The shape a built-in piece is drawn in: a corner picture, a tile along the top or bottom edge, or one along a side edge. */
export type BuiltinShape = 'corner' | 'h' | 'v';

const cache = new Map<string, string>();

/** A built-in accent as a `data:` URL. */
export function builtinOverlaySrc(kind: BuiltinOverlay, shape: BuiltinShape): string {
  const key = `${kind}|${shape}`;
  let url = cache.get(key);
  if (!url) {
    const edge = () => (EDGES[kind] ?? EDGES.motes!)();
    const draw = shape === 'corner' ? (CORNERS[kind] ?? CORNERS.dust!) : shape === 'h' ? edge : () => vertical(edge());
    url = `data:image/svg+xml,${encodeURIComponent(draw().replace(/\s+/g, ' '))}`;
    cache.set(key, url);
  }
  return url;
}

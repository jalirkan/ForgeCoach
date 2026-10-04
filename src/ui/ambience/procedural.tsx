/*
 * ForgeCoach — ui/ambience/procedural.tsx
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The built-in scenery: six original biomes drawn in code (SVG gradients and
 * paths, a few CSS-animated pieces), no images. It is what the board shows
 * when no pack is set, and what a pack falls back to for a biome it lacks.
 *
 * Every biome is a stack of layers, far to near; later stages add layers
 * (each with a stable id, so earlier ones stay put while new ones bloom in).
 * Wide backgrounds stretch (`preserveAspectRatio="none"`); objects (palms,
 * trees, stones) keep their shape. Animations are transform / opacity only,
 * and few per slot (scenery.css).
 */
import type { CSSProperties, ReactNode } from 'react';
import type { Biome } from '../../ambience/model.ts';
import type { ParticlePreset } from '../../ambience/manifest.ts';

export interface DrawLayer {
  id: string;
  z: number;
  /** 0 far … 1 near: how far it travels when it blooms in. */
  depth: number;
  node: ReactNode;
}

/** Deterministic pseudo-random numbers (mulberry32), so a biome looks the same every time. */
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

const f1 = (n: number) => Math.round(n * 10) / 10;

/** A full-bleed backdrop, stretched to the slot. */
function Full({ children, w = 400, className, style }: { children: ReactNode; w?: number; className?: string; style?: CSSProperties }) {
  return (
    <svg className={className ?? 'scn-svg'} style={style} viewBox={`0 0 ${w} 100`} preserveAspectRatio="none" aria-hidden="true">
      {children}
    </svg>
  );
}

/** An object that keeps its shape, placed by % from the slot's left and bottom, sized by % of the strip's height. */
function Obj({ x, b = 0, h, vb, children, className, flip, delay }: { x: number; b?: number; h: number; vb: [number, number]; children: ReactNode; className?: string; flip?: boolean; delay?: number }) {
  const style: CSSProperties = { left: `${x}%`, bottom: `${b}%`, height: `${h}%`, aspectRatio: `${vb[0]} / ${vb[1]}` };
  if (delay) style.animationDelay = `${delay}s`;
  return (
    <span className={`scn-obj ${className ?? ''}`} style={style}>
      <svg viewBox={`0 0 ${vb[0]} ${vb[1]}`} preserveAspectRatio="xMidYMax meet" style={flip ? { transform: 'scaleX(-1)' } : undefined} aria-hidden="true">
        {children}
      </svg>
    </span>
  );
}

function Grad({ id, stops, x2 = 0, y2 = 1 }: { id: string; stops: [number, string, number?][]; x2?: number; y2?: number }) {
  return (
    <linearGradient id={id} x1="0" y1="0" x2={x2} y2={y2}>
      {stops.map(([o, c, op], i) => (
        <stop key={i} offset={o} stopColor={c} stopOpacity={op ?? 1} />
      ))}
    </linearGradient>
  );
}

function Sky({ uid, stops }: { uid: string; stops: [number, string][] }) {
  return (
    <Full>
      <defs>
        <Grad id={`${uid}-sky`} stops={stops} />
      </defs>
      <rect width="400" height="100" fill={`url(#${uid}-sky)`} />
    </Full>
  );
}

/** A ridge line across the slot: `n` points between yMin and yMax, jagged or smooth. */
function ridge(seed: number, n: number, yMin: number, yMax: number, smooth: boolean, w = 400): { d: string; peaks: [number, number][] } {
  const r = rng(seed);
  const pts: [number, number][] = [];
  for (let i = 0; i <= n; i++) pts.push([f1((i / n) * w), f1(yMin + r() * (yMax - yMin))]);
  let d = `M0 100 L0 ${pts[0]![1]}`;
  if (smooth) {
    for (let i = 1; i < pts.length; i++) {
      const [x0, y0] = pts[i - 1]!;
      const [x1, y1] = pts[i]!;
      const mx = f1((x0 + x1) / 2);
      d += ` C ${mx} ${y0}, ${mx} ${y1}, ${x1} ${y1}`;
    }
  } else for (const [x, y] of pts.slice(1)) d += ` L${x} ${y}`;
  d += ` L${w} 100 Z`;
  const peaks = pts.filter((p, i) => i > 0 && i < pts.length - 1 && p[1] < pts[i - 1]![1] && p[1] < pts[i + 1]![1]);
  return { d, peaks };
}

/** A canopy of round crowns along a baseline. */
function canopy(seed: number, base: number, rMin: number, rMax: number, step: number): string {
  const r = rng(seed);
  let d = `M0 100 L0 ${base}`;
  for (let x = 0; x <= 400 + step; x += step * (0.7 + r() * 0.6)) {
    const rad = rMin + r() * (rMax - rMin);
    const top = base - rad * (0.6 + r() * 0.5);
    d += ` Q ${f1(x - step / 2)} ${f1(top)}, ${f1(x)} ${f1(base - r() * 3)}`;
  }
  return `${d} L400 100 Z`;
}

/** Thin strokes for wave glints, wheat, reeds: drawn twice (0–400 and 400–800) for a seamless loop. */
function strokes(seed: number, n: number, yMin: number, yMax: number, len: [number, number], loop: boolean): string {
  const r = rng(seed);
  let d = '';
  for (let i = 0; i < n; i++) {
    const x = r() * 400;
    const y = yMin + r() * (yMax - yMin);
    const l = len[0] + r() * (len[1] - len[0]);
    const seg = (ox: number) => ` M${f1(x + ox)} ${f1(y)} h${f1(l)}`;
    d += seg(0) + (loop ? seg(400) : '');
  }
  return d;
}

// ---------------------------------------------------------------------------
// Island

function Palm({ lean = 0 }: { lean?: number }) {
  const tx = 34 + lean;
  return (
    <g>
      <path d={`M29 100 C 30 78, ${tx - 4} 54, ${tx} 30`} fill="none" stroke="#6e4c2c" strokeWidth="3.4" strokeLinecap="round" />
      <path d={`M29 100 C 30 78, ${tx - 4} 54, ${tx} 30`} fill="none" stroke="#9a7046" strokeWidth="1" strokeDasharray="1.2 3" strokeLinecap="round" />
      <g transform={`translate(${tx} 30)`} fill="#2d7a4c">
        <path d="M0 0 C -9 -9, -22 -8, -30 3 C -20 -3, -10 -3, 0 1 Z" />
        <path d="M0 0 C 9 -10, 22 -9, 30 2 C 20 -3, 10 -3, 0 1 Z" />
        <path d="M0 0 C -6 -14, -14 -20, -24 -18 C -14 -14, -7 -8, 0 1 Z" fill="#3a9460" />
        <path d="M0 0 C 6 -14, 15 -19, 24 -16 C 14 -13, 7 -8, 0 1 Z" fill="#3a9460" />
        <path d="M0 0 C -12 -2, -20 6, -23 16 C -16 7, -8 3, 0 2 Z" fill="#256a40" />
        <path d="M0 0 C 12 -2, 20 6, 22 17 C 16 7, 8 3, 0 2 Z" fill="#256a40" />
        <circle cx="-1.5" cy="3" r="1.8" fill="#5a3b20" />
        <circle cx="1.8" cy="3.4" r="1.6" fill="#4c321b" />
      </g>
    </g>
  );
}

function island(uid: string, s: number): DrawLayer[] {
  const out: DrawLayer[] = [
    { id: 'sky', z: 0, depth: 0, node: <Sky uid={uid} stops={[[0, '#5fa8cf'], [0.5, '#a9d6e2'], [1, '#f7dcae']]} /> },
    {
      id: 'sea',
      z: 2,
      depth: 0.3,
      node: (
        <Full>
          <defs>
            <Grad id={`${uid}-sea`} stops={[[0, '#49b3c9'], [0.35, '#1f7fa6'], [1, '#0b3f62']]} />
          </defs>
          <rect y="58" width="400" height="42" fill={`url(#${uid}-sea)`} />
          <rect y="57.6" width="400" height="0.9" fill="#eaf8f4" opacity="0.7" />
        </Full>
      ),
    },
    {
      id: 'glints',
      z: 3,
      depth: 0.4,
      node: (
        <Full w={800} className="scn-svg scn-loop" style={{ animationDuration: '26s' }}>
          <path d={strokes(11, 34, 61, 98, [6, 18], true)} stroke="#e9fbff" strokeWidth="0.7" opacity="0.45" vectorEffect="non-scaling-stroke" />
        </Full>
      ),
    },
  ];
  if (s >= 3) {
    out.push({
      id: 'sun',
      z: 1,
      depth: 0.1,
      node: (
        <Obj x={68} b={34} h={58} vb={[60, 60]} className="scn-pulse">
          <defs>
            <radialGradient id={`${uid}-sun`}>
              <stop offset="0" stopColor="#fff6d8" />
              <stop offset="0.25" stopColor="#ffe9b0" stopOpacity="0.9" />
              <stop offset="1" stopColor="#ffd38a" stopOpacity="0" />
            </radialGradient>
          </defs>
          <circle cx="30" cy="30" r="30" fill={`url(#${uid}-sun)`} />
        </Obj>
      ),
    });
    out.push({
      id: 'islet',
      z: 2,
      depth: 0.2,
      node: (
        <Full>
          <path d="M262 59 C 276 52, 300 50, 322 59 Z" fill="#3f8a6c" opacity="0.85" />
          <path d="M282 55 C 290 53, 300 53, 306 56" stroke="#2d6b52" strokeWidth="0.8" fill="none" vectorEffect="non-scaling-stroke" />
        </Full>
      ),
    });
  }
  if (s >= 2) {
    out.push({
      id: 'shore',
      z: 4,
      depth: 0.7,
      node: (
        <Full>
          <defs>
            <Grad id={`${uid}-sand`} stops={[[0, '#f4e2b4'], [1, '#d3b277']]} />
          </defs>
          <path d="M0 100 L0 74 C 50 68, 110 70, 160 80 C 195 87, 225 95, 262 100 Z" fill={`url(#${uid}-sand)`} />
          <path d="M0 73.5 C 50 67.5, 110 69.5, 160 79.5 C 195 86.5, 225 94.5, 262 99.6" fill="none" stroke="#ffffff" strokeWidth="1.4" opacity="0.6" vectorEffect="non-scaling-stroke" />
          {s >= 4 && (
            <>
              <path d="M18 91 C 45 82, 108 82, 142 91 C 112 98, 48 98, 18 91 Z" fill="#62d8c6" opacity="0.92" />
              <path d="M30 89.5 C 60 85, 100 85, 128 89.5" fill="none" stroke="#d9fff7" strokeWidth="1" opacity="0.7" vectorEffect="non-scaling-stroke" />
            </>
          )}
        </Full>
      ),
    });
  }
  if (s >= 3) {
    const palms = s >= 4 ? [[13, 88, 0, 0], [25, 70, -6, 1.3], [37, 56, 4, 0.6], [19, 46, 2, 2.1]] : [[14, 82, 0, 0], [27, 62, -5, 1.1]];
    out.push({
      id: s >= 4 ? 'palms-grove' : 'palms',
      z: 6,
      depth: 1,
      node: (
        <>
          {palms.map(([x, h, lean, d], i) => (
            <Obj key={i} x={x!} b={-2} h={h!} vb={[60, 100]} className="scn-sway" delay={-d!} flip={i % 2 === 1}>
              <Palm lean={lean} />
            </Obj>
          ))}
        </>
      ),
    });
  }
  if (s >= 4) {
    out.push({
      id: 'gulls',
      z: 5,
      depth: 0.5,
      node: (
        <Full w={800} className="scn-svg scn-loop scn-loop-rev" style={{ animationDuration: '70s' }}>
          <path d="M120 22 q4 -3 8 0 q4 -3 8 0 M150 30 q3 -2 6 0 q3 -2 6 0 M520 18 q4 -3 8 0 q4 -3 8 0 M548 26 q3 -2 6 0 q3 -2 6 0" fill="none" stroke="#3c5866" strokeWidth="1.1" vectorEffect="non-scaling-stroke" />
        </Full>
      ),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Swamp

function TwistedTree() {
  return (
    <g fill="#121a19" stroke="#121a19" strokeLinecap="round">
      <path d="M34 100 C 37 86, 30 78, 35 66 C 39 56, 31 49, 36 38 L 42 38 C 40 50, 47 57, 43 67 C 39 78, 46 86, 46 100 Z" stroke="none" />
      <path d="M38 44 C 30 36, 20 36, 12 28 M12 28 C 9 24, 10 19, 6 16 M24 34 C 22 28, 26 24, 24 18" fill="none" strokeWidth="2.2" />
      <path d="M40 40 C 48 30, 58 32, 66 24 M66 24 C 70 20, 68 15, 73 12 M54 30 C 58 24, 55 19, 58 14" fill="none" strokeWidth="2.2" />
      <path d="M38 40 C 38 30, 34 24, 37 14" fill="none" strokeWidth="1.8" />
      <g stroke="#4f6e52" strokeWidth="0.9" opacity="0.85">
        <path d="M14 29 v9 M18 31 v6 M26 33 v8 M60 28 v10 M64 25 v7 M70 18 v8" />
      </g>
    </g>
  );
}

function swamp(uid: string, s: number): DrawLayer[] {
  const far = ridge(23, 14, 56, 64, false);
  const out: DrawLayer[] = [
    { id: 'sky', z: 0, depth: 0, node: <Sky uid={uid} stops={[[0, '#1d2030'], [0.55, '#3a414a'], [1, '#626a58']]} /> },
    {
      id: 'treeline',
      z: 2,
      depth: 0.2,
      node: (
        <Full>
          <path d={far.d} fill="#273229" />
        </Full>
      ),
    },
    {
      id: 'water',
      z: 3,
      depth: 0.4,
      node: (
        <Full>
          <defs>
            <Grad id={`${uid}-mire`} stops={[[0, '#2c3a33'], [1, '#0d1412']]} />
          </defs>
          <rect y="66" width="400" height="34" fill={`url(#${uid}-mire)`} />
          <path d={strokes(31, 18, 70, 97, [10, 30], false)} stroke="#7d9a86" strokeWidth="0.6" opacity="0.28" vectorEffect="non-scaling-stroke" />
        </Full>
      ),
    },
    {
      id: 'mist',
      z: 5,
      depth: 0.5,
      node: (
        <Full w={800} className="scn-svg scn-loop" style={{ animationDuration: '60s' }}>
          <defs>
            <filter id={`${uid}-blur`} x="-20%" y="-50%" width="140%" height="200%">
              <feGaussianBlur stdDeviation="5 2" />
            </filter>
          </defs>
          <g fill="#dfe8df" opacity="0.2" filter={`url(#${uid}-blur)`}>
            {[0, 400].map((o) => (
              <g key={o}>
                <ellipse cx={60 + o} cy="68" rx="70" ry="5" />
                <ellipse cx={210 + o} cy="74" rx="90" ry="6" />
                <ellipse cx={340 + o} cy="66" rx="60" ry="4" />
              </g>
            ))}
          </g>
        </Full>
      ),
    },
  ];
  if (s >= 2) {
    out.push({
      id: 'reeds',
      z: 6,
      depth: 0.8,
      node: (
        <Full>
          <g stroke="#1b2620" strokeWidth="1.2" vectorEffect="non-scaling-stroke" fill="none">
            {Array.from({ length: 26 }, (_, i) => {
              const r = rng(70 + i);
              const x = i < 13 ? r() * 70 : 330 + r() * 70;
              const h = 14 + r() * 16;
              return <path key={i} d={`M${f1(x)} 100 q ${f1(r() * 4 - 2)} ${f1(-h / 2)} ${f1(r() * 6 - 3)} ${f1(-h)}`} vectorEffect="non-scaling-stroke" />;
            })}
          </g>
        </Full>
      ),
    });
  }
  if (s >= 3) {
    out.push({
      id: 'moon',
      z: 1,
      depth: 0.1,
      node: (
        <Obj x={70} b={46} h={46} vb={[60, 60]}>
          <defs>
            <radialGradient id={`${uid}-moon`}>
              <stop offset="0" stopColor="#eef3dc" />
              <stop offset="0.22" stopColor="#dfe8c8" stopOpacity="0.85" />
              <stop offset="1" stopColor="#b7c6a0" stopOpacity="0" />
            </radialGradient>
          </defs>
          <circle cx="30" cy="30" r="30" fill={`url(#${uid}-moon)`} />
        </Obj>
      ),
    });
    out.push({
      id: 'trees',
      z: 7,
      depth: 1,
      node: (
        <>
          <Obj x={13} b={-1} h={96} vb={[80, 100]}>
            <TwistedTree />
          </Obj>
          {s >= 4 && (
            <Obj x={66} b={-1} h={74} vb={[80, 100]} flip>
              <TwistedTree />
            </Obj>
          )}
        </>
      ),
    });
  }
  if (s >= 4) {
    out.push({
      id: 'wisps',
      z: 8,
      depth: 0.6,
      node: (
        <>
          {[
            [30, 40, 0],
            [48, 28, 1.7],
            [62, 46, 3.1],
          ].map(([x, b, d], i) => (
            <span key={i} className="scn-dot scn-bob scn-wisp" style={{ left: `${x}%`, bottom: `${b}%`, animationDelay: `-${d}s` }} />
          ))}
        </>
      ),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Mountain

function mountain(uid: string, s: number): DrawLayer[] {
  const far = ridge(41, 9, 24, 50, false);
  const mid = ridge(43, 7, 44, 64, false);
  const near = ridge(47, 5, 62, 78, false);
  const out: DrawLayer[] = [
    { id: 'sky', z: 0, depth: 0, node: <Sky uid={uid} stops={[[0, '#2a1a30'], [0.5, '#6b3149'], [1, '#e48a55']]} /> },
    {
      id: 'far',
      z: 2,
      depth: 0.2,
      node: (
        <Full>
          <path d={far.d} fill="#7d4d63" />
          {s >= 3 &&
            far.peaks.map(([x, y], i) => <path key={i} d={`M${x} ${y} l -7 5.5 l 3 -0.6 l 4 1.6 l 3 -1.2 l 4 0.4 Z`} fill="#f2e2e4" opacity="0.85" />)}
        </Full>
      ),
    },
    {
      id: 'mid',
      z: 3,
      depth: 0.4,
      node: (
        <Full>
          <path d={mid.d} fill="#4d2b3e" />
        </Full>
      ),
    },
  ];
  if (s >= 2) {
    out.push({
      id: 'near',
      z: 5,
      depth: 0.7,
      node: (
        <Full>
          <path d={near.d} fill="#2a1722" />
        </Full>
      ),
    });
  }
  if (s >= 3) {
    out.push({ id: 'embers-glow', z: 4, depth: 0.3, node: <span className="scn-fill scn-pulse scn-ember-glow" /> });
  }
  if (s >= 4) {
    out.push({
      id: 'volcano',
      z: 6,
      depth: 0.9,
      node: (
        <Obj x={52} b={-2} h={92} vb={[120, 80]}>
          <defs>
            <linearGradient id={`${uid}-lava`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#ffd27a" />
              <stop offset="1" stopColor="#ff5a1f" />
            </linearGradient>
          </defs>
          <path d="M0 80 L48 14 C 54 10, 66 10, 72 14 L120 80 Z" fill="#1f1118" />
          <path d="M50 14 C 56 18, 64 18, 70 14" fill="none" stroke={`url(#${uid}-lava)`} strokeWidth="2.4" />
          <path d="M60 16 C 58 30, 64 40, 58 56 C 55 64, 60 72, 57 80" fill="none" stroke={`url(#${uid}-lava)`} strokeWidth="1.6" opacity="0.9" />
          <path d="M66 18 C 72 30, 70 44, 78 58" fill="none" stroke="#ff7a2e" strokeWidth="1" opacity="0.7" />
        </Obj>
      ),
    });
    out.push({
      id: 'embers',
      z: 7,
      depth: 0.6,
      node: (
        <>
          {[56, 60, 63, 66, 58].map((x, i) => (
            <span key={i} className="scn-dot scn-rise scn-ember" style={{ left: `${x}%`, bottom: '62%', animationDelay: `-${i * 0.9}s` }} />
          ))}
        </>
      ),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Forest

function pines(seed: number, n: number, base: number, hMin: number, hMax: number, xMin: number, xMax: number): string {
  const r = rng(seed);
  let d = '';
  for (let i = 0; i < n; i++) {
    const x = xMin + r() * (xMax - xMin);
    const h = hMin + r() * (hMax - hMin);
    const w = h * 0.22;
    const y = base;
    d += ` M${f1(x)} ${f1(y - h)} L${f1(x + w)} ${f1(y - h * 0.55)} L${f1(x + w * 0.5)} ${f1(y - h * 0.55)} L${f1(x + w * 1.4)} ${f1(y)} L${f1(x - w * 1.4)} ${f1(y)} L${f1(x - w * 0.5)} ${f1(y - h * 0.55)} L${f1(x - w)} ${f1(y - h * 0.55)} Z`;
  }
  return d;
}

function forest(uid: string, s: number): DrawLayer[] {
  const out: DrawLayer[] = [
    { id: 'sky', z: 0, depth: 0, node: <Sky uid={uid} stops={[[0, '#8fbfa7'], [0.55, '#cfe2bd'], [1, '#f1e6bf']]} /> },
    {
      id: 'far',
      z: 2,
      depth: 0.2,
      node: (
        <Full>
          <path d={canopy(61, 60, 10, 16, 20)} fill="#7ba487" opacity="0.9" />
        </Full>
      ),
    },
    {
      id: 'mid',
      z: 3,
      depth: 0.45,
      node: (
        <Full>
          <path d={canopy(63, 72, 12, 20, 26)} fill="#3f6d4d" />
        </Full>
      ),
    },
  ];
  if (s >= 2) {
    out.push({
      id: 'near',
      z: 5,
      depth: 0.75,
      node: (
        <Full>
          <path d={pines(65, 9, 101, 30, 52, 0, 400)} fill="#22472f" />
          <path d={canopy(67, 88, 8, 14, 30)} fill="#22472f" />
        </Full>
      ),
    });
  }
  if (s >= 3) {
    out.push({
      id: 'shafts',
      z: 4,
      depth: 0.3,
      node: (
        <Full className="scn-svg scn-pulse scn-screen">
          <defs>
            <Grad id={`${uid}-beam`} stops={[[0, '#fff8d6', 0.55], [1, '#fff8d6', 0]]} />
          </defs>
          <g fill={`url(#${uid}-beam)`}>
            <path d="M70 0 L96 0 L150 100 L110 100 Z" />
            <path d="M190 0 L204 0 L246 100 L222 100 Z" />
            <path d="M300 0 L322 0 L372 100 L340 100 Z" />
          </g>
        </Full>
      ),
    });
  }
  if (s >= 4) {
    out.push({
      id: 'front',
      z: 6,
      depth: 1,
      node: (
        <Full>
          <path d={pines(69, 4, 104, 70, 96, 50, 110)} fill="#12291b" />
          <path d={pines(71, 3, 104, 64, 90, 300, 350)} fill="#12291b" />
          <path d={canopy(73, 97, 4, 8, 14)} fill="#163322" />
        </Full>
      ),
    });
    out.push({
      id: 'fireflies',
      z: 7,
      depth: 0.6,
      node: (
        <>
          {[
            [22, 30, 0],
            [38, 18, 1.2],
            [55, 34, 2.5],
            [70, 22, 0.7],
            [84, 36, 3.3],
          ].map(([x, b, d], i) => (
            <span key={i} className="scn-dot scn-bob scn-firefly" style={{ left: `${x}%`, bottom: `${b}%`, animationDelay: `-${d}s` }} />
          ))}
        </>
      ),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Plains

function plains(uid: string, s: number): DrawLayer[] {
  const back = ridge(81, 4, 58, 68, true);
  const mid = ridge(83, 3, 68, 80, true);
  const front = ridge(85, 3, 80, 90, true);
  const out: DrawLayer[] = [
    { id: 'sky', z: 0, depth: 0, node: <Sky uid={uid} stops={[[0, '#6fb0df'], [0.55, '#c6e0ea'], [1, '#fbe6b8']]} /> },
    {
      id: 'back',
      z: 2,
      depth: 0.2,
      node: (
        <Full>
          <path d={back.d} fill="#cdbf82" />
        </Full>
      ),
    },
    {
      id: 'mid',
      z: 3,
      depth: 0.45,
      node: (
        <Full>
          <defs>
            <Grad id={`${uid}-gold`} stops={[[0, '#e2b552'], [1, '#b98a30']]} />
          </defs>
          <path d={mid.d} fill={`url(#${uid}-gold)`} />
        </Full>
      ),
    },
  ];
  if (s >= 2) {
    out.push({
      id: 'clouds',
      z: 1,
      depth: 0.1,
      node: (
        <Full w={800} className="scn-svg scn-loop" style={{ animationDuration: '90s' }}>
          <g fill="#ffffff" opacity="0.75">
            {[0, 400].map((o) => (
              <g key={o}>
                <ellipse cx={70 + o} cy="22" rx="26" ry="5" />
                <ellipse cx={84 + o} cy="18" rx="14" ry="5" />
                <ellipse cx={250 + o} cy="30" rx="34" ry="5" />
                <ellipse cx={266 + o} cy="25" rx="16" ry="5" />
              </g>
            ))}
          </g>
        </Full>
      ),
    });
    out.push({
      id: 'front',
      z: 5,
      depth: 0.75,
      node: (
        <Full>
          <path d={front.d} fill="#a87a26" />
          <path d={strokes(87, 40, 86, 99, [3, 8], false)} stroke="#f0cf6e" strokeWidth="0.8" opacity="0.6" vectorEffect="non-scaling-stroke" />
        </Full>
      ),
    });
  }
  if (s >= 3) {
    out.push({
      id: 'sun',
      z: 1,
      depth: 0.1,
      node: (
        <Obj x={14} b={40} h={60} vb={[60, 60]} className="scn-pulse">
          <defs>
            <radialGradient id={`${uid}-sun`}>
              <stop offset="0" stopColor="#fffbe6" />
              <stop offset="0.22" stopColor="#ffefb8" stopOpacity="0.95" />
              <stop offset="1" stopColor="#ffe08a" stopOpacity="0" />
            </radialGradient>
          </defs>
          <circle cx="30" cy="30" r="30" fill={`url(#${uid}-sun)`} />
        </Obj>
      ),
    });
    out.push({
      id: 'tree',
      z: 4,
      depth: 0.6,
      node: (
        <Obj x={66} b={20} h={44} vb={[50, 50]} className="scn-sway">
          <path d="M24 50 L24 30" stroke="#4a3520" strokeWidth="2.4" />
          <ellipse cx="24" cy="22" rx="16" ry="12" fill="#5b7a35" />
          <ellipse cx="18" cy="20" rx="8" ry="7" fill="#6e8f40" />
        </Obj>
      ),
    });
  }
  if (s >= 4) {
    out.push({
      id: 'wheat',
      z: 6,
      depth: 1,
      node: (
        <span className="scn-fill scn-sway scn-sway-soft">
          <Full>
            <g stroke="#e9c35c" strokeWidth="1" fill="none" vectorEffect="non-scaling-stroke">
              {Array.from({ length: 70 }, (_, i) => {
                const r = rng(200 + i);
                const x = (i / 70) * 400 + r() * 5;
                const h = 10 + r() * 10;
                return <path key={i} d={`M${f1(x)} 100 q ${f1(r() * 3)} ${f1(-h / 2)} ${f1(r() * 4 - 1)} ${f1(-h)}`} vectorEffect="non-scaling-stroke" />;
              })}
            </g>
          </Full>
        </span>
      ),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Wastes (colourless, unknown and many-coloured lands)

function Stone({ tone = '#2f2a38' }: { tone?: string }) {
  return (
    <g>
      <path d="M8 100 L10 22 L18 8 L28 20 L30 100 Z" fill={tone} />
      <path d="M18 8 L28 20 L30 100 L24 100 L22 24 Z" fill="#8d82a6" opacity="0.25" />
    </g>
  );
}

function wastes(uid: string, s: number): DrawLayer[] {
  const mesa = ridge(91, 6, 56, 64, false);
  const out: DrawLayer[] = [
    { id: 'sky', z: 0, depth: 0, node: <Sky uid={uid} stops={[[0, '#272433'], [0.55, '#55506a'], [1, '#a59ab0']]} /> },
    {
      id: 'mesas',
      z: 2,
      depth: 0.2,
      node: (
        <Full>
          <path d={mesa.d} fill="#4c4559" />
        </Full>
      ),
    },
    {
      id: 'ground',
      z: 3,
      depth: 0.5,
      node: (
        <Full>
          <defs>
            <Grad id={`${uid}-dust`} stops={[[0, '#77707f'], [1, '#383341']]} />
          </defs>
          <rect y="68" width="400" height="32" fill={`url(#${uid}-dust)`} />
          <path d="M20 84 l18 3 l10 -2 l16 5 M120 78 l14 4 l12 -3 l20 6 l8 -2 M230 90 l16 -3 l14 4 l18 -2 M310 80 l12 3 l18 -1 l10 4" fill="none" stroke="#2a2531" strokeWidth="0.9" vectorEffect="non-scaling-stroke" />
        </Full>
      ),
    },
  ];
  if (s >= 2) {
    out.push({
      id: 'stones',
      z: 5,
      depth: 0.8,
      node: (
        <>
          <Obj x={16} b={8} h={70} vb={[40, 100]}>
            <Stone />
          </Obj>
          <Obj x={24} b={10} h={48} vb={[40, 100]} flip>
            <Stone tone="#38324a" />
          </Obj>
          {s >= 3 && (
            <Obj x={74} b={6} h={62} vb={[40, 100]}>
              <Stone />
            </Obj>
          )}
        </>
      ),
    });
  }
  if (s >= 3) {
    out.push({
      id: 'shards',
      z: 6,
      depth: 0.6,
      node: (
        <>
          {[
            [40, 52, 0],
            [52, 64, 1.5],
            [62, 48, 2.6],
          ].map(([x, b, d], i) => (
            <span key={i} className="scn-obj scn-bob" style={{ left: `${x}%`, bottom: `${b}%`, height: '16%', aspectRatio: '1 / 2', animationDelay: `-${d}s` }}>
              <svg viewBox="0 0 10 20" aria-hidden="true">
                <path d="M5 0 L10 8 L5 20 L0 9 Z" fill="#c8b8ef" opacity="0.85" />
                <path d="M5 0 L10 8 L5 20 Z" fill="#8e7cc0" opacity="0.8" />
              </svg>
            </span>
          ))}
        </>
      ),
    });
  }
  if (s >= 4) {
    out.push({
      id: 'ring',
      z: 4,
      depth: 0.3,
      node: (
        <Obj x={38} b={22} h={80} vb={[100, 60]} className="scn-pulse">
          <ellipse cx="50" cy="30" rx="44" ry="24" fill="none" stroke="#cbbcf5" strokeWidth="1.6" opacity="0.7" />
          <ellipse cx="50" cy="30" rx="38" ry="19" fill="none" stroke="#9f8fd8" strokeWidth="0.8" opacity="0.6" />
        </Obj>
      ),
    });
  }
  return out;
}

const DRAW: Record<Biome, (uid: string, stage: number) => DrawLayer[]> = { island, swamp, mountain, forest, plains, wastes };

/** The procedural layers of a biome at a stage (stage 0: the withered base only). */
export function proceduralLayers(biome: Biome, stage: number, uid: string): DrawLayer[] {
  return DRAW[biome](uid, Math.max(1, Math.min(4, stage)));
}

// ---------------------------------------------------------------------------
// Effects: the built-in one-shots (spec 1.2 particle presets). Each fills its
// effect box; the colour comes from `--fx-color`, the length from `--fx-ms`
// (scenery.css). Transform and opacity only, plus one short stroke draw for
// the crack. With reduced motion none of these is drawn (a still glow is).

/** A preset's drawing, for an effect box (its aspect is set by the effect). */
export function proceduralEffect(preset: ParticlePreset, uid: string): ReactNode {
  const r = rng(preset.length * 977 + 13);
  switch (preset) {
    case 'shimmer': {
      // A soft column of light rising, with motes lifting off it.
      const motes = Array.from({ length: 10 }, (_, i) => ({ x: 22 + r() * 76, y: 60 + r() * 30, s: 0.9 + r() * 1.6, d: f1(i * 0.035 + r() * 0.05), dx: f1((r() - 0.5) * 14) }));
      return (
        <svg className="scn-fx-svg" viewBox="0 0 120 100" preserveAspectRatio="xMidYMax meet" aria-hidden="true">
          <defs>
            <radialGradient id={`${uid}-sh`} cx="0.5" cy="0.62" r="0.5">
              <stop offset="0" stopColor="#fff" stopOpacity="0.95" />
              <stop offset="0.35" style={{ stopColor: 'var(--fx-color)' }} stopOpacity="0.7" />
              <stop offset="1" style={{ stopColor: 'var(--fx-color)' }} stopOpacity="0" />
            </radialGradient>
            <linearGradient id={`${uid}-shl`} x1="0" y1="1" x2="0" y2="0">
              <stop offset="0" stopColor="#fff" stopOpacity="0" />
              <stop offset="0.5" stopColor="#fff" stopOpacity="0.8" />
              <stop offset="1" stopColor="#fff" stopOpacity="0" />
            </linearGradient>
          </defs>
          <ellipse className="scn-p-rise" cx="60" cy="66" rx="52" ry="40" fill={`url(#${uid}-sh)`} />
          {[42, 60, 78].map((x, i) => (
            <rect key={x} className="scn-p-ray" x={x - 0.6} y={18 + i * 6} width="1.2" height={58 - i * 8} fill={`url(#${uid}-shl)`} style={{ '--d': `${i * 0.08}` } as CSSProperties} />
          ))}
          {motes.map((m, i) => (
            <circle key={i} className="scn-p-mote" cx={f1(m.x)} cy={f1(m.y)} r={f1(m.s)} fill="#fff" style={{ '--d': m.d, '--dx': `${m.dx}px` } as CSSProperties} />
          ))}
        </svg>
      );
    }
    case 'sweep': {
      // A crescent of light driving toward the other side, with streaks behind it.
      const streaks = Array.from({ length: 6 }, (_, i) => ({ x: 30 + i * 20 + r() * 8, h: 18 + r() * 22, d: f1(r() * 0.2) }));
      return (
        <svg className="scn-fx-svg" viewBox="0 0 160 100" preserveAspectRatio="xMidYMax meet" aria-hidden="true">
          <defs>
            <linearGradient id={`${uid}-sw`} x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" style={{ stopColor: 'var(--fx-color)' }} stopOpacity="0" />
              <stop offset="0.5" stopColor="#fff" stopOpacity="1" />
              <stop offset="1" style={{ stopColor: 'var(--fx-color)' }} stopOpacity="0" />
            </linearGradient>
            <linearGradient id={`${uid}-sws`} x1="0" y1="1" x2="0" y2="0">
              <stop offset="0" style={{ stopColor: 'var(--fx-color)' }} stopOpacity="0" />
              <stop offset="1" style={{ stopColor: 'var(--fx-color)' }} stopOpacity="0.85" />
            </linearGradient>
          </defs>
          <g className="scn-p-sweep">
            <path d="M8 74 Q80 22 152 74" fill="none" stroke={`url(#${uid}-sw)`} strokeWidth="12" strokeLinecap="round" opacity="0.35" />
            <path d="M14 72 Q80 28 146 72" fill="none" stroke={`url(#${uid}-sw)`} strokeWidth="3.2" strokeLinecap="round" />
          </g>
          {streaks.map((s, i) => (
            <rect key={i} className="scn-p-streak" x={f1(s.x)} y={f1(96 - s.h)} width="1.4" height={f1(s.h)} fill={`url(#${uid}-sws)`} style={{ '--d': s.d } as CSSProperties} />
          ))}
        </svg>
      );
    }
    case 'flash':
      // Red into gold, swelling from the strip's ground, and gone.
      return (
        <svg className="scn-fx-svg" viewBox="0 0 600 100" preserveAspectRatio="none" aria-hidden="true">
          <defs>
            <radialGradient id={`${uid}-fl`} cx="0.5" cy="1" r="0.6">
              <stop offset="0" stopColor="#ffd27a" stopOpacity="0.95" />
              <stop offset="0.4" stopColor="#e2452e" stopOpacity="0.6" />
              <stop offset="1" stopColor="#7a1010" stopOpacity="0" />
            </radialGradient>
            <linearGradient id={`${uid}-fle`} x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stopColor="#ffcf6a" stopOpacity="0" />
              <stop offset="0.5" stopColor="#fff1c2" stopOpacity="1" />
              <stop offset="1" stopColor="#ffcf6a" stopOpacity="0" />
            </linearGradient>
          </defs>
          <rect className="scn-p-flash" width="600" height="100" fill={`url(#${uid}-fl)`} />
          <rect className="scn-p-edge" x="0" y="95" width="600" height="5" fill={`url(#${uid}-fle)`} />
        </svg>
      );
    case 'crack':
      // A gold crack splitting up from the ground, over a red ember glow.
      return (
        <svg className="scn-fx-svg" viewBox="0 0 100 100" preserveAspectRatio="xMidYMax meet" aria-hidden="true">
          <defs>
            <radialGradient id={`${uid}-cr`} cx="0.5" cy="0.7" r="0.5">
              <stop offset="0" stopColor="#ffb347" stopOpacity="0.85" />
              <stop offset="0.5" stopColor="#d23b26" stopOpacity="0.45" />
              <stop offset="1" stopColor="#d23b26" stopOpacity="0" />
            </radialGradient>
          </defs>
          <ellipse className="scn-p-ember" cx="50" cy="70" rx="44" ry="34" fill={`url(#${uid}-cr)`} />
          <g className="scn-p-crack" fill="none" stroke="#fff0c0" strokeLinecap="round" strokeLinejoin="round">
            <path d="M50 98 L46 82 L55 70 L47 56 L56 42 L50 26" strokeWidth="2.4" pathLength={1} />
            <path d="M55 70 L67 64 L74 52" strokeWidth="1.6" pathLength={1} />
            <path d="M47 56 L36 50 L31 38" strokeWidth="1.4" pathLength={1} />
          </g>
        </svg>
      );
    case 'motes': {
      const motes = Array.from({ length: 14 }, (_, i) => ({ x: 8 + r() * 104, y: 50 + r() * 46, s: 0.8 + r() * 1.8, d: f1(i * 0.015 + r() * 0.08), dx: f1((r() - 0.5) * 24) }));
      return (
        <svg className="scn-fx-svg" viewBox="0 0 120 100" preserveAspectRatio="xMidYMax meet" aria-hidden="true">
          {motes.map((m, i) => (
            <circle key={i} className="scn-p-mote" cx={f1(m.x)} cy={f1(m.y)} r={f1(m.s)} style={{ fill: i % 3 ? 'var(--fx-color)' : '#fff', '--d': m.d, '--dx': `${m.dx}px` } as CSSProperties} />
          ))}
        </svg>
      );
    }
    case 'ripple':
      return (
        <svg className="scn-fx-svg" viewBox="0 0 200 100" preserveAspectRatio="xMidYMax meet" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <ellipse key={i} className="scn-p-ring" cx="100" cy="82" rx="80" ry="16" fill="none" strokeWidth="1.6" style={{ stroke: i === 1 ? '#fff' : 'var(--fx-color)', '--d': `${i * 0.12}` } as CSSProperties} />
          ))}
        </svg>
      );
  }
}

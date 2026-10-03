/*
 * ForgeCoach — draft/rng.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * A seeded random generator, ported from mtg-table's cube lab
 * (tools/cubelab/rng.ts, GPL-3.0-or-later, Copyright (C) 2026 mtg-table
 * contributors; see NOTICE). sfc32 seeded through splitmix32, so a draft is a
 * pure function of its seed: the same seed deals the same cards here and in
 * the lab. Math.random is never used for a deal.
 */

export interface Rng {
  /** A float in [0, 1). */
  next(): number;
  /** An integer in [0, n). */
  int(n: number): number;
}

function splitmix32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x9e3779b9) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 16), 0x21f0aaad);
    t = Math.imul(t ^ (t >>> 15), 0x735a2d97);
    return (t ^ (t >>> 15)) >>> 0;
  };
}

/** A generator for `seed` and an optional stream name (so two uses of one seed never share draws). */
export function rng(seed: number, stream = ''): Rng {
  let h = Math.floor(seed) >>> 0;
  for (let i = 0; i < stream.length; i++) h = Math.imul(h ^ stream.charCodeAt(i), 0x01000193) >>> 0;
  const sm = splitmix32(h ^ Math.floor(seed / 0x100000000));
  let a = sm(),
    b = sm(),
    c = sm(),
    d = sm();
  const next = (): number => {
    a >>>= 0;
    b >>>= 0;
    c >>>= 0;
    d >>>= 0;
    const t = (((a + b) >>> 0) + d) >>> 0;
    d = (d + 1) >>> 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) >>> 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) >>> 0;
    return t / 4294967296;
  };
  for (let i = 0; i < 12; i++) next();
  return { next, int: (n: number) => Math.floor(next() * n) };
}

/** Fisher-Yates, in place, and returned. */
export function shuffle<T>(arr: T[], r: Rng): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = r.int(i + 1);
    const tmp = arr[i] as T;
    arr[i] = arr[j] as T;
    arr[j] = tmp;
  }
  return arr;
}

/** A fresh seed for a new draft (the one place a draft touches non-seeded randomness). */
export function newSeed(): number {
  return Math.floor(Math.random() * 0x7fffffff) + 1;
}

/*
 * ForgeCoach — bench/benchFiles.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Node-only file access for the coach bench (bench/coach/): case files, the
 * frame logs they point at, and the card-text snapshot. Used by the CLI and
 * by the dry-run test; never imported by the app.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { parseLog, type GameLog } from '../log.ts';
import type { CardInfo } from '../cards.ts';
import { buildCase, validateCase, type BenchCase, type BuiltCase } from './coachBench.ts';

export const BENCH_DIR = 'bench/coach';
export const CASES_DIR = `${BENCH_DIR}/cases`;
export const LOGS_DIR = `${BENCH_DIR}/logs`;
export const CARDS_FILE = `${BENCH_DIR}/cards.json`;
export const RESULTS_DIR = `${BENCH_DIR}/results`;

/** Reads a frame log, gunzipping when the bytes are gzip. */
export function readLogFile(path: string): GameLog {
  const bytes = readFileSync(path);
  const text = bytes[0] === 0x1f && bytes[1] === 0x8b ? gunzipSync(bytes).toString('utf8') : bytes.toString('utf8');
  return parseLog(text);
}

/** The card-text snapshot: Forge name → CardInfo (image URLs dropped). */
export function readCards(root: string): Map<string, CardInfo> {
  const file = join(root, CARDS_FILE);
  if (!existsSync(file)) return new Map();
  const raw = JSON.parse(readFileSync(file, 'utf8')) as Record<string, CardInfo>;
  return new Map(Object.entries(raw));
}

export function writeCards(root: string, cards: Map<string, CardInfo>): void {
  const out: Record<string, CardInfo> = {};
  for (const [k, v] of [...cards].sort(([a], [b]) => a.localeCompare(b))) {
    const { image: _i, scryfallUri: _u, ...rest } = v;
    const faces = rest.faces?.map(({ image: _f, ...f }) => f);
    out[k] = faces ? { ...rest, faces } : rest;
  }
  writeFileSync(join(root, CARDS_FILE), JSON.stringify(out, null, 1) + '\n');
}

export interface LoadedCase {
  file: string;
  value?: BenchCase;
  errors: string[];
}

/** Every case file, validated (sorted by file name). */
export function readCases(root: string): LoadedCase[] {
  const dir = join(root, CASES_DIR);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => {
      const file = join(CASES_DIR, f);
      try {
        const v = validateCase(JSON.parse(readFileSync(join(root, file), 'utf8')));
        if (!v.ok) return { file, errors: v.errors };
        if (`${v.value.id}.json` !== f) return { file, value: v.value, errors: [`file name should be ${v.value.id}.json`] };
        return { file, value: v.value, errors: [] };
      } catch (e) {
        return { file, errors: [`not JSON: ${e instanceof Error ? e.message : String(e)}`] };
      }
    });
}

/** Parses each log once. */
export class LogCache {
  private m = new Map<string, GameLog>();
  constructor(private root: string) {}
  get(path: string): GameLog {
    let l = this.m.get(path);
    if (!l) this.m.set(path, (l = readLogFile(resolve(this.root, path))));
    return l;
  }
}

/** Builds every valid case; collects per-case errors instead of throwing. */
export function buildAll(root: string, cases: BenchCase[], cards: Map<string, CardInfo>): { built: BuiltCase[]; errors: { id: string; error: string }[] } {
  const logs = new LogCache(root);
  const built: BuiltCase[] = [];
  const errors: { id: string; error: string }[] = [];
  for (const c of cases) {
    try {
      built.push(buildCase(c, logs.get(c.log), cards));
    } catch (e) {
      errors.push({ id: c.id, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return { built, errors };
}

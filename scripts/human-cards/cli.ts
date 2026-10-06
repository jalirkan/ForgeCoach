/*
 * ForgeCoach — scripts/human-cards/cli.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * `npm run human-cards -- --updated YYYY-MM-DD GAME_DATA.csv.gz [MORE.csv.gz …] [--min-gih 500] [--dry-run]
 *   [--half 0|1 --out DIR]`
 * (launched by run.mjs). Reads local copies of 17Lands' public game data (the
 * Powered Cube files on https://www.17lands.com/public_datasets; download them
 * first, see README § Human card data), matches every cube in public/cubes/ by
 * card name and writes `public/cubes/<file>.human.json` for each cube with at
 * least MIN_COVERAGE of its cards above the games threshold. Prints the
 * coverage of every cube. `--updated` is the dataset's "Last Updated" date on
 * 17Lands' page. `--half 0|1` counts only the drafts in that half (stats.ts
 * `halfOf`, for docs/human-blend.md's split-half test) and writes
 * `<file>.human.half<N>.json` into `--out` instead of public/cubes.
 */
import { createReadStream, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { createInterface } from 'node:readline';
import { createGunzip } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { CUBES } from '../../src/cube/cubes.ts';
import { parseCube } from '../../src/cube/parseCube.ts';
import type { HumanSource } from '../../src/cube/human.ts';
import { coverage, GameCounter, humanFile, MIN_COVERAGE, MIN_GIH, splitCsvLine } from './stats.ts';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

async function readFile(path: string, counter: GameCounter): Promise<void> {
  const input = createReadStream(path);
  const lines = createInterface({ input: path.endsWith('.gz') ? input.pipe(createGunzip()) : input, crlfDelay: Infinity });
  let first = true;
  for await (const line of lines) {
    if (!line) continue;
    const cells = splitCsvLine(line);
    if (first) {
      counter.header(cells);
      first = false;
    } else counter.row(cells);
  }
}

const DATASET = /^game_data_public\.(.+)\.(PremierDraft|TradDraft|[A-Za-z]+)\.csv(\.gz)?$/;

export async function main(argv: string[]): Promise<number> {
  const files: string[] = [];
  let updated = '';
  let minGih = MIN_GIH;
  let dry = false;
  let half: 0 | 1 | null = null;
  let out = '';
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--updated') updated = argv[++i] ?? '';
    else if (a === '--min-gih') minGih = Number(argv[++i]);
    else if (a === '--dry-run') dry = true;
    else if (a === '--half') {
      const h = argv[++i];
      if (h !== '0' && h !== '1') {
        console.error('human-cards: --half takes 0 or 1');
        return 2;
      }
      half = h === '0' ? 0 : 1;
    } else if (a === '--out') out = argv[++i] ?? '';
    else files.push(a);
  }
  if (!files.length || !/^\d{4}-\d{2}-\d{2}$/.test(updated) || !(minGih > 0)) {
    console.error('usage: npm run human-cards -- --updated YYYY-MM-DD game_data_public.<set>.<event>.csv.gz … [--min-gih 500] [--dry-run]');
    return 2;
  }
  if (half !== null && !out) {
    console.error('human-cards: --half needs --out DIR (a half never goes into public/cubes)');
    return 2;
  }
  const sets = new Set(files.map((f) => DATASET.exec(basename(f))?.[1] ?? '?'));
  if (sets.size !== 1 || sets.has('?')) {
    console.error('human-cards: give the game-data files of one 17Lands dataset (game_data_public.<set>.<event>.csv.gz).');
    return 2;
  }
  const counter = new GameCounter(half);
  for (const f of files) {
    console.log(`reading ${f}…`);
    await readFile(f, counter);
  }
  const s = counter.stats;
  console.log(`${s.games} games (${Object.entries(s.events).map(([e, n]) => `${e || '?'} ${n}`).join(', ')}), ${s.badRows} rows skipped, ${s.cards.size} card columns, win rate ${((100 * s.wins) / s.games).toFixed(1)}%`);
  if (half !== null) console.log(`half ${half}: ${s.otherHalf} games in the other half, ${s.noDraftId} with no draft id`);
  const set = [...sets][0]!;
  const source: HumanSource = {
    name: '17Lands',
    page: 'https://www.17lands.com/public_datasets',
    licence: 'CC BY 4.0',
    licenceUrl: 'https://creativecommons.org/licenses/by/4.0/',
    dataset: set.replace(/^Cube_-_(.+)$/, '$1 Cube').replace(/_/g, ' '),
    files: files.map((f) => basename(f)),
    updated,
    changes: `Per-card games and wins aggregated from the game data${half !== null ? ` (half ${half} of the drafts by draft id)` : ''}; matched to this cube by card name; cards with fewer than ${minGih} games in hand left out.`,
  };
  const generated = new Date().toISOString().slice(0, 10);
  for (const info of CUBES) {
    const cube = parseCube(readFileSync(join(ROOT, 'public/cubes', `${info.file}.md`), 'utf8'));
    const doc = { file: `${info.file}.md`, title: cube.title, names: cube.cards.map((c) => c.name) };
    const { cov } = coverage(s, doc, minGih);
    const share = cov.matched / cov.cards;
    // A half is for the split-half test of a cube that ships human data, whatever its coverage.
    const write = half !== null ? !!info.humanData : share >= MIN_COVERAGE;
    console.log(`${info.id.padEnd(12)} ${cov.cards} cards, ${cov.inData} in the data, ${cov.matched} with ${minGih}+ games in hand (${Math.round(share * 100)}%)${write ? (dry ? ' — would write' : ' — written') : ''}`);
    if (write && !dry) {
      const file = humanFile(s, doc, source, generated, minGih);
      const path = half !== null ? join(out, `${info.file}.human.half${half}.json`) : join(ROOT, 'public/cubes', `${info.file}.human.json`);
      writeFileSync(path, `${JSON.stringify(file, null, 0).replace(/("[^"]+":\{"gih")/g, '\n$1')}\n`);
    }
  }
  return 0;
}

// ForgeCoach — scripts/card-power.ts
// SPDX-License-Identifier: GPL-3.0-or-later
//
// Writes public/cubes/card-power.json from mtg-table's J062 power.tsv (the matchup
// model M0's card strengths; src/cube/cardPower.ts has the schema):
//
//   git -C ../mtg-table show origin/pc-results:results/J062/power.tsv > src/cube/testdata/J062-power.tsv
//   node scripts/card-power.ts src/cube/testdata/J062-power.tsv --job J062 --nights 1-2 > public/cubes/card-power.json
//
// Node 22.18+ (type stripping). src/cube/cardPower.test.ts checks the committed JSON is this
// script's output for the committed TSV.
import fs from 'node:fs';
import { fromPowerTsv, parseCardPower } from '../src/cube/cardPower.ts';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
const opt = (k: string): string | undefined => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : undefined; };
if (!file) {
  console.error('usage: node scripts/card-power.ts <power.tsv> --job J062 --nights 1-2 > public/cubes/card-power.json');
  process.exit(2);
}
const out = fromPowerTsv(fs.readFileSync(file, 'utf8'), { job: opt('job') ?? 'J062', nights: opt('nights') ?? '1-2' });
const check = parseCardPower(out);
if (check.dropped) throw new Error(`${check.dropped} row(s) do not validate`);
process.stdout.write(`${cardPowerJson(out)}\n`);

/** One card per line: small diffs when the lab writes a new table. */
function cardPowerJson(o: Record<string, unknown>): string {
  const { cards, ...head } = o as { cards: Record<string, unknown> };
  const rows = Object.entries(cards).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)}`);
  const top = JSON.stringify(head).slice(0, -1);
  return `${top},\n "cards": {\n${rows.join(',\n')}\n}}`;
}

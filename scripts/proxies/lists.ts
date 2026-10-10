// SPDX-License-Identifier: GPL-3.0-or-later
// Writes docs/proxies/<cube>.txt — one "1 <Card Name>" line per card, the form
// MPC Autofill (mpcfill.com) and most proxy printers paste in — and prints how
// many cards each cube has and which are two-sided (need a printed back).
// Run: node --experimental-transform-types scripts/proxies/lists.ts
import { readFileSync, writeFileSync } from 'node:fs';
import { CUBES } from '../../src/cube/cubes.ts';
import { parseCube } from '../../src/cube/parseCube.ts';

type Face = { name?: string; mana_cost?: string; type_line?: string };
type Sf = { name: string; card_faces?: Face[] };

const root = new URL('../../', import.meta.url);
for (const info of CUBES) {
  const cube = parseCube(readFileSync(new URL(`public/cubes/${info.file}.md`, root), 'utf8'));
  const snap = JSON.parse(readFileSync(new URL(`src/cube/testdata/scryfall-${info.id}.json`, root), 'utf8')) as Sf[];
  const byName = new Map<string, Sf>();
  for (const c of snap) {
    byName.set(c.name, c);
    for (const f of c.card_faces ?? []) if (f.name && !byName.has(f.name)) byName.set(f.name, c);
  }
  // A back face with no mana cost (transform, saga, MDFC land) is printed on its own side;
  // adventures and split cards share one face.
  const twoSided = cube.cards.filter((c) => (byName.get(c.name)?.card_faces ?? []).slice(1).some((f) => !f.mana_cost));
  const lines = cube.cards.map((c) => `1 ${c.name}`);
  writeFileSync(new URL(`docs/proxies/${info.id}.txt`, root), lines.join('\n') + '\n');
  console.log(`${info.id}\t${cube.cards.length}\ttwo-sided ${twoSided.length}: ${twoSided.map((c) => c.name).join('; ')}`);
}

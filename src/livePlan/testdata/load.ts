// SPDX-License-Identifier: GPL-3.0-or-later
// Test helpers: real plan-mode moments recorded by mtg-table's LLM seat (D419) —
// the seat's frame logs, Sonnet's real replies, the user message it was sent —
// and card text from the Scryfall snapshots the cube tests already use.
import { readFileSync, readdirSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { parseLog, type GameLog } from '../../log.ts';
import { mapScryfallCard, type CardInfo, type ScryfallCard } from '../../cards.ts';
import type { AskBody, GameStateBody, InputBody } from '../../protocol.ts';
import type { Snapshot } from '../coach.ts';
import { visibleNames } from '../history.ts';

export interface RecordedMoment {
  log: string;
  run: string;
  momentNo: number;
  moment: string;
  frameSeq: number;
  turn: number;
  phase: string | null;
  question: string;
  reply: string;
  steps: string[];
  plan: string;
  failed: { step: number; text: string; reason: string } | null;
  recordedUser: string;
}

const here = (p: string) => new URL(p, import.meta.url);

export const MOMENTS: RecordedMoment[] = (JSON.parse(readFileSync(here('./moments.json'), 'utf8')) as { moments: RecordedMoment[] }).moments;

const logs = new Map<string, GameLog>();
export function loadLog(name: string): GameLog {
  let l = logs.get(name);
  if (!l) logs.set(name, (l = parseLog(gunzipSync(readFileSync(here(`./${name}.jsonl.gz`))).toString('utf8'))));
  return l;
}

/** Every card of the cube snapshots, by name and by face name. */
let index: Map<string, ScryfallCard> | null = null;
function scryfall(): Map<string, ScryfallCard> {
  if (index) return index;
  index = new Map();
  const dir = here('../../cube/testdata/');
  for (const f of readdirSync(dir).filter((x) => /^scryfall-.*\.json$/.test(x)).sort()) {
    for (const c of JSON.parse(readFileSync(new URL(f, dir), 'utf8')) as ScryfallCard[]) {
      if (c.name && !index.has(c.name)) index.set(c.name, c);
      for (const face of c.card_faces ?? []) if (face.name && !index.has(face.name)) index.set(face.name, c);
    }
  }
  return index;
}

/**
 * Scryfall cards the cube snapshots do not hold (the monarch is a designation, not a cube card;
 * its text as Scryfall's "The Monarch" card has it).
 */
const EXTRA: Record<string, ScryfallCard> = {
  'The Monarch': {
    name: 'The Monarch',
    type_line: 'Card',
    oracle_text: 'At the beginning of your end step, draw a card.\nWhenever a creature deals combat damage to you, its controller becomes the monarch.',
  } as ScryfallCard,
};

/** Card data for names, as cards.ts would give it (a name the snapshots lack is not found). */
export function cardsFor(names: readonly string[]): Map<string, CardInfo> {
  const out = new Map<string, CardInfo>();
  for (const n of names) {
    const c = scryfall().get(n) ?? EXTRA[n];
    out.set(n, c ? mapScryfallCard(n, c) : { name: n, found: false, manaCost: '', typeLine: '', oracleText: '', producedMana: [], colors: [] });
  }
  return out;
}

/** The snapshot a recorded moment was decided at: the state before its frame, and its input or ask. */
export function snapshotOf(m: RecordedMoment): { log: GameLog; snap: Snapshot; seat: number } {
  const log = loadLog(m.log);
  const at = log.frames.findIndex((f) => f.seq === m.frameSeq && f.dir !== 'c2s' && (f.type === 'input' || f.type === 'ask'));
  if (at < 0) throw new Error(`no frame ${m.frameSeq} in ${m.log}`);
  let si = at;
  while (si >= 0 && log.frames[si]!.type !== 'state') si--;
  const state = log.frames[si]!.body as GameStateBody;
  const f = log.frames[at]!;
  // the ask's input is the last input before it (a question asked over an input)
  let input: InputBody | null = null;
  let ask: AskBody | null = null;
  if (f.type === 'ask') ask = f.body as AskBody;
  else input = f.body as InputBody;
  return { log, snap: { frameIndex: si, state, input, ask }, seat: log.seat };
}

export function cardsAt(snap: Snapshot): Map<string, CardInfo> {
  return cardsFor(visibleNames(snap.state));
}

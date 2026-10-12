/*
 * ForgeCoach — engineText.test.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Nothing the player reads names a card by an engine id (common-sense pass
 * items 1, 3, 11): the cleaning itself, then the class — every input prompt
 * (the decision slot), every ask (the dialog), every stack item and every
 * Game Log line of every recorded game in the repository, drawn the way the
 * board draws it, is searched for an id.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { withBoardNames, withoutEngineIds } from './engineText.ts';
import { parseLog, type GameLog } from './log.ts';
import { gameEventLog, lineText } from './eventLog.ts';
import type { AskBody, GameStateBody, InputBody } from './protocol.ts';
import { describeInput, noticeLine } from './ui/play/inputView.ts';
import { displayAsk } from './ui/play/askModel.ts';
import { stackEntries, stackText } from './ui/stackModel.ts';

const ID = /\(\d+\)|#\d|\[\d+\]|\[\[|\w=\d/;

describe('withBoardNames: the engine’s sentences name the seats as the board does', () => {
  const seats = [
    { engine: 'Human', board: 'You', you: true },
    { engine: 'Forge AI', board: 'Search AI', you: false },
  ];
  it('you, with the verb agreeing; the bot by its picked name', () => {
    expect(withBoardNames('Human puts a +1/+1 counter on Carrion Feeder.', seats)).toBe('You put a +1/+1 counter on Carrion Feeder.');
    expect(withBoardNames('Forge AI searches their library for a basic Mountain.', seats)).toBe('Search AI searches their library for a basic Mountain.');
    expect(withBoardNames('Pym Particles - Peggy Carter gains vigilance until end of turn.  Human draws a card.', seats)).toBe('Pym Particles - Peggy Carter gains vigilance until end of turn.  You draw a card.');
    expect(withBoardNames('Opt - Human scries 1. Human draws a card.', seats)).toBe('Opt - You scry 1. You draw a card.');
    // the label is also a creature type: left alone outside the subject of a sentence
    expect(withBoardNames('Create a 1/1 white Human Soldier creature token. Target Human creature gets +1/+1.', seats)).toBe('Create a 1/1 white Human Soldier creature token. Target Human creature gets +1/+1.');
    expect(withBoardNames('Human creatures you control get +1/+1.', seats)).toBe('Human creatures you control get +1/+1.');
    expect(withBoardNames('Exile the top card of Human’s library.', seats)).toBe('Exile the top card of your library.');
    expect(withBoardNames('Target creature Forge AI controls', seats)).toBe('Target creature Search AI controls');
  });
});

describe('withoutEngineIds', () => {
  it('takes the ids out and leaves the numbers that mean something', () => {
    expect(withoutEngineIds('Opt (12) - Human scries 1. Human draws a card.\n\nPay Mana Cost: {U}')).toBe('Opt - Human scries 1. Human draws a card.\n\nPay Mana Cost: {U}');
    expect(withoutEngineIds('Select creatures to block Thallid (41) or select another attacker to declare blockers for.')).toBe(
      'Select creatures to block Thallid or select another attacker to declare blockers for.',
    );
    expect(withoutEngineIds('Seismic Takedown — tap target land. (Targeting: [[Island (38)]])')).toBe('Seismic Takedown — tap target land. (Targeting: Island)');
    expect(withoutEngineIds('March of Otherworldly Light (92) - Exile Cat Soldier Token (299). (Exiled=0)')).toBe('March of Otherworldly Light - Exile Cat Soldier Token.');
    expect(withoutEngineIds('block Construct Token #297 with Phyrexian Myr Token')).toBe('block Construct Token with Phyrexian Myr Token');
    expect(withoutEngineIds('(2 more can be targeted)')).toBe('(2 more can be targeted)');
    expect(withoutEngineIds('Discard 1 card(s)')).toBe('Discard 1 card(s)');
    expect(withoutEngineIds('Pay Mana Cost: {18}')).toBe('Pay Mana Cost: {18}');
    expect(withoutEngineIds('Forest (TRK)')).toBe('Forest (TRK)');
  });
});

function logs(): { name: string; log: GameLog }[] {
  const out: { name: string; log: GameLog }[] = [];
  for (const dir of ['../public/samples/', '../bench/coach/logs/']) {
    const base = new URL(dir, import.meta.url);
    for (const f of readdirSync(base)) if (f.endsWith('.jsonl.gz')) out.push({ name: f, log: parseLog(gunzipSync(readFileSync(new URL(f, base))).toString('utf8')) });
  }
  return out;
}

function strings(v: unknown, keys: ReadonlySet<string>, key: string | null = null, out: string[] = []): string[] {
  if (typeof v === 'string') {
    if (key && keys.has(key)) out.push(v);
  } else if (Array.isArray(v)) for (const x of v) strings(x, keys, key, out);
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) if (k !== 'card' && k !== 'cards') strings(x, keys, k, out);
  return out;
}

describe('no engine id anywhere the player reads, in every recorded game', () => {
  const all = logs();

  it('has recordings to read', () => {
    expect(all.length).toBeGreaterThan(3);
  });

  it('the decision slot: title, the line under it, the engine row, what a payment is for', () => {
    const leaks: string[] = [];
    let raw = 0;
    for (const { name, log } of all) {
      let state: GameStateBody | null = null;
      for (const f of log.frames) {
        if (f.type === 'state') state = f.body as GameStateBody;
        if (f.type !== 'input') continue;
        if (ID.test((f.body as InputBody).prompt)) raw++;
        const v = describeInput(f.body as InputBody, state, log.seat);
        for (const s of [v.title, v.detail, v.engineText, v.payFor]) if (s && ID.test(s)) leaks.push(`${name}: ${s}`);
      }
    }
    // the engine's own prompts do carry ids: the scan has something to catch
    expect(raw).toBeGreaterThan(20);
    expect(leaks).toEqual([]);
  });

  it('the ask dialog: every prompt, title and option label', () => {
    const leaks: string[] = [];
    let asks = 0;
    for (const { name, log } of all)
      for (const f of log.frames) {
        if (f.type !== 'ask') continue;
        asks++;
        for (const s of strings(displayAsk(f.body as AskBody), new Set(['prompt', 'title', 'label', 'destLabel', 'message', 'question']))) if (ID.test(s)) leaks.push(`${name}: ${s}`);
      }
    expect(asks).toBeGreaterThan(0);
    expect(leaks).toEqual([]);
  });

  it('the stack panel and the Game Log', () => {
    const leaks: string[] = [];
    for (const { name, log } of all) {
      for (const f of log.frames) {
        if (f.type !== 'state') continue;
        for (const e of stackEntries(f.body as GameStateBody, log.seat)) {
          const t = stackText(e);
          if (ID.test(t)) leaks.push(`${name} stack: ${t}`);
        }
      }
      for (const t of gameEventLog(log)) for (const l of t.lines) if (ID.test(lineText(l))) leaks.push(`${name} log: ${lineText(l)}`);
    }
    expect(leaks).toEqual([]);
  });

  it('a notice for an id the board does not show says "a card"', () => {
    expect(noticeLine('Not selectable', 'card 31 cannot be selected now', null)).toBe('Not selectable — a card cannot be selected now');
  });
});

/*
 * ForgeCoach — faceDown.test.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The client's own check on a face-down card's face (mtg-table D371): in play,
 * only its controller keeps `alt`; in exile, the bridge's look permission
 * (Gonti, Thief of Sanity) stands. Checked on the module, on every reader that
 * takes frames in (a file, a live follow, the seat), and on the coach prompt.
 */
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { altAllowed, guardFaceDown, guardFrame } from './faceDown.ts';
import { parseLog, type LoggedFrame } from './log.ts';
import { LiveLogBuilder } from './live.ts';
import { extractDecisions } from './decisions.ts';
import { buildCoachPrompt, coachCardNames, promptAsText } from './prompt.ts';
import { allCardNames } from './ui/util.ts';
import type { Card, GameStateBody } from './protocol.ts';

const ELVES = { name: 'Llanowar Elves', manaCost: '{G}', types: 'Creature - Elf Druid', power: '1', toughness: '1' };

function faceDown(id: number, zone: string, owner: number, controller: number): Card {
  const inPlay = zone === 'battlefield';
  return {
    id, name: '', setCode: '???', manaCost: null, types: inPlay ? 'Creature' : '',
    power: inPlay ? '2' : null, toughness: inPlay ? '2' : null, loyalty: null, keywords: [],
    damage: 0, counters: {}, tapped: false, sick: false, attacking: false, blocking: false,
    faceDown: true, token: false, alt: { ...ELVES }, attachedToId: null, attachmentIds: [],
    controller, owner, zone, abilities: [],
  } as Card;
}

describe('altAllowed: Forge canFaceDownBeShownTo, the half a log can show', () => {
  it('in play, the face is the controller’s', () => {
    expect(altAllowed(faceDown(1, 'battlefield', 0, 0), 0)).toBe(true);
    expect(altAllowed(faceDown(1, 'battlefield', 1, 1), 0)).toBe(false);
    // A stolen morph: its owner does not see its face.
    expect(altAllowed(faceDown(1, 'battlefield', 0, 1), 0)).toBe(false);
    expect(altAllowed(faceDown(1, 'stack', 1, 1), 0)).toBe(false);
  });
  it('in exile, the bridge’s look permission stands (Gonti’s card is the player’s to cast)', () => {
    expect(altAllowed(faceDown(1, 'exile', 1, 1), 0)).toBe(true);
  });
  it('a face-up card, a redacted stub and a face-down card without alt are left alone', () => {
    expect(altAllowed({ faceDown: false, alt: null, zone: 'battlefield', controller: 1 }, 0)).toBe(true);
    expect(altAllowed({ hidden: true, zone: 'hand', controller: 1 }, 0)).toBe(true);
    expect(altAllowed({ ...faceDown(1, 'battlefield', 1, 1), alt: null }, 0)).toBe(true);
  });
});

describe('guardFaceDown', () => {
  it('drops the alt wherever the card sits, and nothing else', () => {
    const body = {
      players: [{ zones: { battlefield: { count: 2, cards: [faceDown(5, 'battlefield', 1, 1), faceDown(6, 'battlefield', 0, 0)] } } }],
      stackCards: [faceDown(7, 'stack', 1, 1)],
      ask: { options: [{ card: faceDown(5, 'battlefield', 1, 1) }] },
    };
    const out = guardFaceDown(body, 0);
    expect(out).not.toBe(body);
    expect(out.players[0]!.zones.battlefield.cards[0]!.alt).toBeNull();
    expect(out.players[0]!.zones.battlefield.cards[1]!.alt).toEqual(ELVES);
    expect(out.stackCards[0]!.alt).toBeNull();
    expect(out.ask.options[0]!.card.alt).toBeNull();
    expect(JSON.stringify(out)).not.toContain('"alt":{"name":"Llanowar Elves"},"attachedToId":null,"attachmentIds":[],"controller":1');
    // The input is not mutated.
    expect(body.players[0]!.zones.battlefield.cards[0]!.alt).toEqual(ELVES);
    expect({ ...out.players[0]!.zones.battlefield.cards[0], alt: ELVES }).toEqual(body.players[0]!.zones.battlefield.cards[0]);
  });
  it('returns the very same object when there is nothing to drop', () => {
    const body = { players: [{ zones: { exile: { cards: [faceDown(5, 'exile', 1, 1)] } } }] };
    expect(guardFaceDown(body, 0)).toBe(body);
    const f = { v: 1, seq: 3, t: 0, type: 'state', body, dir: 's2c' } as unknown as LoggedFrame;
    expect(guardFrame(f, 0)).toBe(f);
  });
});

// A real recording with one opponent's face-down permanent planted, alt and all,
// in the frames from the first decision on: what a bridge that got A9 wrong would send.
const GZ = readFileSync(new URL('../public/samples/human-auto-42.jsonl.gz', import.meta.url));
const TEXT = gunzipSync(GZ).toString('utf8');
const SEAT = (JSON.parse(TEXT.split('\n')[0]!) as { seat: number }).seat;
const PLANTED_ID = 99001;

function planted(): string {
  const lines = TEXT.split('\n');
  return lines
    .map((l, i) => {
      if (i === 0 || l.trim() === '') return l;
      const f = JSON.parse(l) as LoggedFrame;
      if (f.type !== 'state') return l;
      const s = f.body as GameStateBody;
      const them = s.players.find((p) => p.id !== SEAT)!;
      them.zones.battlefield.cards.push(faceDown(PLANTED_ID, 'battlefield', them.id, them.id));
      them.zones.battlefield.count = them.zones.battlefield.cards.length;
      return JSON.stringify(f);
    })
    .join('\n');
}

function plantedCard(frames: LoggedFrame[]): Card[] {
  const out: Card[] = [];
  for (const f of frames) {
    if (f.type !== 'state') continue;
    for (const p of (f.body as GameStateBody).players) {
      for (const c of p.zones.battlefield.cards) if (c.id === PLANTED_ID) out.push(c as Card);
    }
  }
  return out;
}

describe('every reader drops an opponent’s face-down face', () => {
  it('a file (parseLog)', () => {
    const log = parseLog(planted());
    const cards = plantedCard(log.frames);
    expect(cards.length).toBeGreaterThan(10);
    expect(cards.every((c) => c.alt === null && c.faceDown && c.name === '')).toBe(true);
    expect(allCardNames(log)).not.toContain('Llanowar Elves');
  });

  it('a live follow (LiveLogBuilder), early frames included', () => {
    const b = new LiveLogBuilder();
    const lines = planted().split('\n').filter((l) => l.trim() !== '');
    for (const l of lines.slice(1)) b.add(JSON.parse(l) as LoggedFrame, true);
    const cards = plantedCard(b.frames);
    expect(cards.length).toBeGreaterThan(10);
    expect(cards.every((c) => c.alt === null)).toBe(true);
  });

  it('the coach prompt never names it', () => {
    const log = parseLog(planted());
    const ds = extractDecisions(log);
    expect(ds.length).toBeGreaterThan(0);
    for (const d of ds.slice(0, 20)) {
      expect(coachCardNames(log, d)).not.toContain('Llanowar Elves');
      const text = promptAsText(buildCoachPrompt(log, d, new Map()));
      expect(text).not.toContain('Llanowar Elves');
    }
  });

  it('the control: the same card under the viewer’s control keeps its face', () => {
    const lines = TEXT.split('\n').map((l, i) => {
      if (i === 0 || l.trim() === '') return l;
      const f = JSON.parse(l) as LoggedFrame;
      if (f.type !== 'state') return l;
      const me = (f.body as GameStateBody).players.find((p) => p.id === SEAT)!;
      me.zones.battlefield.cards.push(faceDown(PLANTED_ID, 'battlefield', me.id, me.id));
      return JSON.stringify(f);
    });
    const log = parseLog(lines.join('\n'));
    const cards = plantedCard(log.frames);
    expect(cards.length).toBeGreaterThan(10);
    expect(cards.every((c) => c.alt?.name === 'Llanowar Elves')).toBe(true);
  });
});

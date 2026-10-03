import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { parseLog, type GameLog } from './log.ts';
import { abilityText, gameEventLog, lineText, phaseSection, sectionsOf, type LogTurn } from './eventLog.ts';
import type { GameStateBody } from './protocol.ts';

function load(name: string): GameLog {
  const bytes = readFileSync(new URL(`../public/samples/${name}.jsonl.gz`, import.meta.url));
  return parseLog(gunzipSync(bytes).toString('utf8'));
}
const auto = load('human-auto-42');
const comfort = load('human-comfort-13');

const textOf = (turns: LogTurn[], turn: number) => turns.find((t) => t.turn === turn)?.lines.map(lineText) ?? [];

describe('gameEventLog', () => {
  const turns = gameEventLog(auto);

  it('groups lines under turn headers, oldest first, with the pre-game first', () => {
    expect(turns[0]!.turn).toBe(0);
    expect(textOf(turns, 0)).toEqual(['Forge AI took a mulligan', 'Forge AI took a mulligan']);
    const nums = turns.map((t) => t.turn);
    expect(nums).toEqual([...nums].sort((a, b) => a - b));
    expect(turns.at(-1)!.turn).toBe(22);
  });

  it('says who played, cast, attacked and blocked, in plain words', () => {
    expect(textOf(turns, 1)).toEqual(['You played Island']);
    expect(textOf(turns, 2)).toEqual(['Forge AI played Plains', 'Forge AI cast S.H.I.E.L.D. Spy Kit']);
    const t13 = textOf(turns, 13);
    expect(t13).toContain('You attacked Forge AI with Quake, Agent of S.H.I.E.L.D. and Aerial Doombot');
    expect(t13).toContain('Soldier Token and Soldier Token blocked Quake, Agent of S.H.I.E.L.D.');
    expect(t13).toContain('Quake, Agent of S.H.I.E.L.D. died');
    expect(t13).toContain('Forge AI lost 1 life (20 → 19)');
    expect(textOf(turns, 14)).toContain('You did not block');
  });

  it('writes tokens, counters, attachments and abilities without engine ids', () => {
    const t12 = textOf(turns, 12);
    expect(t12.filter((l) => l === 'Forge AI created Soldier Token')).toHaveLength(2);
    expect(t12).toContain('S.H.I.E.L.D. Spy Kit ability: Attach to Soldier Token');
    expect(t12).toContain('S.H.I.E.L.D. Spy Kit was attached to Soldier Token');
    expect(textOf(turns, 16)).toContain('Aerial Doombot got 3 +1/+1 counters (now 3)');
    for (const t of turns) for (const l of t.lines) expect(lineText(l)).not.toMatch(/\(\d+\)|#\d/);
  });

  it('files each line under the part of the turn it happened in', () => {
    const t13 = turns.find((t) => t.turn === 13)!;
    const secs = sectionsOf(t13.lines);
    const of = (text: string) => secs.find((s) => s.lines.some((l) => lineText(l) === text))?.section;
    expect(of('You attacked Forge AI with Quake, Agent of S.H.I.E.L.D. and Aerial Doombot')).toBe('Combat');
    expect(of('Forge AI lost 1 life (20 → 19)')).toBe('Combat');
    // Sections come in turn order and never repeat back to back.
    for (let i = 1; i < secs.length; i++) expect(secs[i]!.section).not.toBe(secs[i - 1]!.section);
    expect(turns.find((t) => t.turn === 1)!.lines.every((l) => phaseSection(l.phase) === 'Main phase')).toBe(true);
  });

  it('names the sections', () => {
    expect(['UPKEEP', 'MAIN1', 'COMBAT_DAMAGE', 'MAIN2', 'CLEANUP', null].map(phaseSection)).toEqual([
      'Beginning',
      'Main phase',
      'Combat',
      'Second main',
      'End step',
      'Before the game',
    ]);
  });

  it('ends with the result', () => {
    expect(textOf(turns, 22).at(-1)).toBe('Forge AI won the game');
  });

  it('never names a card the viewing seat could not see', () => {
    // human-comfort-13 T4: the discarded card was revealed by the discard itself.
    expect(textOf(gameEventLog(comfort), 4)).toEqual(['You played Thriving Isle', 'You discarded Wasp, Shrinking Savior']);
    // Draws are never written (the card is hidden at the moment it moves for the opponent).
    for (const t of gameEventLog(comfort)) for (const l of t.lines) expect(lineText(l)).not.toMatch(/drew/);
  });

  it('marks card segments with the card so the drawer can open it', () => {
    const line = turns.find((t) => t.turn === 2)!.lines[1]!;
    const seg = line.segs.find((s) => typeof s !== 'string' && 'card' in s);
    expect(seg && typeof seg !== 'string' && 'card' in seg && seg.card?.name).toBe('S.H.I.E.L.D. Spy Kit');
    expect(line.who).toBe(1);
  });

  it('cuts at a frame for replay', () => {
    const t9 = turns.find((t) => t.turn === 9)!;
    const cut = gameEventLog(auto, t9.lines[0]!.frameIndex);
    expect(cut.at(-1)!.turn).toBe(9);
    expect(cut.at(-1)!.lines.every((l) => l.frameIndex <= t9.lines[0]!.frameIndex)).toBe(true);
  });

  it('grows incrementally with a live log and matches a full walk', () => {
    const half = Math.floor(auto.frames.length / 2);
    const header = { ...auto.header };
    const growing: GameLog = { ...auto, header, frames: auto.frames.slice(0, half) };
    const first = gameEventLog(growing);
    expect(first.length).toBeLessThan(turns.length);
    const full = gameEventLog({ ...growing, frames: auto.frames.slice() });
    expect(full.map((t) => t.lines.map(lineText))).toEqual(turns.map((t) => t.lines.map(lineText)));
  });

  it('turns sacrifices into "sacrificed"', () => {
    const state = (events: GameStateBody['events'], cards: { id: number; name: string; controller: number; types: string }[]): GameStateBody =>
      ({
        gameId: 'g',
        turn: 3,
        round: 2,
        phase: 'MAIN1',
        activePlayer: 0,
        priority: 0,
        gameOver: null,
        stack: [],
        stackCards: [],
        combat: null,
        events,
        players: [0, 1].map((pid) => ({
          id: pid,
          name: pid === 0 ? 'Me' : 'Forge AI',
          isAi: pid === 1,
          life: 20,
          poison: 0,
          counters: {},
          manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
          zones: {
            hand: { count: 0, cards: [] },
            battlefield: { count: 0, cards: cards.filter((c) => c.controller === pid).map((c) => ({ ...c, zone: 'battlefield', owner: pid, tapped: false, token: false })) },
            graveyard: { count: 0, cards: [] },
            exile: { count: 0, cards: [] },
            command: { count: 0, cards: [] },
            library: { count: 0, cards: [] },
          },
        })),
      }) as unknown as GameStateBody;
    const bear = [{ id: 7, name: 'Grizzly Bears', controller: 0, types: 'Creature — Bear' }];
    const log: GameLog = {
      header: { ...auto.header, seat: 0 },
      hello: null,
      over: null,
      seat: 0,
      frames: [
        { v: 1, seq: 1, t: 0, type: 'state', body: state([{ kind: 'turn', player: 0, turn: 3 }], bear) },
        {
          v: 1,
          seq: 2,
          t: 0,
          type: 'state',
          body: state(
            [
              { kind: 'sacrificed', cardId: 7 },
              { kind: 'zone', cardId: 7, from: { zone: 'battlefield', player: 0 }, to: { zone: 'graveyard', player: 0 } },
            ],
            [],
          ),
        },
      ] as GameLog['frames'],
    };
    expect(gameEventLog(log).at(-1)!.lines.map(lineText)).toEqual(['You sacrificed Grizzly Bears']);
  });
});

describe('abilityText', () => {
  it('drops engine ids, the source name and empty targeting', () => {
    expect(abilityText('(47) - Attach to Soldier Token (91)', 'S.H.I.E.L.D. Spy Kit')).toBe('Attach to Soldier Token');
    expect(abilityText('Blood Artist - Whenever Blood Artist or another creature dies', 'Blood Artist')).toBe('Whenever Blood Artist or another creature dies');
    expect(abilityText('Ant-Man - Whenever this attacks. (Targeting: [[]])', 'Ant-Man')).toBe('Whenever this attacks.');
  });
});

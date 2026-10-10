import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { parseLog, type GameLog } from './log.ts';
import { abilityText, foldSummary, foldTriggers, gameEventLog, lineText, phaseSection, sectionsOf, type LogKind, type LogTurn } from './eventLog.ts';
import type { GameEvent, GameStateBody, StackItem } from './protocol.ts';

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
    // Life reads "life 20 → 19" (was "lost 1 life (20 → 19)").
    expect(t13).toContain('Forge AI: life 20 → 19');
    expect(textOf(turns, 14)).toContain('You did not block');
  });

  it('writes tokens, counters, attachments and abilities without engine ids', () => {
    const t12 = textOf(turns, 12);
    expect(t12.filter((l) => l === 'Forge AI created Soldier Token')).toHaveLength(2);
    // The equip ability now names its target ("→ Soldier Token", read off the same frame's stack item).
    expect(t12).toContain('S.H.I.E.L.D. Spy Kit ability: Attach to Soldier Token → Soldier Token');
    expect(t12).toContain('S.H.I.E.L.D. Spy Kit was attached to Soldier Token');
    expect(textOf(turns, 16)).toContain('Aerial Doombot got 3 +1/+1 counters (now 3)');
    for (const t of turns) for (const l of t.lines) expect(lineText(l)).not.toMatch(/\(\d+\)|#\d/);
  });

  it('files each line under the part of the turn it happened in', () => {
    const t13 = turns.find((t) => t.turn === 13)!;
    const secs = sectionsOf(t13.lines);
    const of = (text: string) => secs.find((s) => s.lines.some((l) => lineText(l) === text))?.section;
    expect(of('You attacked Forge AI with Quake, Agent of S.H.I.E.L.D. and Aerial Doombot')).toBe('Combat');
    expect(of('Forge AI: life 20 → 19')).toBe('Combat');
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


// ---------------------------------------------------------------------------
// Targets, kinds, life, folds (the turn-log lane)

const CASTY: LogKind[] = ['cast', 'trigger', 'activated', 'ability'];
/** The cast-like lines of a turn: [kind, text]. */
const kindsOf = (turns: LogTurn[], turn: number) => turns.find((t) => t.turn === turn)?.lines.filter((l) => CASTY.includes(l.kind)).map((l) => [l.kind, lineText(l)] as [LogKind, string]) ?? [];
const allLines = (turns: LogTurn[]) => turns.flatMap((t) => t.lines);

describe('cast targets', () => {
  const autoTurns = gameEventLog(auto);
  const comfortTurns = gameEventLog(comfort);

  it('writes "cast X → Y" from the same frame\'s stack item, on both sample logs', () => {
    const a = textOf(autoTurns, 7);
    expect(a).toContain('You cast Pym Particles → Peggy Carter, Secret Agent');
    expect(a).toContain('You cast Quantum Reduction → Peggy Carter, Secret Agent');
    expect(textOf(autoTurns, 15)).toContain('You cast Robotics Mastery → Aerial Doombot');
    expect(textOf(comfortTurns, 8)).toContain('You cast Depower → Ant-Man\'s Air Force');
    expect(textOf(comfortTurns, 12)).toContain('You cast Web Up');
    // A cast that targets nothing has no arrow.
    expect(textOf(autoTurns, 2)).toContain('Forge AI cast S.H.I.E.L.D. Spy Kit');
    expect(textOf(autoTurns, 9)).toContain('You cast A.I.M. Scientists');
  });

  it('puts the arrow on triggers too, and drops the engine\'s own "(Targeting: …)" tail when it does', () => {
    const web = textOf(comfortTurns, 12).find((l) => l.startsWith('Web Up triggered'))!;
    expect(web).toMatch(/ → A\.I\.M\. Scientists$/);
    expect(web).not.toMatch(/Targeting/);
  });

  it('says the kind of each cast: spell, trigger, ability', () => {
    expect(kindsOf(autoTurns, 9).map(([k]) => k)).toEqual(['cast', 'trigger']);
    expect(kindsOf(autoTurns, 12).map(([k]) => k)).toEqual(['cast', 'trigger', 'ability']);
    expect(kindsOf(autoTurns, 13).filter(([k]) => k === 'trigger')).toHaveLength(2);
    // A trigger reads "<source> triggered: <rules text>".
    expect(kindsOf(autoTurns, 9)[1]![1]).toMatch(/^A\.I\.M\. Scientists triggered: When this creature enters, it connives/);
  });

  it('writes life as "life 20 → 18", never "lost N life"', () => {
    const life = allLines([...autoTurns, ...comfortTurns]).filter((l) => l.kind === 'life').map(lineText);
    expect(life.length).toBeGreaterThan(5);
    for (const t of life) expect(t).toMatch(/^(You|Forge AI): life -?\d+ → -?\d+$/);
    expect(textOf(autoTurns, 14)).toContain('You: life 20 → 16');
    expect(textOf(comfortTurns, 15)).toContain('You: life 6 → -6');
    expect(allLines(autoTurns).map(lineText).join('\n')).not.toMatch(/lost \d+ life|gained \d+ life/);
  });

  it('keeps every line free of engine ids, targets included', () => {
    for (const l of allLines([...autoTurns, ...comfortTurns])) expect(lineText(l)).not.toMatch(/\(\d+\)|#\d/);
  });
});

// A two-frame hand-made log: frame 1 sets the turn up, frame 2 carries the events under test.
function mini(opts: { cards?: unknown[]; hiddenIds?: number[]; stack?: Partial<StackItem>[]; events: GameEvent[]; stackCards?: unknown[] }): GameLog {
  const card = (c: any) => ({ zone: 'battlefield', owner: 0, controller: 0, tapped: false, token: false, types: 'Creature — Bear', ...c });
  const hidden = (id: number) => ({ id, zone: 'hand', owner: 1, controller: 1, hidden: true });
  const state = (events: GameEvent[], withCards: boolean): GameStateBody =>
    ({
      gameId: 'g',
      turn: 3,
      round: 2,
      phase: 'MAIN1',
      activePlayer: 0,
      priority: 0,
      gameOver: null,
      stack: withCards ? (opts.stack ?? []) : [],
      stackCards: withCards ? (opts.stackCards ?? []) : [],
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
          hand: { count: 0, cards: pid === 1 && withCards ? (opts.hiddenIds ?? []).map(hidden) : [] },
          battlefield: { count: 0, cards: withCards ? (opts.cards ?? []).map(card).filter((c) => c.controller === pid) : [] },
          graveyard: { count: 0, cards: [] },
          exile: { count: 0, cards: [] },
          command: { count: 0, cards: [] },
          library: { count: 0, cards: [] },
        },
      })),
    }) as unknown as GameStateBody;
  return {
    header: { ...auto.header, seat: 0 },
    hello: null,
    over: null,
    seat: 0,
    frames: [
      { v: 1, seq: 1, t: 0, type: 'state', body: state([{ kind: 'turn', player: 0, turn: 3 }], false) },
      { v: 1, seq: 2, t: 0, type: 'state', body: state(opts.events, true) },
    ] as GameLog['frames'],
  };
}
const item = (id: number, over: Partial<StackItem> = {}): Partial<StackItem> => ({ id, sourceCardId: 7, controller: 0, text: '', targetCardIds: [], targetPlayerIds: [], ...over });
const cast = (stackId: number, cardId: number, text = ''): GameEvent => ({ kind: 'cast', stackId, cardId, controller: 0, text }) as GameEvent;
const toStack = (cardId: number): GameEvent => ({ kind: 'zone', cardId, from: { zone: 'hand', player: 0 }, to: { zone: 'stack', player: 0 } }) as GameEvent;
const last = (log: GameLog) => gameEventLog(log).at(-1)!.lines.map((l) => [l.kind, lineText(l)]);

describe('cast targets, hand-made frames', () => {
  const bolt = { id: 7, name: 'Lightning Bolt', zone: 'stack' };
  const bear = { id: 9, name: 'Grizzly Bears' };

  it('names a target card and a target player; two targets read "A, B"', () => {
    const log = mini({
      cards: [bear],
      stackCards: [bolt],
      stack: [item(40, { targetCardIds: [9], targetPlayerIds: [1] })],
      events: [toStack(7), cast(40, 7, 'Lightning Bolt deals 3 damage to any target.')],
    });
    expect(last(log)).toEqual([['cast', 'You cast Lightning Bolt → Grizzly Bears, Player 1']]);
  });

  it('writes no arrow when the item is not on that frame\'s stack (it already resolved)', () => {
    const log = mini({ cards: [bear], stackCards: [bolt], stack: [], events: [toStack(7), cast(40, 7)] });
    expect(last(log)).toEqual([['cast', 'You cast Lightning Bolt']]);
    // Nor when the stack holds a different item.
    const other = mini({ cards: [bear], stackCards: [bolt], stack: [item(41, { targetCardIds: [9] })], events: [toStack(7), cast(40, 7)] });
    expect(last(other)).toEqual([['cast', 'You cast Lightning Bolt']]);
  });

  it('never names a concealed target: "a hidden card"', () => {
    const log = mini({ hiddenIds: [55], stackCards: [bolt], stack: [item(40, { targetCardIds: [55] })], events: [toStack(7), cast(40, 7)] });
    const [line] = last(log);
    expect(line).toEqual(['cast', 'You cast Lightning Bolt → a hidden card']);
    // A target id the frame carries nowhere is no more nameable.
    const gone = mini({ stackCards: [bolt], stack: [item(40, { targetCardIds: [123] })], events: [toStack(7), cast(40, 7)] });
    expect(last(gone)).toEqual([['cast', 'You cast Lightning Bolt → a hidden card']]);
    // The arrow's card segment carries no card to open.
    const seg = gameEventLog(log).at(-1)!.lines[0]!.segs.filter((s) => typeof s !== 'string' && 'card' in s);
    expect(seg.map((s) => (s as { card: unknown }).card === null || (s as { name: string }).name === 'Lightning Bolt')).toEqual([true]);
  });

  it('reads the kind from isAbility / isOptionalTrigger, else from the text', () => {
    const src = { id: 7, name: 'Llanowar Elves' };
    const run = (it: Partial<StackItem>, text: string) => last(mini({ cards: [src], stack: [item(40, it)], events: [cast(40, 7, text)] }))[0]![0];
    expect(run({ isAbility: true, isOptionalTrigger: true }, 'Llanowar Elves - You may draw')).toBe('trigger');
    expect(run({ isAbility: true }, 'Llanowar Elves - Whenever this attacks, scry 1.')).toBe('trigger');
    expect(run({ isAbility: true }, '{T}: Add {G}.')).toBe('activated');
    expect(run({ isAbility: true }, 'Llanowar Elves - Attach to Soldier')).toBe('ability');
    // No stack item left on the frame: the text decides.
    expect(last(mini({ cards: [src], events: [cast(40, 7, 'Llanowar Elves - At the beginning of your upkeep, draw.')] }))[0]![0]).toBe('trigger');
    expect(last(mini({ cards: [src], events: [cast(40, 7, '{2}, {T}: Draw a card.')] }))[0]![0]).toBe('activated');
    expect(last(mini({ cards: [src], stack: [item(40, { isAbility: false })], events: [cast(40, 7)] }))[0]![0]).toBe('cast');
  });

  it('names a hidden source, and keeps a blanked text blank', () => {
    const log = mini({ hiddenIds: [55], stack: [item(40, { sourceCardId: 55, isAbility: true, isOptionalTrigger: true })], events: [cast(40, 55, '')] });
    expect(last(log)).toEqual([['trigger', 'a hidden source triggered']]);
  });
});

describe('trigger folds', () => {
  const turns = gameEventLog(auto);
  const t13 = turns.find((t) => t.turn === 13)!;

  it('gathers each run of consecutive triggers into one fold, keyed by its first line', () => {
    const secs = sectionsOf(t13.lines);
    const items = secs.flatMap((s) => foldTriggers(s.lines, s.start));
    const folds = items.filter((i) => i.type === 'fold');
    expect(folds.length).toBeGreaterThan(0);
    for (const f of folds) {
      expect(f.type === 'fold' && f.lines.every((l) => l.kind === 'trigger')).toBe(true);
      expect(t13.lines[(f as { key: number }).key]).toBe((f as { lines: unknown[] }).lines[0]);
    }
    // No plain line is a trigger; nothing is lost or reordered.
    expect(items.filter((i) => i.type === 'line').every((i) => i.type === 'line' && i.line.kind !== 'trigger')).toBe(true);
    expect(items.flatMap((i) => (i.type === 'line' ? [i.line] : i.lines))).toEqual(t13.lines);
  });

  it('summarises a fold in words', () => {
    const trig = t13.lines.filter((l) => l.kind === 'trigger');
    expect(trig.length).toBe(2);
    const one = foldSummary([trig[0]!]).map((s) => (typeof s === 'string' ? s : s.name)).join('');
    expect(one).toBe('Quake, Agent of S.H.I.E.L.D. triggered');
    const two = foldSummary(trig).map((s) => (typeof s === 'string' ? s : s.name)).join('');
    expect(two).toBe('2 triggers: Quake, Agent of S.H.I.E.L.D., S.H.I.E.L.D. Helicarrier');
  });

  it('keeps the incremental walk equal to a cold walk, kinds included', () => {
    const half = Math.floor(auto.frames.length / 2);
    const growing: GameLog = { ...auto, header: { ...auto.header }, frames: auto.frames.slice(0, half) };
    gameEventLog(growing);
    const warm = gameEventLog({ ...growing, frames: auto.frames.slice() });
    expect(warm.map((t) => t.lines.map((l) => [l.kind, lineText(l)]))).toEqual(turns.map((t) => t.lines.map((l) => [l.kind, lineText(l)])));
  });
});

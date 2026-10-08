import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { parseLog, type GameLog } from './log.ts';
import type { CardInfo } from './cards.ts';
import type { Card, GameStateBody } from './protocol.ts';
import {
  activatedAbilities,
  battlefieldView,
  canPay,
  instantSpeedOptions,
  manaColorsInText,
  manaSummary,
  manaValue,
  parseManaCost,
  permanentLine,
  stateAt,
  turnFacts,
  untappedManaSources,
  type ManaSource,
} from './state.ts';

function sample(name: string): GameLog {
  const url = new URL(`../public/samples/${name}.jsonl.gz`, import.meta.url);
  return parseLog(gunzipSync(readFileSync(url)).toString('utf8'));
}
const auto = sample('human-auto-42');
const comfort = sample('human-comfort-13');

function info(name: string, over: Partial<CardInfo>): CardInfo {
  return { name, found: true, manaCost: '', typeLine: '', oracleText: '', producedMana: [], colors: [], ...over };
}
const src = (colors: string[], id = Math.random()): ManaSource => ({ cardId: id, name: 'x', colors });

describe('mana costs', () => {
  it('parses symbols and mana value', () => {
    expect(parseManaCost('{2}{W}{X}').map((s) => s.kind)).toEqual(['generic', 'color', 'x']);
    expect(manaValue('{3}{U}')).toBe(4);
    expect(manaValue('{X}{R}{R}')).toBe(2);
    expect(manaValue('{2/W}{2/W}')).toBe(4);
    expect(manaValue(null)).toBe(0);
  });

  it('canPay matches coloured pips to sources', () => {
    expect(canPay('{2}{W}', [src(['W']), src(['U']), src(['U'])])).toBe(true);
    expect(canPay('{2}{W}', [src(['U']), src(['U']), src(['U'])])).toBe(false);
    expect(canPay('{W}{U}', [src(['W', 'U']), src(['W'])])).toBe(true); // dual must go to U
    expect(canPay('{1}{U}', [src(['U'])])).toBe(false);
    expect(canPay('{W/U}', [src(['U'])])).toBe(true);
    expect(canPay('{B/P}', [])).toBe(true); // pay life
    expect(canPay('{U}', [src([])])).toBe(true); // unknown colour is lenient
    expect(canPay('{R}', [], { R: 1 })).toBe(true); // floating mana
    expect(canPay(null, [])).toBe(true);
  });

  it('reads "Add …" clauses', () => {
    expect(manaColorsInText('{T}: Add {G}.')).toEqual(['G']);
    expect(manaColorsInText('{T}: Add {U} or {B}.')!.sort()).toEqual(['B', 'U']);
    expect(manaColorsInText('Sacrifice this: Add one mana of any color.')!.length).toBe(5);
    expect(manaColorsInText('Flying')).toBeNull();
  });

  it('finds activated abilities, skipping mana, loyalty and sorcery-speed ones', () => {
    const text = '{T}: Add {G}.\n{1}, {T}: Draw a card.\nEquip {2}\n+1: Scry 1.\n{2}: This gets +1/+1 until end of turn. Activate only as a sorcery.\nSacrifice a creature: Scry 1.';
    const abs = activatedAbilities(text);
    expect(abs.map((a) => a.cost)).toEqual(['{1}, {T}', 'Sacrifice a creature']);
    expect(abs[0]!.needsTap).toBe(true);
  });
});

describe('untappedManaSources', () => {
  it('counts untapped lands by basic type (auto R7 attack: two Plains up)', () => {
    const s = stateAt(auto, 1082)!;
    const srcs = untappedManaSources(s, 0);
    expect(srcs.map((x) => x.name)).toEqual(['Plains', 'Plains']);
    expect(srcs.every((x) => x.colors.join() === 'W')).toBe(true);
    expect(manaSummary(s, 0).byColor.W).toBe(2);
  });

  it('treats a non-basic land with no card text as a source of unknown colour, and uses producedMana when given', () => {
    const s = stateAt(comfort, 1278)!;
    expect(untappedManaSources(s, 0)).toEqual([{ cardId: 9, name: 'Thriving Isle', colors: [] }]);
    const cards = new Map([['Thriving Isle', info('Thriving Isle', { producedMana: ['U', 'B'] })]]);
    expect(untappedManaSources(s, 0, cards)[0]!.colors).toEqual(['U', 'B']);
  });

  it('excludes a summoning-sick creature whose mana ability needs {T}, keeps one that does not', () => {
    const s = structuredClone(stateAt(auto, 1082)!) as GameStateBody;
    const elf = s.players[0]!.zones.battlefield.cards.find((c) => (c as Card).name === 'Aerial Doombot') as Card;
    elf.name = 'Llanowar Elves';
    elf.tapped = false;
    elf.sick = true;
    const tapper = new Map([['Llanowar Elves', info('Llanowar Elves', { producedMana: ['G'], oracleText: '{T}: Add {G}.' })]]);
    expect(untappedManaSources(s, 0, tapper).some((x) => x.name === 'Llanowar Elves')).toBe(false);
    const sacker = new Map([['Llanowar Elves', info('Llanowar Elves', { producedMana: ['G'], oracleText: 'Sacrifice this: Add {G}.' })]]);
    expect(untappedManaSources(s, 0, sacker).some((x) => x.name === 'Llanowar Elves')).toBe(true);
    elf.sick = false;
    expect(untappedManaSources(s, 0, tapper).some((x) => x.name === 'Llanowar Elves')).toBe(true);
  });
});

describe('turnFacts', () => {
  it('is unknowable before the first turn', () => {
    expect(turnFacts(auto, 5, 0).landPlayed).toBeNull();
  });

  it('auto R7 (turn 13) after main 1: land played, Helicarrier cast, triggers listed as abilities', () => {
    const f = turnFacts(auto, 1082, 0);
    expect(f.landPlayed).toBe(true);
    expect(f.landsPlayed).toBe(1);
    expect(f.cast).toEqual([{ playerId: 0, name: 'S.H.I.E.L.D. Helicarrier' }]);
    expect(f.abilities.map((a) => a.name)).toEqual(['Quake, Agent of S.H.I.E.L.D.', 'S.H.I.E.L.D. Helicarrier']);
    expect(f.abilities.every((a) => a.triggered)).toBe(true);
    expect(f.entered).toContain('Soldier Token');
    expect(turnFacts(auto, 1082, 1).landPlayed).toBe(false);
  });

  it('land drop flips within the main phase (auto turn 1: before and after the Island)', () => {
    expect(turnFacts(auto, 19, 0).landPlayed).toBe(false);
    expect(turnFacts(auto, 21, 0).landPlayed).toBe(true);
  });

  it('aborted casts are not casts (auto turn 1 clicked four spells, cast none)', () => {
    expect(turnFacts(auto, 115, 0).cast).toEqual([]);
  });

  it('revolt: a permanent exiled on the opponent’s turn left the battlefield (auto turn 10)', () => {
    expect(turnFacts(auto, 830, 0).leftBattlefield).toEqual(['A.I.M. Scientists']);
    expect(turnFacts(auto, 830, 1).leftBattlefield).toEqual([]);
    expect(turnFacts(auto, 857, 0).leftBattlefield).toEqual([]); // next turn resets
  });

  it('combat deaths count as died + left (auto turn 13: Quake kills a Soldier Token)', () => {
    const f = turnFacts(auto, 1116, 1);
    expect(f.died).toContain('Soldier Token');
    expect(f.leftBattlefield).toContain('Soldier Token');
  });

  it('opponent’s turn casts are recorded for both players’ views (auto turn 10 Web Up)', () => {
    expect(turnFacts(auto, 830, 0).cast).toEqual([{ playerId: 1, name: 'Web Up' }]);
  });

  // J109: the board asks on every frame of a live game; the fold goes on from where it stopped while
  // the log grows. It must say exactly what a fold from the first frame says, at every step.
  it('a growing log, followed frame by frame, gets the facts a fold from the start gets', () => {
    for (const log of [auto, comfort]) {
      // A log nobody asked about yet (its own first frame object): a fold from the start.
      const fresh = (k: number, p: number) => turnFacts({ ...log, frames: [{ ...log.frames[0]! }, ...log.frames.slice(1, k + 1)] }, k, p);
      for (let k = 0; k < log.frames.length; k++) {
        // What a live session hands the board: a new snapshot (a new array) of the same frames, one more each time.
        const live = { ...log, frames: log.frames.slice(0, k + 1) };
        for (const p of [0, 1]) {
          const got = turnFacts(live, k, p);
          if (k % 23 === 0 || k === log.frames.length - 1) expect(got).toEqual(fresh(k, p));
          // The caller's copy is its own.
          got.cast.push({ playerId: 9, name: 'scribble' });
          got.died.push('scribble');
        }
      }
      // Back to an earlier frame (a replay's scrubber), then forward again.
      expect(turnFacts(log, 830, 0)).toEqual(fresh(830, 0));
      expect(turnFacts(log, log.frames.length - 1, 1)).toEqual(fresh(log.frames.length - 1, 1));
    }
  });
});

describe('permanent view', () => {
  it('resolves attachments to names and flags sickness', () => {
    const s = stateAt(auto, 1116)!;
    const opp = battlefieldView(s, 1);
    const kit = opp.find((v) => v.name === 'S.H.I.E.L.D. Spy Kit')!;
    expect(kit.attachedTo?.name).toBe('Soldier Token');
    const carrier = opp.find((v) => v.attachments.some((a) => a.name === 'S.H.I.E.L.D. Spy Kit'))!;
    expect(carrier.name).toBe('Soldier Token');
    expect(permanentLine(carrier)).toMatch(/^Soldier Token \d+\/\d+ — token, .*with S\.H\.I\.E\.L\.D\. Spy Kit/);
    const mine = battlefieldView(stateAt(comfort, 1278)!, 0);
    const quake = mine.find((v) => v.name === 'Quake, Agent of S.H.I.E.L.D.')!;
    expect(quake.sick).toBe(true);
    expect(quake.canAttack).toBe(false);
    expect(quake.power).toBe('3');
    expect(mine[mine.length - 1]!.isLand).toBe(true); // lands sort last
  });
});

describe('instantSpeedOptions', () => {
  it('finds an affordable instant in hand (comfort R8: Helicarrier Strike off Thriving Isle)', () => {
    const s = stateAt(comfort, 1278)!;
    expect(instantSpeedOptions(s, 0).map((o) => o.name)).toEqual(['Helicarrier Strike']);
    // With card text, Thriving Isle (U + black chosen) can't make W.
    const cards = new Map([['Thriving Isle', info('Thriving Isle', { producedMana: ['U', 'B'] })]]);
    expect(instantSpeedOptions(s, 0, cards)).toEqual([]);
  });

  it('finds activated abilities from card text', () => {
    const s = stateAt(comfort, 1278)!;
    const cards = new Map([
      ['Thriving Isle', info('Thriving Isle', { producedMana: ['U', 'B'] })],
      ['Ant-Man\'s Air Force', info("Ant-Man's Air Force", { oracleText: '{U}: Draw a card.' })],
    ]);
    expect(instantSpeedOptions(s, 0, cards).map((o) => `${o.name}:${o.via}`)).toEqual(["Ant-Man's Air Force:ability"]);
  });
});

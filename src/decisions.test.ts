import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { parseLog, type GameLog } from './log.ts';
import type { Card } from './protocol.ts';
import { extractDecisions, type Decision } from './decisions.ts';

function sample(name: string): GameLog {
  const url = new URL(`../public/samples/${name}.jsonl.gz`, import.meta.url);
  return parseLog(gunzipSync(readFileSync(url)).toString('utf8'));
}
const auto = sample('human-auto-42');
const comfort = sample('human-comfort-13');
const autoD = extractDecisions(auto);
const comfortD = extractDecisions(comfort);

const byLabel = (ds: Decision[], label: string) => ds.filter((d) => d.label === label);
const one = (ds: Decision[], label: string) => {
  const hits = byLabel(ds, label);
  expect(hits, label).toHaveLength(1);
  return hits[0]!;
};

describe.each([
  ['human-auto-42', auto, autoD],
  ['human-comfort-13', comfort, comfortD],
])('%s — shape', (_name, log, ds) => {
  it('has a sane number of decisions, indexed in order', () => {
    expect(ds.length).toBeGreaterThan(15);
    expect(ds.length).toBeLessThan(40);
    ds.forEach((d, i) => expect(d.index).toBe(i));
  });

  it('has at most one main decision per (turn, main phase)', () => {
    const keys = ds.filter((d) => d.kind === 'main').map((d) => `${d.state.turn}:${d.state.phase}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(ds.filter((d) => d.kind === 'main').every((d) => d.state.activePlayer === log.seat)).toBe(true);
  });

  it('labels main decisions like "R3 · Your main 1" and keeps frames in order', () => {
    for (const d of ds) {
      if (d.kind === 'main') expect(d.label).toMatch(/^R\d+ · Your main [12]$/);
      expect(log.frames[d.frameIndex]!.type).toBe('state');
      expect(d.endFrameIndex).toBeGreaterThanOrEqual(d.frameIndex);
    }
    for (let i = 1; i < ds.length; i++) expect(ds[i]!.frameIndex).toBeGreaterThanOrEqual(ds[i - 1]!.frameIndex);
  });

  it('reads like plays, not clicks', () => {
    for (const d of ds) {
      expect(d.actions.length, d.label).toBeGreaterThan(0);
      for (const a of d.actions) expect(a).not.toMatch(/\b(clicked|pressed|tapped mana|answered the prompt)\b/);
    }
  });

  it('keeps an opponent-turn priority stop only when there was something to do', () => {
    for (const d of ds.filter((x) => x.kind === 'priority')) {
      const did = d.actions.some((a) => /^(cast|activated)\b|→/.test(a));
      expect(did || (d.options?.length ?? 0) > 0, d.label).toBe(true);
    }
  });
});

describe('human-auto-42 (a bot that clicks every card, then cancels)', () => {
  it('starts with the pre-game choice', () => {
    expect(autoD[0]!.label).toBe('Pre-game · keep or mulligan');
    expect(autoD[0]!.actions).toEqual(['chose to play', 'kept the opening hand']);
  });

  it('drops the aborted casts: turn 1 main 1 is just the land', () => {
    expect(one(autoD, 'R1 · Your main 1').actions).toEqual(['played Island']);
    expect(one(autoD, 'R1 · Your main 2').actions).toEqual(['passed without playing anything']);
  });

  it('describes casts with their targets and whose they are', () => {
    expect(one(autoD, 'R4 · Your main 1').actions).toEqual([
      'played Island',
      "cast Pym Particles targeting opponent's Peggy Carter, Secret Agent",
    ]);
    expect(one(autoD, 'R6 · Your main 1').actions).toEqual([
      'played Plains',
      'cast Quake, Agent of S.H.I.E.L.D.',
      'cast Aerial Doombot',
    ]);
  });

  it('mentions a trigger only for the target the player chose', () => {
    expect(one(autoD, 'R7 · Your main 1').actions).toEqual([
      'played Plains',
      'cast S.H.I.E.L.D. Helicarrier',
      "Quake, Agent of S.H.I.E.L.D.'s trigger targeting your Island",
    ]);
  });

  it('reads a connive discard into the main phase that caused it', () => {
    expect(one(autoD, 'R5 · Your main 1').actions).toEqual(['cast A.I.M. Scientists', 'discarded Web Up']);
  });

  it('folds the damage-assignment ask into the attack', () => {
    const atk = one(autoD, 'R7 · Your attacks');
    expect(atk.kind).toBe('attack');
    expect(atk.actions).toEqual([
      'attacked Forge AI with Quake, Agent of S.H.I.E.L.D., Aerial Doombot',
      'assigned combat damage: 3 to Soldier Token',
    ]);
    expect(atk.ask?.kind).toBe('assign_damage');
  });

  it('keeps blocks, without the bridge’s self-block artefact', () => {
    const blocks = autoD.filter((d) => d.kind === 'block');
    expect(blocks.length).toBeGreaterThan(2);
    expect(blocks.every((d) => d.actions.join() === 'declared no blockers')).toBe(true);
    expect(one(autoD, 'R7 · Your blocks').state.turn).toBe(14);
  });

  it('folds ask answers into the play they belong to', () => {
    expect(one(autoD, 'R10 · Your main 1').actions).toEqual(['played Thriving Isle', 'Choose a color → chose black']);
  });

  it('lists no opponent-turn priority stops: the deck has no instants', () => {
    expect(autoD.filter((d) => d.kind === 'priority')).toEqual([]);
  });

  it('captures the state before the player acted', () => {
    const d = one(autoD, 'R4 · Your main 1');
    expect(d.state.turn).toBe(7);
    expect(d.state.phase).toBe('MAIN1');
    const me = d.state.players.find((p) => p.id === 0)!;
    const hand = me.zones.hand.cards.map((c) => (c as Card).name);
    expect(hand).toContain('Pym Particles');
    expect(me.zones.battlefield.cards.filter((c) => (c as Card).name === 'Island')).toHaveLength(3);
    expect(d.input?.prompt).toMatch(/^Priority:/);
  });
});

describe('human-comfort-13', () => {
  it('reads land + choice, sorcery-speed instants and cleanup discards', () => {
    expect(one(comfortD, 'R2 · Your main 1').actions).toEqual(['played Thriving Isle', 'Choose a color → chose black']);
    expect(one(comfortD, 'R2 · Your main 2').actions).toEqual(['discarded Wasp, Shrinking Savior to hand size']);
    expect(one(comfortD, 'R4 · Your main 1').actions).toEqual([
      'played Island',
      "cast Depower targeting your Ant-Man's Air Force",
    ]);
    expect(one(comfortD, 'R6 · Your main 1').actions).toEqual([
      'played Island',
      'cast Web Up',
      "Web Up's trigger targeting opponent's A.I.M. Scientists",
    ]);
  });

  it('keeps attacks, including empty ones', () => {
    expect(one(comfortD, 'R4 · Your attacks').actions).toEqual(["attacked Forge AI with Ant-Man's Air Force"]);
    expect(one(comfortD, 'R5 · Your attacks').actions).toEqual(['declared no attackers']);
  });

  it('keeps the priority stops where an instant was castable', () => {
    const prio = comfortD.filter((d) => d.kind === 'priority');
    expect(prio.map((d) => d.label)).toEqual(["R8 · Opponent's beginning of combat", "R8 · Opponent's declare attackers"]);
    for (const d of prio) {
      expect(d.options?.map((o) => o.name)).toEqual(['Helicarrier Strike']);
      expect(d.actions).toEqual(['passed']);
    }
  });
});

describe('AI-vs-AI recordings (no acts)', () => {
  // Strip every c2s/input/ask frame: what an AI-vs-AI recording looks like.
  const stripped: GameLog = { ...auto, frames: auto.frames.filter((f) => f.type === 'state' || f.type === 'hello_ok' || f.type === 'over') };
  const ds = extractDecisions(stripped);

  it('yields one decision per relevant (turn, phase)', () => {
    expect(ds.length).toBeGreaterThan(20);
    const keys = ds.map((d) => `${d.kind}:${d.state.turn}:${d.state.phase}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(ds.every((d) => d.input === null && d.ask === null)).toBe(true);
  });

  it('fills in the viewer’s plays from the events', () => {
    const r6 = ds.find((d) => d.label === 'R6 · Your main 1')!;
    expect(r6.actions).toEqual(expect.arrayContaining(['cast Quake, Agent of S.H.I.E.L.D.', 'cast Aerial Doombot']));
  });
});

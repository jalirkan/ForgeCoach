import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { parseLog, type GameLog } from './log.ts';
import type { CardInfo } from './cards.ts';
import { buildReviewPrompt, gameHistory, reviewCardNames, summarizeGame } from './review.ts';

function load(name: string): GameLog {
  const bytes = readFileSync(new URL(`../public/samples/${name}.jsonl.gz`, import.meta.url));
  return parseLog(gunzipSync(bytes).toString('utf8'));
}
const comfort = load('human-comfort-13');
const auto = load('human-auto-42');

describe('summarizeGame', () => {
  const s = summarizeGame(comfort);

  it('has one line per turn with lands, spells, attacks and life', () => {
    expect(s).toContain('T1 (R1) Forge AI: land Plains');
    expect(s).toContain('T2 (R1) You: no land played');
    expect(s).toContain('T6 (R3) You: land Island | cast Ant-Man\'s Air Force');
    expect(s).toContain(
      'T9 (R5) Forge AI: land Plains | cast Giant-Sized Flying Ant | attacked you with A.I.M. Scientists 3/3 — no blocks | You life 20→17',
    );
    expect(s).toContain('T12 (R6) You: land Island | cast Web Up | exiled: A.I.M. Scientists (Forge AI\'s)');
    expect(s).toContain('You life 6→-6');
  });

  it('separates spells from abilities and triggers', () => {
    // A.I.M. Scientists' connive trigger and Ant-Man's Air Force's attack trigger are not spells.
    expect(s).not.toMatch(/T7[^\n]*A\.I\.M\. Scientists; A\.I\.M\. Scientists/);
    expect(s).not.toMatch(/T8[^\n]*cast [^|\n]*Ant-Man's Air Force/);
    expect(s).toMatch(/T8 \(R4\) You: land Island \| cast Depower \|/);
  });

  it('ends with life totals, boards, hand and the result', () => {
    expect(s).toContain('Final life: You -6, Forge AI 20.');
    expect(s).toContain('Your hand at the end: Strategic Intervention; Helicarrier Strike.');
    expect(s.trim().split('\n').at(-1)).toBe('Result: Forge AI won (AllOpponentsLost) on turn 15.');
  });

  it('reports blocks, deaths, tokens and mulligans (human-auto-42)', () => {
    const a = summarizeGame(auto);
    expect(a).toContain('Pre-game: mulligans: Forge AI ×2');
    expect(a).toContain('Quake, Agent of S.H.I.E.L.D. 3/3 (blocked by Soldier Token ×2)');
    expect(a).toMatch(/T13 [^\n]*died: Quake, Agent of S\.H\.I\.E\.L\.D\. \(yours\)/);
    expect(a).toMatch(/T12 [^\n]*Forge AI's tokens: Soldier Token ×2/);
    expect(a).toContain('Result: Forge AI won (AllOpponentsLost) on turn 22.');
  });

  it('is deterministic and compact', () => {
    expect(summarizeGame(load('human-comfort-13'))).toBe(s);
    expect(s.length).toBeLessThan(4000);
    expect(summarizeGame(auto).length).toBeLessThan(6000);
  });

  it('drops the bridge\'s self-blocks (an unblocked attacker listed as its own blocker)', () => {
    for (const t of gameHistory(comfort).turns) for (const a of t.attacks) expect(a.blocks.size).toBe(0);
  });
});

describe('buildReviewPrompt', () => {
  it('has the spec, the summary, card text for the cards that mattered, and the guide', () => {
    const names = reviewCardNames(comfort);
    expect(names).toEqual(expect.arrayContaining(['Web Up', 'Depower', 'Giant-Sized Flying Ant', 'Helicarrier Strike']));
    expect(names).not.toContain('Island');
    expect(new Set(names).size).toBe(names.length);
    const cards = new Map<string, CardInfo>(
      names.map((n) => [n, { name: n, found: true, manaCost: '{1}', typeLine: 'Instant', oracleText: `${n} does a thing.`, producedMana: [], colors: [] }]),
    );
    const p = buildReviewPrompt(comfort, cards, { guide: 'Play lands.' });
    expect(p.system).toMatch(/at most three/);
    expect(p.system).toMatch(/What went well/);
    expect(p.user).toContain(summarizeGame(comfort));
    expect(p.user).toContain('Depower {1} — Instant\n  Depower does a thing.');
    expect(p.user).toContain('# My deck play guide\nPlay lands.');
    expect(buildReviewPrompt(comfort, cards)).toEqual(buildReviewPrompt(comfort, cards));
    expect(p.user.length).toBeLessThan(12_000);
  });

  it('tokens are not looked up as cards', () => {
    expect(reviewCardNames(auto)).not.toContain('Soldier Token');
  });
});

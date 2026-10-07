// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { confidenceLevel, parseCoachAnswer, parseTerseAnswer, statedOf } from './coachAnswer.ts';
import { coachSystem, COACH_SYSTEM } from './prompt.ts';

describe('parseCoachAnswer', () => {
  const classic = [
    '**Play:**',
    '1. Attack with Grizzly Bears.',
    '**Why:** They have no flyers.',
    '**Rule:** count lethal.',
    '**Confidence:** low — the Wall might block.',
    '**Trap:** casting the bear first.',
  ].join('\n');

  it('reads the rule and the stated confidence, and takes them out of the body', () => {
    const p = parseCoachAnswer(classic);
    expect(p).toMatchObject({ answer: null, rule: 'count lethal', confidence: 'low', confidenceWhy: 'the Wall might block' });
    expect(p.body).not.toMatch(/Rule:|Confidence:/);
    expect(p.body).toMatch(/\*\*Trap:\*\*/);
  });

  it('reads the answer-first header', () => {
    const p = parseCoachAnswer('**Answer:** Attack with both Bears, keep the Wall home.\n**Confidence:** High\n**Rule:** "trade on your terms"\n**Play:** …');
    expect(p).toMatchObject({ answer: 'Attack with both Bears, keep the Wall home.', confidence: 'high', confidenceWhy: null, rule: 'trade on your terms' });
    expect(p.body.startsWith('**Play:**')).toBe(true);
  });

  it('ignores an unfinished last line while streaming, and reads it once complete', () => {
    expect(parseCoachAnswer('**Answer:** Attack with', { complete: false }).answer).toBeNull();
    expect(parseCoachAnswer('**Answer:** Attack with both\n', { complete: false }).answer).toBe('Attack with both');
    expect(parseCoachAnswer('**Confidence:** hi', { complete: false }).confidence).toBeNull();
  });

  it('accepts the label variants a model writes', () => {
    expect(parseCoachAnswer('- **Confidence: medium** (two lines are close)').confidence).toBe('medium');
    expect(parseCoachAnswer('Confidence: moderate').confidence).toBe('medium');
    expect(parseCoachAnswer('**Confidence:** unsure').confidence).toBeNull();
    expect(confidenceLevel('LOW')).toBe('low');
    expect(statedOf(classic)).toEqual({ confidence: 'low', rule: 'count lethal' });
    expect(statedOf('no labels here')).toEqual({});
  });
});

describe('the answer formats', () => {
  it('classic is the default and asks for the rule and the confidence after the play', () => {
    expect(coachSystem()).toBe(COACH_SYSTEM);
    const i = (s: string) => COACH_SYSTEM.indexOf(s);
    expect(i('**Play:**')).toBeLessThan(i('**Rule:**'));
    expect(i('**Rule:**')).toBeLessThan(i('**Confidence:**'));
    expect(COACH_SYSTEM).not.toContain('**Answer:**');
  });
  it('answer-first puts the one-line answer, its confidence and rule before the play', () => {
    const s = coachSystem('answer-first');
    const i = (x: string) => s.indexOf(x);
    expect(i('**Answer:**')).toBeGreaterThan(0);
    expect(i('**Answer:**')).toBeLessThan(i('**Confidence:**'));
    expect(i('**Confidence:**')).toBeLessThan(i('**Play:**'));
  });
});

describe('parseTerseAnswer (the short style)', () => {
  const ANSWER = [
    'Play: Land — Mountain',
    'Play: Cast Shock → their Grizzly Bears',
    'Mana: R from Mountain',
    'Attack: Goblin Guide → opponent',
    'Why: clear the blocker, then swing',
    '---',
    '**Rule:** trade on your terms',
    '**Confidence:** medium — they may have a trick',
    '**Details:** Holding Shock is tempting but the Bears block every turn.',
  ].join('\n');

  it('reads the commands in order, the why, and keeps the rest for More', () => {
    const p = parseTerseAnswer(ANSWER);
    expect(p.terse).toBe(true);
    expect(p.commands).toEqual([
      { label: 'Play', text: 'Land — Mountain' },
      { label: 'Play', text: 'Cast Shock → their Grizzly Bears' },
      { label: 'Mana', text: 'R from Mountain' },
      { label: 'Attack', text: 'Goblin Guide → opponent' },
    ]);
    expect(p.why).toBe('clear the blocker, then swing');
    expect(p.rule).toBe('trade on your terms');
    expect(p.confidence).toBe('medium');
    expect(p.confidenceWhy).toBe('they may have a trick');
    expect(p.more).toBe('**Details:** Holding Shock is tempting but the Bears block every turn.');
    expect(p.mainDone).toBe(true);
  });

  it('the bench still reads its rule and confidence (statedOf)', () => {
    expect(statedOf(ANSWER)).toEqual({ confidence: 'medium', rule: 'trade on your terms' });
  });

  it('while streaming, nothing after the "---" reaches the main lines, and a half-written label is not shown', () => {
    const p = parseTerseAnswer('Block: Wall → their 3/3\nWhy: the Wall survives\n---\n**Rule:** blo', { complete: false });
    expect(p.commands).toEqual([{ label: 'Block', text: 'Wall → their 3/3' }]);
    expect(p.why).toBe('the Wall survives');
    expect(p.rule).toBeNull();
    expect(p.mainDone).toBe(true);
    const q = parseTerseAnswer('Hold: Bolt for their flyer\nWh', { complete: false });
    expect(q.commands).toEqual([{ label: 'Hold', text: 'Bolt for their flyer' }]);
    expect(q.mainDone).toBe(false);
    const r = parseTerseAnswer('Play: Cast Lightning Bo', { complete: false });
    expect(r.commands).toEqual([{ label: 'Play', text: 'Cast Lightning Bo' }]);
  });

  it('opponent-turn answers: one command and a why', () => {
    const p = parseTerseAnswer('Hold: keep Bolt for their flyer\nWhy: it is their only evasive threat');
    expect(p.commands).toEqual([{ label: 'Hold', text: 'keep Bolt for their flyer' }]);
    expect(p.why).toBe('it is their only evasive threat');
  });

  it('bold labels, list markers, bare Keep / Mulligan and an "If you draw" line', () => {
    const p = parseTerseAnswer('- **Keep**\n**Why:** two lands and a curve\n1. If you draw a land: Cast Ogre turn 3');
    expect(p.commands).toEqual([
      { label: 'Keep', text: '' },
      { label: 'If you draw a land', text: 'Cast Ogre turn 3' },
    ]);
    expect(p.why).toBe('two lands and a curve');
  });

  it('a Rule or Confidence line before the "---" goes behind More, never into the commands', () => {
    const p = parseTerseAnswer('Play: Pass\n**Confidence:** high\nWhy: nothing to do');
    expect(p.commands).toEqual([{ label: 'Play', text: 'Pass' }]);
    expect(p.confidence).toBe('high');
  });

  it('a long-form answer is not terse (the panel falls back to the detailed layout)', () => {
    expect(parseTerseAnswer('You should probably attack here because the board favours you.').terse).toBe(false);
  });
});

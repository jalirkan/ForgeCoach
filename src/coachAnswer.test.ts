// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { confidenceLevel, optionNumberOf, parseCoachAnswer, statedOf } from './coachAnswer.ts';
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

describe('optionNumberOf', () => {
  it('reads the option an answer names by number, with its label', () => {
    expect(optionNumberOf('2 — Plains')).toEqual({ n: 2, rest: 'Plains' });
    expect(optionNumberOf('**2.** Plains')).toEqual({ n: 2, rest: 'Plains' });
    expect(optionNumberOf('Option 3 (pass)')).toEqual({ n: 3, rest: 'pass' });
    expect(optionNumberOf('#1')).toEqual({ n: 1, rest: '' });
    expect(optionNumberOf('`4`')).toEqual({ n: 4, rest: '' });
    expect(optionNumberOf('1 — "0"')).toEqual({ n: 1, rest: '"0"' });
  });
  it('is null for an answer that does not start with a number', () => {
    expect(optionNumberOf('Attack with both Bears')).toBeNull();
    expect(optionNumberOf('cast:12')).toBeNull();
    expect(optionNumberOf('3/3 blocks first')).toBeNull();
  });
});

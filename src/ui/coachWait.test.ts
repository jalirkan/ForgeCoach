// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { isHelperThinking, thinkingLine, type WaitFacts } from './coachWait.ts';

const at = (p: Partial<WaitFacts>): WaitFacts => ({ status: 'streaming', text: '', source: 'helper', thinkingSince: 1_000, ...p });

describe('the coach helper "thinking…" line', () => {
  it('shows while the helper has the question and no word has come, with the seconds so far', () => {
    expect(thinkingLine(at({}), 1_400)).toBe('Claude Code is thinking…');
    expect(thinkingLine(at({}), 13_900)).toBe('Claude Code is thinking… 12 s');
    expect(isHelperThinking(at({}))).toBe(true);
  });

  it('is gone once text arrives, while queued, before the request, after the end, and for the API key', () => {
    expect(thinkingLine(at({ text: 'Keep' }), 5_000)).toBeNull();
    expect(thinkingLine(at({ status: 'queued', thinkingSince: null }), 5_000)).toBeNull();
    expect(thinkingLine(at({ status: 'preparing', thinkingSince: null }), 5_000)).toBeNull();
    expect(thinkingLine(at({ status: 'done' }), 5_000)).toBeNull();
    expect(thinkingLine(at({ status: 'stopped' }), 5_000)).toBeNull();
    expect(thinkingLine(at({ source: 'apiKey', thinkingSince: null }), 5_000)).toBeNull();
    expect(thinkingLine(at({ thinkingSince: null }), 5_000)).toBeNull();
    expect(thinkingLine(undefined, 5_000)).toBeNull();
  });

  it('never counts below zero (a clock that steps back)', () => {
    expect(thinkingLine(at({}), 0)).toBe('Claude Code is thinking…');
  });
});

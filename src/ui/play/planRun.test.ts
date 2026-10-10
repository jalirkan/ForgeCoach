// SPDX-License-Identifier: GPL-3.0-or-later
// Plan mode's run of one moment (planRun.ts) on a REAL recorded moment: Sonnet's
// turn-14 reply that cast Brazen Borrower twice (the seat's one failed step that
// game) is checked, sent back with the reason as a fresh call, and Sonnet's real
// corrected reply stands. The coach helper is faked; everything else is real.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Settings } from '../../claude.ts';
import type { HelperStatus } from '../../coachHelper.ts';
import { readFileSync } from 'node:fs';

const h = vi.hoisted(() => ({
  settings: { apiKey: '', model: 'claude-opus-5-5', coachSource: 'auto' } as Settings,
  helper: null as HelperStatus | null,
  replies: [] as string[],
  prompts: [] as Array<{ system: string; user: string }>,
  opts: [] as Array<Record<string, unknown>>,
}));

vi.mock('../../claude.ts', async (orig) => {
  const real = await orig<typeof import('../../claude.ts')>();
  return { ...real, loadSettings: () => h.settings };
});

vi.mock('../../coachHelper.ts', async (orig) => {
  const real = await orig<typeof import('../../coachHelper.ts')>();
  return {
    ...real,
    pageHelperTarget: () => ({ baseUrl: 'http://127.0.0.1:8643', token: null }),
    peekHelper: () => h.helper,
    helperFresh: () => true,
    detectHelper: vi.fn(async () => h.helper),
    askHelper: vi.fn(async (p: { system: string; user: string }, hs: { onText(d: string): void }, opts: Record<string, unknown>) => {
      h.prompts.push(p);
      h.opts.push(opts);
      const text = h.replies.shift() ?? 'PLAN: nothing.\nSTEPS:\n1. pass\nEND';
      hs.onText(text);
      return { text, stopReason: 'end_turn', refused: false, model: 'sonnet' };
    }),
  };
});

vi.mock('../cardData.ts', async () => {
  const { cardsFor } = await import('../../livePlan/testdata/load.ts');
  return { cardsForPrompt: async (names: string[]) => cardsFor(names), cachedMap: (names: string[]) => cardsFor(names), prefetchCards: () => undefined };
});

import { MOMENTS, snapshotOf as fixtureSnapshot } from '../../livePlan/testdata/load.ts';
import { momentOf } from '../../livePlan/coach.ts';
import { oracleFromCards } from '../../livePlan/oracle.ts';
import { cardsFor } from '../../livePlan/testdata/load.ts';
import { visibleNames } from '../../livePlan/history.ts';
import { clearAnswers, getAnswer } from '../answers.ts';
import { adviceFor, gameKeyOf, momentAnswerKey, resetAdvice } from './autoPlan.ts';
import { runPlanMoment, runStatus } from './planRun.ts';
import { liveDecision } from './liveDecision.ts';

vi.stubGlobal('requestAnimationFrame', (f: () => void) => setTimeout(f, 0));

const OK: HelperStatus = { state: 'ok', baseUrl: 'http://127.0.0.1:8643', claude: '2.1.7', models: ['opus', 'sonnet', 'haiku'], checkedAt: 0, supersedes: true, replaceRunning: true, thinking: ['default', 'low', 'off'] } as HelperStatus;

const ALL = (JSON.parse(readFileSync(new URL('../../livePlan/testdata/moments.json', import.meta.url), 'utf8')) as { all: Array<{ log: string; momentNo: number; replies: string[] }> }).all;

beforeEach(() => {
  vi.clearAllMocks();
  clearAnswers();
  resetAdvice();
  h.settings = { apiKey: '', model: 'claude-opus-5-5', coachSource: 'auto' };
  h.helper = OK;
  h.replies = [];
  h.prompts = [];
  h.opts = [];
});

function setUp() {
  const m = MOMENTS.find((x) => x.log === 's2-search-p0-s6-001' && x.momentNo === 19)!;
  const { log, snap, seat } = fixtureSnapshot(m);
  const sub = { ...log, frames: log.frames.slice(0, snap.frameIndex + 1) };
  const d = liveDecision({ log: sub, state: snap.state, input: snap.input, ask: snap.ask, seat })!;
  const moment = momentOf(log, snap, seat, oracleFromCards(cardsFor(visibleNames(snap.state))))!;
  const game = gameKeyOf(log, seat)!;
  return { m, log, seat, d, moment, game, base: momentAnswerKey(game, moment.id) };
}

describe('a plan-mode moment', () => {
  it('checks the reply, sends the step that cannot be done back as a fresh call, and keeps the corrected plan', async () => {
    const { m, log, seat, d, moment, game, base } = setUp();
    const corrected = ALL.find((x) => x.log === m.log && x.momentNo === 20)!.replies[0]!;
    h.replies = [m.reply, corrected];
    await runPlanMoment({ game, base, kind: 'plan', moment, log, seat, decision: d, slot: `plan:${game}`, supersedes: 'live-coach:t:plan' });
    expect(h.prompts).toHaveLength(2);
    // both fresh, both the full prompt; the second opens with the reason
    expect(h.prompts[0]!.user.startsWith('It is your turn 14. What do you do this turn?\n\nGAME SO FAR')).toBe(true);
    expect(h.prompts[1]!.user.split('\n')[0]).toBe("Step 2 'cast Brazen Borrower' cannot be done: Brazen Borrower is already cast by an earlier step.");
    expect(h.prompts[1]!.user).toContain('\nGAME SO FAR');
    expect(h.prompts[1]!.system).toBe(h.prompts[0]!.system);
    // Sonnet, low thinking: as the seat was tested
    expect(h.opts[0]).toMatchObject({ model: 'claude-sonnet-5-5', thinking: 'low', supersedes: 'live-coach:t:plan', replaceRunning: true });
    const entry = adviceFor(game)[0]!;
    expect(entry).toMatchObject({ key: `${base}~c1`, attempt: 1, kind: 'plan', label: 'Your turn 14' });
    expect(getAnswer(entry.key)).toMatchObject({ status: 'done', text: corrected });
    expect(runStatus(base)).toMatchObject({ phase: 'done', attempt: 1 });
  });

  it('stops after two corrections and keeps the last plan', async () => {
    const { m, log, seat, d, moment, game, base } = setUp();
    h.replies = [m.reply, m.reply, m.reply, m.reply];
    await runPlanMoment({ game, base, kind: 'plan', moment, log, seat, decision: d, slot: `plan:${game}`, supersedes: 's' });
    expect(h.prompts).toHaveLength(3);
    expect(h.prompts[2]!.user).toContain('(Correction 2 of 2.)');
    expect(adviceFor(game)).toHaveLength(1);
    expect(adviceFor(game)[0]).toMatchObject({ key: `${base}~c2`, attempt: 2 });
  });

  it('a reply that reads and checks out is asked once', async () => {
    const { log, seat, d, moment, game, base } = setUp();
    h.replies = ['Keep the Borrower for their next threat.\nPLAN: Attack with the birds.\nSTEPS:\n1. attack with Bird Token #140, Bird Token #141\n2. hold\nEND'];
    await runPlanMoment({ game, base, kind: 'plan', moment, log, seat, decision: d, slot: `plan:${game}`, supersedes: 's' });
    expect(h.prompts).toHaveLength(1);
    expect(adviceFor(game)[0]).toMatchObject({ key: base, attempt: 0 });
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Settings } from '../claude.ts';
import type { HelperStatus } from '../coachHelper.ts';

const h = vi.hoisted(() => ({
  settings: { apiKey: '', model: 'claude-opus-5-5', coachSource: 'auto' } as Settings,
  helper: null as HelperStatus | null,
  fresh: false,
}));

vi.mock('../claude.ts', () => ({
  loadSettings: () => h.settings,
  askClaude: vi.fn(async (_p: unknown, hs: { onText(d: string): void }) => {
    hs.onText('key answer');
    return { text: 'key answer', stopReason: 'end_turn', refused: false, model: 'claude-opus-5-5' };
  }),
}));

vi.mock('../coachHelper.ts', async (orig) => {
  const real = await orig<typeof import('../coachHelper.ts')>();
  return {
    chooseSource: real.chooseSource,
    pageHelperTarget: () => ({ baseUrl: 'http://127.0.0.1:8643', token: null }),
    peekHelper: () => h.helper,
    helperFresh: () => h.fresh,
    detectHelper: vi.fn(async () => h.helper),
    askHelper: vi.fn(async (_p: unknown, hs: { onText(d: string): void }, opts: { model?: string }) => {
      hs.onText('helper answer');
      return { text: 'helper answer', stopReason: 'end_turn', refused: false, model: opts.model === 'claude-haiku-4-5' ? 'haiku' : 'opus' };
    }),
  };
});

import { answerBusy, getAnswer, startAnswer, stopAnswer } from './answers.ts';
import { askClaude } from '../claude.ts';
import { askHelper, detectHelper } from '../coachHelper.ts';

vi.stubGlobal('requestAnimationFrame', (f: () => void) => setTimeout(f, 0));

const OK: HelperStatus = { state: 'ok', baseUrl: 'http://127.0.0.1:8643', claude: '2.1.7', models: ['opus', 'sonnet', 'haiku'], checkedAt: 0 };
const DOWN: HelperStatus = { state: 'down', baseUrl: 'http://127.0.0.1:8643', reason: 'not_running', message: 'not running', checkedAt: 0 };

beforeEach(() => {
  vi.clearAllMocks();
  h.settings = { apiKey: '', model: 'claude-opus-5-5', coachSource: 'auto' };
  h.helper = null;
  h.fresh = false;
});

describe('startAnswer without any coach', () => {
  it('reports no_key without building the prompt or calling anything (helper known to be down)', async () => {
    h.helper = DOWN;
    h.fresh = true;
    const makePrompt = vi.fn(async () => ({ system: 's', user: 'u' }));
    await startAnswer('k', makePrompt);
    expect(makePrompt).not.toHaveBeenCalled();
    expect(detectHelper).not.toHaveBeenCalled();
    expect(getAnswer('k')).toMatchObject({ status: 'error', errorKind: 'no_key', error: expect.stringMatching(/play\.sh/) });
    expect(askClaude).not.toHaveBeenCalled();
    expect(askHelper).not.toHaveBeenCalled();
  });

  it('asks the helper first when its status is unknown', async () => {
    h.helper = DOWN; // what detection will find
    await startAnswer('k2', vi.fn());
    expect(detectHelper).toHaveBeenCalledTimes(1);
    expect(getAnswer('k2')).toMatchObject({ status: 'error', errorKind: 'no_key' });
  });

  it('API-key source with no key keeps the old message and never looks for the helper', async () => {
    h.settings = { ...h.settings, coachSource: 'apiKey' };
    h.helper = OK;
    await startAnswer('k3', vi.fn());
    expect(detectHelper).not.toHaveBeenCalled();
    expect(getAnswer('k3')).toMatchObject({ status: 'error', errorKind: 'no_key', error: expect.stringMatching(/^Add your Anthropic API key/) });
  });
});

describe('startAnswer source selection', () => {
  it('auto uses Claude Code on the PC when detected, with the mapped model', async () => {
    h.helper = OK;
    h.fresh = true;
    h.settings = { apiKey: 'sk-ant-x', model: 'claude-haiku-4-5', coachSource: 'auto' };
    await startAnswer('a1', async () => ({ system: 's', user: 'u' }));
    expect(askHelper).toHaveBeenCalledTimes(1);
    expect(vi.mocked(askHelper).mock.calls[0]![2]).toMatchObject({ model: 'claude-haiku-4-5' });
    expect(askClaude).not.toHaveBeenCalled();
    expect(getAnswer('a1')).toMatchObject({ status: 'done', source: 'helper', text: 'helper answer', model: 'haiku' });
  });

  it('auto falls back to the API key when the helper is not running', async () => {
    h.helper = DOWN;
    h.fresh = true;
    h.settings = { apiKey: 'sk-ant-x', model: 'claude-opus-5-5', coachSource: 'auto' };
    await startAnswer('a2', async () => ({ system: 's', user: 'u' }));
    expect(askHelper).not.toHaveBeenCalled();
    expect(askClaude).toHaveBeenCalledTimes(1);
    expect(getAnswer('a2')).toMatchObject({ status: 'done', source: 'apiKey', text: 'key answer' });
  });

  it('the helper source asks the helper even when detection says it is down (its error explains)', async () => {
    h.helper = DOWN;
    h.fresh = true;
    h.settings = { apiKey: 'sk-ant-x', model: 'claude-opus-5-5', coachSource: 'helper' };
    await startAnswer('a3', async () => ({ system: 's', user: 'u' }));
    expect(askHelper).toHaveBeenCalledTimes(1);
    expect(askClaude).not.toHaveBeenCalled();
  });

  it('the API-key source never uses the helper', async () => {
    h.helper = OK;
    h.fresh = true;
    h.settings = { apiKey: 'sk-ant-x', model: 'claude-opus-5-5', coachSource: 'apiKey' };
    await startAnswer('a4', async () => ({ system: 's', user: 'u' }));
    expect(askHelper).not.toHaveBeenCalled();
    expect(getAnswer('a4')).toMatchObject({ status: 'done', source: 'apiKey' });
  });

  it('reports a helper error with its kind', async () => {
    h.helper = OK;
    h.fresh = true;
    vi.mocked(askHelper).mockRejectedValueOnce(Object.assign(new Error('Claude Code on your PC is busy'), { kind: 'helper_busy' }));
    await startAnswer('a5', async () => ({ system: 's', user: 'u' }));
    expect(getAnswer('a5')).toMatchObject({ status: 'error', errorKind: 'helper_busy', source: 'helper' });
  });
});

describe('the coach helper queue (D325)', () => {
  const QOK: HelperStatus = { ...OK, state: 'ok', queue: { max: 4, length: 0 }, concurrency: 1, supersedes: true } as HelperStatus;

  it('shows a queued question as waiting, with its position, until its turn comes', async () => {
    h.helper = QOK;
    h.fresh = true;
    const seen: (string | null)[] = [];
    vi.mocked(askHelper).mockImplementationOnce(async (_p, hs, opts) => {
      opts!.onQueued!(2);
      seen.push(`${getAnswer('q1')?.status} ${getAnswer('q1')?.queuePosition}`);
      opts!.onRunning!();
      seen.push(`${getAnswer('q1')?.status} ${getAnswer('q1')?.queuePosition}`);
      hs.onText('Hold.');
      return { text: 'Hold.', stopReason: 'end_turn', refused: false, model: 'sonnet' };
    });
    await startAnswer('q1', async () => ({ system: 's', user: 'u' }));
    expect(seen).toEqual(['queued 2', 'streaming null']);
    expect(getAnswer('q1')).toMatchObject({ status: 'done', text: 'Hold.' });
  });

  it('sends the supersede key only to a helper that supports it', async () => {
    h.helper = QOK;
    h.fresh = true;
    await startAnswer('q2', async () => ({ system: 's', user: 'u' }), { supersedes: 'live-coach:x' });
    expect(vi.mocked(askHelper).mock.calls[0]![2]).toMatchObject({ supersedes: 'live-coach:x' });
    h.helper = OK;
    await startAnswer('q3', async () => ({ system: 's', user: 'u' }), { supersedes: 'live-coach:x' });
    expect(vi.mocked(askHelper).mock.calls[1]![2]).not.toHaveProperty('supersedes');
  });

  it('a superseded question reads as stopped, not as an error', async () => {
    h.helper = QOK;
    h.fresh = true;
    vi.mocked(askHelper).mockRejectedValueOnce(Object.assign(new Error('A newer question took this one’s place.'), { kind: 'superseded' }));
    await startAnswer('q4', async () => ({ system: 's', user: 'u' }));
    expect(getAnswer('q4')).toMatchObject({ status: 'stopped', stopReasonNote: 'superseded' });
  });

  it('a stale question is stopped with its reason, and is no longer busy', async () => {
    h.helper = QOK;
    h.fresh = true;
    let signal: AbortSignal | undefined;
    vi.mocked(askHelper).mockImplementationOnce(
      (_p, _hs, opts) =>
        new Promise((_res, rej) => {
          signal = opts!.signal;
          opts!.onQueued!(1);
          signal!.addEventListener('abort', () => rej(Object.assign(new Error('Request cancelled.'), { kind: 'aborted' })));
        }),
    );
    const run = startAnswer('q5', async () => ({ system: 's', user: 'u' }));
    await vi.waitFor(() => expect(getAnswer('q5')?.status).toBe('queued'));
    expect(answerBusy('q5')).toBe(true);
    stopAnswer('q5', 'moved_on');
    await run;
    expect(signal!.aborted).toBe(true);
    expect(answerBusy('q5')).toBe(false);
    expect(getAnswer('q5')).toMatchObject({ status: 'stopped', stopReasonNote: 'moved_on', queuePosition: null });
  });
});

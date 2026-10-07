import Anthropic from '@anthropic-ai/sdk';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { askClaude, buildRequest, friendlyError, hasKey, isLiveModel, LIVE_FAST_MODEL, LIVE_THINKING, liveModelOf, liveThinkingOf, loadSdk, loadSettings, onSettingsChange, saveSettings, SETTINGS_KEY, type Settings } from './claude.ts';

const prompt = { system: 'You are a Magic coach.', user: 'Should I attack?' };
const settings: Settings = { apiKey: 'sk-ant-test', model: 'claude-opus-5-5', coachSource: 'apiKey' };

function sse(events: Array<Record<string, unknown>>): Response {
  const body = events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join('');
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

function message(model: string, stopReason: string, blocks: Array<Record<string, unknown>>, stopDetails: unknown = null) {
  const events: Array<Record<string, unknown>> = [
    {
      type: 'message_start',
      message: { id: 'msg_1', type: 'message', role: 'assistant', model, content: [], stop_reason: null, stop_sequence: null, stop_details: null, usage: { input_tokens: 10, output_tokens: 0 } },
    },
  ];
  blocks.forEach((b, index) => {
    if (b.type === 'text') {
      events.push({ type: 'content_block_start', index, content_block: { type: 'text', text: '' } });
      for (const piece of b.pieces as string[]) events.push({ type: 'content_block_delta', index, delta: { type: 'text_delta', text: piece } });
    } else if (b.type === 'thinking') {
      events.push({ type: 'content_block_start', index, content_block: { type: 'thinking', thinking: '', signature: '' } });
      events.push({ type: 'content_block_delta', index, delta: { type: 'thinking_delta', thinking: b.thinking } });
      events.push({ type: 'content_block_delta', index, delta: { type: 'signature_delta', signature: 'sig' } });
    } else {
      events.push({ type: 'content_block_start', index, content_block: b });
    }
    events.push({ type: 'content_block_stop', index });
  });
  events.push({ type: 'message_delta', delta: { stop_reason: stopReason, stop_sequence: null, stop_details: stopDetails }, usage: { output_tokens: 20 } });
  events.push({ type: 'message_stop' });
  return sse(events);
}

beforeAll(async () => {
  await loadSdk();
});

let requests: Array<{ url: string; headers: Headers; body: Record<string, unknown> }>;

function stubFetch(respond: () => Response | Promise<Response>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(url), headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) });
      return respond();
    }),
  );
}

beforeEach(() => {
  requests = [];
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('buildRequest', () => {
  it('uses adaptive thinking, medium effort and default fallbacks on Opus/Sonnet', () => {
    for (const model of ['claude-opus-5-5', 'claude-sonnet-5-5'] as const) {
      expect(buildRequest(prompt, model)).toEqual({
        model,
        max_tokens: 64000,
        system: [{ type: 'text', text: prompt.system, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: prompt.user }],
        thinking: { type: 'adaptive', display: 'summarized' },
        output_config: { effort: 'medium' },
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
      });
    }
  });
  it('uses a thinking budget and no effort/fallbacks on Haiku 4.5', () => {
    const r = buildRequest(prompt, 'claude-haiku-4-5');
    expect(r.thinking).toEqual({ type: 'enabled', budget_tokens: 8000 });
    expect(r).not.toHaveProperty('output_config');
    expect(r).not.toHaveProperty('fallbacks');
    expect(r).not.toHaveProperty('betas');
  });
});

describe('askClaude', () => {
  it('rejects without a key, before any request', async () => {
    stubFetch(() => message('x', 'end_turn', []));
    await expect(askClaude(prompt, { onText() {} }, { settings: { apiKey: ' ', model: 'claude-opus-5-5', coachSource: 'apiKey' } })).rejects.toMatchObject({ kind: 'no_key' });
    expect(requests).toHaveLength(0);
  });

  it('streams text and thinking and sends the expected request', async () => {
    stubFetch(() => message('claude-opus-5-5', 'end_turn', [{ type: 'thinking', thinking: 'hmm' }, { type: 'text', pieces: ['Attack ', 'with the bear.'] }]));
    const text: string[] = [];
    const thinking: string[] = [];
    const r = await askClaude(prompt, { onText: (d) => text.push(d), onThinking: (d) => thinking.push(d) }, { settings });

    expect(text).toEqual(['Attack ', 'with the bear.']);
    expect(thinking).toEqual(['hmm']);
    expect(r).toEqual({ text: 'Attack with the bear.', stopReason: 'end_turn', refused: false, model: 'claude-opus-5-5' });

    expect(requests).toHaveLength(1);
    const req = requests[0];
    expect(req.url).toBe('https://api.anthropic.com/v1/messages?beta=true');
    expect(req.headers.get('x-api-key')).toBe('sk-ant-test');
    expect(req.headers.get('anthropic-beta')).toBe('server-side-fallback-2026-07-01');
    expect(req.headers.get('anthropic-dangerous-direct-browser-access')).toBe('true');
    expect(req.body).toEqual({
      model: 'claude-opus-5-5',
      max_tokens: 64000,
      system: [{ type: 'text', text: prompt.system, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: prompt.user }],
      thinking: { type: 'adaptive', display: 'summarized' },
      output_config: { effort: 'medium' },
      fallbacks: 'default',
      stream: true,
    });
  });

  it('reports refusals and keeps partial text', async () => {
    stubFetch(() => message('claude-opus-5-5', 'refusal', [{ type: 'text', pieces: ['Partial'] }], { type: 'refusal', category: 'cyber', explanation: null }));
    const r = await askClaude(prompt, { onText() {} }, { settings });
    expect(r).toMatchObject({ refused: true, stopReason: 'refusal', text: 'Partial', refusalCategory: 'cyber' });
  });

  it('reports the model that actually answered after a fallback', async () => {
    stubFetch(() =>
      message('claude-opus-4-8', 'end_turn', [
        { type: 'fallback', from: { model: 'claude-opus-5-5' }, to: { model: 'claude-opus-4-8' }, trigger: { type: 'refusal' } },
        { type: 'text', pieces: ['Block with the wall.'] },
      ]),
    );
    const r = await askClaude(prompt, { onText() {} }, { settings });
    expect(r).toMatchObject({ model: 'claude-opus-4-8', fallbackFrom: 'claude-opus-5-5', refused: false, text: 'Block with the wall.' });
  });

  it('maps a 401 to a friendly error', async () => {
    stubFetch(() => new Response(JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }), { status: 401, headers: { 'Content-Type': 'application/json' } }));
    await expect(askClaude(prompt, { onText() {} }, { settings })).rejects.toMatchObject({ kind: 'auth', status: 401 });
    expect(requests).toHaveLength(1); // 401 is not retried
  });
});

describe('friendlyError', () => {
  const h = new Headers();
  it('maps status codes and network errors', () => {
    expect(friendlyError(new Anthropic.RateLimitError(429, {}, 'x', h)).kind).toBe('rate_limit');
    expect(friendlyError(new Anthropic.InternalServerError(529, { type: 'error', error: { type: 'overloaded_error' } }, 'x', h, 'overloaded_error')).kind).toBe('overloaded');
    expect(friendlyError(new Anthropic.InternalServerError(500, {}, 'x', h)).kind).toBe('server');
    expect(friendlyError(new Anthropic.APIConnectionError({ message: 'Connection error.' })).kind).toBe('network');
    expect(friendlyError(new TypeError('Failed to fetch')).kind).toBe('network');
    expect(friendlyError(new Anthropic.APIUserAbortError()).name).toBe('AbortError');
    expect(friendlyError(new Anthropic.BadRequestError(400, { error: { message: 'Your credit balance is too low' } }, 'x', h)).message).toMatch(/out of credits/);
  });
});

describe('settings', () => {
  it('round-trips through localStorage and validates the model', () => {
    const mem = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => void mem.set(k, v),
    });
    expect(loadSettings()).toEqual({ apiKey: '', model: 'claude-opus-5-5', liveModel: 'auto', coachSource: 'auto', answerFirst: false, coachThinking: 'default', coachStyle: 'short', skin: 'stack', winChance: false });
    expect(hasKey()).toBe(false);
    saveSettings({ apiKey: ' sk-ant-abc ', model: 'claude-haiku-4-5', coachSource: 'helper' });
    expect(JSON.parse(mem.get(SETTINGS_KEY)!)).toEqual({ apiKey: 'sk-ant-abc', model: 'claude-haiku-4-5', liveModel: 'auto', coachSource: 'helper', answerFirst: false, coachThinking: 'default', coachStyle: 'short', skin: 'stack', winChance: false });
    expect(loadSettings()).toEqual({ apiKey: 'sk-ant-abc', model: 'claude-haiku-4-5', liveModel: 'auto', coachSource: 'helper', answerFirst: false, coachThinking: 'default', coachStyle: 'short', skin: 'stack', winChance: false });
    expect(hasKey()).toBe(true);
    mem.set(SETTINGS_KEY, JSON.stringify({ apiKey: 'k', model: 'gpt-4', coachSource: 'cloud' }));
    expect(loadSettings().model).toBe('claude-opus-5-5');
    expect(loadSettings().coachSource).toBe('auto');
    saveSettings({ ...loadSettings(), answerFirst: true });
    expect(loadSettings().answerFirst).toBe(true);
    mem.set(SETTINGS_KEY, JSON.stringify({ apiKey: 'k', answerFirst: 'yes' }));
    expect(loadSettings().answerFirst).toBe(false);
    mem.set(SETTINGS_KEY, '{not json');
    expect(loadSettings()).toEqual({ apiKey: '', model: 'claude-opus-5-5', liveModel: 'auto', coachSource: 'auto', answerFirst: false, coachThinking: 'default', coachStyle: 'short', skin: 'stack', winChance: false });
  });
  it('migrates settings saved before the coach source existed to auto, keeping key and model', () => {
    const mem = new Map<string, string>([[SETTINGS_KEY, JSON.stringify({ apiKey: 'sk-ant-old', model: 'claude-sonnet-5-5' })]]);
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => void mem.set(k, v),
    });
    expect(loadSettings()).toEqual({ apiKey: 'sk-ant-old', model: 'claude-sonnet-5-5', liveModel: 'auto', coachSource: 'auto', answerFirst: false, coachThinking: 'default', coachStyle: 'short', skin: 'stack', winChance: false });
    const seen = vi.fn();
    const off = onSettingsChange(seen);
    saveSettings({ ...loadSettings(), coachSource: 'apiKey' });
    off();
    expect(seen).toHaveBeenCalledTimes(1);
    expect(loadSettings()).toEqual({ apiKey: 'sk-ant-old', model: 'claude-sonnet-5-5', liveModel: 'auto', coachSource: 'apiKey', answerFirst: false, coachThinking: 'default', coachStyle: 'short', skin: 'stack', winChance: false });
  });
  it('keeps the coach thinking choice (D346), and reads a missing or bad one as default', () => {
    const mem = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => void mem.set(k, v),
    });
    saveSettings({ apiKey: '', model: 'claude-haiku-4-5', coachSource: 'helper', coachThinking: 'off' });
    expect(JSON.parse(mem.get(SETTINGS_KEY)!)).toMatchObject({ coachThinking: 'off' });
    expect(loadSettings().coachThinking).toBe('off');
    saveSettings({ ...loadSettings(), coachThinking: 'low' });
    expect(loadSettings().coachThinking).toBe('low');
    mem.set(SETTINGS_KEY, JSON.stringify({ apiKey: 'k', coachThinking: 'none' }));
    expect(loadSettings().coachThinking).toBe('default');
    saveSettings({ apiKey: 'k', model: 'claude-opus-5-5', coachSource: 'auto', coachThinking: 'max' as never });
    expect(JSON.parse(mem.get(SETTINGS_KEY)!).coachThinking).toBe('default');
  });
  it('keeps the skin, defaults to stack, and reads a bad stored skin as stack', () => {
    const mem = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => void mem.set(k, v),
    });
    expect(loadSettings().skin).toBe('stack');
    saveSettings({ ...loadSettings(), skin: 'felt' });
    expect(JSON.parse(mem.get(SETTINGS_KEY)!).skin).toBe('felt');
    expect(loadSettings().skin).toBe('felt');
    saveSettings({ ...loadSettings(), skin: 'stack' });
    expect(loadSettings().skin).toBe('stack');
    mem.set(SETTINGS_KEY, JSON.stringify({ apiKey: 'k', skin: 'neon' }));
    expect(loadSettings().skin).toBe('stack');
    mem.set(SETTINGS_KEY, JSON.stringify({ apiKey: 'k', skin: 7 }));
    expect(loadSettings().skin).toBe('stack');
    saveSettings({ ...loadSettings(), skin: 'neon' as never });
    expect(JSON.parse(mem.get(SETTINGS_KEY)!).skin).toBe('stack');
  });
  it('reads the skin as stack when storage throws', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    });
    expect(loadSettings().skin).toBe('stack');
    expect(() => saveSettings({ ...loadSettings(), skin: 'stack' })).not.toThrow();
  });
  it('works without localStorage', () => {
    vi.stubGlobal('localStorage', undefined);
    expect(loadSettings()).toEqual({ apiKey: '', model: 'claude-opus-5-5', liveModel: 'auto', coachSource: 'auto', answerFirst: false, coachThinking: 'default', coachStyle: 'short', skin: 'stack', winChance: false });
    expect(() => saveSettings({ apiKey: 'x', model: 'claude-opus-5-5', coachSource: 'auto' })).not.toThrow();
  });
});

describe('the live coach model and thinking', () => {
  it('Automatic is the fast live model unless Model is quicker still; a chosen one is used', () => {
    expect(liveModelOf({ model: 'claude-opus-5-5' })).toBe(LIVE_FAST_MODEL);
    expect(liveModelOf({ model: 'claude-opus-5-5', liveModel: 'auto' })).toBe(LIVE_FAST_MODEL);
    expect(liveModelOf({ model: 'claude-haiku-4-5', liveModel: 'auto' })).toBe('claude-haiku-4-5');
    expect(liveModelOf({ model: 'claude-haiku-4-5', liveModel: 'claude-opus-5-5' })).toBe('claude-opus-5-5');
  });

  it('live thinking is LIVE_THINKING unless Coach thinking is set to Low or Off', () => {
    expect(liveThinkingOf({})).toBe(LIVE_THINKING);
    expect(liveThinkingOf({ coachThinking: 'default' })).toBe(LIVE_THINKING);
    expect(liveThinkingOf({ coachThinking: 'off' })).toBe('off');
    expect(liveThinkingOf({ coachThinking: 'low' })).toBe('low');
  });

  it('the live model is saved and read back; a bad value is Automatic', () => {
    expect(isLiveModel('auto')).toBe(true);
    expect(isLiveModel('claude-haiku-4-5')).toBe(true);
    expect(isLiveModel('gpt')).toBe(false);
  });
});

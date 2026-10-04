// SPDX-License-Identifier: GPL-3.0-or-later
//
// Photo to pool through both sources the coach uses, each with an injected
// fetch: mtg-table's coach helper (POST /vision, D362) and the player's API
// key (api.anthropic.com, vision content blocks). Then the answer through the
// parser, the cube-constrained matching and the review.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { askClaude, buildRequest, loadSdk, type AskPrompt, type Settings, type VisionImage } from '../claude.ts';
import { askHelper, chooseSource, detectHelper, forgetHelper, type HelperStatus, type HelperTarget } from '../coachHelper.ts';
import { buildReview, parseRecognition, photoPrompt, planAdd, rowQuestion } from './photoPool.ts';
import { fitSize } from '../ui/deck/photoImage.ts';
import { loadCube } from './testdata/load.ts';

const vintage = loadCube('vintage');
const NAMES = vintage.cards.map((c) => c.name);
const images: VisionImage[] = [
  { mediaType: 'image/jpeg', data: 'AAAAphotoONE/+==' },
  { mediaType: 'image/jpeg', data: 'BBBBphotoTWO/+==' },
];
const prompt: AskPrompt = { ...photoPrompt(vintage.title, NAMES, 2), images };
const target: HelperTarget = { baseUrl: 'http://127.0.0.1:8643', token: null };

/** What a reader might answer for two photos: a card in both, a near miss, a name outside the cube. */
const ANSWER = JSON.stringify({
  cards: [
    { name: 'Ponder', photo: 1, count: 1, confidence: 0.97, note: '' },
    { name: 'Ponder', photo: 2, count: 1, confidence: 0.9, note: 'edge of the photo' },
    { name: 'Swords to Plowshare', photo: 1, count: 1, confidence: 0.8, note: 'sleeved' },
    { name: 'Grizzly Bears', photo: 2, count: 1, confidence: 0.6, note: '' },
  ],
  unrecognised: [{ photo: 2, note: 'face down', guess: '' }],
});

function review(text: string) {
  return buildReview(parseRecognition(text, 2), NAMES, []);
}

function expectReview(text: string) {
  const m = review(text);
  expect(m.rows.map((r) => r.name)).toEqual(['Ponder', 'Swords to Plowshares']);
  expect(rowQuestion(m.rows[0]!)).toBe('photos');
  expect(m.unmatched.map((u) => u.text)).toEqual(['Grizzly Bears', '']);
  // Ponder waits for its question; the near miss is added.
  expect(planAdd(m.rows)).toMatchObject({ add: ['Swords to Plowshares'], open: [expect.objectContaining({ name: 'Ponder' })] });
}

describe('the coach helper: POST /vision (D362)', () => {
  beforeEach(() => forgetHelper());

  it('/health "vision": 1 is read', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ ok: true, helper: 1, claude: '2.1', models: ['opus'], vision: 1 }), { status: 200 }));
    expect(await detectHelper({ fetch: f, target, force: true })).toMatchObject({ state: 'ok', vision: true });
    const g = vi.fn(async () => new Response(JSON.stringify({ ok: true, helper: 1, claude: '2.1', models: ['opus'] }), { status: 200 }));
    expect(await detectHelper({ fetch: g, target, force: true })).toMatchObject({ state: 'ok', vision: false });
  });

  it('sends the images beside the prompt to /vision and streams the answer back', async () => {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    const f = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init?.body)) });
      const half = Math.floor(ANSWER.length / 2);
      const nd = [{ type: 'text', text: ANSWER.slice(0, half) }, { type: 'text', text: ANSWER.slice(half) }, { type: 'done', stopReason: 'end_turn', model: 'claude-x' }]
        .map((o) => JSON.stringify(o) + '\n')
        .join('');
      return new Response(nd, { status: 200, headers: { 'Content-Type': 'application/x-ndjson' } });
    });
    const r = await askHelper(prompt, { onText() {} }, { fetch: f, target, model: 'claude-sonnet-5-5', thinking: 'low' });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('http://127.0.0.1:8643/vision');
    expect(calls[0]!.body).toEqual({ system: prompt.system, user: prompt.user, images, model: 'sonnet', thinking: 'low' });
    expect(r.text).toBe(ANSWER);
    expectReview(r.text);
  });

  it('a question without images still goes to /coach', async () => {
    const urls: string[] = [];
    const f = vi.fn(async (url: string) => {
      urls.push(url);
      return new Response(JSON.stringify({ type: 'done', stopReason: 'end_turn', model: 'm' }) + '\n', { status: 200 });
    });
    await askHelper({ system: 's', user: 'u' }, { onText() {} }, { fetch: f, target });
    expect(urls).toEqual(['http://127.0.0.1:8643/coach']);
  });

  it('an older helper (404) says to update mtg-table; 413 says to send fewer', async () => {
    const f404 = vi.fn(async () => new Response(JSON.stringify({ type: 'error', message: 'not found' }), { status: 404 }));
    await expect(askHelper(prompt, { onText() {} }, { fetch: f404, target })).rejects.toMatchObject({ kind: 'not_found', message: expect.stringMatching(/Update mtg-table/) });
    const f413 = vi.fn(async () => new Response(JSON.stringify({ type: 'error', message: 'request too large (at most 24 MB)' }), { status: 413 }));
    await expect(askHelper(prompt, { onText() {} }, { fetch: f413, target })).rejects.toMatchObject({ message: expect.stringMatching(/fewer/) });
  });
});

describe('choosing who reads the photos', () => {
  const ok = (vision: boolean): HelperStatus => ({ state: 'ok', baseUrl: target.baseUrl, claude: '2', models: [], checkedAt: 0, vision });
  const s = (apiKey: string, coachSource: Settings['coachSource']) => ({ apiKey, coachSource });
  it('auto: the helper when it reads photos, else the key, else the helper to say "update"', () => {
    expect(chooseSource(s('', 'auto'), ok(true), 'vision')).toBe('helper');
    expect(chooseSource(s('sk-ant-x', 'auto'), ok(false), 'vision')).toBe('apiKey');
    expect(chooseSource(s('', 'auto'), ok(false), 'vision')).toBe('helper');
    expect(chooseSource(s('', 'auto'), null, 'vision')).toBeNull();
    // Text questions are unchanged.
    expect(chooseSource(s('sk-ant-x', 'auto'), ok(false))).toBe('helper');
  });
  it('a forced source is kept', () => {
    expect(chooseSource(s('sk-ant-x', 'helper'), ok(false), 'vision')).toBe('helper');
    expect(chooseSource(s('sk-ant-x', 'apiKey'), ok(true), 'vision')).toBe('apiKey');
    expect(chooseSource(s('', 'apiKey'), ok(true), 'vision')).toBeNull();
  });
});

describe('the API key: vision content blocks to api.anthropic.com', () => {
  beforeAll(async () => {
    await loadSdk();
  });
  const settings: Settings = { apiKey: 'sk-ant-test', model: 'claude-opus-5-5', coachSource: 'apiKey' };

  it('buildRequest puts the images first, then the text; a text prompt is unchanged', () => {
    const r = buildRequest(prompt, 'claude-opus-5-5');
    expect(r.messages).toEqual([
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: images[0]!.data } },
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: images[1]!.data } },
          { type: 'text', text: prompt.user },
        ],
      },
    ]);
    expect(buildRequest({ system: 's', user: 'u' }, 'claude-opus-5-5').messages).toEqual([{ role: 'user', content: 'u' }]);
    expect(buildRequest({ system: 's', user: 'u', images: [] }, 'claude-opus-5-5').messages).toEqual([{ role: 'user', content: 'u' }]);
  });

  it('streams the answer from api.anthropic.com only, with the key, through the injected fetch', async () => {
    const seen: Array<{ url: string; headers: Headers; body: Record<string, unknown> }> = [];
    const events = [
      { type: 'message_start', message: { id: 'm', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 0 } } },
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: ANSWER } },
      { type: 'content_block_stop', index: 0 },
      { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 5 } },
      { type: 'message_stop' },
    ];
    const f = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      seen.push({ url: String(url), headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) });
      return new Response(events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join(''), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    });
    const r = await askClaude(prompt, { onText() {} }, { settings, fetch: f as unknown as typeof fetch });
    expect(seen).toHaveLength(1);
    expect(new URL(seen[0]!.url).origin).toBe('https://api.anthropic.com');
    expect(seen[0]!.headers.get('x-api-key')).toBe('sk-ant-test');
    const content = (seen[0]!.body.messages as Array<{ content: Array<{ type: string }> }>)[0]!.content;
    expect(content.map((b) => b.type)).toEqual(['image', 'image', 'text']);
    expect(r.text).toBe(ANSWER);
    expectReview(r.text);
  });
});

describe('fitSize (the browser downscale)', () => {
  it('shrinks the long side to 1568 and never enlarges', () => {
    expect(fitSize(4032, 3024)).toEqual({ width: 1568, height: 1176 });
    expect(fitSize(3024, 4032)).toEqual({ width: 1176, height: 1568 });
    expect(fitSize(800, 600)).toEqual({ width: 800, height: 600 });
    expect(fitSize(0, 10)).toEqual({ width: 0, height: 0 });
  });
});

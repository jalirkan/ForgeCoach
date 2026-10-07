// ForgeCoach — bug/bits.test.ts: the hotkey, the console ring, the context stack, the draft's hidden information, the client facts.
// SPDX-License-Identifier: GPL-3.0-or-later
import { afterEach, describe, expect, it } from 'vitest';
import { isBugHotkey } from './hotkey.ts';
import { createConsoleRing, installConsoleRing, partText } from './consoleRing.ts';
import { currentBugSnapshot, hasBugContext, onOpenBugReport, openBugReport, pushBugContext, resetBugContext } from './context.ts';
import { EMPTY_SNAPSHOT } from './report.ts';
import { draftExtra } from './draftExtra.ts';
import { clientFacts, servedBy } from './client.ts';
import { apply, newDraft, legalLines } from '../draft/draft.ts';
import { planPlayKey, PLAY_KEYS } from '../ui/play/playKeys.ts';

describe('Shift+B', () => {
  it('opens the panel; plain B, Ctrl/Cmd/Alt+B and typing do not', () => {
    expect(isBugHotkey({ key: 'B', code: 'KeyB', shiftKey: true })).toBe(true);
    expect(isBugHotkey({ key: 'b', code: 'KeyB', shiftKey: false })).toBe(false);
    expect(isBugHotkey({ key: 'B', shiftKey: true, ctrlKey: true })).toBe(false);
    expect(isBugHotkey({ key: 'B', shiftKey: true, metaKey: true })).toBe(false);
    expect(isBugHotkey({ key: '∫', code: 'KeyB', shiftKey: true, altKey: true })).toBe(false);
    expect(isBugHotkey({ key: 'B', shiftKey: true, targetTag: 'INPUT' })).toBe(false);
    expect(isBugHotkey({ key: 'B', shiftKey: true, targetTag: 'textarea' })).toBe(false);
    expect(isBugHotkey({ key: 'B', shiftKey: true, targetEditable: true })).toBe(false);
    expect(isBugHotkey({ key: 'B', shiftKey: true, repeat: true })).toBe(false);
  });

  it('plain B still belongs to the board, and the keyboard list names Shift+B', () => {
    const view = { mode: 'main', primary: null, ok: { enabled: false }, cancel: { enabled: false }, needClick: false } as never;
    expect(planPlayKey({ key: 'b' }, { view, askOpen: false, over: false, canUndo: false, poolColors: [], overlay: false })).toMatchObject({ kind: 'act' });
    expect(PLAY_KEYS.some((k) => k.chord === 'Shift+B')).toBe(true);
  });
});

describe('the console ring', () => {
  it('keeps the newest entries, cut to size', () => {
    let t = 0;
    const r = createConsoleRing(3, () => ++t);
    for (let i = 0; i < 5; i++) r.push('error', [`e${i}`, 'x'.repeat(1000)]);
    expect(r.entries().map((e) => e.t)).toEqual([3, 4, 5]);
    expect(r.entries()[0]!.text.length).toBe(600);
  });

  it('wraps console.error and console.warn, still calling them, and records uncaught errors', () => {
    const seen: unknown[][] = [];
    const listeners: Record<string, (e: Event) => void> = {};
    const target = {
      console: { error: (...a: unknown[]) => void seen.push(a), warn: (...a: unknown[]) => void seen.push(a) } as Pick<Console, 'error' | 'warn'>,
      addEventListener: (type: string, cb: (e: Event) => void) => void (listeners[type] = cb),
    };
    const ring = createConsoleRing();
    installConsoleRing(target, ring);
    target.console.error('boom', new Error('bad'));
    target.console.warn({ a: 1 });
    listeners.error!({ error: new TypeError('x is undefined') } as unknown as Event);
    listeners.unhandledrejection!({ reason: 'nope' } as unknown as Event);
    expect(seen.length).toBe(2);
    expect(ring.entries().map((e) => e.level)).toEqual(['error', 'warn', 'unhandled', 'unhandled']);
    expect(ring.entries()[0]!.text).toContain('Error: bad');
    expect(ring.entries()[2]!.text).toContain('TypeError: x is undefined');
  });

  it('partText survives anything', () => {
    const cyc: Record<string, unknown> = {};
    cyc.self = cyc;
    expect(partText(cyc)).toBe('[object Object]');
    expect(partText(undefined)).toBe('undefined');
  });
});

describe('the context stack', () => {
  afterEach(() => resetBugContext());
  it('the newest screen wins; closing it gives the one below back', () => {
    expect(currentBugSnapshot()).toEqual(EMPTY_SNAPSHOT);
    const off1 = pushBugContext(() => ({ ...EMPTY_SNAPSHOT, surface: 'play' }));
    const off2 = pushBugContext(() => ({ ...EMPTY_SNAPSHOT, surface: 'replay' }));
    expect(currentBugSnapshot().surface).toBe('replay');
    off2();
    expect(currentBugSnapshot().surface).toBe('play');
    off1();
    expect(hasBugContext()).toBe(false);
  });
  it('a provider that throws gives an empty snapshot, not an error', () => {
    pushBugContext(() => {
      throw new Error('x');
    });
    expect(currentBugSnapshot()).toEqual(EMPTY_SNAPSHOT);
  });
  it('openBugReport reaches the host', () => {
    let n = 0;
    const off = onOpenBugReport(() => n++);
    openBugReport();
    off();
    openBugReport();
    expect(n).toBe(1);
  });
});

describe('a draft against the AI keeps the AI’s picks hidden', () => {
  const cube = Array.from({ length: 200 }, (_, i) => `Card ${i}`);
  it('grid: both pools are public in a grid draft (the AI takes visible lines)', () => {
    let d = newDraft({ cubeId: 'synergy', format: 'grid', cube, seed: 5, youFirst: true });
    d = apply(d, { kind: 'line', line: legalLines(d as never)[0]! });
    const x = draftExtra(d)!;
    expect(x.yourPicks).toEqual(d.picks.you);
    expect(JSON.stringify(x)).not.toContain('"seed"');
    expect(JSON.stringify(x)).not.toContain('dealt');
  });
  it('booster: never the AI’s list, the other packs or the seed', () => {
    const d = newDraft({ cubeId: 'synergy', format: 'booster', cube, seed: 9, youFirst: true, seats: 4 });
    // As after a pick: the AI took a card the player never saw (four seats: not attributable).
    d.picks.ai.push('Secret AI Card');
    d.log.push({ n: 1, who: 'ai', kind: 'pick', at: 1, cards: ['Secret AI Card'] });
    const x = draftExtra(d)!;
    expect(JSON.stringify(x)).not.toContain('Secret AI Card');
    const text = JSON.stringify(x);
    for (const c of d.picks.ai) expect(x.aiKnown).not.toContain(c);
    expect(x.aiCount).toBe(d.picks.ai.length);
    const others = (d as { table: string[][] }).table.slice(1).flat().filter((c) => !(d as { table: string[][] }).table[0]!.includes(c));
    for (const c of others) expect(text).not.toContain(`"${c}"`);
    expect(text).not.toContain('"seed"');
  });
  it('winston: the stack stays a count, the piles sizes', () => {
    const d = newDraft({ cubeId: 'synergy', format: 'winston', cube, seed: 3, youFirst: true });
    const x = draftExtra(d)! as { winston: { stackLeft: number; piles: number[] } };
    expect(typeof x.winston.stackLeft).toBe('number');
    const stack = (d as { stack: string[] }).stack;
    const text = JSON.stringify(x);
    for (const c of stack.slice(0, 20)) expect(text).not.toContain(`"${c}"`);
  });
  it('no draft: null', () => expect(draftExtra(null)).toBeNull());
});

describe('client facts', () => {
  const loc = (host: string, protocol = 'https:') => ({ protocol, host, hostname: host.split(':')[0]!, port: host.split(':')[1] ?? '', search: '', origin: `${protocol}//${host}` });
  it('names where the page came from', () => {
    expect(servedBy(loc('jalirkan.github.io'), [], false)).toBe('pages');
    expect(servedBy(loc('pc.tail1.ts.net'), [], false)).toBe('funnel');
    expect(servedBy(loc('192.168.1.5:8644', 'http:'), [], false)).toBe('room');
    expect(servedBy(loc('192.168.1.5:8642', 'http:'), [], false)).toBe('engine');
    expect(servedBy(loc('127.0.0.1:5173', 'http:'), [], true)).toBe('dev');
  });
  it('says whether an API key is set, never the key', () => {
    const f = clientFacts({
      settings: { apiKey: 'sk-ant-secret-0123456789', model: 'claude-opus-5-5', coachSource: 'auto' } as never,
      scenery: null,
      skin: 'felt',
      location: loc('jalirkan.github.io'),
      roomBases: [],
      viewport: { w: 1, h: 1, dpr: 1 },
      userAgent: 'u',
      language: 'en',
      online: true,
      standalone: false,
      dev: false,
    });
    expect(f.settings.apiKeySet).toBe(true);
    expect(JSON.stringify(f)).not.toContain('sk-ant');
    expect(f.skin).toBe('felt');
    expect(f.build).toBe(typeof f.build === 'string' ? f.build : 'x');
  });
});

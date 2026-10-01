// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { DEFAULT_SEAT_URL, defaultSeatUrl, redactSeatUrl, servedByEngine } from './seatUrl.ts';
import { unreachableDetail } from './session.ts';

describe('defaultSeatUrl', () => {
  it('github.io -> default', () => {
    const l = { protocol: 'https:', host: 'jalirkan.github.io', search: '' };
    expect(defaultSeatUrl(l)).toBe(DEFAULT_SEAT_URL);
    expect(servedByEngine(l)).toBe(false);
  });
  it('vite dev server -> default', () => {
    const l = { protocol: 'http:', host: 'localhost:5173', search: '?token=x' };
    expect(defaultSeatUrl(l)).toBe(DEFAULT_SEAT_URL);
    expect(servedByEngine(l)).toBe(false);
  });
  it('LAN bridge with token', () => {
    const l = { protocol: 'http:', host: '192.168.1.20:8642', search: '?token=abc' };
    expect(defaultSeatUrl(l)).toBe('ws://192.168.1.20:8642/ws?token=abc');
    expect(servedByEngine(l)).toBe(true);
  });
  it('local bridge without token', () => {
    expect(defaultSeatUrl({ protocol: 'http:', host: '127.0.0.1:8642', search: '' })).toBe('ws://127.0.0.1:8642/ws');
  });
  it('encodes the token; file: is not the engine', () => {
    expect(defaultSeatUrl({ protocol: 'http:', host: 'h:1', search: '?token=a%26b' })).toBe('ws://h:1/ws?token=a%26b');
    expect(servedByEngine({ protocol: 'file:', host: '', search: '' })).toBe(false);
  });
});

describe('token redaction', () => {
  it('redactSeatUrl hides the token', () => {
    expect(redactSeatUrl('ws://h:1/ws?token=secret&x=1')).toBe('ws://h:1/ws?token=…&x=1');
  });
  it('unreachableDetail never shows it', () => {
    expect(unreachableDetail('ws://h:1/ws?token=secret', 500)).not.toContain('secret');
  });
});

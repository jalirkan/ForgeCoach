/*
 * ForgeCoach — play/seatStatus.test.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { describe, expect, it } from 'vitest';
import { CONNECT_SLOW_MS, seatBusy, seatHang, seatStatusText, type SeatStatusInput } from './seatStatus.ts';

const URL_WITH_TOKEN = 'ws://192.168.1.20:5177/ws?token=s3cr3t';
const connecting = (attempts: number, extra: Partial<SeatStatusInput> = {}): SeatStatusInput => ({ status: 'connecting', detail: null, attempts, ...extra });

describe('seatStatusText', () => {
  it('says nothing without a connection', () => expect(seatStatusText(null, URL_WITH_TOKEN)).toBeNull());

  it('a first try is plain; later tries count themselves', () => {
    expect(seatStatusText(connecting(0), URL_WITH_TOKEN)).toBe('Connecting to the engine…');
    expect(seatStatusText(connecting(1), URL_WITH_TOKEN)).toBe('Connecting to the engine…');
    expect(seatStatusText(connecting(2), URL_WITH_TOKEN)).toBe('Looking for the engine… (attempt 2)');
    expect(seatStatusText(connecting(2), URL_WITH_TOKEN, { engineServed: true })).toBe('Looking for the engine… (attempt 2)');
  });

  it('an engine-served page that has been connecting for a while says what it dials, token redacted', () => {
    const t = seatStatusText(connecting(1), URL_WITH_TOKEN, { engineServed: true, slow: true })!;
    expect(t).toContain('ws://192.168.1.20:5177/ws?token=…');
    expect(t).not.toContain('s3cr3t');
    expect(t).toMatch(/did not answer the seat/);
    expect(t).toMatch(/after 8 s/);
    expect(t).toMatch(/Cancel/);
  });

  it('the hang line carries the attempt number when there is one', () => {
    expect(seatStatusText(connecting(3), URL_WITH_TOKEN, { engineServed: true, slow: true })).toMatch(/\(attempt 3\)/);
  });

  it('slow alone changes nothing off the engine-served path (a local default seat keeps its plain line)', () => {
    expect(seatStatusText(connecting(1), 'ws://127.0.0.1:8642/ws', { slow: true })).toBe('Connecting to the engine…');
    expect(seatStatusText(connecting(1), 'ws://127.0.0.1:8642/ws', { engineServed: false, slow: true })).toBe('Connecting to the engine…');
  });

  it('not slow yet, or waking, or already open: no hang line', () => {
    expect(seatStatusText(connecting(1), URL_WITH_TOKEN, { engineServed: true, slow: false })).toBe('Connecting to the engine…');
    expect(seatStatusText(connecting(0, { waking: true }), URL_WITH_TOKEN, { engineServed: true, slow: true })).toBe('Waking the engine…');
    expect(seatStatusText({ status: 'open', detail: null, attempts: 0 }, URL_WITH_TOKEN, { engineServed: true, slow: true })).toBe('Connected — waiting for the engine to deal…');
  });

  it('failures keep their lines and never show the token', () => {
    expect(seatStatusText({ status: 'refused', detail: null, attempts: 0 }, URL_WITH_TOKEN)).toMatch(/Another window/);
    const closed = seatStatusText({ status: 'closed', detail: null, attempts: 12 }, URL_WITH_TOKEN, { engineServed: true, slow: true })!;
    expect(closed).toBe('Couldn’t reach the engine at ws://192.168.1.20:5177/ws?token=….');
  });
});

describe('seatBusy / seatHang', () => {
  it('busy until the seat gives up', () => {
    expect(seatBusy(null)).toBe(false);
    expect(seatBusy(connecting(1))).toBe(true);
    expect(seatBusy({ status: 'open', detail: null, attempts: 0 })).toBe(true);
    expect(seatBusy({ status: 'error', detail: null, attempts: 1 })).toBe(false);
  });
  it('the hang line is for a slow, engine-served connect only', () => {
    expect(seatHang(connecting(1), { engineServed: true, slow: true })).toBe(true);
    expect(seatHang(connecting(1), { engineServed: false, slow: true })).toBe(false);
    expect(seatHang(connecting(1), { engineServed: true })).toBe(false);
    expect(CONNECT_SLOW_MS).toBe(8_000);
  });
});

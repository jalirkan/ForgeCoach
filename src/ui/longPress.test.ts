/*
 * ForgeCoach — ui/longPress.test.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { describe, expect, it, vi } from 'vitest';
import { createLongPress, LONG_PRESS_MS, type PressTimers } from './longPress.ts';

/** Manual timers: `tick(ms)` runs whatever is due. */
function fakeTimers() {
  let now = 0;
  let next = 1;
  const pending = new Map<number, { at: number; fn: () => void }>();
  const timers: PressTimers = {
    set(fn, ms) {
      const id = next++;
      pending.set(id, { at: now + ms, fn });
      return id;
    },
    clear(id) {
      pending.delete(id as number);
    },
  };
  const tick = (ms: number) => {
    now += ms;
    for (const [id, t] of [...pending]) {
      if (t.at <= now) {
        pending.delete(id);
        t.fn();
      }
    }
  };
  return { timers, tick, count: () => pending.size };
}

function setup() {
  const t = fakeTimers();
  const onLong = vi.fn();
  const haptic = vi.fn();
  const press = createLongPress({ onLong, timers: t.timers, haptic });
  return { ...t, onLong, haptic, press };
}

describe('long-press', () => {
  it('a held finger opens the details once, buzzes, and swallows the click that follows', () => {
    const { press, tick, onLong, haptic } = setup();
    press.down(10, 10, 'touch');
    tick(LONG_PRESS_MS - 1);
    expect(onLong).not.toHaveBeenCalled();
    tick(1);
    expect(onLong).toHaveBeenCalledTimes(1);
    expect(haptic).toHaveBeenCalledTimes(1);
    press.cancel(); // pointer up
    expect(press.takeClick()).toBe(true);
    // only that one click
    expect(press.takeClick()).toBe(false);
  });

  it('a quick tap is a click, not a long-press', () => {
    const { press, tick, onLong } = setup();
    press.down(10, 10, 'touch');
    tick(120);
    press.cancel();
    tick(1000);
    expect(onLong).not.toHaveBeenCalled();
    expect(press.takeClick()).toBe(false);
  });

  it('a finger that moves past the slop is scrolling, not pressing', () => {
    const { press, tick, onLong, count } = setup();
    press.down(10, 10, 'touch');
    press.move(16, 14); // within 8px
    expect(press.pending).toBe(true);
    press.move(30, 10);
    expect(press.pending).toBe(false);
    expect(count()).toBe(0);
    tick(1000);
    expect(onLong).not.toHaveBeenCalled();
  });

  it('vertical drift past the slop cancels too', () => {
    const { press, tick, onLong } = setup();
    press.down(10, 10, 'pen');
    press.move(10, 19);
    tick(1000);
    expect(onLong).not.toHaveBeenCalled();
  });

  it('the mouse and secondary touches never long-press', () => {
    const { press, tick, onLong } = setup();
    press.down(0, 0, 'mouse');
    tick(1000);
    press.down(0, 0, 'touch', false);
    tick(1000);
    expect(onLong).not.toHaveBeenCalled();
  });

  it("the browser's own touch long-press (contextmenu) after the timer does not open twice", () => {
    const { press, tick, onLong } = setup();
    press.down(0, 0, 'touch');
    tick(LONG_PRESS_MS);
    expect(press.context('touch')).toBe(false);
    expect(onLong).toHaveBeenCalledTimes(1);
  });

  it('contextmenu before the timer opens now, and a touch one swallows the next click', () => {
    const { press, tick, onLong } = setup();
    press.down(0, 0, 'touch');
    expect(press.context('touch')).toBe(true);
    tick(1000);
    expect(onLong).not.toHaveBeenCalled(); // the caller opened it; the timer is off
    expect(press.takeClick()).toBe(true);
  });

  it('a right-click opens the details and leaves the next click alone', () => {
    const { press } = setup();
    expect(press.context('mouse')).toBe(true);
    expect(press.takeClick()).toBe(false);
  });

  it('a new press clears a stale swallow', () => {
    const { press, tick } = setup();
    press.down(0, 0, 'touch');
    tick(LONG_PRESS_MS);
    press.down(0, 0, 'touch'); // the click never came (finger slid off), then a fresh tap
    press.cancel();
    expect(press.takeClick()).toBe(false);
  });
});

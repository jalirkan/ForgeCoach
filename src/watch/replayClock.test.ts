/*
 * ForgeCoach — watch/replayClock.test.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The draft replay advances at 1× (and 0.5×) while the watch screen polls:
 * every poll re-renders with a new draft object, and the timer used to
 * restart on each, so a step longer than the 1.5 s poll never fired.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import draftJson from './testdata/watch-draft.json';
import { parseWatchDraft } from './data.ts';
import { BASE_PICK_MS, ReplayClock, replayReducer, startReplay, type ReplayState, type Speed } from './replay.ts';

const POLL_MS = 1500; // WatchApp's GET /watch/<id>

function screen(speed: Speed) {
  const draft = parseWatchDraft(draftJson);
  let s: ReplayState = { ...startReplay(), speed };
  const clock = new ReplayClock({ set: (fn, ms) => setTimeout(fn, ms), clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) });
  // Every render syncs the clock, as WatchRun's effect does.
  const render = () => clock.sync(s, true, () => {
    s = replayReducer(s, { kind: 'tick' }, draft);
    render();
  });
  render();
  // The poll: a re-render every 1.5 s with the same replay state (and a new draft object).
  const poll = setInterval(render, POLL_MS);
  return { at: () => s.i, stop: () => (clearInterval(poll), clock.stop()) };
}

describe('the draft replay’s pick timer', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  for (const speed of [0.5, 1, 2, 4] as const)
    it(`at ${speed}× it advances one pick every ${BASE_PICK_MS / speed} ms while the screen polls every ${POLL_MS} ms`, () => {
      const v = screen(speed);
      const step = BASE_PICK_MS / speed;
      expect(v.at()).toBe(0);
      vi.advanceTimersByTime(step - 1);
      expect(v.at()).toBe(0);
      vi.advanceTimersByTime(1);
      expect(v.at()).toBe(1);
      vi.advanceTimersByTime(step * 5);
      expect(v.at()).toBe(6);
      v.stop();
    });

  it('a pause stops it; play starts it again from the same pick', () => {
    const clock = new ReplayClock({ set: (fn, ms) => setTimeout(fn, ms), clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) });
    const tick = vi.fn();
    const s: ReplayState = { i: 3, playing: true, speed: 1 };
    clock.sync(s, true, tick);
    clock.sync({ ...s, playing: false }, true, tick);
    vi.advanceTimersByTime(5000);
    expect(tick).not.toHaveBeenCalled();
    clock.sync(s, true, tick);
    vi.advanceTimersByTime(BASE_PICK_MS);
    expect(tick).toHaveBeenCalledTimes(1);
  });

  it('nothing ticks before the draft is there', () => {
    const clock = new ReplayClock({ set: (fn, ms) => setTimeout(fn, ms), clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) });
    const tick = vi.fn();
    clock.sync(startReplay(), false, tick);
    vi.advanceTimersByTime(10_000);
    expect(tick).not.toHaveBeenCalled();
  });
});

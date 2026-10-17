/*
 * ForgeCoach — play/hintRunner.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The search hint for the decision in front of the player (searchHint.ts,
 * mtg-table D429), as one small state machine the Coach panel and the
 * decision panel share:
 *
 *   none      no decision the search AI judges is open (`key` null)
 *   idle      one is open; nothing asked yet
 *   asking    POST /hint is out (one at a time: a newer one cancels it)
 *   answered  the hint for this decision
 *   error     why there is none, in the engine's words
 *
 * `setDecision(key, auto)` is called on every render: a new key cancels the
 * question still out (the helper answers it `409 superseded` anyway; the
 * newest wins) and, with `auto`, asks once for it; the same key again does
 * nothing, so a re-render never asks twice. `ask()` asks for the decision on
 * screen now (the Ask now button, S). Pure: the request is injected.
 */
import type { HintRefused, SearchHint } from '../searchHint.ts';

export type HintPhase =
  | { state: 'none'; key: null }
  | { state: 'idle'; key: string }
  | { state: 'asking'; key: string; since: number }
  | { state: 'answered'; key: string; hint: SearchHint }
  | { state: 'error'; key: string; message: string };

export type HintAsk = (key: string, signal: AbortSignal) => Promise<SearchHint | HintRefused>;

const refused = (r: SearchHint | HintRefused): r is HintRefused => (r as HintRefused).ok === false;

export class HintRunner {
  private phase: HintPhase = { state: 'none', key: null };
  private ctrl: AbortController | null = null;
  private readonly listeners = new Set<() => void>();
  /** How many requests went out (tests; the playtest's budget). */
  asked = 0;

  constructor(
    private readonly request: HintAsk,
    private readonly now: () => number = Date.now,
  ) {}

  get(): HintPhase {
    return this.phase;
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private set(p: HintPhase): void {
    this.phase = p;
    for (const l of this.listeners) l();
  }

  /** The decision on screen. A new one drops the last answer and stops the question still out; `auto` asks once for it. */
  setDecision(key: string | null, auto: boolean): void {
    if (key !== this.phase.key) {
      this.cancel();
      this.set(key ? { state: 'idle', key } : { state: 'none', key: null });
    }
    // Auto asks once per decision, ever: not again on a re-render, after an error or a supersede.
    if (auto && key && this.autoAsked !== key && this.phase.state === 'idle') {
      this.autoAsked = key;
      this.ask();
    }
  }
  private autoAsked: string | null = null;

  /** Ask for the decision on screen (again, after an answer or an error). Nothing while one is out. */
  ask(): void {
    const key = this.phase.key;
    if (!key || this.phase.state === 'asking') return;
    this.cancel();
    const c = new AbortController();
    this.ctrl = c;
    this.asked++;
    this.set({ state: 'asking', key, since: this.now() });
    void this.request(key, c.signal).then(
      (r) => this.settle(c, key, r),
      (e) => this.settle(c, key, { ok: false, status: 0, code: null, message: e instanceof Error ? e.message : String(e) }),
    );
  }

  private settle(c: AbortController, key: string, r: SearchHint | HintRefused): void {
    if (c.signal.aborted || this.ctrl !== c || this.phase.key !== key) return;
    this.ctrl = null;
    if (refused(r)) {
      // Superseded by a newer question from this game (another tab): nothing to say here.
      if (r.code === 'superseded') this.set({ state: 'idle', key });
      else this.set({ state: 'error', key, message: r.message });
      return;
    }
    this.set({ state: 'answered', key, hint: r });
  }

  cancel(): void {
    this.ctrl?.abort();
    this.ctrl = null;
    if (this.phase.state === 'asking') this.phase = { state: 'idle', key: this.phase.key };
  }

  dispose(): void {
    this.cancel();
    this.listeners.clear();
  }
}

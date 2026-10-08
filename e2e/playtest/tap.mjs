/*
 * ForgeCoach — e2e/playtest/tap.mjs
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The playtest's ear on the seat socket: every frame the page's `/ws` socket
 * receives and sends, read through Playwright's WebSocket events. Nothing is
 * ever sent from here — the monkey only clicks — so this is how it knows
 * what the engine offers (the ask, the input's buttons and selectable cards,
 * mtg-table protocol §4, §5) and whether a click reached the wire.
 *
 * It keeps the same "current" view the app's session does (play/session.ts):
 * the newest state and input by seq, the open ask until answered or the
 * socket drops (M19), `over`, the table (M59), plus the names of every card
 * this seat has been shown (for the hidden-information check).
 */

/**
 * Every card name an s2c body shows this seat: any object with a string `name` and an `id`, plus `alt` faces.
 * With `words`, also every word of the type lines it shows ("Land — Forest"): a card named like a
 * subtype (the basics) is on the page as a type, not as a card.
 */
export function namesIn(body, out = new Set(), words = null) {
  const walk = (v) => {
    if (!v || typeof v !== 'object') return;
    if (Array.isArray(v)) {
      for (const x of v) walk(x);
      return;
    }
    if (words && typeof v.types === 'string') for (const w of v.types.split(/[\s—-]+/)) if (w) words.add(w);
    if (typeof v.name === 'string' && v.name && typeof v.id === 'number' && v.hidden !== true) out.add(v.name);
    for (const k of Object.keys(v)) walk(v[k]);
  };
  walk(body);
  return out;
}

export class SeatTap {
  constructor(label) {
    this.label = label;
    this.frames = []; // every s2c frame, parsed, with .at (ms) and .game (the gameId it belongs to)
    this.sent = []; // every c2s frame, parsed, with .at
    this.hello = null;
    this.state = null;
    this.input = null;
    this.ask = null;
    this.over = null;
    this.table = null;
    this.notices = [];
    this.gameId = null;
    this.games = []; // gameIds in order
    this.seen = new Set(); // card names shown to this seat
    this.typeWords = new Set(); // words of the type lines shown to this seat
    this.lastFrameAt = Date.now();
    this.sockets = 0;
    this.open = false;
    this.answered = new Set();
    this.stateSeq = 0;
    this.inputSeq = 0;
    this.waiters = [];
  }

  attach(page) {
    page.on('websocket', (ws) => {
      let u;
      try {
        u = new URL(ws.url());
      } catch {
        return;
      }
      if (!/\/ws$/.test(u.pathname)) return;
      this.sockets++;
      this.open = true;
      // M19: an ask parked when a socket dropped took its default; the catch-up re-sends a live one.
      this.ask = null;
      ws.on('framereceived', (e) => this.receive(e.payload));
      ws.on('framesent', (e) => this.sentFrame(e.payload));
      ws.on('close', () => {
        this.open = false;
        this.ask = null;
        this.wake();
      });
    });
  }

  receive(payload) {
    let f;
    try {
      f = JSON.parse(typeof payload === 'string' ? payload : payload.toString());
    } catch {
      return;
    }
    f.at = Date.now();
    // Progress is a game frame: the session's own ping/pong every few seconds is not (J107: a seat
    // stuck on a target for 75 minutes kept the watchdog quiet because the pongs kept coming).
    if (f.type !== 'ping' && f.type !== 'pong') this.lastFrameAt = f.at;
    switch (f.type) {
      case 'hello_ok':
        if (this.gameId !== f.body.gameId) {
          this.gameId = f.body.gameId;
          this.games.push(this.gameId);
          this.state = null;
          this.input = null;
          this.ask = null;
          this.over = null;
          this.stateSeq = 0;
          this.inputSeq = 0;
          this.answered.clear();
        }
        this.hello = f.body;
        break;
      case 'state':
        if (this.hello && f.body.gameId !== this.hello.gameId) break;
        if (f.seq > 0 && f.seq < this.stateSeq) break;
        this.state = f.body;
        if (f.seq > 0) this.stateSeq = f.seq;
        break;
      case 'input':
        if (f.seq > 0 && f.seq < this.inputSeq) break;
        this.input = f.body;
        if (f.seq > 0) this.inputSeq = f.seq;
        break;
      case 'ask':
        if (!this.answered.has(f.body.askId)) this.ask = f.body;
        break;
      case 'over':
        this.over = f.body;
        this.ask = null;
        break;
      case 'table':
        this.table = f.body;
        break;
      case 'notice':
        this.notices.push({ ...f.body, at: f.at, seq: f.seq });
        break;
      default:
        break;
    }
    f.game = this.gameId;
    if (f.type !== 'ping' && f.type !== 'pong') {
      this.frames.push(f);
      namesIn(f.body, this.seen, this.typeWords);
    }
    this.wake();
  }

  sentFrame(payload) {
    let f;
    try {
      f = JSON.parse(typeof payload === 'string' ? payload : payload.toString());
    } catch {
      return;
    }
    f.at = Date.now();
    this.sent.push(f);
    if (f.type === 'answer' && f.body?.askId) {
      this.answered.add(f.body.askId);
      if (this.ask?.askId === f.body.askId) this.ask = null;
    }
    this.wake();
  }

  wake() {
    const w = this.waiters;
    this.waiters = [];
    for (const r of w) r();
  }

  /** Resolves on the next frame either way, or after `ms`. */
  next(ms) {
    return new Promise((resolve) => {
      const t = setTimeout(resolve, ms);
      this.waiters.push(() => {
        clearTimeout(t);
        resolve();
      });
    });
  }

  /** Waits until `pred()` holds (checked on every frame), or `ms` passes. True when it held. */
  async until(pred, ms) {
    const end = Date.now() + ms;
    while (!pred()) {
      const left = end - Date.now();
      if (left <= 0) return false;
      await this.next(Math.min(left, 500));
    }
    return true;
  }

  /** The number of s2c frames so far (a mark to wait past). */
  get mark() {
    return this.frames.length;
  }

  sentSince(i) {
    return this.sent.slice(i);
  }

  /** This seat's player id. */
  get seat() {
    return this.hello?.you ?? null;
  }

  /** The frames of the current game. */
  gameFrames() {
    return this.frames.filter((f) => f.game === this.gameId);
  }

  /** The prompt as Forge wrote it. */
  get prompt() {
    return this.input?.prompt ?? '';
  }

  /**
   * The engine is waiting on this seat, by the protocol alone: an open ask, or
   * an input that is not Forge's "Waiting for …" / a running yield and offers
   * a button or a selection.
   */
  deciding() {
    if (this.over) return false;
    if (this.table) {
      const me = this.table.seats?.find((s) => s.seat === this.table.you);
      if (me && !me.deciding && !this.ask) return false;
    }
    if (this.ask) return true;
    const i = this.input;
    if (!i) return false;
    if (/^Waiting for/i.test(i.prompt) && i.selectable.mode === 'none') return false;
    if (/^Yielding/i.test(i.prompt)) return false;
    if (i.buttons.ok.enabled || i.buttons.cancel.enabled || i.selectable.cardIds.length > 0 || i.selectable.mode === 'players') return true;
    // Every button off and nothing listed, with a prompt of its own: Forge waits for a click on something it
    // did not name — a mandatory trigger's "Select target player" (Blood Artist, Falkenrath Noble: J107's two
    // 75-minute hangs). The board's portraits are the controls; monkey.openTarget clicks one.
    return /\S/.test(i.prompt ?? '');
  }

  me() {
    return this.state?.players.find((p) => p.id === this.seat) ?? null;
  }

  opp() {
    return this.state?.players.find((p) => p.id !== this.seat) ?? null;
  }

  /** A card by id anywhere in the current state (zones and the stack's cards). */
  card(id) {
    if (!this.state) return null;
    for (const p of this.state.players) for (const z of Object.values(p.zones)) for (const c of z.cards ?? []) if (c.id === id) return c;
    return (this.state.stackCards ?? []).find((c) => c.id === id) ?? null;
  }
}

/*
 * ForgeCoach — e2e/playtest/monkey.mjs
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * A UI-only player. At every decision it reads what the engine offers from
 * the protocol stream (tap.mjs: the open ask and its options, the input's
 * buttons and selectable cards; at priority, the seat's own cards, with
 * Forge's card scripts saying which can be activated or cast from where),
 * finds the on-screen control for each option and clicks one. It never
 * sends a frame: a click either reaches the wire as the app's own act or
 * answer, or it is a finding.
 *
 *   - An option the engine says is legal with no clickable control is an
 *     "unreachable option" (a screenshot, the frame index, the ask or input,
 *     the card). That is the check that would have caught the attached
 *     Skullclamp and the graveyard target that never showed.
 *   - The engine waiting on this seat with nothing to click is "stuck".
 *
 * Choices are seeded: sometimes Forge's own default (the ask's default, the
 * focused button, the preselection, Auto pay), sometimes random among the
 * legal ones, biased to the rare paths — activated abilities, Equip, targets
 * in graveyards, trigger order, several blockers on one attacker, X costs,
 * modal choices.
 */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const HAND_ZONES = new Set(['hand']);

function isCreature(c) {
  return !!c && !c.hidden && /creature/i.test(c.types ?? '');
}
function isLand(c) {
  return !!c && !c.hidden && /\bland\b/i.test(c.types ?? '');
}
function hasKw(c, k) {
  return (c?.keywords ?? []).includes(k);
}
function firstLine(s) {
  return (s ?? '').split('\n').find((l) => l.trim())?.trim() ?? '';
}

/** Mana value from a cost string ("{2}{R}{R}" → 4; X counts 0). */
export function manaValue(cost) {
  if (!cost) return 0;
  let n = 0;
  for (const m of cost.matchAll(/\{([^}]+)\}/g)) {
    const s = m[1];
    if (/^\d+$/.test(s)) n += Number(s);
    else if (/^[XYZ]$/i.test(s)) n += 0;
    else n += 1;
  }
  return n;
}

export class Monkey {
  /**
   * @param {object} o
   * @param o.page Playwright page (the board)
   * @param o.tap SeatTap
   * @param o.rand seeded () => [0,1)
   * @param o.scripts Map name → flags (scripts.mjs)
   * @param o.finding (rec) => Promise — records a failure with a screenshot
   * @param o.label 'solo' | 'host' | 'friend'
   * @param o.askModel ForgeCoach's askModel module (the dialog's own option grouping)
   */
  constructor(o) {
    Object.assign(this, o);
    this.decisions = 0;
    this.clicks = 0;
    this.seenUnreach = new Set();
    this.tried = new Map(); // priority instance → Set(card ids clicked without effect)
    this.turnClicks = new Map();
    this.mulligans = 0;
    this.stats = { asks: {}, modes: {}, rare: {} };
    this.stuckSince = null;
    this.trace = [];
    this.lastDid = null;
    this.deadEnds = new Set();
  }

  count(group, k) {
    this.stats[group][k] = (this.stats[group][k] ?? 0) + 1;
  }

  pick(list) {
    return list[Math.floor(this.rand() * list.length)];
  }

  /** A weighted choice from [[weight, value]…]. */
  weighted(items) {
    const live = items.filter(([w]) => w > 0);
    const total = live.reduce((s, [w]) => s + w, 0);
    let r = this.rand() * total;
    for (const [w, v] of live) {
      r -= w;
      if (r <= 0) return v;
    }
    return live[live.length - 1]?.[1];
  }

  shuffle(a) {
    const b = [...a];
    for (let i = b.length - 1; i > 0; i--) {
      const j = Math.floor(this.rand() * (i + 1));
      [b[i], b[j]] = [b[j], b[i]];
    }
    return b;
  }

  // -------------------------------------------------------------------------
  // The DOM, as controls

  /**
   * Every control the board offers right now, tagged with `data-pt` so a
   * click can find the same element: cards (tiles, piles, chips, the zone
   * picker, the zone viewer, the hand), the engine buttons, the avatars, the
   * dialog's parts.
   */
  async dom() {
    return this.page.evaluate(() => {
      let n = 0;
      const tag = (el) => {
        const t = `pt${++n}`;
        el.setAttribute('data-pt', t);
        return t;
      };
      const vis = (el) => {
        const r = el.getBoundingClientRect();
        if (r.width < 2 || r.height < 2) return false;
        const s = getComputedStyle(el);
        if (s.visibility === 'hidden' || s.display === 'none' || Number(s.opacity) === 0) return false;
        if (el.closest('[aria-hidden="true"]')) return false;
        return true;
      };
      const where = (el) =>
        el.closest('.hand-dock') ? 'hand' : el.closest('[data-zone-pick]') ? 'zpick' : el.closest('.zone-viewer') ? 'viewer' : el.classList.contains('attach-chip') ? 'chip' : el.closest('.ask-layer') ? 'ask' : 'board';
      const cards = [...document.querySelectorAll('[data-card-id]')].map((el) => ({
        t: tag(el),
        id: Number(el.getAttribute('data-card-id')),
        ids: (el.getAttribute('data-card-ids') ?? el.getAttribute('data-card-id')).split(',').map(Number),
        mark: el.getAttribute('data-mark'),
        vis: vis(el),
        where: where(el),
        disabled: !!el.disabled,
      }));
      const buttons = [...document.querySelectorAll('[data-engine-button]')].map((el) => ({
        t: tag(el),
        which: el.getAttribute('data-engine-button'),
        enabled: !el.disabled,
        vis: vis(el),
        primary: el.hasAttribute('data-primary'),
        where: el.closest('[data-zone-pick]') ? 'zpick' : 'bar',
        text: el.textContent.trim(),
      }));
      const players = [...document.querySelectorAll('[data-player-id]')].map((el) => ({ t: tag(el), id: Number(el.getAttribute('data-player-id')), select: el.classList.contains('is-select'), vis: vis(el) }));
      const layer = document.querySelector('.ask-layer');
      // The opening dialog (OpeningDialog): play/draw as two big options (OK first), keep/mulligan in the footer.
      const opening = [
        ...[...document.querySelectorAll('.ask-layer .ask-big')].map((el, i) => ({ el, which: i === 0 ? 'ok' : 'cancel' })),
        ...[...document.querySelectorAll('.ask-layer .ask-foot .ask-btn-big')].map((el) => ({ el, which: el.classList.contains('ask-btn-second') ? 'cancel' : 'ok' })),
      ].map(({ el, which }) => ({ t: tag(el), which, enabled: !el.disabled, vis: vis(el), text: el.textContent.trim() }));
      const peek = document.querySelector('.ask-peek');
      const eot = document.querySelector('.ab-eot');
      const pips = [...document.querySelectorAll('.ab-pool-pip')].map((el) => ({ t: tag(el), vis: vis(el) }));
      const pills = [...document.querySelectorAll('[data-zone-pill]')].map((el) => ({ t: tag(el), zone: el.getAttribute('data-zone-pill'), player: Number(el.closest('[data-phead-player]')?.getAttribute('data-phead-player') ?? -1), enabled: !el.disabled, vis: vis(el), pick: el.classList.contains('is-pick') }));
      return {
        cards,
        buttons,
        players,
        dialog: !!document.querySelector('.ask-dialog') && vis(document.querySelector('.ask-dialog')),
        layer: !!layer,
        opening,
        peek: peek && vis(peek) ? tag(peek) : null,
        eot: eot && !eot.disabled && vis(eot) ? tag(eot) : null,
        pips,
        pills,
        sheet: !!document.querySelector('.sheet-backdrop'),
        over: !!document.querySelector('.over-card, .game-over, [data-over]'),
      };
    });
  }

  /**
   * Opens the folded hand (phones: `.hand-dock.is-collapsed`) when the seat has
   * cards in hand and the engine waits on it. True when it clicked.
   */
  async unfoldHand() {
    const hand = this.tap.me()?.zones.hand.cards ?? [];
    if (!hand.length) return false;
    const folded = this.page.locator('.hand-dock.is-collapsed .hand-dock-head');
    if (!(await folded.count())) return false;
    if (!(await folded.first().isVisible().catch(() => false))) return false;
    await folded.first().click({ timeout: 3000 }).catch(() => {});
    await sleep(250);
    return true;
  }

  /** The visible, clickable controls for card `id` (marked act/select), best first. */
  cardControls(dom, id, { anyMark = false } = {}) {
    const hits = dom.cards.filter((c) => c.vis && !c.disabled && c.ids.includes(id) && (anyMark || c.mark === 'act' || c.mark === 'select'));
    return hits.sort((a, b) => (b.id === id) - (a.id === id) || (b.mark === 'select') - (a.mark === 'select'));
  }

  button(dom, which) {
    return dom.buttons.find((b) => b.which === which && b.vis && b.enabled) ?? null;
  }

  async click(t, what) {
    this.clicks++;
    this.lastDid = this.lastDid ? `${this.lastDid}; ${what}` : what;
    try {
      await this.page.locator(`[data-pt="${t}"]`).first().click({ timeout: 6000 });
      await this.page.mouse.move(3, 3).catch(() => {});
      return true;
    } catch (e) {
      await this.finding({ kind: 'control-not-clickable', what, why: String(e.message).split('\n')[0] });
      return false;
    }
  }

  /** Records an unreachable option once per game and prompt. */
  async unreachable(what, extra = {}) {
    // Once per game per card and reason (not per step), else per text.
    const key = `${this.tap.gameId}|${extra.key ?? what}`;
    if (this.seenUnreach.has(key)) return;
    // Only a question still open is judged: one the engine replaced while we looked is not a finding.
    if (extra.input && this.tap.input !== extra.input) return;
    if (extra.ask && this.tap.ask?.askId !== extra.ask.askId) return;
    // What the board shows for it, to tell a missing control from one drawn but not marked.
    extra.ui = await this.page
      .evaluate((id) => {
        const game = document.querySelector('.game.play');
        const els = id === undefined ? [] : [...document.querySelectorAll(`[data-card-id="${id}"], [data-card-ids*="${id}"]`)];
        return {
          board: game ? [...game.classList].filter((c) => c.startsWith('mode-') || c === 'is-selecting').join(' ') : null,
          primary: (() => {
            const b = document.querySelector('[data-primary]');
            return b ? `${b.textContent.trim().slice(0, 40)}${b.disabled ? ' (disabled)' : ''}` : null;
          })(),
          dialog: !!document.querySelector('.ask-layer'),
          card: els.map((el) => {
            const r = el.getBoundingClientRect();
            const st = getComputedStyle(el);
            return { where: el.closest('.hand-dock') ? 'hand' : el.closest('.zone-viewer') ? 'viewer' : el.className.split(' ')[0], mark: el.getAttribute('data-mark'), w: Math.round(r.width), h: Math.round(r.height), opacity: st.opacity, hidden: !!el.closest('[aria-hidden="true"]') };
          }),
        };
      }, extra.cardId)
      .catch(() => null);
    this.seenUnreach.add(key);
    await this.finding({ kind: 'unreachable-option', what, ...extra });
  }

  /** Waits for the next s2c frame (or ms), then a beat for React to draw it. */
  async settle(ms = 2500) {
    const m = this.tap.mark;
    await this.tap.until(() => this.tap.mark > m, ms);
    // Quiet for a moment: the engine often sends state, input and highlights in a burst.
    for (let i = 0; i < 10; i++) {
      const k = this.tap.mark;
      await sleep(120);
      if (this.tap.mark === k) break;
    }
    await sleep(80);
  }

  /** Whether `pred` matches a c2s frame sent since index `i` (waiting up to ms). */
  async sentSince(i, pred, ms = 3000) {
    return this.tap.until(() => this.tap.sent.slice(i).some(pred), ms);
  }

  // -------------------------------------------------------------------------
  // One decision

  /** Called while the engine waits on this seat. Returns a word for what it did. */
  async decide() {
    this.decisions++;
    // A sheet (card details, the log) left open would sit over the board: close it as a person would.
    let dom = await this.dom();
    if (dom.sheet && !this.tap.ask) {
      await this.page.keyboard.press('Escape').catch(() => {});
      await sleep(150);
      dom = await this.dom();
    }
    // A phone folds the hand to a peek strip when it is not what you need: open it as a person would.
    if (!this.tap.ask && (await this.unfoldHand())) dom = await this.dom();
    const s = this.tap.state;
    const at = { t: Date.now(), turn: s?.turn ?? 0, phase: s?.phase ?? null, active: s?.activePlayer === this.tap.seat, frame: this.tap.frames.length, what: this.tap.ask ? `ask ${this.tap.ask.kind}: ${firstLine(this.tap.ask.prompt ?? this.tap.ask.title ?? '')}` : firstLine(this.tap.input?.prompt) };
    const r = this.tap.ask ? await this.answerAsk(dom) : await this.answerInput(dom);
    this.trace.push({ ...at, ms: Date.now() - at.t, r, did: this.lastDid ?? null });
    this.lastDid = null;
    return r;
  }

  // -------------------------------------------------------------------------
  // Asks (§5)

  async answerAsk(dom) {
    const ask = this.tap.ask;
    this.count('asks', ask.kind);
    if (!dom.dialog && dom.peek) {
      await this.click(dom.peek, 'the minimised question');
      await sleep(200);
      dom = await this.dom();
    }
    if (!dom.dialog) {
      // Give the dialog a moment to draw before calling it missing.
      await sleep(1500);
      dom = await this.dom();
      if (!dom.dialog && dom.peek) {
        await this.click(dom.peek, 'the minimised question');
        await sleep(200);
        dom = await this.dom();
      }
      if (!dom.dialog) {
        if (this.tap.ask?.askId !== ask.askId) return 'ask-gone';
        await this.unreachable(`ask ${ask.kind} "${firstLine(ask.prompt ?? ask.title ?? '')}": no dialog on screen`, { ask });
        return 'stuck';
      }
    }
    const sentMark = this.tap.sent.length;
    const dlg = this.page.locator('.ask-dialog');
    const answered = () => this.sentSince(sentMark, (f) => f.type === 'answer' && f.body?.askId === ask.askId, 4000);
    const opts = dlg.locator('.ask-body .ask-opt');
    const confirm = dlg.locator('[data-answer="confirm"]').last();
    const skip = dlg.locator('[data-answer="skip"]');
    const clickLoc = async (loc, what) => {
      try {
        await loc.click({ timeout: 5000 });
        return true;
      } catch (e) {
        await this.finding({ kind: 'control-not-clickable', what, ask, why: String(e.message).split('\n')[0] });
        return false;
      }
    };
    const confirmOrSkip = async (why) => {
      if ((await confirm.count()) && (await confirm.isEnabled().catch(() => false))) return clickLoc(confirm, 'Confirm');
      await this.finding({ kind: 'ask-confirm-disabled', what: `${ask.kind}: Confirm stays disabled after a legal choice (${why})`, ask });
      if (await skip.count()) return clickLoc(skip.first(), 'Skip');
      return false;
    };
    const am = this.askModel;
    switch (ask.kind) {
      case 'ability_menu': {
        const playable = ask.options.filter((o) => o.canPlay);
        const n = await dlg.locator('.ask-ability').count();
        if (n !== ask.options.length) await this.unreachable(`ability_menu: ${ask.options.length} abilities, ${n} rows`, { ask });
        if (!playable.length || this.rand() < 0.1) {
          this.count('rare', 'ability-menu-cancel');
          if (await skip.count()) await clickLoc(skip.first(), 'Cancel');
          break;
        }
        const o = this.pick(playable);
        const i = ask.options.indexOf(o);
        const row = dlg.locator('.ask-ability').nth(i);
        if (!(await row.isEnabled().catch(() => false))) {
          await this.unreachable(`ability_menu option "${o.label}" (canPlay) is disabled`, { ask });
          break;
        }
        this.count('rare', 'ability-menu');
        await clickLoc(row, `ability "${o.label}"`);
        break;
      }
      case 'confirm': {
        const yes = this.rand() < 0.7 ? ask.defaultYes : this.rand() < 0.5;
        await clickLoc(dlg.locator(`[data-answer="${yes ? 'yes' : 'no'}"]`), yes ? 'Yes' : 'No');
        break;
      }
      case 'options': {
        const n = await opts.count();
        if (n !== ask.options.length) await this.unreachable(`options: ${ask.options.length} options, ${n} rows ("${firstLine(ask.prompt)}")`, { ask });
        const i = this.rand() < 0.5 && ask.defaultIndex >= 0 && ask.defaultIndex < n ? ask.defaultIndex : Math.floor(this.rand() * Math.max(1, n));
        if (ask.options.length > 1) this.count('rare', 'modal-choice');
        if (n) await clickLoc(opts.nth(i), `option ${i}`);
        await confirmOrSkip('options');
        break;
      }
      case 'text': {
        const input = dlg.locator('input.ask-text');
        const v = ask.suggestions?.length ? this.pick(ask.suggestions) : ask.numeric ? String(Math.floor(this.rand() * 3)) : ask.initial || 'x';
        if (ask.numeric) this.count('rare', 'x-number');
        await input.fill(v).catch(() => {});
        await confirmOrSkip('text');
        break;
      }
      case 'choose_list':
      case 'choose_entities': {
        if (ask.kind === 'choose_list' && ask.reveal) {
          await clickLoc(dlg.locator('[data-answer="ok"]'), 'OK');
          break;
        }
        if (ask.delayedReveal || /graveyard|exile|library/i.test(ask.prompt ?? '')) this.count('rare', 'zone-choice');
        const { lo, hi } = am.choiceBounds(ask);
        // The dialog's own grouping: identical cards are one control with a count.
        const cardList = !am.isNumberList(ask.options) && !am.isColorList(ask.options) && am.isCardList(ask.options);
        const groups = cardList ? am.groupOptions(ask.options) : ask.options.map((o) => ({ ids: [o.id], label: o.label }));
        const n = await opts.count();
        if (n !== groups.length) {
          await this.unreachable(`${ask.kind}: ${groups.length} choices, ${n} controls ("${firstLine(ask.prompt)}")`, { ask });
        }
        let want = lo + Math.floor(this.rand() * (hi - lo + 1));
        if (ask.kind === 'choose_list' && this.rand() < 0.4 && ask.preselected?.length) want = -1; // Forge's own preselection
        if (want >= 0) {
          // Start from nothing (a preselection is toggled off first).
          const chosenNow = new Set(am.initialDraft(ask).indices ?? []);
          const target = new Set();
          const order = this.shuffle(groups.flatMap((g, gi) => g.ids.map((id) => ({ id, gi }))));
          for (const x of order.slice(0, want)) target.add(x.id);
          // Toggle: a group click adds the next copy (toggleGroup), so click a group once per wanted copy.
          for (const id of chosenNow) if (!target.has(id)) {
            const gi = groups.findIndex((g) => g.ids.includes(id));
            if (gi >= 0 && gi < n) await clickLoc(opts.nth(gi), `un-pick ${id}`);
          }
          for (const id of target) {
            if (chosenNow.has(id)) continue;
            const gi = groups.findIndex((g) => g.ids.includes(id));
            if (gi >= 0 && gi < n) await clickLoc(opts.nth(gi), `pick option ${id}`);
          }
        }
        await confirmOrSkip(`${ask.kind} ${want} of ${lo}–${hi}`);
        break;
      }
      case 'order': {
        const tiles = dlg.locator('.ask-otile');
        const t = await tiles.count();
        if (t >= 2) {
          this.count('rare', 'trigger-order');
          // Reorder a little with the tiles' own arrows, then OK.
          const moves = dlg.locator('.ask-otile-move button:not([disabled])');
          const m = await moves.count();
          for (let k = 0; k < Math.min(3, m) && this.rand() < 0.7; k++) await moves.nth(Math.floor(this.rand() * m)).click({ timeout: 3000 }).catch(() => {});
          await confirmOrSkip('order tiles');
          break;
        }
        // The list form: add from the pool until Confirm is enabled.
        for (let k = 0; k < 60; k++) {
          if (await confirm.isEnabled().catch(() => false)) break;
          const pool = dlg.locator('.ask-pool-row');
          if (!(await pool.count())) break;
          await pool.nth(Math.floor(this.rand() * (await pool.count()))).click({ timeout: 3000 }).catch(() => {});
        }
        await confirmOrSkip('order list');
        break;
      }
      case 'assign_damage':
      case 'assign_amount': {
        this.count('rare', ask.kind);
        if (!(await confirm.isEnabled().catch(() => false))) {
          // Spread the amount with the steppers' + until the meter is full.
          const plus = dlg.locator('.ask-step button:last-child:not([disabled])');
          for (let k = 0; k < 40 && !(await confirm.isEnabled().catch(() => false)); k++) {
            const c = await plus.count();
            if (!c) break;
            await plus.nth(Math.floor(this.rand() * c)).click({ timeout: 3000 }).catch(() => {});
          }
        }
        await confirmOrSkip(ask.kind);
        break;
      }
      case 'manipulate_list': {
        this.count('rare', 'manipulate');
        const moves = dlg.locator('.ask-move button:not([disabled])');
        const m = await moves.count();
        for (let k = 0; k < Math.min(2, m) && this.rand() < 0.5; k++) await moves.nth(Math.floor(this.rand() * m)).click({ timeout: 3000 }).catch(() => {});
        await confirmOrSkip('manipulate_list');
        break;
      }
      case 'sideboard':
        await confirmOrSkip('sideboard');
        break;
      default:
        await this.finding({ kind: 'unknown-ask', what: ask.kind, ask });
        if (await skip.count()) await clickLoc(skip.first(), 'Skip');
    }
    if (!(await answered())) {
      if (this.tap.ask?.askId === ask.askId) {
        await this.finding({ kind: 'ask-not-answered', what: `${ask.kind} "${firstLine(ask.prompt ?? '')}": the clicks sent no answer`, ask });
        return 'stuck';
      }
    }
    await this.settle(1500);
    return `ask:${ask.kind}`;
  }

  // -------------------------------------------------------------------------
  // Inputs (§4)

  /** Which kind of moment an input is, from Forge's own prompt. */
  inputKind() {
    const i = this.tap.input;
    const p = i.prompt ?? '';
    const s = this.tap.state;
    if (!s?.phase && /play or draw|keep|mulligan/i.test(p + i.buttons.ok.label)) return 'opening';
    if (/^(keep|play)$/i.test(i.buttons.ok.label.trim()) && /^(mulligan|draw)$/i.test(i.buttons.cancel.label.trim())) return 'opening';
    if (/Pay Mana Cost/i.test(p)) return 'pay';
    if (/^Select creatures to attack/i.test(p)) return 'attack';
    if (/^Select creatures to block/i.test(p)) return 'block';
    if (/^Priority:/i.test(p)) return 'priority';
    if (i.selectable.mode === 'players') return 'players';
    if (i.selectable.mode === 'cards' && i.selectable.cardIds.length) return 'select';
    // OK off and no list: Forge wants a click on a card or a player it did not name (InputSelectTargets for a player).
    if (!i.buttons.ok.enabled) return 'open';
    return 'buttons';
  }

  /** Checks every option of the input has a control; returns nothing. */
  async checkInputReach(dom, kind) {
    const i = this.tap.input;
    if (kind === 'opening') {
      const n = dom.opening.filter((b) => b.vis && b.enabled).length;
      if (n < 2) await this.unreachable(`opening "${firstLine(i.prompt)}": ${n} of 2 buttons`, { input: i });
      return;
    }
    for (const which of ['ok', 'cancel']) {
      const b = i.buttons[which];
      if (!b.enabled) continue;
      // Forge's End Turn is also "To EOT" (the bar shows one of the two when they say the same).
      if (!this.button(dom, which) && !(which === 'cancel' && /end turn/i.test(b.label) && dom.eot)) {
        await this.unreachable(`button ${which} "${b.label}" (${kind}: "${firstLine(i.prompt)}")`, { input: i });
      }
    }
    if (kind === 'select' || kind === 'pay' || kind === 'buttons') {
      for (const id of i.selectable.cardIds) {
        if (!this.cardControls(dom, id).length) {
          const c = this.tap.card(id);
          await this.unreachable(`selectable card ${id}${c && !c.hidden ? ` (${c.name}, ${c.zone})` : ''} — "${firstLine(i.prompt)}"`, { input: i, cardId: id, card: c, key: `sel|${id}|${firstLine(i.prompt)}` });
        }
      }
    }
    if (kind === 'players') {
      if (!dom.players.some((p) => p.vis && p.select)) await this.unreachable(`a player to choose — "${firstLine(i.prompt)}"`, { input: i });
    }
  }

  async answerInput(dom) {
    const input = this.tap.input;
    const kind = this.inputKind();
    this.count('modes', kind);
    // The board can lag the wire by a frame: wait for it to show this input's buttons.
    await sleep(100);
    dom = await this.dom();
    // The moment moved on while we looked (Forge's "Waiting for …" came in): nothing to judge.
    if (this.tap.input !== input || !this.tap.deciding() || this.tap.ask) return 'moved-on';
    await this.checkInputReach(dom, kind);
    if (this.tap.input !== input) return 'moved-on';
    switch (kind) {
      case 'opening':
        return this.opening(dom);
      case 'pay':
        return this.pay(dom);
      case 'attack':
        return this.attack(dom);
      case 'block':
        return this.block(dom);
      case 'priority':
        return this.priority(dom);
      case 'select':
      case 'players':
        return this.select(dom, kind);
      case 'open':
        return this.openTarget(dom);
      default:
        return this.buttons(dom, kind);
    }
  }

  async opening(dom) {
    const btns = dom.opening.filter((b) => b.vis && b.enabled);
    if (!btns.length) return 'stuck';
    const i = this.tap.input;
    const mull = /^mulligan$/i.test(i.buttons.cancel.label.trim());
    let pickCancel = this.rand() < 0.2;
    if (mull && this.mulligans >= 1) pickCancel = false;
    if (pickCancel && mull) this.mulligans++;
    const b = btns.find((x) => x.which === (pickCancel ? 'cancel' : 'ok')) ?? btns[0];
    await this.click(b.t, b.text);
    await this.settle();
    return 'opening';
  }

  /** The engine's OK / Cancel, through the bar's (or the zone picker's) button. */
  async press(dom, which) {
    const b = dom.buttons.find((x) => x.which === which && x.vis && x.enabled && x.where === 'zpick') ?? this.button(dom, which);
    if (!b) return false;
    const mark = this.tap.sent.length;
    if (!(await this.click(b.t, `${which} "${b.text}"`))) return false;
    const act = which === 'ok' ? 'buttonOk' : 'buttonCancel';
    if (!(await this.sentSince(mark, (f) => f.type === 'act' && f.body?.action === act, 3000))) {
      await this.finding({ kind: 'click-no-act', what: `${which} "${b.text}" sent no ${act}`, input: this.tap.input });
    }
    await this.settle();
    return true;
  }

  async clickCard(dom, id, what) {
    const ctl = this.cardControls(dom, id)[0];
    if (!ctl) return false;
    const mark = this.tap.sent.length;
    if (!(await this.click(ctl.t, what))) return false;
    const ok = await this.sentSince(mark, (f) => f.type === 'act' && f.body?.action === 'clickCard' && f.body.cardId === ctl.id, 2500);
    if (!ok) await this.finding({ kind: 'click-no-act', what: `${what}: a click on a marked card sent no clickCard`, cardId: id });
    return ok;
  }

  async pay(dom) {
    const i = this.tap.input;
    const me = this.tap.me();
    const sources = (me?.zones.battlefield.cards ?? []).filter((c) => !c.hidden && !c.tapped && (isLand(c) || (this.scripts.get(c.name)?.bf ?? []).includes('mana')));
    const reachable = sources.filter((c) => this.cardControls(dom, c.id).length);
    const pip = dom.pips.find((p) => p.vis);
    const choice = this.weighted([
      [i.buttons.ok.enabled ? 6 : 0, 'auto'],
      [reachable.length ? 2.5 : 0, 'tap'],
      [pip ? 1 : 0, 'pool'],
      [i.buttons.cancel.enabled ? 0.6 : 0, 'cancel'],
    ]);
    if (choice === 'tap') {
      // Forge's weak set is what Auto would tap: the "good" taps.
      const weak = reachable.filter((c) => i.weak.includes(c.id));
      const c = weak.length && this.rand() < 0.6 ? this.pick(weak) : this.pick(reachable);
      this.count('rare', 'manual-tap');
      await this.clickCard(dom, c.id, `tap ${c.name} for mana`);
      await this.settle();
      return 'pay:tap';
    }
    if (choice === 'pool') {
      this.count('rare', 'use-mana');
      await this.click(pip.t, 'floating mana');
      await this.settle();
      return 'pay:pool';
    }
    if (choice === 'cancel') {
      await this.press(dom, 'cancel');
      return 'pay:cancel';
    }
    if (choice === 'auto') {
      await this.press(dom, 'ok');
      return 'pay:auto';
    }
    // Nothing to pay with and nothing to press.
    return (await this.press(dom, 'cancel')) ? 'pay:cancel' : 'stuck';
  }

  myCreatures(pred = () => true) {
    const me = this.tap.me();
    return (me?.zones.battlefield.cards ?? []).filter((c) => isCreature(c) && pred(c));
  }

  async attack(dom) {
    const i = this.tap.input;
    const ready = this.myCreatures((c) => !c.tapped && !c.attacking && (!c.sick || hasKw(c, 'HASTE')) && !hasKw(c, 'DEFENDER'));
    for (const c of ready) {
      if (!this.cardControls(dom, c.id).length) await this.unreachable(`attacker ${c.name} (${c.id}) has no clickable tile`, { input: i, cardId: c.id });
    }
    const r = this.rand();
    if (/alpha/i.test(i.buttons.cancel.label) && i.buttons.cancel.enabled && r < 0.12 && ready.length) {
      this.count('rare', 'alpha-strike');
      await this.press(dom, 'cancel');
      dom = await this.dom();
      if (this.tap.input && /^Select creatures to attack/i.test(this.tap.input.prompt)) await this.press(dom, 'ok');
      return 'attack:alpha';
    }
    // Mostly in: a monkey that never attacks plays games to the turn cap.
    const chosen = r < 0.55 ? ready : r < 0.9 ? ready.filter(() => this.rand() < 0.6) : [];
    for (const c of chosen) {
      dom = await this.dom();
      if (!this.cardControls(dom, c.id).length) continue;
      await this.clickCard(dom, c.id, `attack with ${c.name}`);
      await this.settle(1200);
      if (!this.tap.input || !/^Select creatures to attack/i.test(this.tap.input.prompt)) return 'attack:moved-on';
    }
    dom = await this.dom();
    if (this.tap.input?.buttons.ok.enabled) await this.press(dom, 'ok');
    return `attack:${chosen.length}`;
  }

  async block(dom) {
    const i = this.tap.input;
    const opp = this.tap.opp();
    const attackers = (opp?.zones.battlefield.cards ?? []).filter((c) => !c.hidden && c.attacking);
    const blockers = this.myCreatures((c) => !c.tapped && !c.blocking);
    for (const a of attackers) if (!this.cardControls(dom, a.id).length) await this.unreachable(`attacker ${a.name} (${a.id}) cannot be clicked to block it`, { input: i, cardId: a.id });
    for (const b of blockers) if (!this.cardControls(dom, b.id).length) await this.unreachable(`blocker ${b.name} (${b.id}) has no clickable tile`, { input: i, cardId: b.id });
    const plan = new Map();
    if (attackers.length && blockers.length && this.rand() < 0.75) {
      const gang = this.rand() < 0.3 && blockers.length >= 2;
      const focus = this.pick(attackers);
      for (const b of blockers) {
        if (gang) plan.set(b.id, focus.id);
        else if (this.rand() < 0.5) plan.set(b.id, this.pick(attackers).id);
      }
      if (gang) this.count('rare', 'multi-block');
    }
    for (const [bid, aid] of plan) {
      const cur = /\((\d+)\)/.exec(this.tap.input?.prompt ?? '')?.[1];
      dom = await this.dom();
      if (Number(cur) !== aid) {
        await this.clickCard(dom, aid, `choose attacker ${aid} to block`);
        await this.settle(1200);
        dom = await this.dom();
      }
      const b = this.tap.card(bid);
      await this.clickCard(dom, bid, `block with ${b?.name ?? bid}`);
      await this.settle(1200);
      if (!this.tap.input || !/^Select creatures to block/i.test(this.tap.input.prompt)) return 'block:moved-on';
    }
    dom = await this.dom();
    if (this.tap.input?.buttons.ok.enabled) await this.press(dom, 'ok');
    return `block:${plan.size}`;
  }

  /** The seat's own cards a click at priority may play (the engine judges each). */
  priorityCandidates() {
    const s = this.tap.state;
    const me = this.tap.me();
    if (!s || !me) return [];
    const myTurn = s.activePlayer === this.tap.seat;
    const mainEmpty = myTurn && (s.phase === 'MAIN1' || s.phase === 'MAIN2') && s.stack.length === 0;
    const untapped = me.zones.battlefield.cards.filter((c) => !c.hidden && !c.tapped && isLand(c)).length + Object.values(me.manaPool ?? {}).reduce((a, b) => a + b, 0);
    const landPlayed = this.tap.gameFrames().some((f) => f.type === 'state' && f.body.turn === s.turn && (f.body.events ?? []).some((e) => e.kind === 'land' && e.player === this.tap.seat));
    const out = [];
    for (const c of me.zones.hand.cards) {
      if (c.hidden) continue;
      const fl = this.scripts.get(c.name);
      const instant = /instant/i.test(c.types ?? '') || hasKw(c, 'FLASH');
      if (isLand(c)) {
        if (mainEmpty && !landPlayed) out.push({ c, zone: 'hand', why: 'land', w: 5, need: true });
      } else if (mainEmpty || instant) {
        const afford = manaValue(c.manaCost) <= untapped;
        out.push({ c, zone: 'hand', why: instant ? 'instant' : 'spell', w: afford ? 3 : 0.3, need: true, x: /\{X\}/.test(c.manaCost ?? '') });
      }
      if (fl?.hand?.length) out.push({ c, zone: 'hand', why: `hand ability (${fl.hand.join(', ')})`, w: 1.2, need: true, rare: 'hand-ability' });
    }
    for (const c of me.zones.battlefield.cards) {
      if (c.hidden || c.controller !== this.tap.seat) continue;
      const fl = this.scripts.get(c.name);
      const abil = (fl?.bf ?? []).filter((x) => x !== 'mana');
      if (abil.length) {
        const equip = abil.includes('Equip');
        out.push({ c, zone: 'battlefield', why: `ability (${abil.join(', ')})`, w: equip ? 3 : 2.2, need: true, rare: equip ? (c.attachedToId ? 'equip-attached' : 'equip') : 'activate', attached: !!c.attachedToId });
      }
    }
    for (const c of me.zones.graveyard.cards) {
      if (c.hidden) continue;
      const fl = this.scripts.get(c.name);
      if (fl?.gy?.length && (mainEmpty || /instant/i.test(c.types ?? '') || fl.gy.some((k) => k !== 'Flashback'))) {
        out.push({ c, zone: 'graveyard', why: `from the graveyard (${fl.gy.join(', ')})`, w: 2, need: true, rare: 'graveyard-cast' });
      }
    }
    return out;
  }

  /** A graveyard card's control: the zone viewer opened from the player's graveyard pill. */
  async graveyardControl(dom, c) {
    const pill = dom.pills.find((p) => p.zone === 'graveyard' && p.player === this.tap.seat && p.vis && p.enabled);
    if (!pill) return null;
    await this.click(pill.t, 'your graveyard');
    await sleep(300);
    const d2 = await this.dom();
    return { dom: d2, ctl: this.cardControls(d2, c.id)[0] ?? null };
  }

  async priority(dom) {
    const s = this.tap.state;
    const i = this.tap.input;
    const inst = `${this.tap.gameId}:${s?.turn}:${s?.phase}:${s?.stack.length}:${s?.stack.at(-1)?.id ?? 0}`;
    const tried = this.tried.get(inst) ?? new Set();
    this.tried.set(inst, tried);
    const turnKey = `${this.tap.gameId}:${s?.turn}`;
    const used = this.turnClicks.get(turnKey) ?? 0;
    const cands = this.priorityCandidates();
    // Reachability: each candidate needs a marked control (the graveyard's through its viewer, checked when chosen).
    // A board a moment behind the wire gets 1.5 s to catch up before a missing control counts.
    if (cands.some((k) => k.zone !== 'graveyard' && !this.cardControls(dom, k.c.id).length)) {
      await sleep(1500);
      if (this.tap.input !== i || this.tap.ask) return 'moved-on';
      dom = await this.dom();
    }
    for (const k of cands) {
      if (k.zone === 'graveyard') continue;
      if (!this.cardControls(dom, k.c.id).length) {
        await this.unreachable(`${k.c.name} (${k.c.id}, ${k.zone}${k.attached ? ', attached' : ''}): ${k.why} — no clickable control at "${firstLine(i.prompt)}" (${s?.phase})`, { input: i, cardId: k.c.id, card: k.c, key: `cand|${k.c.id}|${k.why}` });
      }
    }
    const live = cands.filter((k) => !tried.has(k.c.id));
    const options = [
      [i.buttons.ok.enabled ? 3 : 0, { kind: 'ok' }],
      [i.buttons.cancel.enabled ? 0.25 : 0, { kind: 'cancel' }],
      [dom.eot ? 0.2 : 0, { kind: 'eot' }],
    ];
    // A card already found unreachable is tried rarely after that (the finding is in; the game goes on).
    if (used < 25) for (const k of live) options.push([this.deadEnds.has(k.c.id) ? k.w * 0.05 : k.w, { kind: 'card', k }]);
    const choice = this.weighted(options);
    if (!choice) return 'stuck';
    if (choice.kind === 'ok' || choice.kind === 'cancel') {
      if (await this.press(dom, choice.kind)) return `priority:${choice.kind}`;
      return 'stuck';
    }
    if (choice.kind === 'eot') {
      this.count('rare', 'to-eot');
      const mark = this.tap.sent.length;
      await this.click(dom.eot, 'To EOT');
      await this.sentSince(mark, (f) => f.type === 'act' && f.body?.action === 'yieldTo', 2500);
      await this.settle();
      return 'priority:eot';
    }
    const { k } = choice;
    tried.add(k.c.id);
    this.turnClicks.set(turnKey, used + 1);
    if (k.rare) this.count('rare', k.rare);
    if (k.x) this.count('rare', 'x-spell');
    let d = dom;
    let ctl = this.cardControls(dom, k.c.id)[0];
    if (k.zone === 'graveyard') {
      const g = await this.graveyardControl(dom, k.c);
      if (g) {
        d = g.dom;
        ctl = g.ctl;
      }
      if (!ctl) {
        this.deadEnds.add(k.c.id);
        await this.unreachable(`${k.c.name} (${k.c.id}) in your graveyard: ${k.why} — the graveyard shows no playable control at "${firstLine(i.prompt)}" (${s?.phase})`, { input: i, cardId: k.c.id, card: k.c, key: `gy|${k.c.id}|${k.why}` });
        await this.page.keyboard.press('Escape').catch(() => {});
        return 'priority:gy-unreachable';
      }
    }
    if (!ctl) return 'priority:skip';
    const mark = this.tap.mark;
    const ok = await this.clickCard(d, k.c.id, `${k.why}: ${k.c.name}`);
    if (!ok) return 'priority:click-failed';
    // The engine answers with a payment, a target, a menu, a new state — or nothing (it would not take it).
    await this.tap.until(() => this.tap.mark > mark, 2500);
    await this.settle(800);
    return `priority:card:${k.why}`;
  }

  async select(dom, kind) {
    const i = this.tap.input;
    const prompt = i.prompt;
    if (kind === 'players') {
      const ps = dom.players.filter((p) => p.vis && p.select);
      if (ps.length) {
        const p = this.pick(ps);
        const mark = this.tap.sent.length;
        await this.click(p.t, `player ${p.id}`);
        await this.sentSince(mark, (f) => f.type === 'act' && f.body?.action === 'clickPlayer', 2500);
        await this.settle();
        return 'select:player';
      }
      return this.buttons(dom, kind);
    }
    const ids = i.selectable.cardIds.filter((id) => this.cardControls(dom, id).length);
    if (i.selectable.cardIds.some((id) => this.cardControls(dom, id).some((c) => c.where === 'zpick'))) this.count('rare', 'zone-pick');
    const min = Math.max(0, i.selectable.min);
    const max = Math.max(min, i.selectable.max || 1);
    // Sometimes finish with OK at the minimum (or nothing) when OK is on: Forge's own "done".
    if (i.buttons.ok.enabled && this.rand() < 0.3) {
      await this.press(dom, 'ok');
      return 'select:ok';
    }
    if (!ids.length) return this.buttons(dom, kind);
    const want = Math.max(1, Math.min(ids.length, min + Math.floor(this.rand() * (max - min + 1))));
    const chosen = this.shuffle(ids).slice(0, want);
    for (const id of chosen) {
      dom = await this.dom();
      const c = this.tap.card(id);
      if (!(await this.clickCard(dom, id, `choose ${c && !c.hidden ? c.name : `card ${id}`}`))) break;
      await this.settle(1500);
      if (this.tap.ask || !this.tap.input || this.tap.input.prompt !== prompt) return 'select:done';
    }
    dom = await this.dom();
    if (this.tap.input?.prompt === prompt && this.tap.input.buttons.ok.enabled) await this.press(dom, 'ok');
    return `select:${chosen.length}`;
  }

  /** A target the engine did not list: the board outlines players and cards a click may choose (§4.2). */
  async openTarget(dom) {
    const i = this.tap.input;
    const players = dom.players.filter((p) => p.vis && p.select);
    const cards = dom.cards.filter((c) => c.vis && !c.disabled && (c.mark === 'act' || c.mark === 'select') && c.where !== 'hand');
    if (!players.length && !cards.length) {
      await this.unreachable(`a target with nothing named: no player or card offered to click — "${firstLine(i.prompt)}"`, { input: i });
      return this.buttons(dom, 'open');
    }
    const wantPlayer = /player|opponent|any target/i.test(i.prompt) ? 0.7 : 0.2;
    const prompt = i.prompt;
    const mark = this.tap.sent.length;
    if (players.length && (this.rand() < wantPlayer || !cards.length)) {
      // Mostly the opponent (Forge's own choice for a burn spell or a discard); sometimes yourself.
      const opp = players.find((p) => p.id !== this.tap.seat);
      const p = opp && this.rand() < 0.75 ? opp : this.pick(players);
      await this.click(p.t, `target player ${p.id}`);
      await this.sentSince(mark, (f) => f.type === 'act' && f.body?.action === 'clickPlayer', 2500);
      this.count('rare', 'target-player');
    } else {
      const c = this.pick(cards);
      await this.click(c.t, `target card ${c.id}`);
      await this.sentSince(mark, (f) => f.type === 'act' && f.body?.action === 'clickCard', 2500);
    }
    await this.settle();
    // Not taken (Forge says "not a valid target" and asks again): leave with Cancel now and then.
    if (this.tap.input?.prompt === prompt && !this.tap.ask && this.rand() < 0.3) {
      dom = await this.dom();
      await this.press(dom, 'cancel');
    }
    return 'open-target';
  }

  async buttons(dom, kind) {
    const i = this.tap.input;
    const focus = i.buttons.focus ?? (i.buttons.ok.enabled ? 'ok' : 'cancel');
    const which = this.rand() < 0.75 && i.buttons[focus]?.enabled ? focus : i.buttons.ok.enabled && i.buttons.cancel.enabled ? (this.rand() < 0.5 ? 'ok' : 'cancel') : i.buttons.ok.enabled ? 'ok' : 'cancel';
    if (!i.buttons[which].enabled) return 'stuck';
    if (await this.press(dom, which)) return `buttons:${kind}:${which}`;
    return 'stuck';
  }

  // -------------------------------------------------------------------------
  // Leaving a game through the board

  async concede() {
    const dom = await this.dom();
    if (dom.sheet) await this.page.keyboard.press('Escape').catch(() => {});
    try {
      // Desktop: the top bar's flag. Phone: the top bar's More menu.
      const flag = this.page.getByRole('button', { name: 'Concede', exact: true }).first();
      if (!(await flag.isVisible().catch(() => false))) {
        await this.page.getByRole('button', { name: 'More' }).first().click({ timeout: 8000 });
        await this.page.getByRole('menuitem', { name: /Concede/ }).first().click({ timeout: 8000 });
      } else await flag.click({ timeout: 8000 });
      await this.page.locator('.btn-stop', { hasText: 'Concede' }).click({ timeout: 8000 });
      return await this.tap.until(() => !!this.tap.over, 20_000);
    } catch (e) {
      await this.finding({ kind: 'concede-failed', what: String(e.message).split('\n')[0] });
      return false;
    }
  }
}

export { HAND_ZONES };

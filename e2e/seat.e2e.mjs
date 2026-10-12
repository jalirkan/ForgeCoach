#!/usr/bin/env node
/*
 * ForgeCoach — e2e/seat.e2e.mjs
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Playing through the real app against a fake engine (e2e/fake-engine.mjs):
 * no mtg-table, no Forge, no network. `npm run test:e2e`.
 *
 *   1. builds ForgeCoach (BUILD=0 reuses dist/) and serves it with
 *      `vite preview` on a Vite port of 127.0.0.1 (one of seatUrl.ts's
 *      DEV_PORTS, so the page does not take itself for one the bridge served);
 *   2. runs each scenario below in a fresh browser context against a fresh
 *      fake engine, clicking only what a player clicks, and checking both the
 *      screen and what the engine received;
 *   3. Google Fonts are answered with empty CSS, Scryfall with 404s, the
 *      coach helper (127.0.0.1:8643) with a refused connection, and anything
 *      else off the machine is blocked.
 *
 * Scenarios: a whole game (mulligan, London bottom, land, creature, pay, the
 * stack, attack, the AI's spell, a block, Shock's target ask, game over, the
 * next game); a seat dropped with a question open (engine took the default /
 * engine asked again); an engine restarted under the same game id after the
 * result and mid-game; live watch on /observe never opening /ws; combat damage
 * by the engine's rule (mtg-table M67: no defender row without trample, the
 * engine's refusal shown, a trampler's excess); the coach's "Copy prompt" with
 * no helper; the search hint ("What would the search AI do?", mtg-table D429)
 * against a fake helper that offers it.
 *
 * Environment: BUILD=0 (reuse dist/), APP_URL (test a running ForgeCoach
 * instead; it must be on a Vite port), HEADLESS=0, ONLY=<substring of a
 * scenario name>, REPEAT=<n> (run the suite n times, for flake hunting),
 * VERBOSE=1 (log the engine's frames).
 * Exit status: 0 pass, 1 a scenario failed, 2 could not start. Failure
 * screenshots go to e2e/out/.
 */
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchBrowser, loadPlaywright, waitHttp } from './harness.mjs';
import { startFakeEngine } from './fake-engine.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'e2e', 'out');
const env = process.env;
const HEADLESS = !/^(0|false|no)$/i.test(env.HEADLESS ?? '1');
const VERBOSE = /^(1|true|yes)$/i.test(env.VERBOSE ?? '');
const REPEAT = Math.max(1, Number(env.REPEAT || 1));
const STEP_MS = 15_000;

class Fail extends Error {}
const check = (ok, msg) => {
  if (!ok) throw new Fail(msg);
};

// ---------------------------------------------------------------------------
// The app

let preview = null;

async function appUrl() {
  if (env.APP_URL) return env.APP_URL.replace(/\/?$/, '/');
  if (!/^(0|false|no)$/i.test(env.BUILD ?? '1')) {
    console.log('[e2e seat] building ForgeCoach (npm run build)');
    execFileSync('npm', ['run', 'build'], { cwd: ROOT, stdio: ['ignore', 'ignore', 'inherit'] });
  }
  // A Vite port (src/play/seatUrl.ts DEV_PORTS): on any other the page takes itself for one the bridge served.
  let port = 0;
  for (const p of [4173, 5174, 5173]) {
    if (!(await waitHttp(`http://127.0.0.1:${p}/`, 300, { ok: () => true }))) {
      port = p;
      break;
    }
  }
  if (!port) throw new Error('ports 4173, 5174 and 5173 are all busy: set APP_URL, or free one');
  const bin = path.join(ROOT, 'node_modules', '.bin', 'vite');
  preview = spawn(bin, ['preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: ROOT, stdio: 'ignore' });
  const url = `http://127.0.0.1:${port}/`;
  if (await waitHttp(url, 60_000, { alive: () => preview.exitCode === null })) return url;
  throw new Error(`vite preview did not start on ${url}`);
}

/** Everything off the machine is answered here; WebSockets are not routed (they reach the fake engine). */
async function isolate(context, appOrigin, helper = null) {
  await context.route('**/*', (route) => {
    const u = new URL(route.request().url());
    if (u.origin === appOrigin) return route.continue();
    // A scenario's fake coach helper (127.0.0.1:8643); without one it is refused, as when none runs.
    if (helper && u.hostname === '127.0.0.1' && u.port === '8643') return helper(route, u);
    if (u.hostname === 'fonts.googleapis.com') return route.fulfill({ status: 200, contentType: 'text/css', body: '' });
    if (u.hostname === 'api.scryfall.com') return route.fulfill({ status: 404, contentType: 'application/json', body: '{"object":"error","code":"not_found","status":404,"details":"e2e"}' });
    return route.abort('connectionrefused');
  });
}

// ---------------------------------------------------------------------------
// What a player does

function ui(page) {
  const bar = page.locator('.actionbar');
  const self = {
    /** Waits for the board's input mode (`.game.play.mode-<m>`). */
    async mode(m, ms = STEP_MS) {
      await page.locator(`.game.play.mode-${m}`).waitFor({ timeout: ms });
    },
    async ok() {
      const b = bar.locator('[data-engine-button="ok"]');
      await b.click({ timeout: STEP_MS });
    },
    async cancel() {
      await bar.locator('[data-engine-button="cancel"]').click({ timeout: STEP_MS });
    },
    /** The opening hand's dialog (keep / mulligan): its button whose label starts with `label`. */
    async opening(label) {
      await page.locator('.ask-dialog').getByRole('button', { name: new RegExp(`^${label}`) }).click({ timeout: STEP_MS });
    },
    async openHand() {
      if (await page.locator('.hand-dock.is-collapsed').count()) await page.locator('.hand-dock-head').click();
    },
    /** A card on the board or in the hand, by the id the engine gave it. */
    card(id) {
      return page.locator(`.game [data-card-id="${id}"]`).first();
    },
    async click(id) {
      await self.openHand();
      await self.card(id).click({ timeout: STEP_MS });
      // Off the card: its hover preview (and the lifted tile) would cover the action bar.
      await page.mouse.move(5, 5);
    },
    dialog: page.locator('.ask-dialog'),
    /** Picks the option labelled `label` in the open question, then confirms if it needs confirming. */
    async answer(label) {
      if (await page.locator('.ask-peek').isVisible().catch(() => false)) await page.locator('.ask-peek').click();
      await self.dialog.waitFor({ timeout: STEP_MS });
      await self.dialog.locator('.ask-opt', { hasText: label }).first().click({ timeout: STEP_MS });
      const confirm = self.dialog.locator('.ask-actions .btn-primary');
      if (await confirm.count()) {
        await page.waitForFunction(() => {
          const d = document.querySelector('.ask-dialog');
          return !d || !!d.querySelector('.ask-actions .btn-primary:not([disabled])');
        });
        if (await self.dialog.isVisible().catch(() => false)) await confirm.first().click({ timeout: STEP_MS });
      }
    },
    async noQuestion(ms = STEP_MS) {
      await page.waitForFunction(() => !document.querySelector('.ask-dialog') && !document.querySelector('.ask-peek'), null, { timeout: ms });
    },
  };
  return self;
}

/** The engine's id for a card of yours by name and zone. */
function mine(engine, name, zone = 'hand') {
  const c = engine.game.players[0][zone].find((x) => x.name === name);
  if (!c) throw new Fail(`the engine has no ${name} in your ${zone}`);
  return c.id;
}

/** The act count before, and a wait for the engine to have taken one more of `action`. */
async function sent(engine, action, fn) {
  const before = engine.acts().filter((a) => a.action === action).length;
  await fn();
  await engine.waitFor(() => engine.acts().filter((a) => a.action === action).length > before, `an act ${action}`, STEP_MS);
}

/** From `main3` (round 2, your first main): play a Mountain, Shock the AI (2 life) for the win. */
async function shockForTheWin(engine, u, { land = true } = {}) {
  if (land) {
    await sent(engine, 'clickCard', () => u.click(mine(engine, 'Mountain')));
    await engine.waitFor(() => engine.game.landPlayed, 'the land played');
  }
  await sent(engine, 'clickCard', () => u.click(mine(engine, 'Shock')));
  await u.answer('Forge AI');
  await u.mode('pay');
  await sent(engine, 'buttonOk', () => u.ok());
  await u.mode('stack');
  await sent(engine, 'buttonOk', () => u.ok());
  await engine.waitFor(() => engine.over, 'game over');
}

/** Theirs, by name, on the battlefield. */
function theirs(engine, name) {
  const c = engine.game.players[1].battlefield.find((x) => x.name === name);
  if (!c) throw new Fail(`the engine has no ${name} on the AI's battlefield`);
  return c.id;
}

/**
 * Declaring blocks (scene `blocks`): the AI attacks with Goblin Guide, Hill Giant and Storm Crow (a flyer);
 * you have Memnite, Raging Goblin and a summoning-sick Hill Giant. The attack lane, the block lane, and
 * the engine's own clicks for assign, move, take off (a click, and the ×), and a refused flyer block.
 */
async function blockDeclaration({ page, engine, app }) {
  const u = ui(page);
  await page.goto(`${app}?play=1&seat=${encodeURIComponent(engine.seatUrl)}`);
  await u.mode('block');
  const guide = theirs(engine, 'Goblin Guide');
  const giant = theirs(engine, 'Hill Giant');
  const crow = theirs(engine, 'Storm Crow');
  const memnite = mine(engine, 'Memnite', 'battlefield');
  const goblin = mine(engine, 'Raging Goblin', 'battlefield');
  const myGiant = mine(engine, 'Hill Giant', 'battlefield');
  const blocksOf = (a) => engine.game.blocks.get(a) ?? [];
  const clicks = () => engine.acts().filter((a) => a.action === 'clickCard').map((a) => a.cardId);
  const lastClicks = async (n, want, what) => {
    await engine.waitFor(() => JSON.stringify(clicks().slice(-n)) === JSON.stringify(want), what, STEP_MS);
  };
  const inFront = (blocker, attacker) => page.locator(`.player-me [data-combat-lane="block"] [data-blocks="${attacker}"] .tile[data-card-id="${blocker}"]`);

  // The attack lane: the attackers in the engine's order, on their side; no combat list anywhere.
  const cols = page.locator('.player-top [data-combat-lane="attack"] [data-lane-col]');
  await cols.first().waitFor({ timeout: STEP_MS });
  const order = await cols.evaluateAll((els) => els.map((e) => Number(e.getAttribute('data-lane-col'))));
  check(JSON.stringify(order) === JSON.stringify(engine.game.attackers), `the attack lane holds ${engine.game.attackers} in order (${order})`);
  check(!(await page.locator('.combat-panel, .combat-list').count()), 'no combat list on the board');
  check(!/unblocked/i.test(await page.locator('.board').innerText()), 'no "unblocked" anywhere');
  check(/→\s*You/.test(await page.locator('.player-top [data-lane-label]').innerText()), 'one target label for the lane: → You');
  // The instruction is the engine's flow; the summoning-sick mark is gone in their combat.
  check((await page.locator('.actionbar').innerText()).includes('Click an attacker, then your creature that blocks it'), 'the panel says how blocks are declared');
  check(!(await page.locator(`.tile[data-card-id="${myGiant}"] .tile-zz`).isVisible()), 'no Zz on a creature that may block');
  // Every attacker takes a click (the engine's outline).
  for (const a of [guide, giant, crow]) check((await u.card(a).getAttribute('data-mark')) === 'act', `attacker ${a} is clickable`);

  // Assign: the named attacker is Goblin Guide; Memnite blocks it and sits in front of it.
  await page.locator(`.player-top .tile.is-pair-current[data-card-id="${guide}"]`).waitFor({ timeout: STEP_MS });
  await u.click(memnite);
  await lastClicks(1, [memnite], 'the click on Memnite');
  await engine.waitFor(() => blocksOf(guide).includes(memnite), 'Memnite blocking Goblin Guide');
  await inFront(memnite, guide).waitFor({ timeout: STEP_MS });

  // Switch to Hill Giant, then click Memnite: it moves (off Guide, onto Giant) through the engine's clicks.
  await u.click(giant);
  await lastClicks(1, [giant], 'the click on Hill Giant');
  await page.locator(`.player-top .tile.is-pair-current[data-card-id="${giant}"]`).waitFor({ timeout: STEP_MS });
  await u.click(memnite);
  await lastClicks(4, [guide, memnite, giant, memnite], 'the move: Guide, Memnite, Giant, Memnite');
  await engine.waitFor(() => blocksOf(giant).includes(memnite) && !blocksOf(guide).includes(memnite), 'Memnite moved to Hill Giant');
  await inFront(memnite, giant).waitFor({ timeout: STEP_MS });

  // Take off by a click: Memnite blocks the named attacker, one click takes it off.
  await u.click(memnite);
  await lastClicks(1, [memnite], 'the second click on Memnite');
  await engine.waitFor(() => !blocksOf(giant).includes(memnite), 'Memnite off Hill Giant');
  await inFront(memnite, giant).waitFor({ state: 'detached', timeout: STEP_MS });

  // Take off by the ×, with another attacker named: off it, and the named one named again.
  await u.click(goblin);
  await engine.waitFor(() => blocksOf(giant).includes(goblin), 'Raging Goblin blocking Hill Giant');
  await u.click(crow);
  await lastClicks(1, [crow], 'the click on Storm Crow');
  await page.locator(`.player-top .tile.is-pair-current[data-card-id="${crow}"]`).waitFor({ timeout: STEP_MS });
  await page.locator(`.player-me [data-blocks="${giant}"] .lane-unblock`).click({ timeout: STEP_MS });
  await lastClicks(3, [giant, goblin, crow], 'the ×: Giant, Goblin, Crow');
  await engine.waitFor(() => !blocksOf(giant).includes(goblin) && engine.game.currentAttacker === crow, 'Goblin off, Storm Crow named again');

  // A block the engine refuses: a non-flyer under a flyer, said in the game's terms.
  await u.click(myGiant);
  await lastClicks(1, [myGiant], 'the click on your Hill Giant');
  await page.locator('.actionbar .ab-flash', { hasText: "Hill Giant can't block Storm Crow: it can't block a flyer." }).waitFor({ timeout: STEP_MS });
  check(!/selected now/i.test(await page.locator('.actionbar').innerText()), 'never "cannot be selected now"');

  // Block Goblin Guide with Memnite and confirm: Confirm follows the engine's OK.
  await u.click(guide);
  await u.click(memnite);
  await engine.waitFor(() => blocksOf(guide).includes(memnite), 'Memnite blocking Goblin Guide again');
  await page.locator('.actionbar [data-engine-button="ok"]', { hasText: 'Confirm blocks' }).waitFor({ timeout: STEP_MS });
  await sent(engine, 'buttonOk', () => u.ok());
  await engine.waitFor(() => engine.game.players[0].graveyard.some((c) => c.name === 'Memnite'), 'Memnite died blocking');
}

/** The combat lanes' cards, chips and ×s. */
const LANE_ITEMS = '[data-combat-lane] .tile, [data-combat-lane] .lane-chip, [data-combat-lane] .lane-unblock';
/** Every card on the table and in the hand, and the stack's items. */
const BOARD_ITEMS = '.battlefield .tile, .hand-dock .tile, [data-stack-item]';

/**
 * Whatever of `sel` would be cut off: each item is brought into view as a player would (scrolling its row,
 * then the board) and must then lie wholly inside the window and inside every box that clips it, and a
 * card must be what a tap at its centre reaches (itself, or a card it is fanned or piled with — never a
 * chip, the dock or the panel). A row that scrolls sideways must say so: a lane by `data-lane-more`, a row
 * by its edge fade (`data-fade`). Returns the problems, [] when none.
 */
async function clipped(page, sel = LANE_ITEMS) {
  return page.evaluate(async (sel) => {
    // Cards still sliding into a lane (laneMotion) are judged where they land.
    await Promise.all(document.getAnimations().filter((a) => Number.isFinite(a.effect?.getComputedTiming().endTime)).map((a) => a.finished.catch(() => {})));
    const out = [];
    const clippers = (el) => {
      const r = [];
      for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
        const st = getComputedStyle(a);
        if (st.overflowX !== 'visible' || st.overflowY !== 'visible') r.push(a);
      }
      return r;
    };
    const tol = 1.5;
    const inside = (r, b) => r.left >= b.left - tol && r.right <= b.right + tol && r.top >= b.top - tol && r.bottom <= b.bottom + tol;
    const win = () => ({ left: 0, top: 0, right: innerWidth, bottom: innerHeight });
    const box = (r) => `${Math.round(r.left)},${Math.round(r.top)} → ${Math.round(r.right)},${Math.round(r.bottom)}`;
    const name = (el) => el.closest('[data-card-id]')?.getAttribute('data-card-id') ?? el.getAttribute('data-stack-item') ?? el.className;
    const settle = () => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
    for (const el of document.querySelectorAll(sel)) {
      // A card face drawn under another one in a pile, or a folded hand: not a place a player taps.
      if (el.closest('[aria-hidden="true"]') || el.closest('.hand-dock.is-collapsed')) continue;
      const what = `${el.classList.contains('tile') ? 'card' : String(el.className).split(' ')[0]} ${name(el)}`;
      // Scrolled to as a player would: the nearest way first; a row that snaps may need its start or end.
      let problem = null;
      for (const inline of ['nearest', 'start', 'end', 'center']) {
        el.scrollIntoView({ block: 'nearest', inline });
        await settle();
        const r = el.getBoundingClientRect();
        if (r.width < 2 || r.height < 2) {
          problem = `${what} has no size`;
          break;
        }
        const cut = clippers(el).find((c) => !inside(r, c.getBoundingClientRect()));
        if (!inside(r, win())) problem = `${what} is outside the window (${box(r)})`;
        else if (cut) problem = `${what} is cut off by .${String(cut.className).split(' ')[0]} (${box(r)} in ${box(cut.getBoundingClientRect())})`;
        // A held hand overlaps by design (a hover lifts the card): only the table's cards are tapped where they lie.
        else if (el.classList.contains('tile') && !el.closest('.hand-dock')) {
          const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          const row = el.closest('[data-combat-lane], .bf-cards, .battlefield');
          problem = !hit || !(el.contains(hit) || (hit.closest('.tile') && row && row.contains(hit))) ? `${what}: a tap at its centre reaches ${hit ? `.${String(hit.className).split(' ')[0]}` : 'nothing'}` : null;
        } else problem = null;
        if (!problem) break;
      }
      if (problem) out.push(problem);
    }
    for (const row of document.querySelectorAll('[data-combat-lane] .lane-cols, .bf-cards')) {
      if (row.scrollWidth <= row.clientWidth + 1 || getComputedStyle(row).overflowX === 'visible') continue;
      const lane = row.closest('[data-combat-lane]');
      const said = lane ? lane.hasAttribute('data-lane-more') : row.hasAttribute('data-fade');
      if (!said) out.push(`${lane ? `the ${lane.getAttribute('data-combat-lane')} lane` : 'a row'} scrolls sideways with nothing saying so`);
    }
    if (document.documentElement.scrollWidth > innerWidth + 1) out.push(`the page scrolls sideways (${document.documentElement.scrollWidth} > ${innerWidth})`);
    return out;
  }, sel);
}
const laneClipping = (page) => clipped(page, LANE_ITEMS);

/**
 * Eight attackers and eight blockers (scene `swarm`) at `viewport`: every attacker takes a block (but the
 * flyer), and at each step nothing in either lane is clipped; the columns of the two lanes stay in line.
 */
function wideCombat(viewport, shot) {
  return async ({ page, engine, app }) => {
    await page.goto(`${app}?play=1&seat=${encodeURIComponent(engine.seatUrl)}`);
    await page.locator('.game.play.mode-block').waitFor({ timeout: STEP_MS });
    const cols = page.locator('.player-top [data-combat-lane="attack"] [data-lane-col]');
    await cols.nth(7).waitFor({ timeout: STEP_MS });
    // Collected, not thrown at once: the screenshot of the whole combat comes first.
    const problems = (await laneClipping(page)).map((p) => `eight attackers at ${viewport}: ${p}`);
    const attackers = engine.game.attackers.slice();
    const mineFree = engine.game.players[0].battlefield.filter((c) => c.name !== 'Mountain').map((c) => c.id);
    const tap = async (id) => {
      const el = page.locator(`.battlefield .tile[data-card-id="${id}"]`).first();
      await el.scrollIntoViewIfNeeded({ timeout: STEP_MS });
      await el.click({ timeout: STEP_MS });
      await page.mouse.move(2, 2).catch(() => {});
    };
    let k = 0;
    for (const a of attackers) {
      const att = engine.game.players[1].battlefield.find((c) => c.id === a);
      if (att?.name === 'Storm Crow') continue;
      const b = mineFree[k++];
      if (engine.game.currentAttacker !== a) {
        await tap(a);
        await engine.waitFor(() => engine.game.currentAttacker === a, `attacker ${a} named`);
      }
      await tap(b);
      await engine.waitFor(() => (engine.game.blocks.get(a) ?? []).includes(b), `${b} blocking ${a}`);
      await page.locator(`.player-me [data-combat-lane="block"] [data-blocks="${a}"] .tile[data-card-id="${b}"]`).waitFor({ timeout: STEP_MS });
    }
    // A second blocker on the last attacker: a fan in a lane already full.
    const last = attackers.at(-1);
    await tap(last);
    await engine.waitFor(() => engine.game.currentAttacker === last, 'the last attacker named again');
    await tap(mineFree[k]);
    await engine.waitFor(() => (engine.game.blocks.get(last) ?? []).length === 2, 'two blockers on the last attacker');
    await page.locator(`.player-me [data-combat-lane="block"] [data-blocks="${last}"] .tile[data-card-id="${mineFree[k]}"]`).waitFor({ timeout: STEP_MS });
    await page.evaluate(() => document.querySelectorAll('[data-combat-lane] .lane-cols').forEach((l) => (l.scrollLeft = 0)));
    if (shot) {
      mkdirSync(path.dirname(shot), { recursive: true });
      await page.evaluate(() => document.querySelector('.player-top [data-combat-lane]')?.scrollIntoView({ block: 'center' }));
      await page.screenshot({ path: shot });
    }
    problems.push(...(await laneClipping(page)).map((p) => `eight attackers blocked at ${viewport}: ${p}`));
    // The columns line up across the centre line: each blocker's column starts where its attacker's does.
    const drift = await page.evaluate(() => {
      const top = document.querySelector('.player-top [data-combat-lane="attack"] .lane-cols');
      const me = document.querySelector('.player-me [data-combat-lane="block"] .lane-cols');
      const out = [];
      for (const s of [0, 1e6]) {
        top.scrollLeft = s;
        me.scrollLeft = s;
        // a lane follows the other's scroll (one gesture moves both)
        top.dispatchEvent(new Event('scroll'));
        for (const col of me.querySelectorAll('[data-lane-col]')) {
          const a = top.querySelector(`[data-lane-col="${col.getAttribute('data-lane-col')}"]`);
          if (!a) continue;
          const d = Math.abs(a.getBoundingClientRect().left - col.getBoundingClientRect().left);
          if (d > 2) out.push(`column ${col.getAttribute('data-lane-col')} is ${Math.round(d)} px off its attacker`);
        }
      }
      return out;
    });
    problems.push(...drift);
    check(!problems.length, [...new Set(problems)].slice(0, 12).join('\n'));
    // The engine still decides: Confirm blocks goes as the engine's OK.
    await page.locator('[data-engine-button="ok"]').first().click({ timeout: STEP_MS });
    await engine.waitFor(() => engine.acts().some((a) => a.action === 'buttonOk'), 'the blocks confirmed');
  };
}

/**
 * A crowded table (scene `crowd`) at `viewport`: ten creatures a side, six lands, a hand of twelve. Every
 * card on the table and in the hand can be brought into view whole; then Alpha Strike sends all ten into
 * your attack lane, and nothing there is cut off either.
 */
function crowdedTable(viewport, shot) {
  return async ({ page, engine, app }) => {
    await page.goto(`${app}?play=1&seat=${encodeURIComponent(engine.seatUrl)}`);
    await page.locator('.game.play.mode-main').waitFor({ timeout: STEP_MS });
    await page.waitForTimeout(300);
    if (await page.locator('.hand-dock.is-collapsed').count()) await page.locator('.hand-dock-head').click();
    const problems = (await clipped(page, BOARD_ITEMS)).map((p) => `the table at ${viewport}: ${p}`);
    // To combat, then Alpha Strike: all ten attack.
    await page.locator('[data-engine-button="ok"]').first().click({ timeout: STEP_MS });
    await page.locator('.game.play.mode-attack').waitFor({ timeout: STEP_MS });
    await page.locator('[data-engine-button="cancel"]', { hasText: /alpha/i }).first().click({ timeout: STEP_MS });
    await engine.waitFor(() => engine.game.attackers.length === 10, 'ten attackers');
    await page.locator('.player-me [data-combat-lane="attack"] [data-lane-col]').nth(9).waitFor({ timeout: STEP_MS });
    await page.evaluate(() => document.querySelectorAll('[data-combat-lane] .lane-cols').forEach((l) => (l.scrollLeft = 0)));
    if (shot) {
      mkdirSync(path.dirname(shot), { recursive: true });
      await page.evaluate(() => document.querySelector('.player-me [data-combat-lane]')?.scrollIntoView({ block: 'center' }));
      await page.screenshot({ path: shot });
    }
    problems.push(...(await clipped(page, LANE_ITEMS)).map((p) => `ten attackers at ${viewport}: ${p}`));
    check(!problems.length, [...new Set(problems)].slice(0, 12).join('\n'));
  };
}

// ---------------------------------------------------------------------------
// Scenarios

const scenarios = [
  {
    name: 'a whole game: mulligan, land, creature, the stack, attack, block, a target ask, game over, next game',
    async run({ page, engine, app }) {
      const u = ui(page);
      await page.goto(`${app}?play=1&seat=${encodeURIComponent(engine.seatUrl)}`);
      await u.mode('mulligan');
      check((await page.locator('.ab-title-text').innerText()).includes('Keep this hand'), 'the keep/mulligan prompt is shown');

      // Mulligan once, put one on the bottom (an input selection), keep.
      await sent(engine, 'buttonCancel', () => u.opening('Mulligan'));
      await engine.waitFor(() => engine.game.mulligans === 1, 'the mulligan');
      await sent(engine, 'buttonOk', () => u.opening('Keep'));
      // As Forge sends it: no card listed, OK off, Cancel "Auto"; the hand is the control, and once the card is
      // picked Forge counts down to "Return 0" with OK on. The portraits must not glow (a player is no answer here).
      await u.mode('target');
      check((await page.locator('.ab-title-text').innerText()).includes('Put a card on the bottom'), 'the bottom pick is worded');
      check((await page.locator('[data-player-id].is-select').count()) === 0, 'no portrait is offered for the bottom pick');
      await sent(engine, 'clickCard', () => u.click(mine(engine, 'Hill Giant')));
      await page.locator('.actionbar [data-engine-button="ok"]:not([disabled])').waitFor({ timeout: STEP_MS });
      check((await page.locator('.ab-title-text').innerText()).includes('Put it on the bottom'), 'the pick waits for a confirm');
      await sent(engine, 'buttonOk', () => u.ok());

      // Round 1: Mountain, Raging Goblin (pay Auto), pass to resolve it, Memnite, attack with the Goblin.
      await u.mode('main');
      // The decision panel bottom-left and a hand you can read: whole cards, at least 120 px wide.
      check((await page.locator('.actionbar .ab-eyebrow').innerText()).toLowerCase().includes('decision'), 'the decision panel says DECISION');
      const handW = await page.locator('.hand-dock .tile .tile-slot').first().evaluate((el) => el.getBoundingClientRect().width);
      check(handW >= 120, `hand cards are readable (${Math.round(handW)} px wide)`);
      check(engine.game.players[0].hand.length === 6, 'six cards after the London mulligan');
      await sent(engine, 'clickCard', () => u.click(mine(engine, 'Mountain')));
      await engine.waitFor(() => engine.game.players[0].battlefield.length === 1, 'the Mountain on the battlefield');
      await sent(engine, 'clickCard', () => u.click(mine(engine, 'Raging Goblin')));
      await u.mode('pay');
      await sent(engine, 'buttonOk', () => u.ok());
      await u.mode('stack');
      check((await page.locator('.ab-title-text').innerText()).includes('Raging Goblin'), 'your Raging Goblin is on the stack');
      // The stack panel (endstep-style): numbered, the top resolves next, its kind and controller.
      const top = page.locator('.stackp-float [data-stack-n="1"]');
      await top.waitFor({ timeout: STEP_MS });
      const topText = await top.innerText();
      check(/Raging Goblin/.test(topText) && /Spell/i.test(topText) && /You/.test(topText) && /next/i.test(topText), `the stack panel shows 1 · Raging Goblin · Spell · You · next (${topText})`);
      await sent(engine, 'buttonOk', () => u.ok());
      await u.mode('main');
      await sent(engine, 'clickCard', () => u.click(mine(engine, 'Memnite')));
      await u.mode('stack');
      await sent(engine, 'buttonOk', () => u.ok());
      await u.mode('main');
      await u.card(mine(engine, 'Memnite', 'battlefield')).waitFor({ timeout: STEP_MS });
      await sent(engine, 'buttonOk', () => u.ok()); // to combat
      await u.mode('attack');
      const goblin = mine(engine, 'Raging Goblin', 'battlefield');
      await sent(engine, 'clickCard', () => u.click(goblin));
      await engine.waitFor(() => engine.game.attackers.includes(goblin), 'the Goblin attacking');
      await page.locator('.actionbar [data-engine-button="cancel"]', { hasText: /call back/i }).waitFor({ timeout: STEP_MS });
      await sent(engine, 'buttonOk', () => u.ok());
      await engine.waitFor(() => engine.game.players[1].life === 2, 'the AI on 2 life');
      await u.mode('main'); // main 2
      await page.locator('.life-n', { hasText: /^2$/ }).first().waitFor({ timeout: STEP_MS });

      // Round 1, the AI's turn: it casts Goblin Guide (you pass), attacks; you block with Memnite.
      await sent(engine, 'buttonOk', () => u.ok());
      await u.mode('stack');
      check((await page.locator('.ab-title-text').innerText()).includes('Goblin Guide'), 'the AI’s Goblin Guide is on the stack');
      check(/Goblin Guide[\s\S]*Forge AI/.test(await page.locator('.stackp-float [data-stack-n="1"]').innerText()), 'the stack panel names the AI’s Goblin Guide and who cast it');
      await sent(engine, 'buttonOk', () => u.ok());
      await u.mode('block');
      const memnite = mine(engine, 'Memnite', 'battlefield');
      // Who blocks whom: the attacker your block goes to is marked, and the blocker takes its number.
      const current = page.locator('.player-top .tile.is-pair-current .tile-pair');
      await current.waitFor({ timeout: STEP_MS });
      const pairN = (await current.innerText()).trim();
      await sent(engine, 'clickCard', () => u.click(memnite));
      await engine.waitFor(() => [...engine.game.blocks.values()].flat().includes(memnite), 'Memnite blocking');
      const blockerBadge = page.locator(`.player-me .tile[data-card-id="${memnite}"] .tile-pair.pair-blocker`);
      await blockerBadge.waitFor({ timeout: STEP_MS });
      check((await blockerBadge.innerText()).trim() === pairN, `Memnite wears its attacker's number ${pairN}`);
      check((await page.locator('.actionbar [data-engine-button="ok"]').innerText()).includes('Confirm blocks'), 'the panel says Confirm blocks');
      await sent(engine, 'buttonOk', () => u.ok());

      // Round 2: Mountain, Shock (a choose_entities ask) at the AI for the win.
      await u.mode('main');
      check(engine.game.players[0].graveyard.some((c) => c.name === 'Memnite'), 'Memnite died blocking');
      check(engine.game.turn === 3, 'your second turn');
      await shockForTheWin(engine, u);
      const answer = engine.frames('/ws', 'answer').at(-1);
      check(answer && answer.body.askId === 'a1' && JSON.stringify(answer.body.value) === '[0]', `the target ask was answered with the AI (${JSON.stringify(answer?.body)})`);
      await page.locator('.over-wrap .over-title', { hasText: 'You won' }).waitFor({ timeout: STEP_MS });

      // The next game of the match: a new hello_ok (M38) and the board starts over.
      await sent(engine, 'newGame', () => page.locator('.over-wrap').getByRole('button', { name: 'Next game' }).click());
      await engine.waitFor(() => engine.gameId === 'human-ws-0-g2', 'game 2');
      await u.mode('mulligan');
      check(!(await page.locator('.over-wrap').count()), 'the result card is gone in game 2');
      await sent(engine, 'buttonOk', () => u.opening('Keep'));
      await u.mode('main');
      const acts = engine.acts().map((a) => a.action).join(' ');
      const want = [
        'buttonCancel buttonOk clickCard buttonOk', // mulligan, keep, a card to the bottom, OK
        'clickCard clickCard buttonOk buttonOk clickCard buttonOk', // Mountain, Goblin, pay, pass, Memnite, pass
        'buttonOk clickCard buttonOk buttonOk', // to combat, the Goblin attacks, confirm, end the turn
        'buttonOk clickCard buttonOk', // pass on Goblin Guide, Memnite blocks, confirm
        'clickCard clickCard buttonOk buttonOk', // Mountain, Shock (+ the ask), pay, pass
        'newGame buttonOk', // the next game, keep
      ].join(' ');
      check(acts === want, `the engine received exactly the player's acts:\n  got  ${acts}\n  want ${want}`);
    },
  },

  {
    name: 'the seat drops with a question open; the engine took the default (M19)',
    engine: { scene: 'main3', dropMode: 'default' },
    async run({ page, engine, app }) {
      const u = ui(page);
      await page.goto(`${app}?play=1&seat=${encodeURIComponent(engine.seatUrl)}`);
      await u.mode('main');
      await sent(engine, 'clickCard', () => u.click(mine(engine, 'Shock')));
      await u.dialog.waitFor({ timeout: STEP_MS });
      engine.dropSeat();
      // The client reconnects by itself and resyncs; the dead question must leave the screen.
      await engine.waitFor(() => engine.connections.filter((c) => c.path === '/ws' && !c.refused).length === 2 && engine.seat, 'the seat reconnected');
      await engine.waitFor(() => engine.frames('/ws', 'resync').length >= 1, 'a resync after the reconnect');
      await u.noQuestion();
      await u.mode('main');
      // Acts reach the engine again: cast Shock anew, answer its new question, win.
      await shockForTheWin(engine, u, { land: false });
      const answers = engine.frames('/ws', 'answer');
      check(answers.length === 1 && answers[0].body.askId === 'a2', `only the new question (a2) was answered (${JSON.stringify(answers.map((a) => a.body.askId))})`);
    },
  },

  {
    name: 'the seat drops with a question open; the engine asks again with a new id',
    engine: { scene: 'main3', dropMode: 'reask' },
    async run({ page, engine, app }) {
      const u = ui(page);
      await page.goto(`${app}?play=1&seat=${encodeURIComponent(engine.seatUrl)}`);
      await u.mode('main');
      await sent(engine, 'clickCard', () => u.click(mine(engine, 'Shock')));
      await u.dialog.waitFor({ timeout: STEP_MS });
      engine.dropSeat();
      await engine.waitFor(() => engine.openAsk?.askId === 'a2', 'the question asked again');
      await u.answer('Forge AI');
      await engine.waitFor(() => engine.frames('/ws', 'answer').length === 1, 'an answer');
      const a = engine.frames('/ws', 'answer')[0];
      check(a.body.askId === 'a2', `the answer is to the question asked again (${a.body.askId})`);
      await u.mode('pay');
      await sent(engine, 'buttonOk', () => u.ok());
      await u.mode('stack');
      await sent(engine, 'buttonOk', () => u.ok());
      await page.locator('.over-wrap .over-title', { hasText: 'You won' }).waitFor({ timeout: STEP_MS });
    },
  },

  {
    name: 'the engine refuses a target answer (M68): the same question again, with its reason on screen',
    engine: { scene: 'main3' },
    async run({ page, engine, app }) {
      const u = ui(page);
      await page.goto(`${app}?play=1&seat=${encodeURIComponent(engine.seatUrl)}`);
      await u.mode('main');
      await sent(engine, 'clickCard', () => u.click(mine(engine, 'Shock')));
      await u.dialog.waitFor({ timeout: STEP_MS });
      check(!(await u.dialog.locator('[data-refused]').count()), 'no refusal on a first asking');
      engine.game.refuseNext = 'Choose exactly 1 option (this answer chose 0).';
      const asked = engine.game.askBody.askId;
      await u.answer('Forge AI');
      await engine.waitFor(() => engine.game.askBody && engine.game.askBody.askId !== asked, 'the question asked again', STEP_MS);
      await u.dialog.locator('[data-refused]', { hasText: 'That answer wasn’t allowed: Choose exactly 1 option' }).waitFor({ timeout: STEP_MS });
      await u.answer('Forge AI');
      await u.mode('pay');
      check(!(await page.locator('[data-refused]').count()), 'the refusal leaves with its question');
      const answers = engine.frames('/ws', 'answer').map((a) => a.body.askId);
      check(answers.length === 2 && answers[0] === asked && answers[1] !== asked, `one answer to each asking (${answers.join(', ')})`);
      await sent(engine, 'buttonOk', () => u.ok());
      await u.mode('stack');
      await sent(engine, 'buttonOk', () => u.ok());
      await page.locator('.over-wrap .over-title', { hasText: 'You won' }).waitFor({ timeout: STEP_MS });
    },
  },

  {
    name: 'after the result, the engine restarts under the same game id: a new game, acts accepted',
    engine: { scene: 'main3' },
    async run({ page, engine, app }) {
      const u = ui(page);
      await page.goto(`${app}?play=1&seat=${encodeURIComponent(engine.seatUrl)}`);
      await u.mode('main');
      await shockForTheWin(engine, u);
      await page.locator('.over-wrap .over-title', { hasText: 'You won' }).waitFor({ timeout: STEP_MS });
      // A bare play.sh restarted: same id (human-ws-0), a fresh seq series. After `over` the client does not retry by itself.
      await engine.restart({ scene: 'pregame' });
      // The result card's Reconnect (on a desktop it covers the top bar's).
      await page.locator('.over-wrap').getByRole('button', { name: 'Reconnect' }).click({ timeout: STEP_MS });
      await engine.waitFor(() => engine.seat, 'the seat back');
      await u.mode('mulligan');
      check(!(await page.locator('.over-wrap').count()), 'the old result is gone');
      await sent(engine, 'buttonOk', () => u.opening('Keep'));
      await engine.waitFor(() => engine.game.turn === 1 && engine.pendingKind === 'priority', 'the new game under way');
      await u.mode('main');
    },
  },

  {
    name: 'mid-game, the engine restarts under the same game id: the board follows the new game',
    engine: { scene: 'main3' },
    async run({ page, engine, app }) {
      const u = ui(page);
      await page.goto(`${app}?play=1&seat=${encodeURIComponent(engine.seatUrl)}`);
      await u.mode('main');
      await sent(engine, 'clickCard', () => u.click(mine(engine, 'Mountain')));
      await engine.waitFor(() => engine.game.landPlayed, 'the land played');
      await engine.restart({ scene: 'pregame', downMs: 400 });
      // The client reconnects on its own; the new engine's frames start again at seq 1.
      await engine.waitFor(() => engine.seat, 'the seat back', 10_000);
      await u.mode('mulligan');
      check((await page.locator('.ab-title-text').innerText()).includes('Keep this hand'), 'the new game’s keep prompt is shown');
      await sent(engine, 'buttonOk', () => u.opening('Keep'));
      await u.mode('main');
      check(engine.game.turn === 1, 'the new game is on turn 1');
    },
  },

  {
    name: 'live watch follows /observe and never opens /ws',
    engine: { scene: 'main3' },
    async run({ page, engine, app, sockets }) {
      await page.goto(app);
      // The seat path is refused before any socket opens.
      const input = page.getByLabel('Live URL');
      await input.fill(engine.seatUrl);
      await page.getByRole('button', { name: 'Watch', exact: true }).click();
      await page.getByText('player-seat socket', { exact: false }).first().waitFor({ timeout: STEP_MS });
      await page.waitForTimeout(300);
      check(engine.connections.length === 0, `nothing connected for a /ws live URL (${JSON.stringify(engine.connections)})`);
      // The observer socket.
      await input.fill(engine.observeUrl);
      await page.getByRole('button', { name: 'Watch', exact: true }).click();
      await page.locator('.topbar-game', { hasText: 'human-ws-0' }).waitFor({ timeout: STEP_MS });
      await page.locator('.live-pill', { hasText: 'Live' }).waitFor({ timeout: STEP_MS });
      // The game moves on (played in mtg-table's own board): attack with the Goblin, the AI drops to 1.
      engine.seatAct({ action: 'buttonOk' });
      engine.seatAct({ action: 'clickCard', cardId: mine(engine, 'Raging Goblin', 'battlefield') });
      engine.seatAct({ action: 'buttonOk' });
      check(engine.game.players[1].life === 1, 'the engine played the attack');
      await page.locator('.life-n', { hasText: /^1$/ }).first().waitFor({ timeout: STEP_MS });
      check(engine.connections.every((c) => c.path === '/observe'), `only /observe connections at the engine (${JSON.stringify(engine.connections.map((c) => c.path))})`);
      check(sockets.length > 0 && sockets.every((s) => new URL(s).pathname === '/observe'), `the page's sockets: ${JSON.stringify(sockets)}`);
      check(engine.received.length === 0, `nothing was sent on /observe (${engine.received.length} frames)`);
    },
  },

  {
    name: 'Cauldron Familiar returns from the graveyard: the engine lists it (M61), the pill and the tile say so, a click plays it',
    engine: { scene: 'graveyard', playable: true },
    async run({ page, engine, app }) {
      const u = ui(page);
      await page.goto(`${app}?play=1&seat=${encodeURIComponent(engine.seatUrl)}`);
      await u.mode('main');
      const familiar = mine(engine, 'Cauldron Familiar', 'graveyard');
      const pill = page.locator('.phead[data-phead-player="0"] [data-zone-pill="graveyard"]');
      await page.locator('.phead[data-phead-player="0"] [data-zone-pill="graveyard"][data-playable="true"]').waitFor({ timeout: STEP_MS });
      check(!(await page.locator('.phead[data-phead-player="1"] [data-zone-pill="graveyard"][data-playable="true"]').count()), "the opponent's graveyard pill is not marked");
      await pill.click();
      const tile = page.locator(`.zv-grid .tile[data-card-id="${familiar}"]`);
      await tile.waitFor({ timeout: STEP_MS });
      check(/\bis-act\b/.test((await tile.getAttribute('class')) ?? ''), 'the Familiar is outlined in the graveyard viewer');
      await sent(engine, 'clickCard', () => tile.click());
      const act = engine.acts().filter((a) => a.action === 'clickCard').at(-1);
      check(act?.cardId === familiar, `the click went to the engine for the Familiar (${JSON.stringify(act)})`);
      await engine.waitFor(() => engine.game.players[0].battlefield.some((c) => c.id === familiar), 'the Familiar back on the battlefield');
      await page.locator('.zv-grid').waitFor({ state: 'detached', timeout: STEP_MS });
      await u.card(familiar).waitFor({ timeout: STEP_MS });
      // The graveyard is empty now: nothing to mark.
      await page.locator('.phead[data-phead-player="0"] [data-zone-pill="graveyard"][data-playable="true"]').waitFor({ state: 'detached', timeout: STEP_MS });
      // The hand follows the engine's list too: the Mountain (a land drop) is outlined, then not once it is played.
      const mountain = mine(engine, 'Mountain');
      await u.openHand();
      check(/\bis-act\b/.test((await u.card(mountain).getAttribute('class')) ?? ''), 'the Mountain is outlined while the land drop is open');
      await sent(engine, 'clickCard', () => u.click(mountain));
      await engine.waitFor(() => engine.game.landPlayed, 'the land played');
      const other = mine(engine, 'Mountain');
      await page.waitForFunction((id) => !document.querySelector(`.game .tile.is-act[data-card-id="${id}"]`), other, { timeout: STEP_MS });
    },
  },

  {
    name: 'declaring blocks (M65 chosen): the lanes; assign, move, take off by a click and by the ×; a flyer refused in the game’s terms',
    engine: { scene: 'blocks', selection: true },
    run: blockDeclaration,
  },

  {
    name: 'declaring blocks on an engine before M65: the same clicks, the browser’s own picture of the blocks',
    engine: { scene: 'blocks' },
    run: blockDeclaration,
  },

  {
    name: 'a phone (390×844): eight attackers and their blockers, nothing in the combat lanes cut off',
    engine: { scene: 'swarm', selection: true },
    context: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
    run: wideCombat('390×844', env.LANE_SHOT ? path.join(ROOT, env.LANE_SHOT) : null),
  },

  {
    name: 'a desktop (1440×900): eight attackers and their blockers, nothing in the combat lanes cut off',
    engine: { scene: 'swarm' },
    run: wideCombat('1440×900', env.LANE_SHOT_DESKTOP ? path.join(ROOT, env.LANE_SHOT_DESKTOP) : null),
  },

  {
    name: 'a phone (390×844): a crowded table — every card in reach, ten attackers in the lane',
    engine: { scene: 'crowd' },
    context: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
    run: crowdedTable('390×844', env.CROWD_SHOT ? path.join(ROOT, env.CROWD_SHOT) : null),
  },

  {
    name: 'a tablet (820×1180): a crowded table — every card in reach, ten attackers in the lane',
    engine: { scene: 'crowd' },
    context: { viewport: { width: 820, height: 1180 }, isMobile: true, hasTouch: true },
    run: crowdedTable('820×1180', null),
  },

  {
    name: 'a desktop (1440×900): a crowded table — every card in reach, ten attackers in the lane',
    engine: { scene: 'crowd' },
    run: crowdedTable('1440×900', null),
  },

  {
    name: 'an engine since M64–M66: Until they act [Y] lights and stops; the defender glows; the engine’s own count of attackers',
    engine: { scene: 'main3', selection: true },
    async run({ page, engine, app }) {
      const u = ui(page);
      await page.goto(`${app}?play=1&seat=${encodeURIComponent(engine.seatUrl)}`);
      await u.mode('main');
      // M64: the toggle beside the others, its key printed on it.
      const toggle = page.locator('.ds-autopass [data-toggle="theyAct"]');
      await toggle.waitFor({ timeout: STEP_MS });
      check(/until they act/i.test((await toggle.innerText()) ?? '') && /Y/.test(await toggle.innerText()), `the toggle reads "Until they act [Y]" (${await toggle.innerText()})`);
      await page.mouse.move(5, 5);
      await sent(engine, 'yieldTo', () => page.keyboard.press('y'));
      const y = engine.acts().filter((a) => a.action === 'yieldTo').at(-1);
      check(y?.kind === 'endStepOrOpponent', `Y sent the M64 yield (${JSON.stringify(y)})`);
      await page.locator('.ds-autopass [data-toggle="theyAct"][aria-pressed="true"]').waitFor({ timeout: STEP_MS });
      // A lit toggle is the engine's Cancel, and only stops the yield.
      await sent(engine, 'buttonCancel', () => toggle.click());
      await page.locator('.ds-autopass [data-toggle="theyAct"][aria-pressed="false"]').waitFor({ timeout: STEP_MS });
      check(engine.game.yieldState === null && engine.game.phase === 'MAIN1', 'the yield stopped and the turn went on');
      // To combat: the defending player is the one portrait that takes a click (M66).
      await sent(engine, 'buttonOk', () => u.ok());
      await u.mode('attack');
      await page.locator('.phead[data-phead-player="1"] button.avatar.is-select').waitFor({ timeout: STEP_MS });
      check(!(await page.locator('.phead[data-phead-player="0"] button.avatar.is-select').count()), 'your own portrait is not a choice while attacking');
      // M65: an attacker the engine reports (declared from its own board, not clicked here) is counted on the button.
      const goblin = mine(engine, 'Raging Goblin', 'battlefield');
      engine.seatAct({ action: 'clickCard', cardId: goblin });
      await page.locator('.actionbar [data-primary]', { hasText: 'Attack with 1' }).waitFor({ timeout: STEP_MS });
    },
  },

  {
    name: 'an engine from before M61: no list, the graveyard creature without a keyword opens its details',
    engine: { scene: 'graveyard' },
    async run({ page, engine, app }) {
      const u = ui(page);
      await page.goto(`${app}?play=1&seat=${encodeURIComponent(engine.seatUrl)}`);
      await u.mode('main');
      check(!JSON.parse(engine.lastState).body.hasOwnProperty('playable'), 'the old engine writes no playable key');
      // Nor M64–M66: no "Until they act" beside the other toggles.
      await page.locator('.ds-autopass [data-toggle="eot"]').waitFor({ timeout: STEP_MS });
      check(!(await page.locator('[data-toggle="theyAct"]').count()), 'no Until they act on an engine before M64');
      const familiar = mine(engine, 'Cauldron Familiar', 'graveyard');
      await page.locator('.phead[data-phead-player="0"] [data-zone-pill="graveyard"]').click();
      const tile = page.locator(`.zv-grid .tile[data-card-id="${familiar}"]`);
      await tile.waitFor({ timeout: STEP_MS });
      // Scryfall is offline here, so no oracle text: today's keyword rule, and no click goes out.
      check(!/\bis-act\b/.test((await tile.getAttribute('class')) ?? ''), 'not outlined without the list or its text');
      // The hand keeps its old rule: every card of yours is a click in your main phase.
      await page.keyboard.press('Escape');
      await page.locator('.zv-grid').waitFor({ state: 'detached', timeout: STEP_MS });
      await u.openHand();
      check(/\bis-act\b/.test((await u.card(mine(engine, 'Hill Giant')).getAttribute('class')) ?? ''), 'a hand card is outlined as before');
    },
  },

  {
    name: 'combat damage follows the engine (M67): no defender row without trample, and the engine’s refusal shown',
    engine: { scene: 'combat' },
    async run({ page, engine, app }) {
      const u = ui(page);
      const answers = () => engine.frames('/ws', 'answer').map((f) => f.body);
      await page.goto(`${app}?play=1&seat=${encodeURIComponent(engine.seatUrl)}`);
      await u.mode('main');
      await sent(engine, 'buttonOk', () => u.ok()); // to combat
      await u.mode('attack');
      // Hill Giant (no trample) into two Memnites: the engine's question has no row for the bot.
      const giant = mine(engine, 'Hill Giant', 'battlefield');
      await sent(engine, 'clickCard', () => u.click(giant));
      await sent(engine, 'buttonOk', () => u.ok());
      if (await page.locator('.ask-peek').isVisible().catch(() => false)) await page.locator('.ask-peek').click();
      await u.dialog.waitFor({ timeout: STEP_MS });
      check(engine.game.askBody?.kind === 'assign_damage' && engine.game.askBody.defenderAllowed === false, 'the engine asks assign_damage, defenderAllowed false');
      const labels = await u.dialog.locator('.ask-row-label').allInnerTexts();
      check(labels.length === 2 && !labels.includes('Forge AI'), `two blocker rows and no Forge AI row (${labels.join(', ')})`);
      check(!(await u.dialog.locator('[data-refused]').count()), 'no refusal on a first asking');
      // The engine refuses the split (a rule the dialog does not know): the same question, with its reason.
      engine.game.refuseNext = 'Blockers take damage in order: Memnite needs lethal damage (1) before Memnite gets any.';
      const asked = engine.game.askBody.askId;
      await u.dialog.locator('.ask-actions .btn-primary:not([disabled])').click({ timeout: STEP_MS });
      await engine.waitFor(() => engine.game.askBody && engine.game.askBody.askId !== asked, 'the question asked again', STEP_MS);
      await u.dialog.locator('[data-refused]', { hasText: 'Memnite needs lethal damage' }).waitFor({ timeout: STEP_MS });
      check((await u.dialog.locator('.ask-row-label').allInnerTexts()).length === 2, 'still no Forge AI row');
      await u.dialog.locator('.ask-actions .btn-primary:not([disabled])').click({ timeout: STEP_MS });
      await engine.waitFor(() => engine.game.phase === 'MAIN2', 'combat over', STEP_MS);
      const sentSplits = answers().map((a) => a.value);
      check(sentSplits.length === 2 && sentSplits.every((v) => v && !('0' in v)), `no split put damage on the bot (${JSON.stringify(sentSplits)})`);
      check(engine.game.players[1].life === 3 && engine.game.players[1].battlefield.length === 0, 'the bot on 3 life, both Memnites dead');
      await u.mode('main');
    },
  },

  {
    name: 'combat damage follows the engine (M67): a trampler’s excess goes to the player',
    engine: { scene: 'combat' },
    async run({ page, engine, app }) {
      const u = ui(page);
      await page.goto(`${app}?play=1&seat=${encodeURIComponent(engine.seatUrl)}`);
      await u.mode('main');
      await sent(engine, 'buttonOk', () => u.ok());
      await u.mode('attack');
      await sent(engine, 'clickCard', () => u.click(mine(engine, 'Colossal Dreadmaw', 'battlefield')));
      await sent(engine, 'buttonOk', () => u.ok());
      if (await page.locator('.ask-peek').isVisible().catch(() => false)) await page.locator('.ask-peek').click();
      await u.dialog.waitFor({ timeout: STEP_MS });
      check(engine.game.askBody?.defenderAllowed === true, 'defenderAllowed true for a trampler');
      const labels = await u.dialog.locator('.ask-row-label').allInnerTexts();
      check(labels.includes('Forge AI') && labels.length === 3, `the Forge AI row beside two blockers (${labels.join(', ')})`);
      await u.dialog.locator('.ask-actions .btn-primary:not([disabled])').click({ timeout: STEP_MS });
      await engine.waitFor(() => engine.over, 'game over', STEP_MS);
      const v = engine.frames('/ws', 'answer').at(-1).body.value;
      check(v['0'] === 4 && v['1'] === 1 && v['2'] === 1, `lethal to each Memnite, 4 to the bot (${JSON.stringify(v)})`);
    },
  },

  {
    name: 'the coach panel offers Copy prompt with no helper and no key',
    engine: { scene: 'main3' },
    async run({ page, engine, app }) {
      const u = ui(page);
      await page.goto(`${app}?play=1&seat=${encodeURIComponent(engine.seatUrl)}`);
      await u.mode('main');
      const coach = page.locator('.play-coach');
      await coach.waitFor({ timeout: STEP_MS });
      await coach.getByText('No coach connected').waitFor({ timeout: STEP_MS });
      const copy = coach.getByRole('button', { name: 'Copy prompt' });
      await copy.click();
      await coach.getByRole('button', { name: 'Copied' }).waitFor({ timeout: STEP_MS });
      const text = await page.evaluate(() => navigator.clipboard.readText());
      check(/Shock/.test(text) && /Goblin Guide/.test(text), `the copied prompt describes the board (${text.length} chars)`);
    },
  },
];

// ---------------------------------------------------------------------------
// The search hint (mtg-table D429): a fake coach helper that offers it

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' };

/** /health says `hint: 1` (and that Claude Code is not ready: no coach questions); POST /hint answers after 600 ms. */
function hintHelper(engine) {
  const asked = [];
  const handler = async (route, u) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    if (u.pathname === '/health') {
      return route.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: JSON.stringify({ ok: false, helper: 1, error: 'Claude Code is not logged in', hint: 1, hintEngine: 'idle', hintBudgetMs: { default: 3000, min: 1500, max: 6000 } }) });
    }
    if (u.pathname === '/hint' && req.method() === 'POST') {
      const body = JSON.parse(req.postData() ?? '{}');
      asked.push(body);
      await new Promise((r) => setTimeout(r, 600));
      const shock = mine(engine, 'Shock');
      const mountain = engine.game.players[0].hand.find((x) => x.name === 'Mountain');
      const answer = {
        ok: true, v: 1, kind: 'search-hint', gameId: body.gameId, seat: body.seat, stateSeq: body.stateSeq, status: 'ok', type: 'spell', measure: 'leaf',
        pick: `cast:${shock}`, strength: 'close', runnerUp: 'pass', ...(mountain ? { landFirst: mountain.id } : {}),
        options: [{ token: `cast:${shock}`, label: 'cast Shock', verdict: 'best', winRate: 0.61 }, { token: 'pass', label: 'cast nothing now', verdict: 'close', winRate: 0.58 }],
        knowledge: { opponent: 'unknown', opponentModel: 'basic-lands', ownDeck: null }, wallMs: 3100,
      };
      return route.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: JSON.stringify(answer) });
    }
    return route.fulfill({ status: 404, headers: CORS, contentType: 'application/json', body: '{"ok":false,"type":"error","message":"not found"}' });
  };
  handler.asked = asked;
  return handler;
}

const hintScenario = {
  name: 'the search hint: asked with a button or S, the pick in board words, how sure, the caveat',
  engine: { scene: 'main3' },
  helper: (engine) => {
    hintScenario.fake = hintHelper(engine);
    return hintScenario.fake;
  },
  async run({ page, engine, app }) {
    const u = ui(page);
    await page.goto(`${app}?play=1&seat=${encodeURIComponent(engine.seatUrl)}`);
    await u.mode('main');
    const hint = page.locator('.actionbar .ds-hint');
    const btn = hint.getByRole('button', { name: /What would the search AI do\?/ });
    await btn.waitFor({ timeout: STEP_MS });
    await btn.click();
    await page.locator('[data-search-hint="thinking"]').getByText('Search AI thinking…').waitFor({ timeout: STEP_MS });
    const done = page.locator('[data-search-hint="done"]');
    await done.waitFor({ timeout: STEP_MS });
    const line = await done.locator('.ds-hint-line').innerText();
    check(/^Search AI\s+Play (your )?Mountain first, then: cast Shock, or cast nothing now — too close to call$/i.test(line.trim()), `the pick in board words (${line})`);
    check(!/#\d/.test(line), `no engine id on screen (${line})`);
    const caveat = await done.locator('.ds-hint-caveat').innerText();
    check(caveat.startsWith('Knows only what you know'), `the caveat (${caveat})`);
    const asked = hintScenario.fake.asked;
    check(asked.length === 1, `one question per click (${asked.length})`);
    const body = asked[0];
    check(body.gameId === engine.gameId && body.seat === 0 && Number.isInteger(body.stateSeq) && body.stateSeq > 0, `the moment: game, seat, state seq (${JSON.stringify(body)})`);
    check(Object.keys(body).every((k) => ['gameId', 'seat', 'stateSeq', 'inputSeq', 'oppPool', 'oppKnown', 'budgetMs'].includes(k)), `no other field, never a deck (${Object.keys(body)})`);
    // The cards it names glow on the board.
    const shock = mine(engine, 'Shock');
    await page.locator(`.game [data-card-id="${shock}"][data-search-pick]`).first().waitFor({ state: 'attached', timeout: STEP_MS });
    // Play the land: a new board, a new decision -- the answer goes, the button is back; S asks again.
    await sent(engine, 'clickCard', () => u.click(mine(engine, 'Mountain')));
    await engine.waitFor(() => engine.game.landPlayed, 'the land played');
    await btn.waitFor({ timeout: STEP_MS });
    check((await page.locator('[data-search-pick]').count()) === 0, 'the glow goes with the answer');
    await page.evaluate(() => (document.activeElement instanceof HTMLElement ? document.activeElement.blur() : undefined));
    await page.keyboard.press('s');
    await done.waitFor({ timeout: STEP_MS });
    check(asked.length === 2 && asked[1].stateSeq > body.stateSeq, `S asks for the new moment (${asked.map((a) => a.stateSeq)})`);
    check(engine.acts().filter((a) => a.action !== 'clickCard').length === 0, `asking sent the engine nothing (${JSON.stringify(engine.acts())})`);
  },
};
scenarios.push(hintScenario);

// ---------------------------------------------------------------------------
// Runner

async function runOne(browser, app, s, round) {
  const engine = await startFakeEngine({ ...(s.engine ?? {}), verbose: VERBOSE });
  const appOrigin = new URL(app).origin;
  const context = await browser.newContext(s.context ?? { viewport: { width: 1440, height: 900 } });
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: appOrigin });
  await isolate(context, appOrigin, s.helper ? s.helper(engine) : null);
  const page = await context.newPage();
  const errors = [];
  const sockets = [];
  page.on('pageerror', (e) => errors.push(`page error: ${e.message}`));
  page.on('websocket', (ws) => sockets.push(ws.url()));
  const t = Date.now();
  try {
    await s.run({ page, engine, app, sockets });
    check(errors.length === 0, errors.join('\n'));
    return { ok: true, ms: Date.now() - t };
  } catch (e) {
    mkdirSync(OUT, { recursive: true });
    const shot = path.join(OUT, `seat-${round}-${scenarios.indexOf(s)}.png`);
    await page.screenshot({ path: shot }).catch(() => {});
    return { ok: false, ms: Date.now() - t, error: `${e instanceof Fail ? e.message : e.stack ?? e}${errors.length ? `\n${errors.join('\n')}` : ''}\n  screenshot ${shot}` };
  } finally {
    await context.close().catch(() => {});
    await engine.close().catch(() => {});
  }
}

async function main() {
  const pw = await loadPlaywright();
  let app;
  try {
    app = await appUrl();
  } catch (e) {
    console.error(`[e2e seat] ${e.message ?? e}`);
    return 2;
  }
  const browser = await launchBrowser(pw, { headless: HEADLESS });
  const chosen = scenarios.filter((s) => !env.ONLY || s.name.includes(env.ONLY));
  let failed = 0;
  const t0 = Date.now();
  try {
    for (let round = 1; round <= REPEAT; round++) {
      if (REPEAT > 1) console.log(`[e2e seat] run ${round} of ${REPEAT}`);
      for (const s of chosen) {
        const r = await runOne(browser, app, s, round);
        console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${(r.ms / 1000).toFixed(1).padStart(5)}s  ${s.name}`);
        if (!r.ok) {
          failed++;
          console.log(`      ${r.error.replace(/\n/g, '\n      ')}`);
        }
      }
    }
  } finally {
    await browser.close().catch(() => {});
    preview?.kill('SIGTERM');
  }
  console.log(`[e2e seat] ${chosen.length * REPEAT - failed} passed, ${failed} failed in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  return failed ? 1 : 0;
}

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    preview?.kill('SIGTERM');
    process.exit(130);
  });
}

main().then(
  (code) => process.exit(code),
  (e) => {
    console.error(e);
    preview?.kill('SIGTERM');
    process.exit(1);
  },
);

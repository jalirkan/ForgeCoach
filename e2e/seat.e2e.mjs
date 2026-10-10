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
 * result and mid-game; live watch on /observe never opening /ws; the coach's
 * "Copy prompt" with no helper.
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
async function isolate(context, appOrigin) {
  await context.route('**/*', (route) => {
    const u = new URL(route.request().url());
    if (u.origin === appOrigin) return route.continue();
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
      await u.mode('target');
      await sent(engine, 'clickCard', () => u.click(mine(engine, 'Hill Giant')));
      await page.locator('.actionbar [data-engine-button="ok"]:not([disabled])').waitFor({ timeout: STEP_MS });
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
// Runner

async function runOne(browser, app, s, round) {
  const engine = await startFakeEngine({ ...(s.engine ?? {}), verbose: VERBOSE });
  const appOrigin = new URL(app).origin;
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: appOrigin });
  await isolate(context, appOrigin);
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

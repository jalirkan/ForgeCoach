#!/usr/bin/env node
/*
 * ForgeCoach — e2e/table.e2e.mjs
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * End-to-end: play with a friend (mtg-table D402–D404), two people in two
 * browser contexts against mtg-table's real draft room, real match launcher
 * and real Forge engine, from the draft to the result:
 *
 *   1. builds ForgeCoach with FORGECOACH_BASE=./ into a scratch folder and
 *      starts mtg-table's `scripts/play.sh --engine-only --draft-room
 *      --site-dir <build>` (the room listener serves the build; ports from
 *      mtg-table's config.json: 8642 engine, 8643 helper, 8644 room, 8646 table);
 *   2. HOST (http://localhost:8644) makes a room, FRIEND (another context,
 *      http://127.0.0.1:8644) joins by the link — both by clicking; the 18
 *      grids are then drafted through the room's own API with each browser's
 *      seat token (friend.e2e.mjs drafts them by clicking);
 *   3. each player clicks "Hand in this deck" (the whole pool: the room checks
 *      it against that seat's own picks); the room starts a game between them
 *      on the real engine (--humans 2), and each page goes to its seat;
 *   4. both boards say "You vs <the other>", neither offers Next game / New
 *      match / the engine review; the opening questions are answered; a line
 *      about the other player ("… is thinking") shows on a board; the friend
 *      RELOADS mid-game and is back at the same seat (the token resumes it);
 *   5. the friend concedes; the host's card says "You won", the friend's "You
 *      lost"; Back to the room says the game is over and offers a rematch.
 *
 * Environment: MTG_TABLE (default ../mtg-table, a checkout with D404), FORGE_JAR
 * as play.sh wants it, HEADLESS=0 to watch. Screenshots: e2e/out/table-*.png.
 */
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchBrowser, loadPlaywright } from './harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MTG = path.resolve(process.env.MTG_TABLE ?? path.join(ROOT, '..', 'mtg-table'));
const OUT = path.join(ROOT, 'e2e', 'out');
const HEADLESS = process.env.HEADLESS !== '0';
const ROOM = 8644;
const log = (s) => console.log(`[table] ${s}`);
let failed = 0;
let play = null;
const check = (ok, what) => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${what}`);
  if (!ok) failed++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function roomCall(base, id, token, p = '', body) {
  const r = await fetch(`${base}/room/${id}${p}`, {
    method: body ? 'POST' : 'GET',
    headers: { 'X-Room-Token': token, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: r.status, body: await r.json() };
}

/** The seat this page's browser holds in the room (draft/room.ts's saved list). */
async function seatOf(page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem('forgecoach.friendRooms.v1') ?? '[]')[0]);
}

/** Answer the opening questions (play or draw, keep) whenever one is up. */
async function answerOpening(page) {
  for (const name of [/^Play$/, /^Keep/]) {
    const b = page.getByRole('button', { name });
    if (await b.count()) await b.first().click({ timeout: 2000 }).catch(() => {});
  }
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const scratch = mkdtempSync(path.join(tmpdir(), 'forgecoach-table-'));
  const site = path.join(scratch, 'site');
  log('building ForgeCoach with FORGECOACH_BASE=./');
  execFileSync('npx', ['vite', 'build', '--outDir', site, '--emptyOutDir'], { cwd: ROOT, env: { ...process.env, FORGECOACH_BASE: './' }, stdio: ['ignore', 'ignore', 'inherit'] });

  log(`starting ${MTG}/scripts/play.sh --engine-only --draft-room`);
  play = spawn('./scripts/play.sh', ['--engine-only', '--draft-room', '--site-dir', site, '--no-human-collect', '--no-eval', '--no-open'], { cwd: MTG, env: process.env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  let pout = '';
  play.stdout.on('data', (d) => { pout += d; });
  play.stderr.on('data', (d) => { pout += d; });
  for (let i = 0; i < 6000 && !/Engine ready/.test(pout); i++) await sleep(100);
  if (!/Engine ready/.test(pout)) throw new Error(`play.sh did not get ready:\n${pout.slice(-3000)}`);
  check(/Draft room: on/.test(pout), 'play.sh started the draft room');

  const pw = await loadPlaywright();
  const browser = await launchBrowser(pw, { headless: HEADLESS });
  try {
    const ctx = [];
    for (let i = 0; i < 2; i++) {
      const c = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      await c.route(/scryfall\.(com|io)/, (r) => r.fulfill({ status: 404, contentType: 'application/json', body: '{"object":"error"}' }));
      ctx.push(c);
    }
    const host = await ctx[0].newPage();
    const friend = await ctx[1].newPage();
    const errors = [];
    for (const [n, p] of [['host', host], ['friend', friend]]) p.on('pageerror', (e) => errors.push(`${n}: ${e.message}`));

    // ---- 2. the room, by clicking; the draft through the room's API
    await host.goto(`http://localhost:${ROOM}/#draft/friend`);
    await host.getByLabel('Your name').fill('Justin');
    await host.getByLabel('Who picks first').selectOption('0');
    await host.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => b.textContent === 'Create room' && !b.disabled), null, { timeout: 60_000 });
    await host.getByRole('button', { name: 'Create room' }).click();
    await host.getByText('Waiting for your friend').waitFor({ timeout: 15_000 });
    const joinUrl = await host.locator('.fr-link input').last().inputValue();
    await friend.goto(joinUrl);
    await friend.getByLabel('Your name').fill('Sam');
    await friend.getByRole('button', { name: 'Join' }).click();
    await friend.waitForURL(/#draft\/friend\/r\/r[\w-]{8}\/1$/, { timeout: 15_000 });
    const seats = [await seatOf(host), await seatOf(friend)];
    check(seats[0]?.seat === 0 && seats[1]?.seat === 1 && seats[0].id === seats[1].id, `both browsers hold a seat in room ${seats[0]?.id}`);
    const base = `http://127.0.0.1:${ROOM}`;
    let state = (await roomCall(base, seats[0].id, seats[0].token)).body;
    for (let pick = 0; !state.done && pick < 60; pick++) {
      const s = seats[state.toAct];
      let ok = false;
      for (let line = 0; line < 6 && !ok; line++) {
        const r = await roomCall(base, s.id, s.token, '/pick', { line, expect: state.version });
        if (r.status === 200) {
          state = r.body;
          ok = true;
        }
      }
      if (!ok) throw new Error(`pick ${pick + 1}: no legal line`);
    }
    check(state.done, `the draft is over (${state.seats[0].picks.length} + ${state.seats[1].picks.length} cards)`);

    // ---- 3. hand in the decks
    for (const [n, p] of [['host', host], ['friend', friend]]) {
      await p.getByText(/You drafted \d+ cards/).waitFor({ timeout: 30_000 });
      await p.getByRole('button', { name: 'Hand in this deck' }).click();
      await p.getByText(/You: (handed in|playing)/).or(p.getByText(/Starting game 1/)).or(p.locator('.fr-error')).first().waitFor({ timeout: 15_000 });
      const err = await p.locator('.fr-error').allInnerTexts();
      check(err.length === 0, `${n} handed in a deck${err.length ? `: ${err.join(' | ')}` : ''}`);
    }
    await host.screenshot({ path: path.join(OUT, 'table-1-handed-in.png') });
    const seen = (await friend.locator('.fr-rooms li').allInnerTexts()).join(' | ');
    check(/Justin: (handed in|playing) .+/.test(seen) && !seen.includes(state.seats[0].picks[0]), `the friend sees the host’s deck by name, not its list (${seen})`);
    // Both pages go to their seats when the game is ready (up to the engine's restart time).
    for (const p of [host, friend]) {
      await p.waitForURL(/#play\/friend$/, { timeout: 180_000 }).catch(async (e) => {
        throw new Error(`${e.message}\nthe room page says: ${(await p.locator('.fr-panel').allInnerTexts()).join(' | ')}`);
      });
    }
    check(true, 'both pages went to their seats when the room said the game was ready');

    // ---- 4. the boards
    for (const p of [host, friend]) await p.locator('.topbar-game').first().waitFor({ timeout: 60_000 });
    check((await host.locator('.topbar-game').first().innerText()) === 'You vs Sam', 'the host’s board says "You vs Sam"');
    check((await friend.locator('.topbar-game').first().innerText()) === 'You vs Justin', 'the friend’s board says "You vs Justin"');
    for (const [n, p] of [['host', host], ['friend', friend]]) {
      const text = await p.evaluate(() => document.body.innerText);
      const at = text.indexOf('Forge AI');
      check(at < 0, `${n}: nothing on the board calls the opponent "Forge AI"${at < 0 ? '' : `: …${text.slice(Math.max(0, at - 80), at + 40).replace(/\s+/g, ' ')}…`}`);
      check(!(await p.content()).includes(seats[n === 'host' ? 0 : 1].token), `${n}: the room token is nowhere on the page`);
    }
    let thinking = false;
    for (let i = 0; i < 150 && !thinking; i++) {
      await answerOpening(host);
      await answerOpening(friend);
      for (const p of [host, friend]) if (await p.locator('.play-table.is-thinking').count()) thinking = true;
      if (!thinking) await sleep(200);
    }
    check(thinking, 'a board says the other player is thinking');
    await host.screenshot({ path: path.join(OUT, 'table-2-host.png') });
    await friend.screenshot({ path: path.join(OUT, 'table-3-friend.png') });

    // The friend reloads: the same seat comes back by its token.
    await friend.reload();
    await friend.locator('.topbar-game').first().waitFor({ timeout: 30_000 });
    check((await friend.locator('.topbar-game').first().innerText()) === 'You vs Justin', 'the friend reloads mid-game and is back at the same seat');
    await friend.locator('.live-pill.is-open').waitFor({ timeout: 15_000 });

    // ---- 5. the friend concedes
    for (let i = 0; i < 50; i++) {
      await answerOpening(friend);
      const b = friend.getByRole('button', { name: 'Concede' }).first();
      if ((await b.count()) && (await b.isEnabled())) break;
      await sleep(200);
    }
    // An engine question may be up (its layer covers the top bar): the clicks go to the buttons themselves.
    await friend.getByRole('button', { name: 'Concede' }).first().dispatchEvent('click');
    await friend.locator('.btn-stop', { hasText: 'Concede' }).waitFor({ timeout: 5000 });
    await friend.locator('.btn-stop', { hasText: 'Concede' }).dispatchEvent('click');
    await host.getByText('You won').waitFor({ timeout: 60_000 });
    await friend.getByText('You lost').waitFor({ timeout: 60_000 });
    check((await host.getByText('You beat Sam.').count()) === 1, 'the host’s card: "You won … You beat Sam."');
    for (const [n, p] of [['host', host], ['friend', friend]]) {
      check((await p.getByRole('button', { name: /Next game|New match|Engine review/ }).count()) === 0, `${n}: no next game, new match or engine review at a table of two`);
    }
    await host.screenshot({ path: path.join(OUT, 'table-4-over.png') });
    await host.getByRole('button', { name: 'Back to the room' }).click();
    await host.getByText(/Game 1 is over/).waitFor({ timeout: 15_000 });
    check((await host.getByRole('button', { name: /Take your seat/ }).count()) === 0, 'back in the room, the spent seat is not offered again');
    check((await host.getByRole('button', { name: /Hand in/ }).count()) === 1, 'back in the room, a rematch is a deck away');
    check(errors.length === 0, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
  } finally {
    await browser.close();
    rmSync(scratch, { recursive: true, force: true });
  }
}

main()
  .catch((e) => {
    failed++;
    console.log(`  FAIL  ${e.stack}`);
  })
  .finally(() => {
    if (play) {
      try {
        process.kill(-play.pid, 'SIGTERM');
      } catch {
        /* gone */
      }
    }
    console.log(failed ? `\ntable e2e FAILED (${failed})` : '\ntable e2e OK');
    setTimeout(() => process.exit(failed ? 1 : 0), 3000);
  });

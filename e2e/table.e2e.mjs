#!/usr/bin/env node
/*
 * ForgeCoach — e2e/table.e2e.mjs
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * End-to-end: play with a friend (mtg-table D402–D407), two people in two
 * browser contexts against mtg-table's real draft room, real match launcher,
 * real Forge engine and real automatic engine review, a whole best of three:
 *
 *   1. builds ForgeCoach with FORGECOACH_BASE=./ into a scratch folder and
 *      starts mtg-table's `scripts/play.sh --engine-only --draft-room
 *      --site-dir <build>` (the room listener serves the build; ports from
 *      mtg-table's config.json: 8642 engine, 8643 helper, 8644 room, 8646 table);
 *   2. HOST (http://localhost:8644) makes a room with "Record our games by
 *      default" ticked, FRIEND (another context, http://127.0.0.1:8644) joins by
 *      the link — both by clicking; the 18 grids are drafted through the room's
 *      own API with each browser's seat token (friend.e2e.mjs drafts by clicking);
 *   3. the friend opts their own seat out of recording in the room (D407); each
 *      player clicks "Hand in this deck"; the room starts game 1 of 3;
 *   4. game 1: both boards say "You vs <the other>" and "Game 1 / 3", neither
 *      offers Next game / New match; both players pass priority into round 3; a
 *      line about the other player ("… is thinking") shows; the friend RELOADS and
 *      is back at the same seat; the friend concedes with a real click on the
 *      board's Concede (D406: a loss); the cards say the score and who chooses
 *      next; the host's card follows its own engine review, the friend's says it
 *      was not recorded;
 *   5. between games: back in the room, the score on both pages; the friend
 *      sideboards (another 40 of its own picks, through the room's API), the
 *      host keeps its deck by clicking; game 2 starts;
 *   6. game 2: the friend — who lost game 1 — alone is asked "you lost the last
 *      game: play or draw?" and plays first; the host concedes with a REAL CLICK
 *      on the board's Concede while its opening dialog is open (the fix: the
 *      dialog no longer covers the board's button); 1–1;
 *   7. game 3: the host is the one asked; it concedes from inside the question
 *      itself ("Concede…"); the friend wins the match 2–1, said on both cards and
 *      in both rooms;
 *   8. reviews (D407): the friend's room lists three games, none recorded, and
 *      the room hands the friend nothing of the host's (review and log refused
 *      with the friend's token); the coach helper's own /review never lists a
 *      friend's seat; the host's first engine review comes in (real
 *      coach-grade, idle priority) and opens on the host's room page;
 *   9. one person against Forge (the board's Concede in one-human play): the
 *      host goes back to the start page, Play vs Forge wakes the engine, and a
 *      real click on Concede works while the opening dialog is open.
 *
 * Environment: MTG_TABLE (default ../mtg-table, a checkout with D406/D407),
 * FORGE_JAR as play.sh wants it, HEADLESS=0 to watch, REVIEW_WAIT_S (default
 * 1500) for the host's first review. Screenshots: e2e/out/table-*.png.
 */
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchBrowser, loadPlaywright } from './harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MTG = path.resolve(process.env.MTG_TABLE ?? path.join(ROOT, '..', 'mtg-table'));
const OUT = path.join(ROOT, 'e2e', 'out');
const HEADLESS = process.env.HEADLESS !== '0';
const REVIEW_WAIT_S = Number(process.env.REVIEW_WAIT_S ?? 1500);
const ROOM = 8644;
const HELPER = 8643;
const T0 = Date.now();
const log = (s) => console.log(`[table ${((Date.now() - T0) / 1000).toFixed(0)}s] ${s}`);
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
  const text = await r.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* a log */
  }
  return { status: r.status, body: json, text };
}

/** The seat this page's browser holds in the room (draft/room.ts's saved list). */
async function seatOf(page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem('forgecoach.friendRooms.v1') ?? '[]')[0]);
}

const visible = (loc) => loc.isVisible().catch(() => false);

/** The round the phase strip shows (0 before the first turn). */
async function roundOf(page) {
  const t = await page.evaluate(() => document.querySelector('.pstrip[data-round]')?.getAttribute('data-round') ?? '0');
  return Number(t) || 0;
}

/**
 * One step of "pass priority": an engine question gets its default (Play, Keep,
 * or the dialog's primary), else the action bar's primary button. True when it
 * pressed something.
 */
async function step(page) {
  const peek = page.locator('.ask-peek');
  if (await visible(peek)) {
    await peek.click({ timeout: 3000 }).catch(() => {});
    return true;
  }
  const dialog = page.locator('.ask-dialog');
  if (await visible(dialog)) {
    for (const sel of ['.ask-opt.is-default:not([disabled])', '.ask-actions .btn-primary:not([disabled])', '.ask-actions .btn-keep:not([disabled])', '.ask-opt:not([disabled])', '.ask-actions .btn-quiet:not([disabled])']) {
      const b = dialog.locator(sel).first();
      if (await b.count()) {
        await b.click({ timeout: 3000 }).catch(() => {});
        return true;
      }
    }
    return false;
  }
  const bar = page.locator('.actionbar');
  if (!(await visible(bar))) return false;
  for (const sel of ['[data-primary][data-engine-button]', '[data-engine-button="ok"]']) {
    const b = bar.locator(sel).first();
    if ((await b.count()) && (await b.isEnabled().catch(() => false))) {
      await b.click({ timeout: 3000 }).catch(() => {});
      return true;
    }
  }
  return false;
}

/**
 * Both players pass priority until each has pressed `n` engine buttons (or the time runs out) -- decisions
 * for the engine review to grade; returns the presses and whether a "… is thinking" line showed.
 */
async function playTo(pages, n, ms = 120_000) {
  const t = Date.now();
  let thinking = false;
  const pressed = pages.map(() => 0);
  while (Date.now() - t < ms && pressed.some((k) => k < n)) {
    let any = false;
    for (const [i, p] of pages.entries()) {
      if (await p.locator('.play-table.is-thinking').count()) thinking = true;
      if (await step(p)) { pressed[i]++; any = true; await sleep(300); }
    }
    if (!any) await sleep(250);
  }
  return { reached: pressed.every((k) => k >= n), pressed, thinking };
}

/** Both pages on the board of a new game of the room (their hash goes to #play/friend), its first frame in. */
async function toTable(pages) {
  for (const p of pages) {
    await p.waitForURL(/#play\/friend$/, { timeout: 240_000 }).catch(async (e) => {
      throw new Error(`${e.message}\nthe room page says: ${(await p.locator('.fr-panel').allInnerTexts()).join(' | ')}`);
    });
  }
  for (const p of pages) await p.locator('.topbar-game').first().waitFor({ timeout: 60_000 });
}

/** The board's own Concede (the top bar), then the confirmation -- real clicks, as a person makes them. */
async function concedeFromBoard(page) {
  await page.getByRole('button', { name: 'Concede', exact: true }).first().click({ timeout: 8000 });
  await page.locator('.btn-stop', { hasText: 'Concede' }).click({ timeout: 8000 });
}

async function backToRoom(page) {
  await page.getByRole('button', { name: 'Back to the room' }).click();
  await page.locator('.fr-score').waitFor({ timeout: 20_000 });
}

/** The build on a port of its own (step 9: a page that is neither the room's nor the bridge's, as GitHub Pages is). */
async function serveSite(dir) {
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.gz': 'application/gzip', '.md': 'text/markdown' };
  // A preview port (play/seatUrl.ts DEV_PORTS): a page there is not taken for one the engine served.
  const srv = createServer((req, res) => {
    const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    let f = path.join(dir, p.endsWith('/') ? `${p}index.html` : p);
    if (!f.startsWith(dir) || !existsSync(f) || !statSync(f).isFile()) f = path.join(dir, 'index.html');
    res.writeHead(200, { 'Content-Type': types[path.extname(f)] ?? 'application/octet-stream' });
    res.end(readFileSync(f));
  });
  let port = 0;
  for (const p of [4173, 5174, 5173]) {
    const ok = await new Promise((r) => { srv.once('error', () => r(false)); srv.listen(p, '127.0.0.1', () => r(true)); });
    if (ok) { port = p; break; }
  }
  if (!port) throw new Error('no preview port (4173, 5174, 5173) is free for step 9');
  return { url: `http://127.0.0.1:${port}/`, close: () => srv.close() };
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
    const both = [host, friend];
    const errors = [];
    for (const [n, p] of [['host', host], ['friend', friend]]) p.on('pageerror', (e) => errors.push(`${n}: ${e.message}`));

    // ---- 2. the room, by clicking; the draft through the room's API
    await host.goto(`http://localhost:${ROOM}/#draft/friend`);
    await host.getByLabel('Your name').fill('Justin');
    await host.getByLabel('Who picks first').selectOption('0');
    await host.getByLabel('Record our games by default').check();
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
    const [id, tokH, tokF] = [seats[0].id, seats[0].token, seats[1].token];
    let state = (await roomCall(base, id, tokH)).body;
    check(state.record?.you === true && state.record?.default === true, 'the room records by default: the owner ticked it');
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
    const pickF = state.seats[1].picks;

    // ---- 3. the friend opts out of recording; both hand in their decks
    await friend.getByText(/You drafted \d+ cards/).waitFor({ timeout: 30_000 });
    const box = friend.getByLabel('Record my seat of the next game');
    check(await box.isChecked(), "the friend's seat starts from the room's default: recorded");
    await box.uncheck();
    await friend.waitForFunction(() => !document.querySelector('input[aria-label="Record my seat of the next game"]')?.checked, null, { timeout: 10_000 });
    check((await roomCall(base, id, tokF)).body.record?.you === false && (await roomCall(base, id, tokH)).body.record?.you === true, 'the friend opted their own seat out (D407); the host is still recorded');
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

    // ---- 4. game 1
    await toTable(both);
    check(true, 'both pages went to their seats when the room said game 1 was ready');
    check((await host.locator('.topbar-game').first().innerText()) === 'You vs Sam', 'the host’s board says "You vs Sam"');
    check((await friend.locator('.topbar-game').first().innerText()) === 'You vs Justin', 'the friend’s board says "You vs Justin"');
    for (const [n, p] of [['host', host], ['friend', friend]]) {
      const mb = (await p.locator('.match-box').first().innerText().catch(() => '')).replace(/\s+/g, ' ');
      check(/Game 1 \/ 3/.test(mb) && /0 – 0/.test(mb), `${n}: the board says game 1 of 3, 0 – 0 (${mb})`);
      const text = await p.evaluate(() => document.body.innerText);
      const at = text.indexOf('Forge AI');
      check(at < 0, `${n}: nothing on the board calls the opponent "Forge AI"${at < 0 ? '' : `: …${text.slice(Math.max(0, at - 80), at + 40).replace(/\s+/g, ' ')}…`}`);
      check(!(await p.content()).includes(seats[n === 'host' ? 0 : 1].token), `${n}: the room token is nowhere on the page`);
    }
    const g1 = await playTo(both, 6);
    check(g1.reached, `both players answered the engine (kept, passed priority) at least six times each (${g1.pressed.join(' + ')}; round ${Math.max(await roundOf(host), await roundOf(friend))})`);
    check(g1.thinking, 'a board said the other player is thinking');
    await host.screenshot({ path: path.join(OUT, 'table-2-host.png') });
    await friend.screenshot({ path: path.join(OUT, 'table-3-friend.png') });
    // The friend reloads: the same seat comes back by its token.
    await friend.reload();
    await friend.locator('.topbar-game').first().waitFor({ timeout: 30_000 });
    check((await friend.locator('.topbar-game').first().innerText()) === 'You vs Justin', 'the friend reloads mid-game and is back at the same seat');
    await friend.locator('.live-pill.is-open').waitFor({ timeout: 15_000 });
    await concedeFromBoard(friend);
    await host.getByText('You won').waitFor({ timeout: 60_000 });
    await friend.getByText('You lost').waitFor({ timeout: 60_000 });
    check((await host.getByText('You beat Sam.').count()) === 1, 'game 1, the friend conceded: the host’s card says "You won … You beat Sam."');
    for (const [n, p] of [['host', host], ['friend', friend]]) {
      check((await p.getByRole('button', { name: /Next game|New match/ }).count()) === 0, `${n}: no next game or new match on the card at a table of two`);
    }
    const hm = await host.locator('.over-match').innerText().catch(() => '');
    const fm = await friend.locator('.over-match').innerText().catch(() => '');
    check(/Game 1 of 3 · you 1 – 0 Sam/.test(hm) && /Sam chooses to play or draw/.test(hm), `the host’s card: the score, and that Sam chooses next (${hm})`);
    check(/Game 1 of 3 · you 0 – 1 Justin/.test(fm) && /you choose to play or draw/.test(fm), `the friend’s card: the score, and that they choose next (${fm})`);
    await friend.locator('.over-review', { hasText: 'not recorded' }).waitFor({ timeout: 20_000 }).catch(() => {});
    const fr = await friend.locator('.over-review').innerText().catch(() => '');
    check(/not recorded/.test(fr), `the friend’s card: not recorded, so no engine review (${fr})`);
    await host.locator('.over-review, .over-actions button:has-text("Your engine review")').first().waitFor({ timeout: 20_000 }).catch(() => {});
    const hr = (await host.locator('.over-actions').innerText().catch(() => '')).replace(/\s+/g, ' ');
    check(/Your engine review/.test(hr) && !/not recorded/.test(hr), `the host’s card follows its own engine review (${hr.slice(0, 160)})`);
    check((await host.getByRole('button', { name: 'Engine review: grade every decision' }).count()) === 0, 'the helper’s own review run is not offered at a table');
    await host.screenshot({ path: path.join(OUT, 'table-4-over.png') });

    // ---- 5. between games: the score in the room, sideboarding
    await backToRoom(host);
    await backToRoom(friend);
    for (const p of both) await p.locator('.fr-score', { hasText: '1 – 0' }).or(p.locator('.fr-score', { hasText: '0 – 1' })).waitFor({ timeout: 15_000 }).catch(() => {});
    check((await host.locator('.fr-score').innerText()) === 'Match 1: you 1 – 0 Sam.', `the host’s room: ${await host.locator('.fr-score').innerText()}`);
    check((await friend.locator('.fr-score').innerText()) === 'Match 1: you 0 – 1 Justin.', `the friend’s room: ${await friend.locator('.fr-score').innerText()}`);
    check((await friend.getByText('You lost the last game, so you choose to play or draw.').count()) === 1, 'the friend’s room says they choose to play or draw in game 2');
    check((await host.getByRole('button', { name: /Take your seat/ }).count()) === 0, 'back in the room, the spent seat is not offered again');
    const side = { name: 'Sam sideboarded', main: [...pickF.slice(1, 24).map((c) => [1, c]), [17, 'Island']], sideboard: [[1, pickF[0]]] };
    const sb = await roomCall(base, id, tokF, '/deck', side);
    check(sb.status === 200 && sb.body.decks[1].ready && sb.body.yourDeck.name === 'Sam sideboarded', `the friend sideboards: another 40 of its own picks, accepted (${sb.status})`);
    const cheat = await roomCall(base, id, tokF, '/deck', { name: 'Cheat', main: [...state.seats[0].picks.slice(0, 23).map((c) => [1, c]), [17, 'Island']] });
    check(cheat.status === 400 && cheat.body.code === 'deck', 'a sideboard of the other player’s picks is refused');
    await roomCall(base, id, tokF, '/deck', side);
    await host.getByRole('button', { name: 'Keep this deck for game 2' }).click();

    // ---- 6. game 2: the friend lost game 1, so the friend chooses; the host concedes through its open dialog
    await toTable(both);
    for (const [n, p] of [['host', host], ['friend', friend]]) {
      const mb = (await p.locator('.match-box').first().innerText().catch(() => '')).replace(/\s+/g, ' ');
      check(/Game 2 \/ 3/.test(mb), `${n}: the board says game 2 of 3 (${mb})`);
    }
    await friend.getByText(/you lost the last game/i).waitFor({ timeout: 60_000 });
    check((await host.getByText(/you lost the last game/i).count()) === 0, 'game 2: the friend alone is asked "you lost the last game: play or draw?"');
    await friend.locator('.ask-dialog .ask-opt.is-default').first().click();
    // Forge asks the player who goes first to keep or mulligan first: the friend keeps, then the host is asked.
    for (let i = 0; i < 240 && !(await visible(host.locator('.ask-layer'))); i++) {
      if (!(await step(friend))) await sleep(250);
    }
    await host.locator('.ask-layer').waitFor({ timeout: 30_000 });
    await host.screenshot({ path: path.join(OUT, 'table-5-dialog.png') });
    await concedeFromBoard(host);
    check(true, 'the host conceded with real clicks on the board’s Concede while its opening dialog was open');
    await host.getByText('You lost').waitFor({ timeout: 60_000 });
    await friend.getByText('You won').waitFor({ timeout: 60_000 });
    const hm2 = await host.locator('.over-match').innerText().catch(() => '');
    check(/Game 2 of 3 · you 1 – 1 Sam/.test(hm2) && /you choose to play or draw/.test(hm2), `1–1, the host chooses next (${hm2})`);
    await backToRoom(host);
    await backToRoom(friend);

    // ---- 7. game 3: the host chooses, and concedes from inside the question
    await host.getByRole('button', { name: 'Keep this deck for game 3' }).click();
    await friend.getByRole('button', { name: 'Keep this deck for game 3' }).click();
    await toTable(both);
    await host.getByText(/you lost the last game/i).waitFor({ timeout: 60_000 });
    check((await friend.getByText(/you lost the last game/i).count()) === 0, 'game 3: the host alone is asked "you lost the last game: play or draw?"');
    await host.locator('.ask-dialog .ask-concede').click();
    await host.locator('.btn-stop', { hasText: 'Concede' }).click({ timeout: 8000 });
    check(true, 'the host conceded from the question itself ("Concede…")');
    await host.getByText('You lost').waitFor({ timeout: 60_000 });
    await friend.getByText('You won').waitFor({ timeout: 60_000 });
    const fm3 = await friend.locator('.over-match').innerText().catch(() => '');
    const hm3 = await host.locator('.over-match').innerText().catch(() => '');
    check(fm3 === 'You win the match 2 – 1.' && hm3 === 'Sam wins the match 2 – 1.', `the match is decided, on both cards (${fm3} / ${hm3})`);
    await host.screenshot({ path: path.join(OUT, 'table-6-match.png') });
    await backToRoom(host);
    await backToRoom(friend);
    // The room scores a game from the bridge's result.json within its 2 s poll.
    for (const p of both) await p.locator('.fr-score', { hasText: 'won the match' }).waitFor({ timeout: 15_000 }).catch(() => {});
    check((await host.locator('.fr-score').innerText()) === 'Sam won the match 2 – 1.', `the host’s room: ${await host.locator('.fr-score').innerText()}`);
    check((await friend.locator('.fr-score').innerText()) === 'You won the match 2 – 1.', `the friend’s room: ${await friend.locator('.fr-score').innerText()}`);
    check((await host.getByRole('button', { name: 'Hand in a deck for a new match' }).count()) === 1, 'after the match, a deck starts a new one');

    // ---- 8. reviews: the host's own, never the friend's
    const final = (await roomCall(base, id, tokF)).body;
    check(final.games.length === 3 && final.games.every((g) => g.recorded === false && g.review === 'off'), `the friend’s three games: not recorded, no review (${JSON.stringify(final.games.map((g) => [g.game, g.winner, g.review]))})`);
    const friendLines = (await friend.locator('.fr-games li').allInnerTexts()).join(' | ');
    check(/not recorded/.test(friendLines) && (await friend.getByRole('button', { name: 'Open your review' }).count()) === 0, `the friend’s room offers no review (${friendLines.slice(0, 200)})`);
    for (const g of final.games) {
      const rv = await roomCall(base, id, tokF, `/review/${g.matchId}`);
      const lg = await roomCall(base, id, tokF, `/log/${g.matchId}`);
      check(rv.body?.state === 'off' && rv.body?.report === undefined && lg.status === 404, `game ${g.game}: the friend’s token gets no review and no log — never the host’s`);
    }
    const ownerList = await fetch(`http://127.0.0.1:${HELPER}/review`).then((r) => r.json()).catch(() => null);
    check(ownerList?.ok === true && !(ownerList.reviews ?? []).some((r) => /^friend-/.test(r.gameId)), `the coach helper’s own /review lists no seat of a friend’s game (${(ownerList?.reviews ?? []).length} review(s))`);
    const hostGames = (await roomCall(base, id, tokH)).body.games;
    check(hostGames.every((g) => g.recorded === true), 'the host’s three games are recorded');
    log(`waiting up to ${REVIEW_WAIT_S} s for the host's first engine review (real coach-grade, idle priority)`);
    const t = Date.now();
    let doneGame = null;
    while (Date.now() - t < REVIEW_WAIT_S * 1000 && !doneGame) {
      const gs = (await roomCall(base, id, tokH)).body.games;
      doneGame = gs.find((g) => g.review === 'done') ?? null;
      const bad = gs.find((g) => g.review === 'failed');
      if (bad) {
        const why = (await roomCall(base, id, tokH, `/review/${bad.matchId}`)).body?.why;
        check(false, `the host’s review of game ${bad.game} failed: ${why}`);
        break;
      }
      if (!doneGame) await sleep(10_000);
    }
    check(!!doneGame, `the host’s review of game ${doneGame?.game ?? '?'} is done (${Math.round((Date.now() - t) / 1000)} s after the match)`);
    if (doneGame) {
      const fromHost = await roomCall(base, id, tokH, `/review/${doneGame.matchId}`);
      check(fromHost.body?.state === 'done' && fromHost.body?.report?.kind === 'game-review' && fromHost.body.report.seat === 0, 'the room hands the host its own report (seat 0)');
      const fromFriend = await roomCall(base, id, tokF, `/review/${doneGame.matchId}`);
      check(!fromFriend.text.includes('game-review'), 'and the same game asked for with the friend’s token carries nothing of it');
      await host.getByRole('button', { name: 'Open your review' }).first().waitFor({ timeout: 20_000 });
      await host.getByRole('button', { name: 'Open your review' }).first().click();
      await host.locator('.rv .topbar-game').waitFor({ timeout: 30_000 });
      const title = await host.locator('.rv .topbar-game').innerText();
      check(/Engine review · game \d with Sam/.test(title), `the host’s review opens on its room page (${title})`);
      const problems = await host.locator('.rv').innerText();
      check(!/is not a game state in this log|The review is for game/.test(problems), 'the report matches the log the room served');
      await host.screenshot({ path: path.join(OUT, 'table-7-review.png') });
      await host.getByRole('button', { name: 'Back to the room' }).click();
      await host.locator('.fr-score').waitFor({ timeout: 15_000 });
    }

    // ---- 9. one person against Forge: the board's Concede while the opening dialog is open
    const pages = await serveSite(site);
    await host.goto(pages.url);
    await host.locator('.lobby-tile', { hasText: 'Play vs Forge' }).click();
    await host.locator('.topbar-game').first().waitFor({ timeout: 120_000 });
    check(!/You vs (Sam|Justin)/.test(await host.locator('.topbar-game').first().innerText()), 'Play vs Forge after the table: a game against the AI');
    await host.locator('.ask-layer').waitFor({ timeout: 60_000 });
    await concedeFromBoard(host);
    await host.getByText('You lost').waitFor({ timeout: 60_000 });
    check(true, 'one-human play: a real click on the board’s Concede works while the opening dialog is open');
    pages.close();
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

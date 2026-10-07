#!/usr/bin/env node
/*
 * ForgeCoach — e2e/friend.e2e.mjs
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * End-to-end: Draft with a friend (mtg-table D400), two people in two browser
 * contexts against mtg-table's real draft room, using only what a user clicks:
 *
 *   1. builds ForgeCoach with FORGECOACH_BASE=./ (the build the room listener
 *      serves) into a scratch folder;
 *   2. starts mtg-table's coach helper with --draft-room on free ports, the
 *      room listener serving that build (no engine: a draft needs none);
 *   3. HOST opens #draft/friend on http://localhost:<room port>, makes a room
 *      on the Synergy Cube (FRIEND_CUBE=<id> for another, e.g. evybaby, Evan's
 *      360-card cube) and reads the friend's link off the page;
 *   4. FRIEND (another context, so another browser's storage) opens the link on
 *      http://127.0.0.1:<room port>, joins as "Sam"; the token leaves the
 *      address bar;
 *   5. the two draft all 18 grids by clicking an arrow and "Take": whoever's
 *      turn it is; the other page must say it is waiting, never offer a pick;
 *      FRIEND reloads the page mid-draft and must come back to the same grid;
 *   6. at the end both pages say the draft is complete, the pools are the
 *      room's, the page's own replay of the seed says "Checked", and each
 *      player's Build your deck opens the deck editor on their own pool;
 *   7. deck export (ui/DeckExport.tsx): the room screen has it before the deck
 *      is built; the editor has Copy list by Submit (the dock on a 390×844
 *      phone) after picking by hand and after Suggest a build, its count the
 *      deck's; after Hand in this deck the room screen still has it, with the
 *      same list; the two players' lists share no card (only your own pool);
 *      a page that may not use the clipboard shows the list selected instead.
 *
 * Environment:  MTG_TABLE (default ../mtg-table)   FRIEND_CUBE (a cube id, default the first)   HEADLESS=0 to watch
 * Screenshots go to e2e/out/friend-*.png.
 */
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { freePort, launchBrowser, loadPlaywright } from './harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MTG = path.resolve(process.env.MTG_TABLE ?? path.join(ROOT, '..', 'mtg-table'));
const OUT = path.join(ROOT, 'e2e', 'out');
const SHOTS = process.env.SHOTS ?? OUT;
const HEADLESS = process.env.HEADLESS !== '0';
const CUBE = process.env.FRIEND_CUBE ?? null;
const log = (s) => console.log(`[friend] ${s}`);
const procs = [];
let failed = 0;
const check = (ok, what) => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${what}`);
  if (!ok) failed++;
};

async function main() {
  mkdirSync(OUT, { recursive: true });
  mkdirSync(SHOTS, { recursive: true });
  const scratch = mkdtempSync(path.join(tmpdir(), 'forgecoach-friend-'));
  const site = path.join(scratch, 'site');
  log('building ForgeCoach with FORGECOACH_BASE=./');
  execFileSync('npx', ['vite', 'build', '--outDir', site, '--emptyOutDir'], { cwd: ROOT, env: { ...process.env, FORGECOACH_BASE: './' }, stdio: ['ignore', 'ignore', 'inherit'] });

  const coachPort = await freePort();
  const roomPort = await freePort();
  const cfg = path.join(scratch, 'config.json');
  writeFileSync(cfg, JSON.stringify({ wsAllowedOrigins: ['http://127.0.0.1:*', 'http://localhost:*', 'https://jalirkan.github.io'], coach: { autoReview: false } }));
  const roomDir = `var/draft-room-forgecoach-e2e-${process.pid}`;
  const helper = spawn(process.execPath, [path.join(MTG, 'tools', 'coach-helper.mjs'), '--port', String(coachPort), '--no-review', '--no-eval',
    '--draft-room', '--room-port', String(roomPort), '--room-site-dir', site, '--room-dir', roomDir], { cwd: MTG, env: { ...process.env, MTG_TABLE_CONFIG: cfg }, stdio: ['ignore', 'pipe', 'pipe'] });
  procs.push(helper);
  let hout = '';
  helper.stdout.on('data', (d) => { hout += d; });
  helper.stderr.on('data', (d) => { hout += d; });
  for (let i = 0; i < 100 && !/COACH ROOM/.test(hout); i++) await new Promise((r) => setTimeout(r, 100));
  if (!/ROOM LISTENING/.test(hout)) throw new Error(`the helper did not start its room:\n${hout}`);
  log(`helper on ${coachPort}, room listener on ${roomPort}`);

  const pw = await loadPlaywright();
  const browser = await launchBrowser(pw, { headless: HEADLESS });
  try {
    const hostCtx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const friendCtx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    for (const c of [hostCtx, friendCtx]) {
      // No network for card data in a test: Scryfall is answered "not found" (the page falls back to names).
      await c.route(/scryfall\.(com|io)/, (r) => r.fulfill({ status: 404, contentType: 'application/json', body: '{"object":"error"}' }));
    }
    // The friend's page may write the clipboard (127.0.0.1 is a secure context); the host's fallback is tested below.
    await friendCtx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: `http://127.0.0.1:${roomPort}` });
    const host = await hostCtx.newPage();
    const friend = await friendCtx.newPage();
    for (const [n, p] of [['host', host], ['friend', friend]]) p.on('pageerror', (e) => console.log(`[${n} pageerror] ${e.message}`));

    // ---- 3. the host makes a room (the page on localhost: the room listener's own origin, another name for it)
    await host.goto(`http://localhost:${roomPort}/?coachPort=${coachPort}#draft/friend`);
    await host.getByLabel('Your name').fill('Justin');
    await host.getByLabel('Who picks first').selectOption('0');
    if (CUBE) await host.getByLabel('Cube').selectOption(CUBE);
    const create = host.getByRole('button', { name: 'Create room' });
    await create.waitFor({ timeout: 60_000 });
    await host.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => b.textContent === 'Create room' && !b.disabled), null, { timeout: 60_000 });
    await create.click();
    await host.getByText('Waiting for your friend').waitFor({ timeout: 15_000 });
    const linkInput = host.locator('.fr-link input').last();
    const joinUrl = (await linkInput.inputValue()).replace(`http://127.0.0.1:${roomPort}`, `http://127.0.0.1:${roomPort}`);
    check(new RegExp(`^http://127\\.0\\.0\\.1:${roomPort}/#draft/friend/join\\?room=r[\\w-]{8}&t=[\\w-]{22}$`).test(joinUrl), `the friend's link is the room listener's page with the seat in the fragment (${joinUrl.replace(/t=[\w-]+/, 't=…')})`);
    check(/#draft\/friend\/r\/r[\w-]{8}\/0$/.test(host.url()), 'the host\'s address bar holds no token');
    await host.screenshot({ path: path.join(OUT, 'friend-1-waiting.png') });

    // ---- 4. the friend joins
    await friend.goto(joinUrl);
    await friend.getByText('Justin invites you to draft').waitFor({ timeout: 30_000 });
    await friend.getByLabel('Your name').fill('Sam');
    await friend.getByRole('button', { name: 'Join' }).click();
    await friend.waitForURL(/#draft\/friend\/r\/r[\w-]{8}\/1$/, { timeout: 15_000 });
    check(!friend.url().includes('t='), 'the friend\'s token left the address bar');
    await host.locator('.pk-title').waitFor({ timeout: 30_000 });
    await friend.locator('.pk-title').waitFor({ timeout: 30_000 });
    check((await host.locator('.seat-chip').allTextContents()).some((t) => t.includes('Sam')), 'the host\'s seat chips name Sam');
    await friend.screenshot({ path: path.join(OUT, 'friend-2-pick.png') });

    // ---- 5. eighteen grids, by clicking
    const pages = { host, friend };
    let reloaded = false;
    let waitingSeen = 0;
    for (let pick = 0; pick < 36; pick++) {
      // Whose turn: the page whose Take button can be enabled by choosing a line.
      let mover = null;
      for (let i = 0; i < 100 && !mover; i++) {
        for (const [n, p] of Object.entries(pages)) {
          if (await p.locator('.garrow:not([disabled])').count()) { mover = n; break; }
        }
        if (!mover) await new Promise((r) => setTimeout(r, 100));
      }
      if (!mover) throw new Error(`pick ${pick + 1}: nobody can pick`);
      const other = mover === 'host' ? pages.friend : pages.host;
      if (await other.locator('.garrow:not([disabled])').count()) throw new Error(`pick ${pick + 1}: both pages offer a pick`);
      if (await other.getByText(/picks a line…/).count()) waitingSeen++;
      const p = pages[mover];
      const title = await p.locator('.pk-title').innerText();
      const arrows = p.locator('.garrow:not([disabled])');
      const k = await arrows.count();
      await arrows.nth(pick % k).click();
      await p.locator('.pk-primary').click();
      // Both pages move on (the room's state arrives on both streams).
      await other.waitForFunction((t) => {
        const el = document.querySelector('.pk-title');
        return !el || el.textContent !== t || document.querySelectorAll('.garrow:not([disabled])').length > 0;
      }, title, { timeout: 10_000 }).catch(() => {});
      if (pick === 13 && !reloaded) {
        reloaded = true;
        const before = await pages.friend.locator('.pk-title').innerText();
        await pages.friend.reload();
        await pages.friend.locator('.pk-title').waitFor({ timeout: 30_000 });
        const after = await pages.friend.locator('.pk-title').innerText();
        check(after === before, `the friend reloads mid-draft and is back at "${after}"`);
      }
    }
    check(waitingSeen >= 30, `the page not picking says it is waiting (${waitingSeen} of 36)`);

    // ---- 6. the end
    for (const [n, p] of Object.entries(pages)) {
      await p.getByText(/You drafted \d+ cards/).waitFor({ timeout: 15_000 });
      const t = await p.locator('.fr-title').innerText();
      const checked = await p.getByText(/Checked: this is exactly the draft the cube deals from seed \d+/).count();
      check(checked === 1, `${n}: the page re-dealt the draft from the revealed seed and it matches`);
      log(`${n}: ${t}`);
    }
    const hostN = Number(/(\d+)/.exec(await host.locator('.fr-title').innerText())[1]);
    const friendN = Number(/(\d+)/.exec(await friend.locator('.fr-title').innerText())[1]);
    check(hostN + friendN >= 18 * 5 && hostN + friendN <= 18 * 6, `the pools add up to 5 or 6 cards a grid (${hostN} + ${friendN})`);
    check((await host.getByText(`Sam has ${friendN}`).count()) === 1, 'the host sees the friend\'s pool size');
    await host.screenshot({ path: path.join(OUT, 'friend-3-done.png') });
    await friend.getByRole('button', { name: 'Build your deck' }).click();
    await friend.getByText('Draft with Justin · complete').waitFor({ timeout: 15_000 });
    check(true, 'the friend\'s Build your deck opens the deck editor');
    await friend.screenshot({ path: path.join(OUT, 'friend-4-build.png') });

    // ---- 7. deck export
    const listOf = async (p, scope) => {
      const box = p.locator(`${scope}[data-testid=deck-export], ${scope} [data-testid=deck-export]`);
      await box.getByRole('button', { name: 'Show list' }).click();
      const t = await box.locator('textarea').inputValue();
      await box.getByRole('button', { name: 'Hide list' }).click();
      return t;
    };
    const total = (t) => t.split('\n').filter((l) => /^\d+ /.test(l));
    const mainTotal = (t) => total(t.split('\nSideboard\n')[0]).reduce((n, l) => n + Number(l.split(' ')[0]), 0);
    // By hand: move one card to the sideboard, then the export follows the screen.
    const deckCopy = friend.locator('.de-stat').getByTestId('copy-deck');
    check(await deckCopy.isVisible(), 'the deck editor has Copy list beside Submit');
    const handCount = await friend.locator('.de-side').getByTestId('deck-export-count').innerText();
    await friend.locator('.de-main .dcard').last().click();
    const handCount2 = await friend.locator('.de-side').getByTestId('deck-export-count').innerText();
    const n0 = Number(/^(\d+)/.exec(handCount)[1]);
    check(handCount === `${n0} cards, no sideboard` && handCount2 === `${n0 - 1} cards + 1 sideboard`, `the export follows a card moved by hand (${handCount} → ${handCount2})`);
    await deckCopy.click();
    await friend.locator('.de-stat').getByText('Copied', { exact: true }).waitFor({ timeout: 5000 }).then(() => check(true, 'Copy list says Copied'), () => check(false, 'Copy list says Copied'));
    // Suggest a build, then basics to 40.
    await friend.locator('.de-suggest').click();
    await friend.waitForFunction(() => !!document.querySelector('.de-note'), null, { timeout: 30_000 });
    for (let n = Number(await friend.locator('.de-count b').innerText()); n < 40; n = Number(await friend.locator('.de-count b').innerText())) {
      await friend.locator('.basic-row.is-on').first().getByRole('button', { name: /One more/ }).click();
    }
    const deckN = Number(await friend.locator('.de-count b').innerText());
    const sugCount = await friend.locator('.de-side').getByTestId('deck-export-count').innerText();
    check(sugCount.startsWith(`${deckN} cards`), `after Suggest a build the export counts the deck on screen (${sugCount})`);
    const editorList = await listOf(friend, '.de-side');
    check(editorList.startsWith('Deck\n') && mainTotal(editorList) === deckN, `the list is the ${deckN}-card deck, Deck / Sideboard sections`);
    await friend.screenshot({ path: path.join(SHOTS, 'friend-editor-desktop.png') });
    // A phone: Copy list is in the dock, on screen without scrolling.
    await friend.setViewportSize({ width: 390, height: 844 });
    const dockCopy = friend.locator('.dbuild-dock').getByTestId('copy-deck');
    const box = await dockCopy.boundingBox();
    check(!!box && box.y >= 0 && box.y + box.height <= 844 && box.x >= 0 && box.x + box.width <= 390, 'on a 390×844 phone Copy list sits in the bottom dock, on screen');
    await friend.screenshot({ path: path.join(SHOTS, 'friend-editor-phone.png') });
    await dockCopy.click();
    await friend.locator('.dbuild-dock').getByText('Copied', { exact: true }).waitFor({ timeout: 5000 }).then(() => check(true, 'the phone dock\'s Copy list says Copied'), () => check(false, 'the phone dock\'s Copy list says Copied'));
    check((await friend.evaluate(() => navigator.clipboard.readText())) === editorList, 'the clipboard holds the list');
    // Back to the room, hand the deck in: the room screen exports the same list.
    await friend.locator('.dbuild-dock .dock-main').click();
    await friend.getByText(/You drafted \d+ cards/).waitFor({ timeout: 15_000 });
    await friend.getByRole('button', { name: 'Hand in this deck' }).click();
    await friend.getByText(/You: handed in/).waitFor({ timeout: 15_000 });
    const roomCopy = friend.locator('.fr-export').getByTestId('copy-deck');
    const rb = await roomCopy.boundingBox();
    log(`room screen on a phone: Copy deck list at y=${Math.round(rb?.y ?? -1)}`);
    check(!!rb, 'after Hand in, the room screen has Copy deck list');
    const roomList = await listOf(friend, '.fr-export');
    check(roomList === editorList, 'the room screen exports the same list as the editor');
    await roomCopy.scrollIntoViewIfNeeded();
    await friend.screenshot({ path: path.join(SHOTS, 'friend-room-phone.png') });
    await friend.setViewportSize({ width: 1280, height: 900 });
    await friend.screenshot({ path: path.join(SHOTS, 'friend-room-desktop.png'), fullPage: true });
    // The host's list (its starting deck: every card drafted) shares no card with the friend's.
    const hostList = await listOf(host, '.fr-export');
    const names = (t) => new Set(total(t).map((l) => l.replace(/^\d+ /, '')).filter((n) => !/^(Plains|Island|Swamp|Mountain|Forest|Wastes)$/.test(n)));
    const shared = [...names(hostList)].filter((n) => names(roomList).has(n));
    check(names(hostList).size > 0 && shared.length === 0, `each page exports only its own pool (shared: ${shared.join(', ') || 'none'})`);
    // A page that may not use the clipboard (plain http on a LAN): the list, selected, to copy by hand.
    await host.evaluate(() => {
      Object.defineProperty(window, 'isSecureContext', { value: false });
      document.execCommand = () => false;
    });
    await host.locator('.fr-export').getByTestId('copy-deck').click();
    const dialog = host.getByRole('dialog', { name: 'Copy the deck list' });
    await dialog.waitFor({ timeout: 5000 });
    const sel = await host.evaluate(() => {
      const t = document.querySelector('.dx-modal textarea');
      return t && document.activeElement === t ? t.value.slice(t.selectionStart, t.selectionEnd) : '';
    });
    check(sel === hostList, 'without a clipboard the list opens selected in a box');
    await host.screenshot({ path: path.join(SHOTS, 'host-copy-fallback.png') });
    await dialog.getByRole('button', { name: 'Done' }).click();
  } finally {
    await browser.close();
    rmSync(path.join(MTG, roomDir), { recursive: true, force: true });
    rmSync(scratch, { recursive: true, force: true });
  }
}

main()
  .catch((e) => {
    failed++;
    console.log(`  FAIL  ${e.stack}`);
  })
  .finally(() => {
    for (const p of procs) try { p.kill('SIGTERM'); } catch { /* gone */ }
    console.log(failed ? `\nfriend e2e FAILED (${failed})` : '\nfriend e2e OK');
    process.exit(failed ? 1 : 0);
  });

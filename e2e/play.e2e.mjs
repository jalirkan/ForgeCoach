#!/usr/bin/env node
/*
 * ForgeCoach — e2e/play.e2e.mjs
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * End-to-end: play one whole game through the real app against the real
 * Forge engine (mtg-table's bridge), using only what a user sees on screen.
 *
 *   ./scripts/play.sh --engine-only        # in mtg-table, first
 *   npm run e2e                            # here
 *
 * Environment:
 *   SEAT_URL       the engine's seat socket       (default ws://127.0.0.1:8642/ws)
 *   APP_URL        a running ForgeCoach to test    (default: start vite on a free port)
 *   HEADLESS       0 to watch it play              (default 1)
 *   VIEWPORT       desktop | phone                 (default desktop)
 *   MAX_TURNS      stop (and pass) after this round (default 40)
 *   STALL_SECONDS  fail when nothing on screen changes for this long (default 90)
 *   SEED           the seed for the bot's "sometimes" choices (default: random)
 *   NEXT_GAME      0 to leave the engine at the result (default: start the next
 *                  game at the end, so the engine stays up for another run)
 *   VERBOSE        1 to log more of what the bot sees
 *   BROWSER_PATH   a Chromium/Chrome executable, when Playwright has none installed
 *   IGNORE_HTTPS_ERRORS  1 behind a TLS-intercepting proxy (so Scryfall card data loads)
 *
 * Exit status: 0 the game finished (or MAX_TURNS was reached), 1 the test
 * failed (stall, page error, console error), 2 it could not start.
 * Failure screenshots and the console log go to e2e/out/ (gitignored).
 *
 * Not part of `npm test` and not run in CI: it needs mtg-table (private) and
 * Forge (large) on the machine.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { freePort, healthUrl, launchBrowser as launch, loadPlaywright, rng } from './harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'e2e', 'out');

const env = process.env;
const SEAT_URL = env.SEAT_URL || 'ws://127.0.0.1:8642/ws';
const HEADLESS = !/^(0|false|no)$/i.test(env.HEADLESS ?? '1');
const VIEWPORT = (env.VIEWPORT || 'desktop').toLowerCase();
const MAX_TURNS = Number(env.MAX_TURNS || 40);
const STALL_MS = Number(env.STALL_SECONDS || 90) * 1000;
const NEXT_GAME = !/^(0|false|no)$/i.test(env.NEXT_GAME ?? '1');
const VERBOSE = /^(1|true|yes)$/i.test(env.VERBOSE ?? '');
// Behind a TLS-intercepting proxy, Scryfall (card text and images) fails certificate checks.
const IGNORE_TLS = /^(1|true|yes)$/i.test(env.IGNORE_HTTPS_ERRORS ?? '');
const SEED = Number(env.SEED || Math.floor(Math.random() * 2 ** 31));

if (VIEWPORT !== 'desktop' && VIEWPORT !== 'phone') {
  console.error(`VIEWPORT must be desktop or phone, not ${VIEWPORT}`);
  process.exit(2);
}
const PHONE = VIEWPORT === 'phone';

// ---------------------------------------------------------------------------
// Setup

async function checkEngine() {
  const url = healthUrl(SEAT_URL);
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (res.ok) return;
    throw new Error(`HTTP ${res.status}`);
  } catch (e) {
    console.error(`e2e: the engine is not answering at ${url} (${e.message}).`);
    console.error('Start it in mtg-table with `./scripts/play.sh --engine-only`, or point SEAT_URL at your bridge.');
    process.exit(2);
  }
}

/** Start vite on 127.0.0.1 (the engine's default Origin allowlist has http://127.0.0.1:*). */
async function startVite() {
  const port = await freePort();
  const bin = path.join(ROOT, 'node_modules', '.bin', 'vite');
  const child = spawn(bin, ['--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...env, BROWSER: 'none' },
  });
  let out = '';
  child.stdout.on('data', (d) => (out += d));
  child.stderr.on('data', (d) => (out += d));
  const url = `http://127.0.0.1:${port}/`;
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) break;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (res.ok) return { url, stop: () => child.kill('SIGTERM') };
    } catch {
      /* not yet */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  child.kill('SIGTERM');
  console.error(`e2e: vite did not start on ${url}:\n${out}`);
  process.exit(2);
}

// ---------------------------------------------------------------------------
// The bot

class Fail extends Error {}

async function main() {
  const pw = await loadPlaywright();
  await checkEngine();
  const vite = env.APP_URL ? null : await startVite();
  const appUrl = env.APP_URL || vite.url;
  const u = new URL(appUrl);
  u.searchParams.set('seat', SEAT_URL);
  u.searchParams.set('play', '1');

  // Ctrl-C (or a CI timeout) must not leave vite behind.
  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.on(sig, () => {
      vite?.stop();
      process.exit(130);
    });
  }
  const browser = await launch(pw, { headless: HEADLESS });
  const context = await browser.newContext(
    PHONE
      ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, ignoreHTTPSErrors: IGNORE_TLS }
      : { viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: IGNORE_TLS },
  );
  const page = await context.newPage();
  const random = rng(SEED);
  const consoleLog = [];
  const errors = [];
  const appOrigin = new URL(appUrl).origin;
  page.on('console', (m) => {
    const line = `[${m.type()}] ${m.text()}`;
    consoleLog.push(line);
    if (m.type() !== 'error') return;
    // Card images and text come from Scryfall; an offline machine is not an app bug.
    const where = m.location()?.url ?? '';
    if (/Failed to load resource/i.test(m.text()) && where && !where.startsWith(appOrigin)) return;
    errors.push(`console error: ${m.text()}${where ? ` (${where})` : ''}`);
  });
  page.on('pageerror', (e) => errors.push(`page error: ${e.message}`));

  const tag = `${new Date().toISOString().replace(/[:.]/g, '-')}-${VIEWPORT}`;
  const log = (...a) => console.log(`[e2e ${VIEWPORT}]`, ...a);
  log(`app ${u}  seed ${SEED}  headless ${HEADLESS}`);

  let result = 1;
  try {
    await page.goto(u.toString());
    result = await play(page, { random, errors, log });
  } catch (e) {
    mkdirSync(OUT, { recursive: true });
    const shot = path.join(OUT, `${tag}.png`);
    await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
    writeFileSync(path.join(OUT, `${tag}.console.txt`), consoleLog.join('\n') + '\n');
    console.error(`[e2e ${VIEWPORT}] FAIL: ${e instanceof Fail ? e.message : e.stack}`);
    console.error(`[e2e ${VIEWPORT}] screenshot ${shot}`);
    result = 1;
  } finally {
    await browser.close().catch(() => {});
    vite?.stop();
  }
  process.exit(result);
}

/** What changes when the game moves: everything on screen but transient notices. */
async function signature(page) {
  return page.evaluate(() => {
    const parts = [];
    for (const sel of ['.game', '.ask-layer', '.ask-peek']) {
      const el = document.querySelector(sel);
      if (!el) continue;
      let t = el.innerText;
      for (const f of el.querySelectorAll('.ab-flash')) t = t.replace(f.innerText, '');
      parts.push(t);
    }
    return parts.join('\n§\n');
  });
}

/** Wait until the screen changes from `before` (the engine answered), or `ms` passes. */
async function settle(page, before, ms = 4000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    await page.waitForTimeout(80);
    if ((await signature(page)) !== before) return true;
  }
  return false;
}

async function visible(loc) {
  return (await loc.count()) > 0 && (await loc.first().isVisible().catch(() => false));
}

async function play(page, { random, errors, log }) {
  const press = (loc) => (PHONE ? loc.tap({ timeout: 5000 }) : loc.click({ timeout: 5000 }));
  const checkErrors = () => {
    if (errors.length) throw new Fail(errors.join('\n'));
  };

  let sig = '';
  let lastChange = Date.now();
  let actedInGame = false; // a game over before we played is a leftover from an earlier run
  let round = 0;
  const tried = new Set(); // `${round}:${cardId}` hand cards already tapped this round
  let targetTries = 0;
  let lastMode = '';
  let steps = 0;

  for (;;) {
    checkErrors();
    const now = await signature(page);
    if (now !== sig) {
      sig = now;
      lastChange = Date.now();
    } else if (Date.now() - lastChange > STALL_MS) {
      throw new Fail(`stalled: nothing changed on screen for ${STALL_MS / 1000}s`);
    }

    // ---- connection
    const connectFail = page.locator('.engine-connect-icon.is-bad');
    if (await visible(connectFail)) {
      const card = await page.locator('.engine-connect-title').locator('..').innerText().catch(() => '');
      throw new Fail(`could not join the table: ${card.replace(/\s+/g, ' ').trim()}`);
    }
    const pill = page.locator('.live-pill');
    if (await visible(page.locator('.live-pill.is-error'))) {
      const why = (await page.locator('.play-banner').first().innerText().catch(() => '')) || (await pill.innerText());
      throw new Fail(`not connected to the engine: ${why.trim()}`);
    }

    // ---- game over
    const over = page.locator('.over-wrap');
    if (await visible(over)) {
      const title = (await over.locator('.over-title').innerText()).trim();
      if (actedInGame) {
        checkErrors();
        log(`game over after round ${round}: ${title} (${steps} actions)`);
        if (NEXT_GAME) await startNextGame(page, over, press, log);
        checkErrors();
        log('PASS');
        return 0;
      }
      // A finished game from an earlier run on this engine: start the next one.
      log(`found a finished game (${title}); starting another`);
      await startNextGame(page, over, press, log);
      continue;
    }

    // ---- round limit
    // textContent: the label is uppercased by CSS.
    const roundText = await page.evaluate(() => document.querySelector('.pstrip[data-round]')?.getAttribute('data-round') ?? document.querySelector('.phase-round')?.textContent ?? '');
    const r = Number(/^\d+$/.test(roundText) ? roundText : /Round (\d+)/i.exec(roundText)?.[1] ?? 0);
    if (r !== round) {
      round = r;
      if (r) log(`round ${r}`);
    }
    if (round > MAX_TURNS) {
      checkErrors();
      log(`MAX_TURNS (${MAX_TURNS}) reached with the game still going (${steps} actions) — PASS (not played to the end)`);
      return 0;
    }

    // ---- a question from Forge (or the opening keep/play-draw dialog)
    const peek = page.locator('.ask-peek');
    if (await visible(peek)) {
      await press(peek);
      continue;
    }
    const dialog = page.locator('.ask-dialog');
    if (await visible(dialog)) {
      const before = sig;
      const title = (await dialog.locator('.ask-title').first().innerText().catch(() => '')).trim().replace(/\s+/g, ' ');
      if (await answerAsk(dialog, press)) {
        steps++;
        actedInGame = actedInGame || round > 0;
        log(`answered: ${title.slice(0, 80)}`);
        await settle(page, before, 6000);
      } else {
        await settle(page, before, 1000);
      }
      continue;
    }

    // ---- the action bar
    const bar = page.locator('.actionbar');
    if (!(await visible(bar))) {
      await settle(page, sig, 1000);
      continue;
    }
    const mode = /\bab-(\w+)/.exec((await bar.getAttribute('class')) ?? '')?.[1] ?? 'other';
    if (mode !== lastMode) {
      targetTries = 0;
      lastMode = mode;
    }
    const ok = bar.locator('[data-engine-button="ok"]');
    const cancel = bar.locator('[data-engine-button="cancel"]');
    const enabled = async (b) => (await b.count()) > 0 && (await b.isEnabled());
    // The button's plain words plus the engine's own label (its sub-line).
    const label = async (b) => ((await b.count()) ? (await b.innerText()).trim().replace(/\s+/g, ' ') : '');
    const before = sig;
    let did = null;

    if (mode === 'waiting') {
      await settle(page, before, 2000);
      continue;
    }

    if (mode === 'main') {
      const card = await playableHandCard(page, round, tried);
      if (card) {
        tried.add(`${round}:${card.id}`);
        await press(card.loc);
        did = `play ${card.name}`;
      } else if (VERBOSE) {
        const hand = await page.locator('.hand-dock-row .tile').count();
        log(`main: nothing outlined as playable (${hand} card(s) in hand)`);
      }
    } else if (mode === 'pay') {
      if (await enabled(ok)) {
        await press(ok);
        did = `pay with ${await label(ok)}`;
      } else if (await enabled(cancel)) {
        await press(cancel);
        did = 'cancel payment';
      }
    } else if (mode === 'attack') {
      // Attack with everything sometimes: the engine's Alpha Strike, then confirm.
      const cl = await label(cancel);
      if (/alpha/i.test(cl) && (await enabled(cancel)) && random() < 0.5) {
        await press(cancel);
        did = 'attack with everything';
        await settle(page, before, 3000);
        if (await enabled(ok)) await press(ok);
      } else if (await enabled(ok)) {
        await press(ok);
        did = /call back/i.test(cl) ? 'confirm attacks' : 'no attack';
      }
    } else if (mode === 'target' || mode === 'discard') {
      targetTries++;
      if (targetTries > 4 && (await enabled(cancel))) {
        await press(cancel);
        did = `give up choosing (${await label(cancel)})`;
      } else if (await enabled(ok)) {
        await press(ok);
        did = await label(ok);
      } else {
        const pick = await targetToPick(page);
        if (pick) {
          await press(pick.loc);
          did = `choose ${pick.name}`;
        } else if (await enabled(cancel)) {
          await press(cancel);
          did = await label(cancel);
        }
      }
    }

    // Otherwise: the bar's primary button.
    if (!did) {
      const primary = bar.locator('[data-primary][data-engine-button]');
      if ((await primary.count()) && (await primary.isEnabled())) {
        const l = (await primary.innerText()).trim().replace(/\s+/g, ' ');
        await press(primary);
        did = `${l} (${mode})`;
      } else if (await enabled(ok)) {
        await press(ok);
        did = `${await label(ok)} (${mode})`;
      }
    }

    if (did) {
      steps++;
      if (round > 0) actedInGame = true;
      log(`${mode}: ${did}`);
      await settle(page, before, 6000);
    } else {
      await settle(page, before, 1500);
    }
  }
}

/**
 * Next game (or New match once the match is over), and wait for it to begin.
 * Leaving the engine in a fresh game keeps it up for the next run: mtg-table
 * ends its session when the client leaves while it waits for `newGame`.
 */
async function startNextGame(page, over, press, log) {
  const next = over.getByRole('button', { name: 'Next game' });
  const fresh = over.getByRole('button', { name: 'New match' });
  await page.waitForFunction(
    () => [...document.querySelectorAll('.over-wrap button')].some((b) => /^(Next game|New match)$/.test(b.textContent.trim()) && !b.disabled),
    null,
    { timeout: 30_000 },
  );
  const btn = (await next.isEnabled()) ? next : fresh;
  log(`starting the next game (${(await btn.innerText()).trim()})`);
  await press(btn);
  await page.waitForFunction(() => !document.querySelector('.over-wrap'), null, { timeout: 60_000 });
}

/** The first hand card the app outlines as playable — lands first. Skips ones already tried this round. */
async function playableHandCard(page, round, tried) {
  const head = page.locator('.hand-dock-head');
  if (await visible(page.locator('.hand-dock.is-collapsed'))) {
    await head.click();
    await page.locator('.hand-dock-row').waitFor({ timeout: 3000 }).catch(() => {});
  }
  const tiles = page.locator('.hand-dock-row .tile.is-hint');
  const n = await tiles.count();
  const lands = [];
  const spells = [];
  for (let i = 0; i < n; i++) {
    const t = tiles.nth(i);
    const id = await t.getAttribute('data-card-id');
    if (tried.has(`${round}:${id}`)) continue;
    const type = (await t.locator('.tile-type').innerText().catch(() => '')).trim();
    const name = (await t.locator('.tile-name').innerText().catch(() => '')).trim();
    (/\bland\b/i.test(type) ? lands : spells).push({ loc: t, id, name });
  }
  return lands[0] ?? spells[0] ?? null;
}

/** A card or player the engine outlined: the opponent's side first. */
async function targetToPick(page) {
  const sets = [
    page.locator('.player-top [data-mark="select"]'),
    page.locator('.avatar.is-select.avatar-opp'),
    page.locator('[data-mark="select"]'),
    page.locator('.avatar.is-select'),
    page.locator('.hand-dock-row [data-mark="act"]'),
  ];
  for (const s of sets) {
    const n = await s.count();
    for (let i = 0; i < n; i++) {
      const loc = s.nth(i);
      if (!(await loc.isVisible().catch(() => false)) && !(await loc.isEnabled().catch(() => false))) continue;
      const name = ((await loc.getAttribute('aria-label')) || (await loc.innerText().catch(() => '')) || '').split('\n')[0].trim();
      return { loc, name };
    }
  }
  return null;
}

/** Answer whatever the dialog asks with its default: the primary button, the default option, else the first one. */
async function answerAsk(dialog, press) {
  const primary = dialog.locator('.ask-actions .btn-primary');
  if ((await primary.count()) && (await primary.first().isEnabled())) {
    await press(primary.first());
    return true;
  }
  const def = dialog.locator('.ask-opt.is-default:not([disabled])');
  if (await def.count()) {
    await press(def.first());
    return true;
  }
  // Pick options until the primary button enables (or an option sends by itself).
  const opts = dialog.locator('.ask-opt:not([disabled])');
  const n = await opts.count();
  for (let i = 0; i < n; i++) {
    const o = opts.nth(i);
    if (!(await o.isVisible().catch(() => false))) continue;
    if ((await o.getAttribute('class'))?.includes('is-on')) continue;
    await press(o);
    // Either the option answered by itself (the dialog goes) or it became the draft (Confirm enables).
    await dialog
      .page()
      .waitForFunction(
        () => {
          const d = document.querySelector('.ask-dialog');
          return !d || !!d.querySelector('.ask-actions .btn-primary:not([disabled])') || !!d.querySelector('.ask-opt.is-on');
        },
        null,
        { timeout: 1500 },
      )
      .catch(() => {});
    if (!(await dialog.isVisible().catch(() => false))) return true;
    if ((await primary.count()) && (await primary.first().isEnabled())) {
      await press(primary.first());
      return true;
    }
  }
  const skip = dialog.locator('.ask-actions .btn-quiet:not([disabled])');
  if (await skip.count()) {
    await press(skip.first());
    return true;
  }
  return false;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

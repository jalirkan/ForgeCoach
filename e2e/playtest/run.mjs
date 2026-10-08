#!/usr/bin/env node
/*
 * ForgeCoach — e2e/playtest/run.mjs
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The full-game playtest: complete games played through the real UI by a
 * monkey (monkey.mjs) that reads what the engine offers from the protocol
 * stream and clicks the board's controls for it — never a frame of its own.
 *
 *   npm run playtest -- --mode fake  --games 3 --seed 1        # CI: the fake engine
 *   npm run playtest -- --mode solo  --games 10 --seed 7       # vs real Forge (mtg-table's play.sh)
 *   npm run playtest -- --mode table --games 2 --seed 7        # two browsers, best of three each
 *
 * Options:
 *   --mode fake|solo|table   fake: e2e/fake-engine.mjs; solo: one person vs Forge through the
 *                            match launcher (POST /match); table: two people through mtg-table's
 *                            draft room (D400–D407), a best of three with sideboarding
 *   --games N                games (fake, solo) or best-of-threes (table)
 *   --seed N                 every choice replays from it (decks, the monkey, the draft)
 *   --decks SPEC             solo: cube | cube:<id> | dck | dck:<name>, comma-separated
 *                            (default cube,dck); table: the room's cube, cube:<id>
 *   --turn-cap N             rounds before a game counts as stuck in a loop (default 40: a 40-card
 *                            deck runs out by about round 34, so a game past 40 is not ending)
 *   --coach off|fake|real    fake: a helper that answers at once (the panel and auto-coach
 *                            cadence are checked); real: the PC's helper (latency recorded)
 *   --reload 0|1             reload one seat mid-game and check the log and the seat (default 1)
 *   --out DIR                the report (default e2e/out/playtest-<time>)
 *   --game-minutes N         wall clock before a game is abandoned (default 75)
 *   --headless 0             watch it
 *   --viewport desktop|phone|mixed   the board's size: a desktop window, a phone (390×844, touch),
 *                            or mixed (solo: every other game on a phone; table: the friend on a phone)
 *   --max-shots N            screenshots in all (default 300; each finding's first ones)
 *   --port-base N            the engine on N, its helper on N+1, the draft room on N+2, the
 *                            table on N+4 (default 8642, play.sh's own; the PC job uses another
 *                            so it never meets a game Justin is playing)
 *
 * Environment: PLAYTEST_DEBUG_CLICKS=1 prints every click the page receives (what the monkey hit);
 * PLAYTEST_COACH_MS=N makes the fake coach take N ms per answer (default 50: a slow coach checks
 * that the last plan stays in view while the next is written);
 * MTG_TABLE (default ../mtg-table), FORGE_JAR (play.sh's), FORGE_RES (Forge's
 * res/ for the card scripts; default: beside FORGE_JAR), SITE_DIR (a built site to serve
 * instead of building one).
 *
 * Output: <out>/report.json, <out>/report.md, <out>/shots/*.png. Exit 1 when any game has a
 * finding, 2 when it could not start.
 */
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { gzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchBrowser, loadPlaywright, rng, waitHttp } from '../harness.mjs';
import { startFakeEngine } from '../fake-engine.mjs';
import { SeatTap } from './tap.mjs';
import { Monkey } from './monkey.mjs';
import { loadScripts } from './scripts.mjs';
import { deckNames, deckPlan, CUBES } from './decks.mjs';
import { combatAgrees, hiddenFromOther, hiddenLeaks, logCovers, logTurns, stackAgrees, streamTurns } from './checks.mjs';
import { startFakeHelper } from './fakehelper.mjs';
import { writeReport } from './report.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const FAKE_COACH_MS = Number(process.env.PLAYTEST_COACH_MS) || 50;

// ---------------------------------------------------------------------------
// Options

function parseArgs(argv) {
  const o = { mode: 'fake', games: 3, seed: 1, decks: null, turnCap: 40, coach: 'off', reload: 1, out: null, headless: true, stallS: 150, gameMinutes: 75, aiProfile: null, portBase: 8642, maxShots: 300, viewport: 'desktop' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const v = () => argv[++i];
    if (a === '--mode') o.mode = v();
    else if (a === '--games') o.games = Number(v());
    else if (a === '--seed') o.seed = Number(v());
    else if (a === '--decks') o.decks = v();
    else if (a === '--turn-cap') o.turnCap = Number(v());
    else if (a === '--coach') o.coach = v();
    else if (a === '--reload') o.reload = Number(v());
    else if (a === '--out') o.out = v();
    else if (a === '--headless') o.headless = !/^(0|false|no)$/i.test(v());
    else if (a === '--stall-s') o.stallS = Number(v());
    else if (a === '--game-minutes') o.gameMinutes = Number(v());
    else if (a === '--ai-profile') o.aiProfile = v();
    else if (a === '--port-base') o.portBase = Number(v());
    else if (a === '--max-shots') o.maxShots = Number(v());
    else if (a === '--viewport') o.viewport = v();
    else if (a === '--help' || a === '-h') {
      console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0]);
      process.exit(0);
    } else throw new Error(`unknown option ${a}`);
  }
  if (!['fake', 'solo', 'table'].includes(o.mode)) throw new Error(`--mode ${o.mode}: fake, solo or table`);
  if (!['off', 'fake', 'real'].includes(o.coach)) throw new Error(`--coach ${o.coach}: off, fake or real`);
  if (!['desktop', 'phone', 'mixed'].includes(o.viewport)) throw new Error(`--viewport ${o.viewport}: desktop, phone or mixed`);
  return o;
}

const opts = parseArgs(process.argv.slice(2));
const env = process.env;
const MTG = path.resolve(env.MTG_TABLE ?? path.join(ROOT, '..', 'mtg-table'));
const OUT = path.resolve(opts.out ?? path.join(ROOT, 'e2e', 'out', `playtest-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`));
const SHOTS = path.join(OUT, 'shots');
const T0 = Date.now();
const log = (s) => console.log(`[playtest ${((Date.now() - T0) / 1000).toFixed(0)}s] ${s}`);

const children = [];
const cleanups = [];

// ---------------------------------------------------------------------------
// The site and the engine

async function serveSite(dir) {
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.gz': 'application/gzip', '.md': 'text/markdown' };
  const srv = createServer((req, res) => {
    const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    let f = path.join(dir, p.endsWith('/') ? `${p}index.html` : p);
    if (!f.startsWith(dir) || !existsSync(f) || !statSync(f).isFile()) f = path.join(dir, 'index.html');
    res.writeHead(200, { 'Content-Type': types[path.extname(f)] ?? 'application/octet-stream' });
    res.end(readFileSync(f));
  });
  // A Vite port (play/seatUrl.ts DEV_PORTS): a page there is not taken for one the bridge served.
  for (const port of [4173, 5174, 5173]) {
    const ok = await new Promise((r) => {
      srv.once('error', () => r(false));
      srv.listen(port, '127.0.0.1', () => r(true));
    });
    if (ok) {
      cleanups.push(() => srv.close());
      return `http://127.0.0.1:${port}/`;
    }
  }
  throw new Error('no preview port (4173, 5174, 5173) is free');
}

function buildSite(scratch) {
  if (env.SITE_DIR) return path.resolve(env.SITE_DIR);
  const site = path.join(scratch, 'site');
  log('building ForgeCoach (FORGECOACH_BASE=./)');
  execFileSync(path.join(ROOT, 'node_modules', '.bin', 'vite'), ['build', '--outDir', site, '--emptyOutDir'], { cwd: ROOT, env: { ...env, FORGECOACH_BASE: './' }, stdio: ['ignore', 'ignore', 'inherit'] });
  return site;
}

const PORTS = { engine: opts.portBase, helper: opts.portBase + 1, room: opts.portBase + 2, table: opts.portBase + 4 };

async function startPlaySh(extra) {
  // The playtest's games are not the owner's: no human test set (D369), no automatic engine review (D385).
  const playSh = readFileSync(path.join(MTG, 'scripts', 'play.sh'), 'utf8');
  const own = ['--port', String(PORTS.engine), '--coach-port', String(PORTS.helper), ...(/^\s*--no-auto-review\)\s/m.test(playSh) ? ['--no-auto-review'] : [])];
  log(`starting ${MTG}/scripts/play.sh --engine-only ${[...own, ...extra].join(' ')}`);
  const p = spawn('./scripts/play.sh', ['--engine-only', '--no-human-collect', '--no-eval', '--no-open', ...own, ...extra], { cwd: MTG, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  children.push(p);
  let out = '';
  p.stdout.on('data', (d) => (out += d));
  p.stderr.on('data', (d) => (out += d));
  for (let i = 0; i < 6000 && !/Engine ready/.test(out); i++) {
    if (p.exitCode !== null) break;
    await sleep(100);
  }
  if (!/Engine ready/.test(out)) throw new Error(`play.sh did not get ready:\n${out.slice(-3000)}`);
  return { proc: p, out: () => out };
}

// ---------------------------------------------------------------------------
// Findings and screenshots

const report = { started: new Date().toISOString(), options: opts, games: [], matches: [], env: {} };
let shotN = 0;

function makeFinding(game, seat) {
  return async (rec) => {
    const tap = seat.tap;
    const f = {
      game: game.id,
      seat: seat.label,
      kind: rec.kind,
      what: rec.what,
      ...(rec.why ? { why: rec.why } : {}),
      frame: tap.gameFrames().length,
      seq: tap.frames.at(-1)?.seq ?? null,
      turn: tap.state?.turn ?? null,
      phase: tap.state?.phase ?? null,
      prompt: rec.input?.prompt ?? tap.input?.prompt ?? null,
      ask: rec.ask ? { kind: rec.ask.kind, askId: rec.ask.askId, prompt: rec.ask.prompt ?? rec.ask.title ?? null, options: (rec.ask.options ?? rec.ask.targets ?? rec.ask.cards ?? []).slice(0, 12).map((o) => o.label) } : null,
      card: rec.card ? { id: rec.card.id, name: rec.card.name, zone: rec.card.zone, attachedToId: rec.card.attachedToId ?? null } : rec.cardId ? { id: rec.cardId } : null,
      ...(rec.ui ? { ui: rec.ui } : {}),
      at: Math.round((Date.now() - game.t0) / 1000),
      shot: null,
    };
    if (game.shots < 40 && shotN < opts.maxShots) {
      game.shots++;
      const file = `g${game.id}-${seat.label}-${++shotN}-${rec.kind}.png`;
      try {
        await seat.page.screenshot({ path: path.join(SHOTS, file) });
        f.shot = `shots/${file}`;
      } catch {
        /* the page is gone */
      }
    }
    game.findings.push(f);
    log(`  FINDING ${seat.label}: ${f.kind} — ${f.what}${f.why ? ` (${f.why})` : ''}`);
  };
}

function watchPage(game, seat) {
  const finding = makeFinding(game, seat);
  const seen = new Set();
  seat.page.on('pageerror', (e) => {
    const k = `pe|${e.message}`;
    if (seen.has(k)) return;
    seen.add(k);
    void finding({ kind: 'page-error', what: e.message.slice(0, 300) });
  });
  seat.page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const text = m.text();
    // Card data and fonts are answered 404 / refused on purpose (no network in the playtest).
    if (/Failed to load resource|net::ERR_|scryfall/i.test(text)) return;
    const k = `ce|${text.slice(0, 120)}`;
    if (seen.has(k)) return;
    seen.add(k);
    void finding({ kind: 'console-error', what: text.slice(0, 300) });
  });
  return finding;
}

// ---------------------------------------------------------------------------
// Browser contexts

let browser = null;

const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };

/** Which seats play on a phone: --viewport phone (all), mixed (the friend; every other solo game). */
function phoneFor(label, i = 0) {
  if (opts.viewport === 'phone') return true;
  if (opts.viewport !== 'mixed') return false;
  return label === 'friend' || (label === 'solo' && i % 2 === 1);
}

async function newSeatPage(label, appOrigin, phone = false) {
  const ctx = await browser.newContext(phone ? PHONE : { viewport: { width: 1366, height: 900 } });
  await ctx.route('**/*', (route) => {
    const u = new URL(route.request().url());
    if (u.hostname === '127.0.0.1' || u.hostname === 'localhost') return route.continue();
    if (u.hostname === 'fonts.googleapis.com') return route.fulfill({ status: 200, contentType: 'text/css', body: '' });
    if (/scryfall\.(com|io)$/.test(u.hostname)) return route.fulfill({ status: 404, contentType: 'application/json', body: '{"object":"error","code":"not_found","status":404,"details":"playtest"}' });
    return route.abort('connectionrefused');
  });
  const page = await ctx.newPage();
  if (env.PLAYTEST_DEBUG_CLICKS) {
    await page.addInitScript(() => {
      document.addEventListener('click', (e) => console.log(`[click] ${(e.target.closest('button,[role=button]') ?? e.target).outerHTML.slice(0, 140)}`), true);
    });
    page.on('console', (m) => m.text().startsWith('[click]') && console.log(`  ${label} ${new Date().toISOString().slice(11, 23)} ${m.text()}`));
  }
  const tap = new SeatTap(label);
  tap.attach(page);
  const coach = [];
  page.on('request', (r) => {
    // After `over` it is the film room's question about a turning point, not auto-coach's.
    if (/\/coach$/.test(new URL(r.url()).pathname) && r.method() === 'POST') coach.push({ start: Date.now(), end: null, round: tap.state?.round ?? null, turn: tap.state?.turn ?? null, phase: tap.state?.phase ?? null, mine: tap.state ? tap.state.activePlayer === tap.seat : null, sockets: tap.sockets, over: !!tap.over, req: r });
  });
  page.on('requestfinished', (r) => {
    const c = coach.find((x) => x.req === r);
    if (c) c.end = Date.now();
  });
  page.on('requestfailed', (r) => {
    const c = coach.find((x) => x.req === r);
    if (c) {
      c.end = Date.now();
      c.failed = r.failure()?.errorText ?? 'failed';
    }
  });
  return { label, ctx, page, tap, coach, appOrigin, phone };
}

// ---------------------------------------------------------------------------
// One game, any number of seats

/**
 * Plays until `over` on every seat (or the game is abandoned). Each seat's
 * monkey answers whenever the engine waits on it; the checks run between
 * decisions; one seat reloads once mid-game.
 */
async function playGame(game, seats, { scripts, askModel, rand, hiddenFor, allowedFor, reloadSeat, onReload }) {
  const deadline = Date.now() + opts.gameMinutes * 60_000;
  let abandoned = null;
  const reloadAtTurn = 5 + Math.floor(rand() * 4);
  let reloaded = !opts.reload;
  for (const s of seats) {
    s.finding = s.finding ?? watchPage(game, s);
    s.monkey = new Monkey({ page: s.page, tap: s.tap, rand, scripts, askModel, label: s.label, finding: s.finding });
  }
  const anyOver = () => seats.some((s) => s.tap.over);
  const allOver = () => seats.every((s) => s.tap.over);
  let capped = false;

  const coachWatch = { blanks: 0, seenAnswer: false, samples: 0 };

  const seatLoop = async (s) => {
    let stuck = 0;
    let lastCheck = 0;
    let lastLeak = 0;
    while (!s.tap.over && !abandoned) {
      if (Date.now() > deadline) {
        abandoned = 'time';
        break;
      }
      // The turn cap: a game that never ends is a finding; leave it through the board.
      const round = s.tap.state?.round ?? Math.ceil((s.tap.state?.turn ?? 0) / 2);
      if (round > opts.turnCap && !capped) {
        capped = true;
        await s.finding({ kind: 'turn-cap', what: `no end after ${opts.turnCap} rounds (turn ${s.tap.state?.turn})` });
        await s.monkey.concede();
        break;
      }
      // One reload of one seat mid-game: the log keeps its turns and the seat comes back.
      if (!reloaded && s === reloadSeat && (s.tap.state?.turn ?? 0) >= reloadAtTurn && s.tap.deciding() && !s.tap.ask) {
        reloaded = true;
        await reloadCheck(s, onReload);
        continue;
      }
      // Auto-coach on through its switch once the opening dialog is gone (it covers the panel).
      if (opts.coach !== 'off' && !s.coachTried && (s.tap.state?.turn ?? 0) >= 1 && !s.tap.ask && !(await s.page.locator('.ask-layer').count())) {
        s.coachTried = true;
        await coachOn(s);
      }
      if (opts.coach !== 'off' && s.coachOn) coachSample(s, coachWatch);
      if (!s.tap.deciding()) {
        await s.tap.next(400);
        continue;
      }
      // Let the burst land before reading the board.
      await sleep(150);
      // With the real coach, think like a person: wait for the question in flight to be answered
      // (up to 2 min), so its latency is an answer's, not the time until the monkey moved on.
      if (opts.coach === 'real' && s.coachOn) {
        await sleep(400);
        const t0 = Date.now();
        while (s.coach.some((q) => q.end === null) && Date.now() - t0 < 120_000) await sleep(250);
      }
      if (!s.tap.deciding()) continue;
      let r;
      try {
        r = await s.monkey.decide();
      } catch (e) {
        if (s.tap.over || /Target page, context or browser has been closed/.test(e.message)) break;
        await s.finding({ kind: 'harness-error', what: String(e.stack).split('\n').slice(0, 3).join(' | ') });
        r = 'stuck';
      }
      if (r === 'stuck') {
        stuck++;
        if (stuck >= 4) {
          await s.finding({ kind: 'stuck', what: `the engine waits on this seat and the board offers nothing that moves it (${s.tap.ask ? `ask ${s.tap.ask.kind}` : `"${(s.tap.input?.prompt ?? '').split('\n')[0]}"`})` });
          if (!(await s.monkey.concede())) abandoned = 'stuck';
          break;
        }
        await sleep(1500);
      } else stuck = 0;
      // The board against the frames, when the stream is quiet.
      if (s.monkey.decisions - lastCheck >= 3 && s.tap.state) {
        lastCheck = s.monkey.decisions;
        for (const p of await stackAgrees(s.page, s.tap)) await s.finding({ kind: 'stack-mismatch', what: p });
        for (const p of await combatAgrees(s.page, s.tap)) await s.finding({ kind: 'combat-badge-mismatch', what: p });
      }
      if (s.monkey.decisions - lastLeak >= 12) {
        lastLeak = s.monkey.decisions;
        for (const p of await hiddenLeaks(s.page, hiddenFor(s), allowedFor(s))) await s.finding({ kind: 'hidden-info', what: p });
      }
    }
  };

  // Progress watchdog: no frame anywhere for stallS while nobody is deciding.
  const watchdog = (async () => {
    while (!allOver() && !abandoned) {
      await sleep(2000);
      const last = Math.max(...seats.map((s) => s.tap.lastFrameAt));
      if (Date.now() - last > opts.stallS * 1000 && !seats.some((s) => s.tap.deciding())) {
        await seats[0].finding({ kind: 'no-progress', what: `no frame for ${opts.stallS} s and the engine waits on no seat (turn ${seats[0].tap.state?.turn}, ${seats[0].tap.state?.phase})` });
        if (!(await seats[0].monkey.concede())) abandoned = 'no-progress';
        break;
      }
    }
  })();

  await Promise.all(seats.map((s) => seatLoop(s)));
  // A seat that conceded ends the game for both: wait for the other's over.
  if (!abandoned) await Promise.all(seats.map((s) => s.tap.until(() => !!s.tap.over, 30_000)));
  abandoned = abandoned ?? (allOver() ? null : 'no over');
  if (abandoned) await seats[0].finding({ kind: 'abandoned', what: `the game was left without an end (${abandoned}) at turn ${seats[0].tap.state?.turn ?? '?'}` });
  await watchdog.catch(() => {});

  // The board's own word on the result.
  for (const s of seats) {
    if (!s.tap.over) continue;
    const won = s.tap.over.winner === s.tap.seat;
    const draw = s.tap.over.winner === null;
    const want = draw ? /draw/i : won ? /You won/ : /You lost/;
    const ok = await s.page.getByText(want).first().waitFor({ timeout: 20_000 }).then(() => true).catch(() => false);
    if (!ok) await s.finding({ kind: 'over-card', what: `the game ended (${draw ? 'draw' : won ? 'won' : 'lost'}, ${s.tap.over.reason}) and the board does not say so` });
    for (const p of await hiddenLeaks(s.page, hiddenFor(s), allowedFor(s))) await s.finding({ kind: 'hidden-info', what: `at the end: ${p}` });
  }
  const s0 = seats[0];
  game.result = abandoned ? `abandoned (${abandoned})` : s0.tap.over.winner === null ? 'draw' : s0.tap.over.winner === s0.tap.seat ? 'win' : 'loss';
  game.reason = s0.tap.over?.reason ?? null;
  game.capped = capped;
  game.turns = Math.max(...seats.map((s) => s.tap.state?.turn ?? 0));
  game.rounds = Math.max(...seats.map((s) => s.tap.state?.round ?? 0));
  game.decisions = Object.fromEntries(seats.map((s) => [s.label, s.monkey.decisions]));
  game.clicks = Object.fromEntries(seats.map((s) => [s.label, s.monkey.clicks]));
  game.stats = Object.fromEntries(seats.map((s) => [s.label, s.monkey.stats]));
  game.frames = Object.fromEntries(seats.map((s) => [s.label, s.tap.gameFrames().length]));
  // The steps: every decision, what the monkey clicked, what came of it (to replay a finding by hand).
  for (const s of seats) {
    const file = `trace-g${game.id}-${s.label}.jsonl`;
    writeFileSync(path.join(OUT, file), s.monkey.trace.map((x) => JSON.stringify(x)).join('\n') + '\n');
    (game.traces ??= {})[s.label] = file;
    // The seat's own frames, both directions, as the socket carried them (a finding's "frame N" indexes the s2c ones).
    const frames = `frames-g${game.id}-${s.label}.jsonl.gz`;
    const lines = [...s.tap.gameFrames().map((f) => ({ ...f, dir: 's2c' })), ...s.tap.sent.filter((f) => f.at >= game.t0).map((f) => ({ ...f, dir: 'c2s' }))].sort((a, b) => a.at - b.at);
    writeFileSync(path.join(OUT, frames), gzipSync(lines.map((x) => JSON.stringify(x)).join('\n') + '\n'));
    (game.frameLogs ??= {})[s.label] = frames;
  }
  if (opts.coach !== 'off') game.coach = coachSummary(game, seats, coachWatch);
  return game;
}

/** Reload a seat's page: it comes back to the same seat, and its Game Log keeps every turn. */
async function reloadCheck(s, onReload) {
  const before = await logTurns(s.page);
  const turns = streamTurns(s.tap);
  for (const p of logCovers(before, turns)) await s.finding({ kind: 'log-incomplete', what: `before the reload: ${p}` });
  const sockets = s.tap.sockets;
  await s.page.reload();
  if (onReload) await onReload(s);
  const back = await s.tap.until(() => s.tap.sockets > sockets && !!s.tap.state, 60_000);
  if (!back) {
    await s.finding({ kind: 'reload-no-seat', what: 'after a reload the page did not take its seat again within 60 s' });
    return;
  }
  await s.page.locator('.live-pill.is-open').waitFor({ timeout: 20_000 }).catch(() => {});
  await sleep(1500);
  const after = await logTurns(s.page);
  for (const p of logCovers(after, streamTurns(s.tap))) await s.finding({ kind: 'log-incomplete', what: `after the reload: ${p}` });
  if (before && after && before.turns.some((t) => !after.turns.includes(t))) {
    await s.finding({ kind: 'log-incomplete', what: `the reload lost turns: ${before.turns.join(' ')} → ${after.turns.join(' ')}` });
  }
  s.reloaded = { before: before?.turns ?? null, after: after?.turns ?? null };
  log(`  ${s.label} reloaded at turn ${s.tap.state?.turn}: log ${before?.turns.length ?? '?'} → ${after?.turns.length ?? '?'} turns`);
}

// ---------------------------------------------------------------------------
// The coach (optional)

async function coachOn(s) {
  // A phone's coach is a sheet over the board; its cadence is the same code, checked on a desktop seat.
  if (s.phone) return;
  // The panel's own switch, as a person would turn it on.
  const sw = s.page.locator('.play-coach .switch input[type="checkbox"]').first();
  try {
    await sw.waitFor({ state: 'attached', timeout: 20_000 });
    if (!(await sw.isChecked())) await s.page.locator('.play-coach .switch').first().click({ timeout: 5000 });
    s.coachOn = (await sw.isChecked()) === true;
  } catch (e) {
    await s.finding({ kind: 'coach', what: `could not turn auto-coach on: ${String(e.message).split('\n')[0]}` });
  }
}

/** During the opponent's turn the panel keeps the advice it showed (never blank). */
function coachSample(s, w) {
  const now = Date.now();
  if (now - (w.last ?? 0) < 1000) return;
  w.last = now;
  const st = s.tap.state;
  if (!st) return;
  void s.page
    .evaluate(() => document.querySelector('.play-coach')?.innerText ?? '')
    .then((text) => {
      const has = /keep your mana up/i.test(text) || (opts.coach === 'real' && /\S{40,}/.test(text.replace(/\s+/g, '')));
      if (has) {
        w.seenAnswer = true;
        w.answerSockets = s.tap.sockets;
      }
      if (st.activePlayer !== s.tap.seat && w.seenAnswer) {
        w.samples++;
        // Advice never disappears: while a new plan is being written the last one stays in view
        // (PlayCoach's stand-in), so a question in flight is no excuse for an empty panel (J107: 6×).
        if (!has) {
          w.blanks++;
          // A reload since the last advice is its own case: the page's advice lives in memory.
          const reloaded = s.tap.sockets > (w.answerSockets ?? 0);
          if (w.blanks === 1 || (reloaded && !w.toldReload)) {
            if (reloaded) w.toldReload = true;
            void s.finding({ kind: 'coach-blank', what: `during the opponent's turn ${st.turn} the coach panel shows no advice (it had answered before${reloaded ? '; the page was reloaded since' : ''})` });
          }
        }
      }
    })
    .catch(() => {});
}

let coachLogSeen = 0;

function coachSummary(game, seats, w) {
  const s = seats[0];
  const all = s.coach.filter((c) => c.start >= game.t0);
  const qs = all.filter((c) => !c.over);
  const perRound = {};
  for (const q of qs) perRound[q.round ?? 0] = (perRound[q.round ?? 0] ?? 0) + 1;
  // Auto-coach asks one plan per turn cycle: per planned turn, one question (the fake helper says which
  // turn each plans); a question about a moment is never auto-coach's (the monkey never asks).
  const typeOfQ = (q) => (s.helperAsks ?? []).find((a) => Math.abs(a.at - q.start) < 1500)?.type ?? null;
  const byPlan = {};
  for (const q of qs) {
    const t = /^plan my turn (\d+)/.exec(typeOfQ(q) ?? '')?.[1];
    const k = t ? `plan ${t}` : `other ${typeOfQ(q) ?? '?'}`;
    (byPlan[k] ??= []).push(q);
  }
  const over = Object.entries(byPlan).filter(([k, l]) => l.length > 1 || k.startsWith('other'));
  if (opts.coach === 'fake' && over.length) {
    const words = (l) => l.map((q) => `T${q.turn} ${q.phase ?? '?'}${q.sockets > 1 ? ' after a reload' : ''}`).join(' + ');
    game.findings.push({ game: game.id, seat: s.label, kind: 'coach-cadence', what: `auto-coach asked more than once per turn cycle: ${over.map(([k, l]) => `${k} ×${l.length} (${words(l)})`).join(', ')}`, shot: null });
  }
  let lat = qs.filter((q) => q.end && !q.failed).map((q) => q.end - q.start);
  let source = 'page';
  let firstText = [];
  let promptKB = [];
  // The real helper's own log says how long each answer took ("done …; 24449 ms"); the page cannot always
  // tell (a streamed answer the board stops reading after its end shows as aborted).
  if (opts.coach === 'real') {
    const file = path.join(MTG, 'var', 'play', 'coach.log');
    const lines = existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter((l) => /POST \/coach /.test(l)) : [];
    const fresh = lines.slice(coachLogSeen);
    coachLogSeen = lines.length;
    const done = fresh.filter((l) => /-> 200 \(done /.test(l));
    lat = done.map((l) => /(\d+) ms\)\s*$/.exec(l)?.[1]).filter(Boolean).map(Number);
    // mtg-table D410's timing line: the prompt's size and the first word's wait, per answer.
    firstText = done.map((l) => /first text (\d+) ms/.exec(l)?.[1]).filter(Boolean).map(Number);
    promptKB = done.map((l) => /([\d.]+) KB prompt/.exec(l)?.[1]).filter(Boolean).map(Number);
    source = 'helper log';
  }
  const list = qs.map((q) => ({ at: Math.round((q.start - game.t0) / 100) / 10, ms: q.end ? q.end - q.start : null, turn: q.turn, phase: q.phase, stopped: q.failed ?? null, type: (s.helperAsks ?? []).find((a) => Math.abs(a.at - q.start) < 1500)?.type ?? null }));
  return { questions: qs.length, afterOver: all.length - qs.length, list, answered: lat.length, latencySource: source, ...(firstText.length ? { firstTextMs: firstText } : {}), ...(promptKB.length ? { promptKB } : {}), perRound, latencyMs: lat, stopped: qs.filter((q) => q.failed).length, blankSamples: w.blanks, oppTurnSamples: w.samples };
}

// ---------------------------------------------------------------------------
// Modes

async function loadAskModel() {
  return import(path.join(ROOT, 'src/ui/play/askModel.ts'));
}

function scriptsIndex() {
  // Forge's res/: FORGE_RES, else beside FORGE_JAR, else mtg-table's forge-home (tools/make-forge-home.sh links it there).
  const res = env.FORGE_RES ?? (env.FORGE_JAR ? path.join(path.dirname(env.FORGE_JAR), 'res') : path.join(MTG, 'forge-home', 'res'));
  const zip = res ? path.join(res, 'cardsfolder', 'cardsfolder.zip') : null;
  const m = loadScripts({ zip, cache: path.join(OUT, 'card-scripts.json') });
  report.env.cardScripts = m.size;
  return m;
}

async function runFake(app) {
  const scripts = scriptsIndex();
  const askModel = await loadAskModel();
  const helper = opts.coach === 'fake' ? await startFakeHelper({ answerMs: FAKE_COACH_MS }) : null;
  if (helper) cleanups.push(() => helper.close());
  for (let i = 0; i < opts.games; i++) {
    const rand = rng(opts.seed * 7919 + i);
    // Every other game an engine with mtg-table M61 (`state.playable`), its graveyard holding Cauldron Familiar.
    const m61 = i % 2 === 1;
    // The others: Blood Artist out, so a creature dying asks "Select target player" with both buttons off (J107's hang).
    const engine = await startFakeEngine({ dropMode: 'default', ...(m61 ? { playable: true, scene: 'graveyard' } : { deathTrigger: true }) });
    const game = { id: i + 1, mode: 'fake', seed: opts.seed, decks: { mine: `fake (Mountains and goblins${m61 ? '; M61, Cauldron Familiar in the graveyard' : '; Blood Artist out'})`, theirs: 'fake' }, findings: [], shots: 0, t0: Date.now() };
    const s = await newSeatPage('solo', app, phoneFor('solo', i));
    game.viewport = s.phone ? 'phone' : 'desktop';
    if (helper) s.helperAsks = helper.asks;
    const url = `${app}?play=1&seat=${encodeURIComponent(engine.seatUrl)}${helper ? `&coach=${encodeURIComponent(helper.url)}` : ''}`;
    s.finding = watchPage(game, s);
    await s.page.goto(url);
    log(`game ${game.id}: fake engine`);
    await playGame(game, [s], {
      scripts,
      askModel,
      rand,
      // The fake AI's deck (fake-engine.mjs AI_LIBRARY): the one card not in yours is Goblin Guide.
      hiddenFor: () => new Set(['Goblin Guide']),
      allowedFor: (x) => new Set([...x.tap.seen, ...x.tap.typeWords]),
      reloadSeat: s,
    });
    report.games.push(stripGame(game));
    log(`game ${game.id}: ${game.result} in ${game.turns} turns, ${game.decisions.solo} decisions, ${game.findings.length} finding(s)`);
    await s.ctx.close();
    await engine.close?.();
  }
}

async function runSolo(app) {
  const scripts = scriptsIndex();
  const askModel = await loadAskModel();
  const helperFake = opts.coach === 'fake' ? await startFakeHelper({ answerMs: FAKE_COACH_MS }) : null;
  if (helperFake) cleanups.push(() => helperFake.close());
  const helper = `http://127.0.0.1:${PORTS.helper}`;
  // An engine already up (play.sh --engine-only started by hand) is used as it is.
  if (await waitHttp(`${helper}/health`, 1000)) log(`using the engine and helper already running on ${PORTS.engine}/${PORTS.helper}`);
  else await startPlaySh([]);
  if (!(await waitHttp(`${helper}/health`, 60_000))) throw new Error(`the coach helper (and its match launcher) is not up on ${PORTS.helper}`);
  const rand0 = rng(opts.seed);
  const plan = await deckPlan({ spec: opts.decks ?? 'cube,dck', root: ROOT, mtgRoot: MTG, seed: opts.seed, rand: rand0 });
  for (let i = 0; i < opts.games; i++) {
    const rand = rng(opts.seed * 7919 + i);
    const { mine, theirs } = await plan(i);
    const profile = opts.aiProfile ?? ['Default', 'Default', 'Reckless', 'Cautious'][Math.floor(rand() * 4)];
    const game = { id: i + 1, mode: 'solo', seed: opts.seed, decks: { mine: `${mine.name} (${mine.source})`, theirs: `${theirs.name} (${theirs.source})` }, aiProfile: profile, findings: [], shots: 0, t0: Date.now() };
    log(`game ${game.id}: ${game.decks.mine} vs ${game.decks.theirs} [${profile}]`);
    const body = { deck: { name: mine.name.replace(/[^A-Za-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60), main: mine.main, sideboard: mine.sideboard ?? [] }, aiDeck: { name: 'Playtest AI', main: theirs.main, sideboard: [] }, aiProfile: profile, games: 1 };
    let started = null;
    for (let attempt = 0; attempt < 2 && !started; attempt++) {
      const r = await fetch(`${helper}/match`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: app.replace(/\/$/, '') }, body: JSON.stringify(body), signal: AbortSignal.timeout(200_000) }).catch((e) => ({ ok: false, status: 0, json: async () => ({ message: String(e) }) }));
      const j = await r.json().catch(() => ({}));
      if (r.ok && j.ok) started = j;
      else {
        log(`  /match refused (${r.status}): ${j.message ?? ''} ${(j.problems ?? []).slice(0, 5).join('; ')}`);
        if (attempt === 1) {
          game.result = `not started: ${j.message ?? r.status}`;
          game.findings.push({ game: game.id, seat: 'solo', kind: 'match-refused', what: `${j.message ?? r.status}: ${(j.problems ?? []).slice(0, 8).join('; ')}`, shot: null });
        }
        await sleep(3000);
      }
    }
    if (!started) {
      report.games.push(stripGame(game));
      continue;
    }
    const s = await newSeatPage('solo', app, phoneFor('solo', i));
    game.viewport = s.phone ? 'phone' : 'desktop';
    if (helperFake) s.helperAsks = helperFake.asks;
    s.finding = watchPage(game, s);
    // The seat and the helper by URL (the page's defaults are 8642/8643): a fake helper for the coach checks.
    const url = `${app}?play=1&seat=${encodeURIComponent(`ws://127.0.0.1:${PORTS.engine}/ws`)}&coach=${encodeURIComponent(helperFake ? helperFake.url : helper)}`;
    await s.page.goto(url);
    const got = await s.tap.until(() => !!s.tap.hello && !!s.tap.state, 120_000);
    if (!got) {
      await s.finding({ kind: 'no-seat', what: 'Play vs Forge did not reach the table in 120 s' });
      game.result = 'abandoned (no seat)';
      report.games.push(stripGame(game));
      await s.ctx.close();
      continue;
    }
    const aiNames = deckNames(theirs);
    const myNames = deckNames(mine);
    await playGame(game, [s], {
      scripts,
      askModel,
      rand,
      hiddenFor: () => aiNames,
      allowedFor: (x) => new Set([...x.tap.seen, ...x.tap.typeWords, ...myNames]),
      reloadSeat: s,
    });
    report.games.push(stripGame(game));
    log(`game ${game.id}: ${game.result} (${game.reason}) in ${game.turns} turns, ${game.decisions.solo} decisions, ${game.findings.length} finding(s)`);
    await s.ctx.close();
    writeReport(OUT, report);
  }
}

// ---- table: the draft room, two browsers, best of three

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
    /* not json */
  }
  return { status: r.status, body: json };
}

async function runTable(scratch) {
  const site = buildSite(scratch);
  const scripts = scriptsIndex();
  const askModel = await loadAskModel();
  await startPlaySh(['--draft-room', '--site-dir', site, '--room-port', String(PORTS.room), '--table-port', String(PORTS.table)]);
  const ROOM = PORTS.room;
  const base = `http://127.0.0.1:${ROOM}`;
  const cubes = (opts.decks ?? 'cube').split(',').flatMap((p) => (p === 'cube' ? CUBES : p.startsWith('cube:') ? [p.slice(5)] : []));
  for (let m = 0; m < opts.games; m++) {
    const rand = rng(opts.seed * 104729 + m);
    const cube = cubes[(opts.seed + m) % cubes.length];
    const match = { id: m + 1, cube, games: [], findings: [], result: null, t0: Date.now() };
    log(`match ${match.id}: a ${cube} grid draft between two browsers`);
    const host = await newSeatPage('host', `http://localhost:${ROOM}`, phoneFor('host'));
    const friend = await newSeatPage('friend', `http://127.0.0.1:${ROOM}`, phoneFor('friend'));
    const both = [host, friend];
    const mgame = { id: `m${match.id}`, findings: match.findings, shots: 0, t0: Date.now() };
    for (const s of both) s.finding = watchPage(mgame, s);
    try {
      // The room, by clicking.
      // Off the default ports the page is told where its helper is (play.sh --coach-port's ?coachPort=).
      const cp = PORTS.helper === 8643 ? '' : `?coachPort=${PORTS.helper}`;
      await host.page.goto(`http://localhost:${ROOM}/${cp}#draft/friend`);
      await host.page.getByLabel('Your name').fill('Justin');
      const cubeSel = host.page.getByLabel('Cube');
      const values = await cubeSel.locator('option').evaluateAll((os) => os.map((o) => o.value));
      const want = values.find((v) => v.startsWith(cube)) ?? values[0];
      await cubeSel.selectOption(want);
      await host.page.getByLabel('Who picks first').selectOption(String(m % 2));
      await host.page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => b.textContent === 'Create room' && !b.disabled), null, { timeout: 60_000 });
      await host.page.getByRole('button', { name: 'Create room' }).click();
      await host.page.getByText('Waiting for your friend').waitFor({ timeout: 15_000 });
      let joinUrl = await host.page.locator('.fr-link input').last().inputValue();
      if (cp && !/coachPort=/.test(joinUrl)) {
        const u = new URL(joinUrl);
        u.searchParams.set('coachPort', String(PORTS.helper));
        joinUrl = u.toString();
      }
      await friend.page.goto(joinUrl);
      await friend.page.getByLabel('Your name').fill('Sam');
      await friend.page.getByRole('button', { name: 'Join' }).click();
      await friend.page.waitForURL(/#draft\/friend\/r\/r[\w-]{8}\/1$/, { timeout: 15_000 });
      const seatOf = (p) => p.evaluate(() => JSON.parse(localStorage.getItem('forgecoach.friendRooms.v1') ?? '[]')[0]);
      const seatsInfo = [await seatOf(host.page), await seatOf(friend.page)];
      const [id, tokH, tokF] = [seatsInfo[0].id, seatsInfo[0].token, seatsInfo[1].token];
      let state = (await roomCall(base, id, tokH)).body;
      // The draft through the room's API: a seeded legal line each pick (friend.e2e.mjs drafts by clicking).
      for (let pick = 0; !state.done && pick < 60; pick++) {
        const s = seatsInfo[state.toAct];
        let ok = false;
        for (const line of [Math.floor(rand() * 6), 0, 1, 2, 3, 4, 5]) {
          const r = await roomCall(base, s.id, s.token, '/pick', { line, expect: state.version });
          if (r.status === 200) {
            state = r.body;
            ok = true;
            break;
          }
        }
        if (!ok) throw new Error(`pick ${pick + 1}: no legal line`);
      }
      const pools = [(await roomCall(base, id, tokH)).body.seats[0].picks, (await roomCall(base, id, tokF)).body.seats[1].picks];
      for (const [n, p] of [['host', host.page], ['friend', friend.page]]) {
        await p.getByText(/You drafted \d+ cards/).waitFor({ timeout: 30_000 });
        await p.getByRole('button', { name: 'Hand in this deck' }).click();
        await p.getByText(/You: (handed in|playing)/).or(p.getByText(/Starting game 1/)).or(p.locator('.fr-error')).first().waitFor({ timeout: 15_000 });
        const err = await p.locator('.fr-error').allInnerTexts();
        if (err.length) throw new Error(`${n} could not hand in a deck: ${err.join(' | ')}`);
      }
      // Each seat's own list (to that seat alone): what it may name, and what the other must never see.
      const decks = [(await roomCall(base, id, tokH)).body.yourDeck, (await roomCall(base, id, tokF)).body.yourDeck];
      const allowed = (i) => new Set([...pools[i], ...deckNames(decks[i] ?? { main: [] })]);
      const hiddenOf = (i) => new Set([...pools[1 - i], ...hiddenFromOther(both[1 - i].tap)]);
      for (let g = 1; g <= 3; g++) {
        // To the table.
        for (const s of both) await s.page.waitForURL(/#play\/friend$/, { timeout: 300_000 });
        for (const s of both) await s.tap.until(() => !!s.tap.state && s.tap.games.length >= g, 120_000);
        const game = { id: `${match.id}.${g}`, mode: 'table', seed: opts.seed, cube, decks: { host: decks[0]?.name, friend: decks[1]?.name }, findings: [], shots: 0, t0: Date.now() };
        for (const s of both) s.finding = watchPage(game, s);
        log(`match ${match.id} game ${g}`);
        await playGame(game, both, {
          scripts,
          askModel,
          rand,
          hiddenFor: (s) => hiddenOf(s === host ? 0 : 1),
          allowedFor: (s) => new Set([...s.tap.seen, ...s.tap.typeWords, ...allowed(s === host ? 0 : 1)]),
          reloadSeat: g === 1 ? friend : host,
        });
        game.result = game.result === 'win' ? 'host won' : game.result === 'loss' ? 'friend won' : game.result;
        match.games.push(stripGame(game));
        report.games.push(stripGame(game));
        log(`match ${match.id} game ${g}: ${game.result} (${game.reason}) in ${game.turns} turns, ${game.findings.length} finding(s)`);
        writeReport(OUT, report);
        if (game.result.startsWith('abandoned')) {
          match.result = 'abandoned';
          break;
        }
        // The match card on the board, then back to the room.
        const st = (await roomCall(base, id, tokH)).body;
        const hm = await host.page.locator('.over-match').innerText().catch(() => '');
        for (const s of both) await s.page.getByRole('button', { name: 'Back to the room' }).click({ timeout: 20_000 });
        for (const s of both) await s.page.locator('.fr-score').waitFor({ timeout: 20_000 });
        await sleep(2500);
        const st2 = (await roomCall(base, id, tokH)).body;
        if (st2.match?.over) {
          match.result = `${st2.match.winner === 0 ? 'host' : 'friend'} won ${Math.max(...st2.match.wins)} – ${Math.min(...st2.match.wins)}`;
          if (!/wins? the match|won the match/i.test(hm)) match.findings.push({ kind: 'match-card', what: `the match is over (${match.result}) and the host's card says "${hm}"` });
          break;
        }
        if (g === 3) {
          match.findings.push({ kind: 'bo3-incomplete', what: `three games and the room's match is not over (${JSON.stringify(st2.match ?? st.match)})` });
          break;
        }
        // Sideboarding: the friend swaps a card of its deck for one from its picks (the room's API), the host keeps by clicking.
        const fd = (await roomCall(base, id, tokF)).body.yourDeck;
        const side = sideboarded(fd, pools[1], rand);
        const sb = await roomCall(base, id, tokF, '/deck', side);
        if (sb.status !== 200) match.findings.push({ kind: 'sideboard', what: `the friend's sideboarded deck was refused (${sb.status}: ${JSON.stringify(sb.body?.problems ?? sb.body?.code)})` });
        else decks[1] = side;
        await host.page.getByRole('button', { name: `Keep this deck for game ${g + 1}` }).click({ timeout: 20_000 });
      }
      if (!match.result) match.result = 'unfinished';
    } catch (e) {
      match.findings.push({ kind: 'table-flow', what: String(e.stack ?? e).split('\n').slice(0, 4).join(' | ') });
      try {
        await host.page.screenshot({ path: path.join(SHOTS, `m${match.id}-flow-host.png`) });
        await friend.page.screenshot({ path: path.join(SHOTS, `m${match.id}-flow-friend.png`) });
      } catch {
        /* gone */
      }
      match.result = match.result ?? 'failed';
      log(`match ${match.id}: ${String(e.message).split('\n')[0]}`);
    }
    report.matches.push({ id: match.id, cube, result: match.result, games: match.games.map((g) => g.id), findings: match.findings });
    log(`match ${match.id}: ${match.result}`);
    for (const s of both) await s.ctx.close();
    writeReport(OUT, report);
  }
}

/** A sideboarded 40: one non-basic card of the main out, one card of the pool's rest in. */
function sideboarded(deck, pool, rand) {
  const main = deck.main.map(([n, c]) => [n, c]);
  const basics = /^(Plains|Island|Swamp|Mountain|Forest|Wastes)$/;
  const inMain = new Set(main.map(([, c]) => c));
  const rest = pool.filter((c) => !inMain.has(c) && !basics.test(c));
  const outs = main.filter(([, c]) => !basics.test(c));
  if (rest.length && outs.length) {
    const out = outs[Math.floor(rand() * outs.length)];
    out[0]--;
    main.push([1, rest[Math.floor(rand() * rest.length)]]);
  }
  return { name: `${deck.name.slice(0, 40)} (sideboarded)`, main: main.filter(([n]) => n > 0), sideboard: [] };
}

function stripGame(g) {
  const { shots, t0, ...rest } = g;
  return { ...rest, seconds: Math.round((Date.now() - t0) / 1000) };
}

// ---------------------------------------------------------------------------

async function main() {
  mkdirSync(SHOTS, { recursive: true });
  const scratch = mkdtempSync(path.join(tmpdir(), 'forgecoach-playtest-'));
  cleanups.push(() => rmSync(scratch, { recursive: true, force: true }));
  const pw = await loadPlaywright();
  browser = await launchBrowser(pw, { headless: opts.headless });
  cleanups.push(() => browser.close());
  if (opts.mode === 'table') await runTable(scratch);
  else {
    const site = opts.mode === 'fake' && !env.SITE_DIR && existsSync(path.join(ROOT, 'dist', 'index.html')) && env.BUILD === '0' ? path.join(ROOT, 'dist') : buildSite(scratch);
    const app = await serveSite(site);
    if (opts.mode === 'fake') await runFake(app);
    else await runSolo(app);
  }
}

let code = 0;
let finishing = false;
// Stopped from outside (a timeout, Ctrl-C, the lab runner): still stop play.sh and its JVM, and write the report.
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => {
    report.error = report.error ?? `stopped by ${sig}`;
    code = code || 2;
    void finish();
  });
}
main()
  .catch((e) => {
    console.error(`playtest could not run: ${e.stack ?? e}`);
    report.error = String(e.stack ?? e);
    code = 2;
  })
  .finally(() => finish());

async function finish() {
  if (finishing) return;
  finishing = true;
  report.finished = new Date().toISOString();
  const summary = writeReport(OUT, report);
  // play.sh and its JVM first (a browser that hangs on close must not keep the engine up).
  for (const p of children) {
    try {
      process.kill(-p.pid, 'SIGTERM');
    } catch {
      /* gone */
    }
  }
  for (const c of cleanups.reverse()) {
    try {
      await Promise.race([c(), sleep(10_000)]);
    } catch {
      /* best effort */
    }
  }
  if (code === 0 && summary.findings > 0) code = 1;
  console.log(`\n${summary.line}\nreport: ${path.join(OUT, 'report.md')}`);
  setTimeout(() => process.exit(code), 2000);
}

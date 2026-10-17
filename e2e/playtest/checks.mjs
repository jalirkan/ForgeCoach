/*
 * ForgeCoach — e2e/playtest/checks.mjs
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The invariants the playtest holds the board to, checked against the frames
 * the seat received (tap.mjs):
 *
 *   - the stack panel shows as many items as the state's stack;
 *   - every blocker wears its attacker's number (who blocks whom); every
 *     attacker stays in its own row with an arrow to what it attacks, every
 *     blocker stays in its own row, and a block line joins the two (the
 *     combat study, §2 and §4; no attack lane since 2026-10-17);
 *   - the Game Log has a header for every turn the stream went through,
 *     and keeps them through a reload;
 *   - hidden information: no card name the other seat holds hidden (its hand
 *     and library: the other seat's own frames at a table, the AI's deck list
 *     against Forge) is anywhere in this page's DOM, unless this seat was
 *     shown that card;
 *   - no engine id in what the player reads: no "Opt (12)", "[[Island (38)]]",
 *     "Construct Token #297" or "(Exiled=0)" in the board's visible text
 *     (common-sense pass: the board never names a card by an id).
 *
 * Each returns a list of problems ([] when it holds). A board a frame behind
 * the wire is not a problem: the caller checks when the stream is quiet, and
 * these re-read before calling a mismatch.
 */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The stack panel against `state.stack` (and its numbering 1…n). */
export async function stackAgrees(page, tap) {
  const read = () =>
    page.evaluate(() => {
      const panel = document.querySelector('[data-stack-panel]');
      if (!panel) return { panel: false, n: 0, items: 0, folded: false };
      return {
        panel: true,
        n: Number(panel.querySelector('.stackp-n')?.textContent ?? -1),
        items: panel.querySelectorAll('[data-stack-item]').length,
        folded: panel.classList.contains('is-folded'),
        nums: [...panel.querySelectorAll('[data-stack-n]')].map((e) => Number(e.getAttribute('data-stack-n'))),
      };
    });
  // A board a state behind gets 3 s: in a long game the page can take a second to draw a state, and the
  // tap hears of the next frames no earlier than the page does (J109 1.2: Walking Ballista's panel came).
  const waits = [500, 1000, 1500];
  for (let attempt = 0; attempt <= waits.length; attempt++) {
    const seq = tap.stateSeq;
    const want = tap.state?.stack.length ?? 0;
    const got = await read();
    const problems = [];
    if (want === 0 && got.panel) problems.push(`the stack panel is up (${got.n}) with an empty stack`);
    if (want > 0 && !got.panel) problems.push(`the stack holds ${want} but no stack panel shows`);
    if (want > 0 && got.panel) {
      if (got.n !== want) problems.push(`the stack panel says ${got.n}, the stack holds ${want}`);
      if (!got.folded && got.items !== want) problems.push(`the stack panel lists ${got.items} items, the stack holds ${want}`);
      if (!got.folded && got.nums.join(',') !== Array.from({ length: got.items }, (_, i) => i + 1).join(',')) problems.push(`stack numbers ${got.nums.join(',')}`);
    }
    if (!problems.length || tap.stateSeq !== seq) return [];
    if (attempt < waits.length) await sleep(waits[attempt]);
    else return problems;
  }
  return [];
}

/** Who blocks whom: each blocker's badge number equals its attacker's (confirmed blocks in `state.combat`). */
export async function combatAgrees(page, tap) {
  const bands = tap.state?.combat?.bands ?? [];
  const pairs = [];
  for (const b of bands) for (const blk of b.blockerIds) pairs.push({ atk: b.attackerIds[0], blk });
  if (!pairs.length) return [];
  const seq = tap.stateSeq;
  const read = () =>
    page.evaluate((ids) => {
      const badge = (id) => {
        const el = [...document.querySelectorAll(`.battlefield [data-card-id="${id}"]`)].find((e) => e.classList.contains('tile'));
        const b = el?.querySelector('.tile-pair');
        return el ? (b ? { n: b.textContent.trim(), role: [...b.classList].find((c) => c.startsWith('pair-')) } : { n: null }) : null;
      };
      return ids.map(({ atk, blk }) => ({ atk, blk, a: badge(atk), b: badge(blk) }));
    }, pairs);
  let res = await read();
  const bad = (r) => r.filter((x) => x.a && x.b && (x.a.n === null || x.b.n === null || x.a.n !== x.b.n || x.b.role !== 'pair-blocker'));
  if (bad(res).length) {
    await sleep(500);
    if (tap.stateSeq !== seq) return [];
    res = await read();
  }
  return bad(res).map((x) => `blocker ${x.blk} wears ${x.b.n ?? 'no badge'} (${x.b.role ?? '-'}), its attacker ${x.atk} wears ${x.a.n ?? 'no badge'}`);
}

/**
 * Who attacks and who blocks, on the board: every attacker the state's combat lists is in its own
 * row with an arrow to what it attacks (`.combat-line.is-target[data-line-from]`), and every
 * confirmed blocker is in its own row with a block line from each attacker it blocks
 * (`.combat-line.is-block[data-line-from][data-line-to]`, CombatArrows.tsx).
 */
export async function combatPlaced(page, tap) {
  const bands = tap.state?.combat?.bands ?? [];
  if (!bands.length) return [];
  const seq = tap.stateSeq;
  const pairs = [];
  // A band whose attacker has left combat (removed, sacrificed) keeps its blockers with no attacker
  // to draw a line from: nothing to check them by (seen against real Forge, 2026-10-12).
  for (const b of bands) if (b.attackerIds.length) for (const blk of b.blockerIds) if (!b.attackerIds.includes(blk)) pairs.push({ atk: b.attackerIds[0], blk });
  const want = { atk: bands.flatMap((b) => b.attackerIds), aimed: bands.filter((b) => b.defender).flatMap((b) => b.attackerIds), pairs };
  const read = () =>
    page.evaluate(({ atk, aimed, pairs }) => {
      const out = [];
      const on = (id) => document.querySelector(`.battlefield .tile[data-card-id="${id}"]`);
      for (const a of atk) {
        const el = on(a);
        if (el && !el.closest('.bf-row-permanents')) out.push(`attacker ${a} is not in its row`);
        if (el && aimed.includes(a) && !document.querySelector(`.combat-line.is-target[data-line-from="${a}"]`)) out.push(`no arrow from attacker ${a} to what it attacks`);
      }
      for (const { atk: a, blk: b } of pairs) {
        const el = on(b);
        if (!el || !on(a)) continue;
        if (!el.closest('.bf-row-permanents')) out.push(`blocker ${b} is not in its row`);
        if (!document.querySelector(`.combat-line.is-block[data-line-from="${a}"][data-line-to="${b}"]`)) out.push(`no block line from attacker ${a} to blocker ${b}`);
      }
      return out;
    }, want);
  let res = await read();
  if (res.length) {
    await sleep(500);
    if (tap.stateSeq !== seq) return [];
    res = await read();
  }
  return res;
}

/** The Game Log's turn headers ("T1"…), opened with its L key and closed again. */
export async function logTurns(page) {
  await page.keyboard.press('l');
  try {
    await page.locator('.log-drawer').waitFor({ timeout: 6000 });
  } catch {
    return null;
  }
  const turns = await page.locator('.log-drawer .log-turn-no').allInnerTexts();
  const lines = await page.locator('.log-drawer .log-drawer-n').innerText().catch(() => '');
  await page.keyboard.press('Escape');
  await page.locator('.log-drawer').waitFor({ state: 'detached', timeout: 6000 }).catch(() => {});
  return { turns: turns.map((t) => t.trim()), lines };
}

/** Every turn number the stream's states went through this game. */
export function streamTurns(tap) {
  const s = new Set();
  for (const f of tap.gameFrames()) if (f.type === 'state' && f.body.turn > 0) s.add(f.body.turn);
  return [...s].sort((a, b) => a - b);
}

/** The log holds a header for each turn of the stream (T<n>). */
export function logCovers(log, turns) {
  if (!log) return ['the Game Log did not open'];
  const have = new Set(log.turns.map((t) => Number(/\d+/.exec(t)?.[0])));
  const missing = turns.filter((t) => !have.has(t));
  return missing.length ? [`the Game Log has no header for turn${missing.length > 1 ? 's' : ''} ${missing.join(', ')} (it shows ${log.turns.join(' ') || 'none'})`] : [];
}

const BASICS = new Set(['Plains', 'Island', 'Swamp', 'Mountain', 'Forest', 'Wastes', 'Snow-Covered Plains', 'Snow-Covered Island', 'Snow-Covered Swamp', 'Snow-Covered Mountain', 'Snow-Covered Forest']);

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Hidden names in the DOM. `hidden` is the set of names the other seat holds
 * where this one cannot see them; `allowed` what this seat may name anyway
 * (cards it was shown, its own deck). Text and attribute values both count.
 *
 * Both are judged against the frames the page had drawn when it was read, not
 * a moment before: pass them as functions and the seat's `tap`, and the page
 * is read first (with the board's `data-frame-seq`, the last frame it took),
 * the tap is let catch up to that frame (up to `waitMs`), and only then are
 * the two sets taken. Taken before the read, a spell the opponent cast while
 * the page was read was on the stack in the DOM and not yet "shown" to the
 * checker (the common-sense pass's one false leak). A name that no frame up
 * to the page's own ever showed this seat is still a leak.
 */
export async function hiddenLeaks(page, hidden, allowed, { tap = null, waitMs = 3000 } = {}) {
  const now = (x) => (typeof x === 'function' ? x() : x);
  const read = await page.evaluate(() => {
    const parts = [document.body.innerText];
    for (const el of document.querySelectorAll('*')) for (const a of el.attributes) if (a.value && a.name !== 'class' && a.name !== 'style' && !a.name.startsWith('data-pt')) parts.push(a.value);
    for (const t of document.querySelectorAll('title')) parts.push(t.textContent);
    const seq = Number(document.querySelector('.game.play')?.getAttribute('data-frame-seq') ?? NaN);
    return { text: parts.join('\n'), seq };
  });
  const html = typeof read === 'string' ? read : read.text;
  const seq = typeof read === 'string' ? NaN : read.seq;
  if (tap && Number.isFinite(seq) && seq > 0) await tap.until(() => tap.frameSeq >= seq, waitMs);
  const shown = now(allowed);
  // Basic land names are also land types ("Savannah — Land — Forest"): never evidence of a leak.
  const names = [...now(hidden)].filter((n) => n && n.length >= 4 && !shown.has(n) && !BASICS.has(n));
  if (!names.length) return [];
  const out = [];
  for (const n of names) {
    const re = new RegExp(`(?<![A-Za-z])${esc(n)}(?![A-Za-z])`);
    const m = re.exec(html);
    if (m) out.push(`"${n}" is in the page: …${html.slice(Math.max(0, m.index - 60), m.index + n.length + 40).replace(/\s+/g, ' ')}…`);
  }
  return out;
}

/** The names the other seat holds hidden right now, by its own frames (a table of two). */
export function hiddenFromOther(otherTap) {
  const s = otherTap.state;
  const me = otherTap.me();
  const out = new Set();
  if (!s || !me) return out;
  for (const c of me.zones.hand.cards) if (!c.hidden && c.name) out.add(c.name);
  for (const c of me.zones.library.cards ?? []) if (!c.hidden && c.name) out.add(c.name);
  return out;
}

/**
 * Engine ids in the page's visible text: "Shock (4)" or "Construct Token #297"
 * where that number is a card the state shows under that name, "[[…]]", or a
 * "(Key=value)" tail. A count ("Earlier advice (2)") is not an id.
 */
export async function engineIds(page, tap) {
  const names = new Map();
  const s = tap.state;
  if (s) {
    for (const p of s.players ?? []) for (const z of Object.values(p.zones ?? {})) for (const c of z.cards ?? []) if (c && !c.hidden && c.name) names.set(c.id, c.name);
    for (const c of s.stackCards ?? []) if (c && !c.hidden && c.name) names.set(c.id, c.name);
  }
  const text = await page.evaluate(() => {
    const root = document.querySelector('.game.play') ?? document.body;
    const parts = [root.innerText];
    // titles a hover shows count too
    for (const el of root.querySelectorAll('[title]')) parts.push(el.getAttribute('title'));
    return parts.join('\n');
  });
  const out = [];
  const idRe = /(?:\((\d+)\)|#(\d+)\b)/g;
  for (const line of text.split('\n')) {
    let bad = /\[\[|\([A-Z][A-Za-z ]*=\w+\)/.test(line);
    for (const m of line.matchAll(idRe)) {
      const name = names.get(Number(m[1] ?? m[2]));
      const before = line.slice(0, m.index).trimEnd().toLowerCase();
      if (name && (before.endsWith(name.toLowerCase()) || before.endsWith(name.toLowerCase().replace(/ token$/, '')))) bad = true;
    }
    if (bad) out.push(`an engine id in "${line.trim().slice(0, 140)}"`);
    if (out.length >= 3) break;
  }
  return out;
}

/*
 * ForgeCoach — bench/coach/cli.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * `npm run bench:coach -- …` (launched by run.mjs). See the README's
 * "Coach benchmark" section. Subcommands:
 *
 *   (run)      ask the coach every case and write results/<time>-<label>.{json,md}
 *   --dry-run  build every prompt and check every case; no model call
 *   --compare  a.json b.json: paired, statistical comparison of two runs
 *   list       the decisions (or --live moments) of a log, to pick a case from
 *   add        write a case skeleton for one decision of a log
 *   cards      fetch card text the snapshot lacks (Scryfall)
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { extractDecisions } from '../../src/decisions.ts';
import { getCards, isLookupName } from '../../src/cards.ts';
import type { CardInfo } from '../../src/cards.ts';
import { askClaude, DEFAULT_MODEL, isModelId, MODELS } from '../../src/claude.ts';
import { askHelper, DEFAULT_HELPER_URL, detectHelper, type HelperTarget } from '../../src/coachHelper.ts';
import { promptAsText } from '../../src/prompt.ts';
import { visibleName } from '../../src/review.ts';
import type { AnyCard, AskBody, GameStateBody, InputBody } from '../../src/protocol.ts';
import {
  BENCH_TYPES,
  buildMoment,
  caseProblems,
  choiceSet,
  compareReports,
  missingCards,
  normalizeReport,
  reportMarkdown,
  runBench,
  type AskCoach,
  type BenchCase,
  type BenchType,
  type BuiltCase,
} from '../../src/bench/coachBench.ts';
import { buildAll, CARDS_FILE, CASES_DIR, LOGS_DIR, readCards, readCases, readLogFile, RESULTS_DIR, writeCards } from '../../src/bench/benchFiles.ts';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));

function flags(argv: string[]): { pos: string[]; f: Map<string, string | true> } {
  const pos: string[] = [];
  const f = new Map<string, string | true>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=', 2) as [string, string | undefined];
      if (v !== undefined) f.set(k, v);
      else if (argv[i + 1] !== undefined && !argv[i + 1]!.startsWith('--') && VALUED.has(k)) f.set(k, argv[++i]!);
      else f.set(k, true);
    } else pos.push(a);
  }
  return { pos, f };
}
const VALUED = new Set(['source', 'model', 'label', 'only', 'type', 'helper-url', 'show', 'log', 'decision', 'frame', 'id', 'kind', 'out', 'repeat', 'concurrency']);
const str = (f: Map<string, string | true>, k: string): string | undefined => {
  const v = f.get(k);
  return typeof v === 'string' ? v : undefined;
};

const USAGE = `Coach benchmark (bench/coach/). Usage: npm run bench:coach -- [options]

  (no subcommand)        run every case against the coach and write a report
    --source helper|api  who answers (default: the coach helper if it is up, else the API
                         with ANTHROPIC_API_KEY)
    --model <m>          helper: a model alias the helper accepts; api: a model id
    --label <name>       report name (default: the source)
    --repeat N           answers per case (default 3); the coach is stochastic, so one
                         answer per case cannot tell two prompts apart
    --concurrency K      calls in flight at once (default 2)
    --only a,b  --type t only these case ids / this decision type
    --helper-url <url>   default ${DEFAULT_HELPER_URL}
  --dry-run [--show <id>]  build every prompt and check every case; no model call
  --compare a.json b.json  paired comparison: per-case difference, 95% interval, verdict,
                         flips beyond noise, unstable cases (old single-sample files load as N=1)
  list --log <file> [--live]   the decisions (or live moments) of a log
  add --log <file> (--decision <n> | --frame <n> --live) --type <t> --id <id>
                         write a case skeleton (copies the log, fetches card text)
  cards                  fetch card text missing from ${CARDS_FILE}`;

export async function main(argv: string[]): Promise<number> {
  const { pos, f } = flags(argv);
  if (f.has('help') || pos[0] === 'help') {
    console.log(USAGE);
    return 0;
  }
  if (f.has('compare')) return compare(pos);
  if (pos[0] === 'list') return list(f);
  if (pos[0] === 'add') return add(f);
  if (pos[0] === 'cards') return refreshCards();
  if (f.has('dry-run')) return dryRun(f);
  if (pos.length) {
    console.error(`Unknown command: ${pos.join(' ')}\n\n${USAGE}`);
    return 2;
  }
  return run(f);
}

// ---------------------------------------------------------------------------

function loadBuilt(f: Map<string, string | true>): { built: BuiltCase[]; bad: number } {
  const loaded = readCases(ROOT);
  let bad = 0;
  for (const l of loaded) if (l.errors.length) {
    bad++;
    console.error(`✗ ${l.file}: ${l.errors.join('; ')}`);
  }
  const only = str(f, 'only')?.split(',').map((s) => s.trim());
  const type = str(f, 'type');
  if (type && !BENCH_TYPES.includes(type as BenchType)) throw new Error(`--type: one of ${BENCH_TYPES.join(', ')}`);
  const cases = loaded
    .filter((l) => l.value && !l.errors.length)
    .map((l) => l.value!)
    .filter((c) => (!only || only.includes(c.id)) && (!type || c.type === type));
  const cards = readCards(ROOT);
  const { built, errors } = buildAll(ROOT, cases, cards);
  for (const e of errors) {
    bad++;
    console.error(`✗ ${e.id}: ${e.error}`);
  }
  return { built, bad };
}

function dryRun(f: Map<string, string | true>): number {
  const { built, bad: bad0 } = loadBuilt(f);
  let bad = bad0;
  const cards = readCards(ROOT);
  const counts = new Map<string, number>();
  for (const b of built) {
    const problems = caseProblems(b);
    const miss = missingCards(b.moment.log, b.moment.decision, cards);
    if (miss.length) problems.push(`card text missing from the snapshot: ${miss.join(', ')} (run: npm run bench:coach -- cards)`);
    if (problems.length) {
      bad++;
      console.error(`✗ ${b.case.id}: ${problems.join('; ')}`);
    }
    const k = `${b.case.type}${b.case.confidence === 'low' ? ' (low)' : ''}`;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const show = str(f, 'show');
  if (show) {
    const b = built.find((x) => x.case.id === show);
    if (!b) console.error(`No case ${show}`);
    else console.log(promptAsText(b.prompt));
  }
  console.log(`${built.length} case${built.length === 1 ? '' : 's'} built: ${[...counts].map(([k, n]) => `${k} ${n}`).join(', ')}`);
  console.log(bad ? `${bad} problem${bad === 1 ? '' : 's'}` : 'All cases build and every answer is legal.');
  return bad ? 1 : 0;
}

async function run(f: Map<string, string | true>): Promise<number> {
  const { built, bad } = loadBuilt(f);
  if (bad) console.error(`(${bad} case problem${bad === 1 ? '' : 's'} above; those cases are skipped)`);
  if (!built.length) {
    console.error('No cases to run.');
    return 1;
  }
  const model = str(f, 'model');
  const helperTarget: HelperTarget = { baseUrl: (str(f, 'helper-url') ?? DEFAULT_HELPER_URL).replace(/\/+$/, ''), token: process.env.FORGECOACH_TOKEN ?? null };
  let source = str(f, 'source');
  if (!source) {
    const st = await detectHelper({ target: helperTarget, force: true, timeoutMs: 3000 });
    source = st.state === 'ok' ? 'helper' : process.env.ANTHROPIC_API_KEY ? 'api' : '';
    if (!source) {
      console.error(`No coach: the helper at ${helperTarget.baseUrl} isn't up (${st.state === 'down' ? st.message : ''}) and ANTHROPIC_API_KEY is not set.`);
      return 1;
    }
  }
  let ask: AskCoach;
  if (source === 'helper') {
    const st = await detectHelper({ target: helperTarget, force: true, timeoutMs: 3000 });
    if (st.state !== 'ok') {
      console.error(`The coach helper at ${helperTarget.baseUrl} isn't ready: ${st.message}`);
      return 1;
    }
    ask = async (p, signal) => {
      const r = await askHelper(p, { onText: () => {} }, { target: helperTarget, ...(model ? { model: model as never } : {}), ...(signal ? { signal } : {}) });
      return { text: r.text, model: r.model };
    };
  } else if (source === 'api') {
    const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
    if (!apiKey) {
      console.error('--source api needs ANTHROPIC_API_KEY in the environment.');
      return 1;
    }
    if (model && !isModelId(model)) {
      console.error(`--model: one of ${MODELS.map((m) => m.id).join(', ')}`);
      return 1;
    }
    const settings = { apiKey, model: model && isModelId(model) ? model : DEFAULT_MODEL, coachSource: 'apiKey' as const };
    ask = async (p, signal) => {
      const r = await askClaude(p, { onText: () => {} }, { settings, ...(signal ? { signal } : {}) });
      return { text: r.text, model: r.model };
    };
  } else {
    console.error('--source: helper or api');
    return 1;
  }

  const intFlag = (k: string, dflt: number): number | null => {
    const v = str(f, k);
    if (v === undefined) return dflt;
    return /^\d+$/.test(v) && Number(v) >= 1 ? Number(v) : null;
  };
  const repeat = intFlag('repeat', 3);
  const concurrency = intFlag('concurrency', 2);
  if (repeat === null || concurrency === null) {
    console.error('--repeat and --concurrency: a whole number, 1 or more.');
    return 2;
  }
  console.log(`${built.length} cases × ${repeat} = ${built.length * repeat} calls, ${concurrency} at a time.`);
  const label = (str(f, 'label') ?? source).replace(/[^A-Za-z0-9._-]+/g, '-');
  const ctrl = new AbortController();
  process.once('SIGINT', () => {
    console.error('\nStopping after the calls in flight…');
    ctrl.abort();
  });
  const report = await runBench(built, ask, {
    label,
    source,
    model: model ?? null,
    repeat,
    concurrency,
    signal: ctrl.signal,
    onResult: ({ id, type, rep, sample: r }, done, n) => {
      const mark = r.verdict === 'acceptable' ? '✓' : r.verdict === 'unacceptable' ? '✗' : '·';
      console.log(`${mark} [${done}/${n}] ${id} #${rep + 1} (${type}) ${r.verdict}${r.canonical ? ` ${r.canonical}` : ''}${r.note ? ` — ${r.note.slice(0, 100)}` : ''} · ${(r.latencyMs / 1000).toFixed(1)} s`);
    },
  });
  const md = reportMarkdown(report);
  const dir = join(ROOT, RESULTS_DIR);
  mkdirSync(dir, { recursive: true });
  const stamp = report.startedAt.replace(/\.\d+Z$/, 'Z').replace(/:/g, '-');
  const base = join(dir, `${stamp}-${label}`);
  writeFileSync(`${base}.json`, JSON.stringify(report, null, 1) + '\n');
  writeFileSync(`${base}.md`, md);
  console.log(`\n${md}`);
  console.log(`Wrote ${relative(ROOT, base)}.json and .md`);
  return 0;
}

function compare(pos: string[]): number {
  if (pos.length !== 2) {
    console.error('--compare a.json b.json');
    return 2;
  }
  const loaded = pos.map((p) => normalizeReport(JSON.parse(readFileSync(resolve(p), 'utf8'))));
  for (const l of loaded) for (const w of l.warnings) console.error(`Warning: ${w}`);
  console.log(compareReports(loaded[0]!.report, loaded[1]!.report).markdown);
  return 0;
}

// ---------------------------------------------------------------------------
// Making cases

function firstLine(s: string | undefined | null): string {
  return (s ?? '').split('\n').filter(Boolean).slice(0, 2).join(' / ');
}

function list(f: Map<string, string | true>): number {
  const path = str(f, 'log');
  if (!path) {
    console.error('list --log <frames.jsonl[.gz]> [--live]');
    return 2;
  }
  const log = readLogFile(resolve(path));
  const cards = readCards(ROOT);
  if (f.has('live')) {
    // Every act or answer the player sent: the moment before it is a live case.
    let input: InputBody | null = null;
    let ask: AskBody | null = null;
    let state: GameStateBody | null = null;
    log.frames.forEach((fr, i) => {
      if (fr.type === 'state') state = fr.body as GameStateBody;
      else if (fr.type === 'input') input = fr.body as InputBody;
      else if (fr.type === 'ask') ask = fr.body as AskBody;
      else if (fr.type === 'act' || fr.type === 'answer') {
        const s = state as GameStateBody | null;
        const where = s ? `T${s.turn} ${s.phase ?? 'pre-game'}` : '';
        const what = fr.type === 'answer' && ask ? `ask ${(ask as AskBody).kind}: ${firstLine('prompt' in (ask as object) ? String((ask as { prompt?: string }).prompt ?? '') : '')}` : `input: ${firstLine((input as InputBody | null)?.prompt)}`;
        console.log(`--frame ${i}  ${where}  ${what}  → ${fr.type} ${JSON.stringify(fr.body).slice(0, 80)}`);
        if (fr.type === 'answer') ask = null;
      }
    });
    return 0;
  }
  for (const d of extractDecisions(log, { cards })) {
    console.log(`--decision ${d.index}  (frame ${d.frameIndex}, ${d.kind})  ${d.label}  — did: ${d.actions.join('; ')}`);
  }
  return 0;
}

async function add(f: Map<string, string | true>): Promise<number> {
  const path = str(f, 'log');
  const type = str(f, 'type') as BenchType | undefined;
  const id = str(f, 'id');
  if (!path || !type || !id || !BENCH_TYPES.includes(type) || (!f.has('decision') && !f.has('frame'))) {
    console.error(`add --log <file> (--decision <n> | --frame <n> --live) --type <${BENCH_TYPES.join('|')}> --id <case-id>`);
    return 2;
  }
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) {
    console.error('--id: lower-case letters, digits and dashes');
    return 2;
  }
  const caseFile = join(ROOT, CASES_DIR, `${id}.json`);
  if (existsSync(caseFile)) {
    console.error(`${relative(ROOT, caseFile)} exists already`);
    return 1;
  }
  // The log goes into bench/coach/logs (gzipped) unless it is in the repository already.
  const abs = resolve(path);
  let logRel = relative(ROOT, abs);
  if (logRel.startsWith('..')) {
    const log0 = readLogFile(abs);
    const name = `${(log0.header.gameId || basename(abs).replace(/\.jsonl(\.gz)?$/, '')).replace(/[^A-Za-z0-9._-]+/g, '-')}.jsonl.gz`;
    const dest = join(ROOT, LOGS_DIR, name);
    mkdirSync(join(ROOT, LOGS_DIR), { recursive: true });
    if (!existsSync(dest)) {
      const bytes = readFileSync(abs);
      if (bytes[0] === 0x1f && bytes[1] === 0x8b) copyFileSync(abs, dest);
      else writeFileSync(dest, gzipSync(bytes, { level: 9 }));
    }
    logRel = relative(ROOT, dest);
  }
  const log = readLogFile(join(ROOT, logRel));
  let cards = readCards(ROOT);
  let moment: BenchCase['moment'];
  if (f.has('frame')) {
    moment = { mode: 'live', frame: Number(str(f, 'frame')) };
  } else {
    const n = Number(str(f, 'decision'));
    const d = extractDecisions(log, { cards })[n];
    if (!d) {
      console.error(`No decision ${n} in that log (see: npm run bench:coach -- list --log …)`);
      return 1;
    }
    moment = { mode: 'review', frame: d.frameIndex, kind: d.kind };
  }
  const skeleton: BenchCase = {
    id,
    log: logRel,
    source: `Justin's game ${log.header.gameId}`,
    moment,
    seat: log.seat,
    type,
    acceptable: ['TODO'],
    unacceptable: [],
    rationale: 'TODO: why, in rules terms',
    confidence: 'high',
  };
  const m = buildMoment(skeleton, log, cards);
  skeleton.label = m.decision.label;
  const miss = missingCards(m.log, m.decision, cards);
  if (miss.length) {
    cards = await fetchMissing(cards, miss);
    writeCards(ROOT, cards);
  }
  mkdirSync(join(ROOT, CASES_DIR), { recursive: true });
  writeFileSync(caseFile, JSON.stringify(skeleton, null, 2) + '\n');
  const cs = choiceSet(type, m.log, m.decision, cards, {});
  console.log(`Wrote ${relative(ROOT, caseFile)} (${m.decision.label}). Legal choices:`);
  for (const c of cs.choices) console.log(`  ${c.token} — ${c.label}`);
  console.log('Fill in acceptable / unacceptable / rationale, then check it: npm run bench:coach -- --dry-run --show ' + id);
  return 0;
}

// ---------------------------------------------------------------------------
// Card text

/** Scryfall asks API clients for a User-Agent that names the application. */
async function fetchMissing(cards: Map<string, CardInfo>, names: string[]): Promise<Map<string, CardInfo>> {
  const want = names.filter((n) => isLookupName(n));
  if (!want.length) return cards;
  const orig = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL, init: RequestInit = {}) =>
    orig(input, { ...init, headers: { ...((init.headers as Record<string, string>) ?? {}), 'User-Agent': 'ForgeCoach-coach-bench/1 (https://github.com/jalirkan/ForgeCoach)' } })) as typeof fetch;
  try {
    const got = await getCards(want);
    const out = new Map(cards);
    for (const [k, v] of got) {
      if (!v.found) console.error(`Scryfall has no card named "${k}" (kept as text unavailable)`);
      out.set(k, v);
    }
    console.log(`Fetched ${got.size} card${got.size === 1 ? '' : 's'} from Scryfall.`);
    return out;
  } finally {
    globalThis.fetch = orig;
  }
}

async function refreshCards(): Promise<number> {
  const cards = readCards(ROOT);
  const need = new Set<string>();
  for (const l of readCases(ROOT)) {
    if (!l.value) continue;
    try {
      const log = readLogFile(join(ROOT, l.value.log));
      // Every visible card of the log, so moments near this one are covered too.
      for (const fr of log.frames) {
        if (fr.type !== 'state') continue;
        const s = fr.body as GameStateBody;
        const all: AnyCard[] = [...(s.stackCards ?? [])];
        for (const p of s.players) for (const z of Object.values(p.zones)) all.push(...(z.cards as AnyCard[]));
        for (const c of all) {
          const n = visibleName(c);
          if (n && !cards.has(n) && isLookupName(n)) need.add(n);
        }
      }
    } catch (e) {
      console.error(`${l.file}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  if (!need.size) {
    console.log('The card snapshot covers every case log.');
    return 0;
  }
  writeCards(ROOT, await fetchMissing(cards, [...need]));
  console.log(`Updated ${CARDS_FILE}.`);
  return 0;
}

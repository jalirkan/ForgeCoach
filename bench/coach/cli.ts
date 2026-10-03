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
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { extractDecisions } from '../../src/decisions.ts';
import { getCards, isLookupName } from '../../src/cards.ts';
import type { CardInfo } from '../../src/cards.ts';
import { askClaude, DEFAULT_MODEL, isModelId, MODELS } from '../../src/claude.ts';
import { askHelper, DEFAULT_HELPER_URL, detectHelper, helperModel, type HelperTarget } from '../../src/coachHelper.ts';
import { PROMPT_FORMATS, promptAsText, type PromptFormat } from '../../src/prompt.ts';
import { visibleName } from '../../src/review.ts';
import type { AnyCard, AskBody, GameStateBody, InputBody } from '../../src/protocol.ts';
import {
  BENCH_SPLITS,
  BENCH_TYPES,
  buildCase,
  buildMoment,
  illegalReason,
  inSplit,
  parseAnswer,
  regradeReport,
  type BenchSplit,
  caseProblems,
  choiceSet,
  compareReports,
  missingCards,
  normalizeReport,
  parseModelByType,
  reportMarkdown,
  runBench,
  transportWarning,
  type AskCoach,
  type BenchCase,
  type BenchType,
  type BuiltCase,
} from '../../src/bench/coachBench.ts';
import { buildAll, CARDS_FILE, CASES_DIR, LOGS_DIR, readCards, readCases, readLogFile, RESULTS_DIR, writeCards } from '../../src/bench/benchFiles.ts';
import {
  answerLists,
  caseGradeOf,
  chooseHoldout,
  gradeRationale,
  LOW_INFO_HALF_WIDTH,
  selectTurningPoints,
  seriousFidelity,
  type GradedLine,
  type MomentLine,
} from '../../src/bench/grade.ts';
import { GRADED_TYPES, labDecks, momentsOf, type GradedType } from '../../src/bench/moments.ts';

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
const VALUED = new Set([
  'source', 'model', 'label', 'only', 'type', 'helper-url', 'show', 'log', 'decision', 'frame', 'id', 'kind', 'out', 'repeat', 'concurrency', 'model-by-type', 'prompt-format',
  'split', 'logs', 'types', 'prefix', 'opp-deck', 'opp-pool', 'deck', 'max-per-log', 'select', 'candidates', 'min-spread', 'max-fidelity', 'holdout', 'grader',
]);
const str = (f: Map<string, string | true>, k: string): string | undefined => {
  const v = f.get(k);
  return typeof v === 'string' ? v : undefined;
};

const USAGE = `Coach benchmark (bench/coach/). Usage: npm run bench:coach -- [options]

  (no subcommand)        run every case against the coach and write a report
    --source helper|api  who answers (default: the coach helper if it is up, else the API
                         with ANTHROPIC_API_KEY)
    --model <m>          helper: a model alias the helper accepts (opus, sonnet, haiku) or a
                         model id (mapped to its alias); api: a model id
    --model-by-type t=m,…  a model per decision type, e.g. mulligan=claude-haiku-4-5,
                         play_draw=claude-haiku-4-5 (ids: ${MODELS.map((m) => m.id).join(', ')});
                         types not listed use --model
    --prompt-format f    classic (default) or answer-first: the ANSWER line first, then
                         the reasoning
    --label <name>       report name (default: the source)
    --repeat N           answers per case (default 3); the coach is stochastic, so one
                         answer per case cannot tell two prompts apart
    --concurrency K      calls in flight at once (default 1 for the helper, which answers
                         one at a time; 2 for the API)
    Busy, rate-limited, overloaded, network and 5xx calls are retried with backoff; a call
    that still fails is a transport error, reported apart from format failures.
    --only a,b  --type t only these case ids / this decision type
    --helper-url <url>   default ${DEFAULT_HELPER_URL}
    --split dev|holdout|all  which cases (default dev: every case not held out; the held-out
                         set is run only to confirm a finished change, never while tuning)
  --dry-run [--show <id>]  build every prompt and check every case (all splits); no model call
  regrade <results.json>   fill each answer's regret from the cases' current regret tables
  moments --cases --out m.jsonl [--only ids]   the bench's own spell/attack/block/target cases, to grade
  moments --logs 'glob,…' --out m.jsonl [--types spell,attack,block,target] [--prefix mined]
          [--opp-deck D | --opp-pool P] [--deck D] [--max-per-log N]
                         the decisions of logs worth grading (mtg-table tools/coach-grade.sh
                         batch reads the file); a cube-lab run's logs get both decks from
                         its drafts.jsonl
  import-graded <graded.jsonl> --select N --candidates c.jsonl [--min-spread 0.15] [--max-fidelity 0]
                         the turning-point miner: keep the N decisions whose options differ most
  import-graded <graded.jsonl> --write [--holdout N] [--prefix mined] [--grader "mtg-table <sha>"]
                         write each graded decision's regret table into its case (a new case
                         when no case has its id), then hold out N graded cases
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
  try {
    promptFormat(f);
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    return 2;
  }
  if (f.has('compare')) return compare(pos);
  if (pos[0] === 'list') return list(f);
  if (pos[0] === 'add') return add(f);
  if (pos[0] === 'cards') return refreshCards();
  if (pos[0] === 'moments') return moments(f);
  if (pos[0] === 'import-graded') return importGraded(pos.slice(1), f);
  if (pos[0] === 'regrade') return regrade(pos.slice(1));
  if (f.has('dry-run')) return dryRun(f);
  if (pos.length) {
    console.error(`Unknown command: ${pos.join(' ')}\n\n${USAGE}`);
    return 2;
  }
  return run(f);
}

// ---------------------------------------------------------------------------

function promptFormat(f: Map<string, string | true>): PromptFormat {
  const v = str(f, 'prompt-format') ?? 'classic';
  if (!PROMPT_FORMATS.includes(v as PromptFormat)) throw new Error(`--prompt-format: one of ${PROMPT_FORMATS.join(', ')}`);
  return v as PromptFormat;
}

function splitOf(f: Map<string, string | true>): BenchSplit {
  const v = str(f, 'split') ?? 'dev';
  if (!BENCH_SPLITS.includes(v as BenchSplit)) throw new Error(`--split: one of ${BENCH_SPLITS.join(', ')}`);
  return v as BenchSplit;
}

function loadBuilt(f: Map<string, string | true>, split: BenchSplit = 'all'): { built: BuiltCase[]; bad: number } {
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
    .filter((c) => (!only || only.includes(c.id)) && (!type || c.type === type) && (only !== undefined || inSplit(c, split)));
  const cards = readCards(ROOT);
  const { built, errors } = buildAll(ROOT, cases, cards, { format: promptFormat(f) });
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
  let split: BenchSplit;
  try {
    split = splitOf(f);
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    return 2;
  }
  const { built, bad } = loadBuilt(f, split);
  if (split !== 'dev') console.error(`Note: --split ${split} runs held-out cases. Do not tune the prompt on what they show.`);
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
  const ids = MODELS.map((m) => m.id) as string[];
  let modelByType: Partial<Record<BenchType, string>> = {};
  try {
    const spec = str(f, 'model-by-type');
    if (spec) modelByType = parseModelByType(spec, source === 'helper' ? [...ids, 'opus', 'sonnet', 'haiku'] : ids);
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    return 2;
  }
  const modelFor = (type: BenchType | undefined): string | undefined => (type && modelByType[type]) || model;

  const intFlag = (k: string, dflt: number): number | null => {
    const v = str(f, k);
    if (v === undefined) return dflt;
    return /^\d+$/.test(v) && Number(v) >= 1 ? Number(v) : null;
  };
  let helperConcurrency = 1;
  let ask: AskCoach;
  if (source === 'helper') {
    const st = await detectHelper({ target: helperTarget, force: true, timeoutMs: 3000 });
    if (st.state !== 'ok') {
      console.error(`The coach helper at ${helperTarget.baseUrl} isn't ready: ${st.message}`);
      return 1;
    }
    helperConcurrency = st.concurrency ?? 1;
    if (!st.queue) console.error('Note: this coach helper has no queue (older than mtg-table D325): a second call in flight is refused as busy and retried here.');
    ask = async (p, signal, ctx) => {
      const m = modelFor(ctx?.type);
      const t0 = Date.now();
      let runningAt: number | null = null;
      let queued = false;
      const r = await askHelper(
        p,
        { onText: () => {} },
        {
          target: helperTarget,
          ...(m ? { model: helperModel(m) } : {}),
          ...(signal ? { signal } : {}),
          onQueued: () => {
            queued = true;
          },
          onRunning: () => {
            runningAt = Date.now();
          },
        },
      );
      return { text: r.text, model: r.model, ...(queued && runningAt !== null ? { queuedMs: (runningAt as number) - t0 } : {}) };
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
    ask = async (p, signal, ctx) => {
      const m = modelFor(ctx?.type);
      const settings = { apiKey, model: m && isModelId(m) ? m : DEFAULT_MODEL, coachSource: 'apiKey' as const };
      const r = await askClaude(p, { onText: () => {} }, { settings, ...(signal ? { signal } : {}) });
      return { text: r.text, model: r.model };
    };
  } else {
    console.error('--source: helper or api');
    return 1;
  }

  const repeat = intFlag('repeat', 3);
  const concurrency = intFlag('concurrency', source === 'helper' ? 1 : 2);
  if (repeat === null || concurrency === null) {
    console.error('--repeat and --concurrency: a whole number, 1 or more.');
    return 2;
  }
  if (source === 'helper' && concurrency > helperConcurrency) {
    console.error(
      `Warning: --concurrency ${concurrency}, but the coach helper answers ${helperConcurrency} at a time. ` +
        'The extra calls wait in its queue (or, with an older helper, are refused as busy and retried): no faster, and more chances of a transport error.',
    );
  }
  const format = promptFormat(f);
  console.log(
    `${built.length} cases × ${repeat} = ${built.length * repeat} calls, ${concurrency} at a time · prompt ${format}` +
      (Object.keys(modelByType).length ? ` · models by type: ${Object.entries(modelByType).map(([k, v]) => `${k}=${v}`).join(', ')}` : ''),
  );
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
    promptFormat: format,
    modelByType,
    split,
    onRetry: ({ id, rep, attempt, kind, waitMs }) => {
      console.error(`  ↻ ${id} #${rep + 1}: ${kind} on try ${attempt}; retrying in ${(waitMs / 1000).toFixed(0)} s`);
    },
    onResult: ({ id, type, rep, sample: r }, done, n) => {
      const mark = r.verdict === 'acceptable' ? '✓' : r.verdict === 'unacceptable' ? '✗' : r.verdict === 'error' ? '!' : '·';
      const what = r.verdict === 'error' ? `TRANSPORT ERROR${r.errorKind ? ` (${r.errorKind})` : ''}` : r.verdict;
      console.log(`${mark} [${done}/${n}] ${id} #${rep + 1} (${type}) ${what}${r.canonical ? ` ${r.canonical}` : ''}${r.note ? ` — ${r.note.slice(0, 100)}` : ''} · ${(r.latencyMs / 1000).toFixed(1)} s${r.attempts ? ` · ${r.attempts} tries` : ''}`);
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
  const warn = transportWarning(report);
  if (warn) {
    console.error(`\n${'!'.repeat(78)}\nWARNING — ${warn}\n${'!'.repeat(78)}`);
    return 3;
  }
  return 0;
}

function compare(pos: string[]): number {
  if (pos.length !== 2) {
    console.error('--compare a.json b.json');
    return 2;
  }
  const loaded = pos.map((p) => normalizeReport(JSON.parse(readFileSync(resolve(p), 'utf8'))));
  for (const l of loaded) for (const w of l.warnings) console.error(`Warning: ${w}`);
  const c = compareReports(loaded[0]!.report, loaded[1]!.report);
  console.log(c.markdown);
  if (c.untrustworthy) {
    console.error('WARNING: a run in this comparison has transport errors; its verdict is not trustworthy.');
    return 3;
  }
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

// ---------------------------------------------------------------------------
// The engine-graded bench: moments for the grader, its results back as cases

/** Files matching a simple glob (`*` within a path part, `**` across parts), or the path itself. */
function globFiles(pattern: string): string[] {
  const abs = resolve(pattern);
  if (!/[*?]/.test(abs)) return existsSync(abs) ? [abs] : [];
  const parts = abs.split('/');
  const first = parts.findIndex((p) => /[*?]/.test(p));
  const base = parts.slice(0, first).join('/') || '/';
  const re = new RegExp(
    '^' +
      parts
        .slice(first)
        .join('/')
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*\*\//g, '(?:.*/)?')
        .replace(/\*\*/g, '.*')
        .replace(/\*/g, '[^/]*')
        .replace(/\?/g, '[^/]') +
      '$',
  );
  const out: string[] = [];
  const walk = (dir: string) => {
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      return;
    }
    for (const n of names) {
      const p = join(dir, n);
      let st;
      try {
        st = statSync(p);
      } catch {
        continue;
      }
      if (st.isDirectory()) walk(p);
      else if (re.test(relative(base, p))) out.push(p);
    }
  };
  walk(base);
  return out.sort();
}

/** The bench's own graded-type cases as moments, with their answers as extra options and their logs' opponents. */
function caseMoments(f: Map<string, string | true>, out: string): number {
  const opp = JSON.parse(readFileSync(join(ROOT, BENCH_DIR_OPPONENTS), 'utf8')) as Record<string, string>;
  const only = str(f, 'only')?.split(',').map((x) => x.trim());
  const lines: string[] = [];
  for (const l of readCases(ROOT)) {
    const c = l.value;
    if (!c || !(GRADED_TYPES as readonly string[]).includes(c.type) || (only && !only.includes(c.id))) continue;
    const m: MomentLine & { lands?: boolean } = {
      log: join(ROOT, c.log),
      frame: c.moment.frame,
      mode: c.moment.mode,
      type: c.type as GradedType,
      id: c.id,
      extra: [...c.acceptable, ...c.unacceptable],
    };
    if (c.moment.mode === 'review') m.kind = c.moment.kind;
    if (c.label) m.label = c.label;
    if (c.lands) m.lands = true;
    const o = opp[basename(c.log)];
    if (o) m.oppDeck = o;
    else console.error(`${c.id}: no opponent deck for ${basename(c.log)} in ${BENCH_DIR_OPPONENTS}`);
    lines.push(JSON.stringify(m));
  }
  writeFileSync(resolve(out), lines.join('\n') + (lines.length ? '\n' : ''));
  console.log(`${lines.length} case moments → ${out}`);
  return 0;
}

const BENCH_DIR_OPPONENTS = 'bench/coach/opponents.json';

function moments(f: Map<string, string | true>): number {
  if (f.has('cases')) {
    const o = str(f, 'out');
    if (!o) {
      console.error('moments --cases --out m.jsonl [--only ids]');
      return 2;
    }
    return caseMoments(f, o);
  }
  const logs = (str(f, 'logs') ?? str(f, 'log') ?? '').split(',').filter(Boolean).flatMap(globFiles);
  const out = str(f, 'out');
  if (!logs.length || !out) {
    console.error("moments --logs 'glob,…' --out moments.jsonl [--types spell,attack,block,target]");
    return 2;
  }
  const types = (str(f, 'types') ?? GRADED_TYPES.join(',')).split(',') as GradedType[];
  if (types.some((t) => !GRADED_TYPES.includes(t))) {
    console.error(`--types: some of ${GRADED_TYPES.join(', ')}`);
    return 2;
  }
  const maxPer = Number(str(f, 'max-per-log') ?? 0);
  const cards = readCards(ROOT);
  const lines: string[] = [];
  for (const path of logs) {
    let log;
    try {
      log = readLogFile(path);
    } catch (e) {
      console.error(`${path}: ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }
    let ms = momentsOf(log, path, cards, { types, prefix: str(f, 'prefix') ?? 'mined', logName: basename(path) });
    if (maxPer > 0 && ms.length > maxPer) {
      const all = ms;
      ms = Array.from({ length: maxPer }, (_, k) => all[Math.floor((k * all.length) / maxPer)]!);
    }
    // A cube-lab recording: both decks from its run's drafts.jsonl (D315).
    const runDir = resolve(dirname(path), '../..');
    let decks: { own: string; opp: string } | null = null;
    if (existsSync(join(runDir, 'drafts.jsonl'))) {
      const d = labDecks(path, readFileSync(join(runDir, 'drafts.jsonl'), 'utf8'));
      if (d) decks = { own: resolve(runDir, d.own), opp: resolve(runDir, d.opp) };
    }
    // A game ForgeCoach launched (mtg-table D303): var/match/<id>/you.dck beside ai.dck, paths in mtg-table.
    const ownPath = ((log.header as { decks?: { player: number; path: string | null }[] }).decks ?? []).find((d) => d.player === log.seat)?.path ?? null;
    const launched = ownPath && /(^|\/)var\/match\/[^/]+\/you\.dck$/.test(ownPath) ? ownPath.replace(/you\.dck$/, 'ai.dck') : null;
    for (const m of ms) {
      const line: MomentLine = { ...m };
      const deck = str(f, 'deck') ?? decks?.own;
      const oppDeck = str(f, 'opp-deck') ?? decks?.opp ?? launched ?? undefined;
      if (deck) line.deck = resolve(deck);
      if (oppDeck) line.oppDeck = oppDeck === launched ? oppDeck : resolve(oppDeck);
      else if (str(f, 'opp-pool')) line.oppPool = resolve(str(f, 'opp-pool')!);
      lines.push(JSON.stringify(line));
    }
    console.error(`${relative(process.cwd(), path)}: ${ms.length} moment${ms.length === 1 ? '' : 's'}${decks ? ' (lab decks)' : ''}`);
  }
  mkdirSync(dirname(resolve(out)), { recursive: true });
  writeFileSync(resolve(out), lines.join('\n') + (lines.length ? '\n' : ''));
  console.log(`${lines.length} moments → ${out}`);
  return 0;
}

function readGraded(path: string): GradedLine[] {
  return readFileSync(resolve(path), 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as GradedLine);
}

/** The log's path inside the repository, copying (gzipped) into bench/coach/logs when it is outside. */
function repoLog(abs: string): string {
  let rel = relative(ROOT, abs);
  if (!rel.startsWith('..')) return rel;
  const log0 = readLogFile(abs);
  const name = `${(log0.header.gameId || basename(abs).replace(/\.jsonl(\.gz)?$/, '')).replace(/[^A-Za-z0-9._-]+/g, '-')}.jsonl.gz`;
  const dest = join(ROOT, LOGS_DIR, name);
  mkdirSync(join(ROOT, LOGS_DIR), { recursive: true });
  if (!existsSync(dest)) {
    const bytes = readFileSync(abs);
    if (bytes[0] === 0x1f && bytes[1] === 0x8b) copyFileSync(abs, dest);
    else writeFileSync(dest, gzipSync(bytes, { level: 9 }));
  }
  rel = relative(ROOT, dest);
  return rel;
}

async function importGraded(pos: string[], f: Map<string, string | true>): Promise<number> {
  if (pos.length !== 1) {
    console.error('import-graded <graded.jsonl> (--select N --candidates c.jsonl | --write [--holdout N])');
    return 2;
  }
  const lines = readGraded(pos[0]!);
  if (f.has('select')) {
    const keep = Number(str(f, 'select'));
    const out = str(f, 'candidates');
    if (!keep || !out) {
      console.error('--select N needs --candidates <file>');
      return 2;
    }
    const { kept, rejected } = selectTurningPoints(lines, {
      keep,
      ...(str(f, 'min-spread') ? { minSpread: Number(str(f, 'min-spread')) } : {}),
      ...(str(f, 'max-fidelity') ? { maxFidelity: Number(str(f, 'max-fidelity')) } : {}),
    });
    const moments = kept.map((k) => {
      const { grade: _g, momentKey: _k, ...m } = k.line;
      // The second pass grades every option the first one saw, plus nothing new.
      return JSON.stringify({ ...m, firstPass: { spread: k.spread, score: k.score } });
    });
    writeFileSync(resolve(out), moments.join('\n') + (moments.length ? '\n' : ''));
    for (const k of kept) console.log(`kept ${k.line.momentKey} (${k.line.type}): ${k.why}`);
    const why = new Map<string, number>();
    for (const r of rejected) why.set(r.why.replace(/[\d.]+/g, '#').slice(0, 60), (why.get(r.why.replace(/[\d.]+/g, '#').slice(0, 60)) ?? 0) + 1);
    console.log(`${kept.length} kept of ${lines.length} → ${out}; rejected: ${[...why].map(([k, n]) => `${k} ×${n}`).join('; ') || 'none'}`);
    return 0;
  }
  if (!f.has('write')) {
    console.error('import-graded: --select N --candidates <file>, or --write');
    return 2;
  }
  const meta = { grader: str(f, 'grader') ?? 'mtg-table tools/coach-grade.sh', gradedAt: new Date().toISOString() };
  const loaded = readCases(ROOT);
  const existing = new Map(loaded.filter((l) => l.value).map((l) => [l.value!.id, l.value!]));
  let cards = readCards(ROOT);
  let wrote = 0;
  const skipped: string[] = [];
  for (const line of lines) {
    const grade = caseGradeOf(line.grade, meta);
    const label = line.id ?? line.momentKey;
    if (!grade) {
      skipped.push(`${label}: ${line.grade.status}${line.grade.error ? ` (${line.grade.error})` : ''}`);
      continue;
    }
    const old = line.id ? existing.get(line.id) : undefined;
    try {
      let c: BenchCase;
      if (old) {
        if (old.moment.frame !== line.frame || old.type !== line.type) throw new Error(`case ${old.id} is a different moment (frame ${old.moment.frame} ${old.type})`);
        c = { ...old, grade };
      } else {
        const logRel = repoLog(resolve(line.log));
        const log = readLogFile(join(ROOT, logRel));
        const moment: BenchCase['moment'] = line.mode === 'review' ? { mode: 'review', frame: line.frame, kind: (line.kind ?? { spell: 'main', attack: 'attack', block: 'block' }[line.type as 'spell']) as 'main' } : { mode: 'live', frame: line.frame };
        c = {
          id: line.id ?? `mined-${line.type}-${basename(logRel).replace(/\.jsonl(\.gz)?$/, '').toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${line.frame}`,
          log: logRel,
          source: `engine-graded: ${basename(line.log)} frame ${line.frame} (${line.mode})`,
          moment,
          seat: log.seat,
          type: line.type,
          acceptable: ['pass'],
          unacceptable: [],
          rationale: gradeRationale(grade),
          confidence: 'high',
          tags: ['engine-graded', 'mined'],
          grade,
        };
        const m = buildMoment(c, log, cards);
        c.label = m.decision.label;
        const miss = missingCards(m.log, m.decision, cards);
        if (miss.length) {
          cards = await fetchMissing(cards, miss);
          writeCards(ROOT, cards);
        }
        const cs = choiceSet(c.type, m.log, m.decision, cards, {});
        const legal = (t: string) => {
          const p = parseAnswer(t);
          return !!p && illegalReason(p, cs) === null;
        };
        const lists = answerLists(grade, legal);
        if (!lists.acceptable.length) throw new Error('no graded option is legal by the bench’s own check');
        c.acceptable = lists.acceptable;
        c.unacceptable = lists.unacceptable;
        const informative = grade.noise <= LOW_INFO_HALF_WIDTH && seriousFidelity(grade.fidelity).length === 0;
        if (!informative) c.confidence = 'low';
      }
      const b = buildCase(c, readLogFile(join(ROOT, c.log)), cards);
      const problems = caseProblems(b);
      if (problems.length) throw new Error(problems.join('; '));
      writeFileSync(join(ROOT, CASES_DIR, `${c.id}.json`), JSON.stringify(c, null, 2) + '\n');
      existing.set(c.id, c);
      wrote++;
      console.log(`${old ? 'graded' : 'new   '} ${c.id}: noise ±${grade.noise.toFixed(2)}, best ${grade.options.find((o) => o.best)?.token ?? '?'}${c.confidence === 'low' ? ' (low confidence: noisy or a serious fidelity warning)' : ''}`);
    } catch (e) {
      skipped.push(`${label}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  for (const s of skipped) console.error(`skipped ${s}`);
  const n = Number(str(f, 'holdout') ?? 0);
  if (n > 0) {
    const graded = [...existing.values()].filter((c) => c.grade);
    const hold = new Set(chooseHoldout(graded, n));
    for (const c of graded) {
      if (hold.has(c.id) && !c.holdout) {
        c.holdout = true;
        writeFileSync(join(ROOT, CASES_DIR, `${c.id}.json`), JSON.stringify(c, null, 2) + '\n');
      }
    }
    console.log(`held out (${hold.size}): ${[...hold].join(', ')}`);
  }
  console.log(`${wrote} case${wrote === 1 ? '' : 's'} written, ${skipped.length} skipped. Check them: npm run bench:coach -- --dry-run`);
  return skipped.length && !wrote ? 1 : 0;
}

function regrade(pos: string[]): number {
  if (pos.length !== 1) {
    console.error('regrade <results.json>');
    return 2;
  }
  const { report, warnings } = normalizeReport(JSON.parse(readFileSync(resolve(pos[0]!), 'utf8')));
  for (const w of warnings) console.error(`Warning: ${w}`);
  const cases = readCases(ROOT).filter((l) => l.value).map((l) => l.value!);
  const { built } = buildAll(ROOT, cases, readCards(ROOT), { format: report.promptFormat ?? 'classic' });
  const r = regradeReport(report, built);
  const base = resolve(pos[0]!).replace(/\.json$/, '') + '-regraded';
  writeFileSync(`${base}.json`, JSON.stringify(r.report, null, 1) + '\n');
  writeFileSync(`${base}.md`, reportMarkdown(r.report));
  console.log(`${r.graded} answers in ${r.cases} graded cases → ${relative(process.cwd(), base)}.json and .md`);
  return 0;
}

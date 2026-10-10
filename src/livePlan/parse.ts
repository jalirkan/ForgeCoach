/*
 * ForgeCoach — livePlan/parse.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Ported from mtg-table tools/llm-seat (lib/plan.mjs, D419: plan mode). The
 * coach answers every moment with
 *
 *   PLAN: <one or two sentences, plain words>
 *   STEPS:
 *   1. <verb> <card name or creature names> [-> <target name>]
 *   2. ...
 *   END
 *
 * read strictly: reasoning is allowed only BEFORE the `PLAN:` line (kept as
 * `preamble`, the play screen's "Why"), nothing but blank lines (or a ```
 * fence) after `END`, the steps numbered 1, 2, 3 …, and every step one of the
 * fixed verbs below. An invalid reply gets a precise reason, which goes back
 * to the model as a correction (corrections.ts).
 *
 * Names are matched the seat's way: case, accents and punctuation do not
 * count, `#35` (or `[35]`, the game log's spelling) picks one card by its id,
 * and a name that fits cards of two owners or zones is ambiguous unless an id
 * says which. Pure: no state, no clock.
 */

export const VERBS = ['play land', 'cast', 'activate', 'attack with', 'block', 'target', 'choose', 'pass', 'keep', 'mulligan', 'hold'] as const;
export type Verb = (typeof VERBS)[number];

/** Verbs that end a list of steps (nothing may follow them). */
const LAST: ReadonlySet<Verb> = new Set(['pass', 'hold']);
const ALONE: ReadonlySet<Verb> = new Set(['keep', 'mulligan']);

const VERB_LIST = VERBS.join(', ');

export interface Step {
  n: number;
  verb: Verb;
  /** The step as the model wrote it (decoration stripped). */
  raw: string;
  /** play land / cast / activate: the card (activate: may carry ": <ability>"). */
  name?: string;
  /** cast / activate: the text after "->", or null. */
  targets?: string | null;
  /** attack with (null = none), target, choose: the names as written. */
  names?: string | null;
  /** block: the attacker and my blocker. */
  attacker?: string;
  blocker?: string;
}

export type ParsedPlan = { ok: true; plan: string; steps: Step[]; preamble: string } | { ok: false; error: string };

/** Strips the decoration a model puts round a step: backticks, bold, a final full stop. */
function cleanLine(s: string): string {
  return s.trim().replace(/^[`*_]+|[`*_]+$/g, '').replace(/\.$/, '').trim();
}

const splitArrow = (s: string): { what: string; to: string | null } => {
  const m = /^(.*?)\s*(?:->|→|=>)\s*(.*)$/.exec(s);
  return m ? { what: m[1]!.trim(), to: m[2]!.trim() } : { what: s.trim(), to: null };
};

/** One step's text (after the number) -> a step, or {error}. */
export function parseStep(n: number, text: string): Step | { error: string } {
  const raw = cleanLine(text);
  const low = raw.toLowerCase();
  const verb = VERBS.find((v) => low === v || low.startsWith(`${v} `));
  const quote = `step ${n} "${raw.slice(0, 80)}"`;
  if (!verb) {
    const first = low.split(/\s+/)[0] ?? '';
    return { error: `${quote}: "${first}" is not a verb this program knows; the verbs are: ${VERB_LIST}` };
  }
  const arg = raw.slice(verb.length).trim();
  const step: Step = { n, verb, raw };
  switch (verb) {
    case 'play land':
      if (!arg) return { error: `${quote}: which land? write "play land <card name>"` };
      if (/->|→/.test(arg)) return { error: `${quote}: a land has no target` };
      step.name = arg;
      return step;
    case 'cast':
    case 'activate': {
      const { what, to } = splitArrow(arg);
      if (!what) return { error: `${quote}: which card? write "${verb} <card name>"` };
      if (to === '') return { error: `${quote}: nothing after "->"; name the target or leave the arrow out` };
      step.name = what;
      step.targets = to ? to : null;
      return step;
    }
    case 'attack with':
      if (!arg) return { error: `${quote}: with which creatures? write "attack with <names>" or "attack with none"` };
      step.names = /^(none|nothing|no one|nobody)$/i.test(arg) ? null : arg;
      return step;
    case 'block': {
      const m = /^(.+?)\s+with\s+(.+)$/i.exec(arg);
      if (!m) return { error: `${quote}: write "block <attacker> with <your blocker>", one line per block` };
      step.attacker = m[1]!.trim();
      step.blocker = m[2]!.trim();
      return step;
    }
    case 'target':
    case 'choose':
      if (!arg) return { error: `${quote}: ${verb} what? write "${verb} <name>"` };
      step.names = arg;
      return step;
    default:
      if (arg) return { error: `${quote}: "${verb}" takes nothing after it` };
      return step;
  }
}

/**
 * parsePlan(text) -> {ok: true, plan, steps, preamble} | {ok: false, error}.
 * `preamble` is the reasoning before PLAN: (shown behind "Why").
 */
export function parsePlan(text: string | null | undefined): ParsedPlan {
  if (typeof text !== 'string' || text.trim() === '') return { ok: false, error: 'the reply is empty' };
  const lines = text.replace(/\r/g, '').split('\n');
  const isFence = (l: string) => /^\s*```\w*\s*$/.test(l);
  const head = (l: string, word: string) => new RegExp(`^\\s*[*_]{0,2}${word}:[*_]{0,2}\\s*(.*)$`).exec(l);
  const planAt = lines.findIndex((l) => head(l, 'PLAN'));
  if (planAt < 0) return { ok: false, error: 'there is no line starting with "PLAN:"' };
  const planText = [head(lines[planAt]!, 'PLAN')![1]!.trim()];
  let i = planAt + 1;
  for (; i < lines.length && !head(lines[i]!, 'STEPS'); i++) {
    if (/^\s*END\s*$/.test(lines[i]!)) return { ok: false, error: 'there is no "STEPS:" line between PLAN: and END' };
    if (!isFence(lines[i]!) && lines[i]!.trim()) planText.push(lines[i]!.trim());
  }
  if (i >= lines.length) return { ok: false, error: 'there is no "STEPS:" line after PLAN:' };
  const plan = planText.filter(Boolean).join(' ');
  if (!plan) return { ok: false, error: 'the PLAN: line is empty; say in a sentence what you mean to do' };
  if (head(lines[i]!, 'STEPS')![1]!.trim()) return { ok: false, error: 'put the steps on their own lines after "STEPS:", one numbered step per line' };
  const steps: Step[] = [];
  let end = -1;
  for (i += 1; i < lines.length; i++) {
    const l = lines[i]!;
    if (/^\s*[*_]{0,2}END[*_]{0,2}\s*$/.test(l)) {
      end = i;
      break;
    }
    if (!l.trim() || isFence(l)) continue;
    const m = /^\s*(\d+)[.)]\s+(.*)$/.exec(l);
    if (!m) return { ok: false, error: `the line "${l.trim().slice(0, 80)}" between STEPS: and END is not a numbered step` };
    const n = Number(m[1]);
    if (n !== steps.length + 1) return { ok: false, error: `the steps must be numbered 1, 2, 3 …: found ${n} where ${steps.length + 1} was due` };
    const s = parseStep(n, m[2]!);
    if ('error' in s) return { ok: false, error: s.error };
    steps.push(s);
  }
  if (end < 0) return { ok: false, error: 'there is no END line; the reply must end with END on a line of its own' };
  const after = lines.slice(end + 1).find((l) => l.trim() && !isFence(l));
  if (after !== undefined) return { ok: false, error: `nothing may follow END, but the reply goes on: "${after.trim().slice(0, 60)}"` };
  if (steps.length === 0) return { ok: false, error: 'STEPS: lists no step; write "1. pass" to do nothing now' };
  for (const s of steps) {
    if (LAST.has(s.verb) && s.n !== steps.length) return { ok: false, error: `step ${s.n} "${s.raw}" must be the last step` };
    if (ALONE.has(s.verb) && steps.length > 1) return { ok: false, error: `step ${s.n} "${s.raw}" must be the only step` };
  }
  const preamble = lines.slice(0, planAt).join('\n').trim();
  return { ok: true, plan, steps, preamble };
}

/**
 * What can be read of a reply still streaming: the reasoning so far and, once
 * the PLAN: line is there, its sentence (the panel shows it before the steps).
 */
export function partialPlan(text: string): { preamble: string; plan: string | null } {
  const lines = text.replace(/\r/g, '').split('\n');
  const at = lines.findIndex((l) => /^\s*[*_]{0,2}PLAN:/.test(l));
  if (at < 0) return { preamble: text.trim(), plan: null };
  const plan = lines[at]!.replace(/^\s*[*_]{0,2}PLAN:[*_]{0,2}\s*/, '').trim();
  return { preamble: lines.slice(0, at).join('\n').trim(), plan: plan || null };
}

export const stepText = (s: Pick<Step, 'n' | 'raw'>): string => `step ${s.n} '${s.raw}'`;

/** "1. play land Island; 2. cast Shock" — a plan as the model wrote it. */
export function stepsText(steps: readonly Step[]): string {
  return steps.map((s) => `${s.n}. ${s.raw}`).join('; ');
}

// ---------------------------------------------------------------------------
// Names

/** A name as the matcher compares it: lower case, no accents, no punctuation. */
export function normName(s: unknown): string {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/['’`]/g, '')
    .replace(/[^\p{L}\p{N} ]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface Ref {
  name: string;
  id: number | null;
  raw: string;
}

/** "Island #35", "Island [35]", "Grizzly Bears (2/2)" -> {name, id}. */
export function parseRef(text: unknown): Ref {
  let t = String(text ?? '').trim();
  let id: number | null = null;
  const idm = /\s*(?:#|\[#?)(\d+)\]?\s*$/.exec(t) ?? /\s*\(#(\d+)\)\s*$/.exec(t);
  if (idm) {
    id = Number(idm[1]);
    t = t.slice(0, idm.index);
  }
  t = t.replace(/\s*\([^)]*\)\s*$/, ''); // a trailing "(2/2)", "(tapped)"
  const id2 = /\s*(?:#|\[#?)(\d+)\]?\s*$/.exec(t);
  if (id === null && id2) {
    id = Number(id2[1]);
    t = t.slice(0, id2.index);
  }
  return { name: normName(t), id, raw: String(text ?? '').trim() };
}

const facesOf = (name: string): string[] => {
  const n = String(name ?? '');
  return [normName(n), ...n.split(' // ').map(normName)].filter(Boolean);
};

export interface Candidate<T = unknown> {
  id: number | string;
  name: string;
  /** What makes two same-named cards different choices (owner and zone). */
  group?: string;
  aliases?: string[];
  data?: T;
}

export type Match<T> = { ok: true; pick: Candidate<T> } | { ok: false; why: 'missing' | 'ambiguous' | 'id'; found: Candidate<T>[] };

/**
 * matchRef(ref, candidates): same-named candidates in one group are
 * interchangeable and the first is taken. `taken` ids are skipped.
 */
export function matchRef<T>(ref: Ref, candidates: readonly Candidate<T>[], taken: ReadonlySet<number | string> = new Set()): Match<T> {
  const free = candidates.filter((c) => !taken.has(c.id));
  if (ref.id !== null) {
    const c = free.find((x) => x.id === ref.id);
    if (!c) return { ok: false, why: 'id', found: [] };
    // the number is the card's own: a name that is only near ("Insect Token" for
    // a token the engine calls "Insect") still means this card
    const near = (a: string, b: string) =>
      a === b || a.replace(/\btoken\b/g, '').trim() === b.replace(/\btoken\b/g, '').trim() || a.startsWith(b) || b.startsWith(a);
    if (ref.name && !facesOf(c.name).some((f) => near(f, ref.name)) && !c.aliases?.includes(ref.name)) return { ok: false, why: 'id', found: [c] };
    return { ok: true, pick: c };
  }
  const untoken = (x: string) => x.replace(/\btoken\b/g, '').replace(/\s+/g, ' ').trim();
  let hits = free.filter((c) => facesOf(c.name).includes(ref.name) || (c.aliases ?? []).includes(ref.name));
  if (hits.length === 0) hits = free.filter((c) => facesOf(c.name).some((f) => untoken(f) === untoken(ref.name)));
  if (hits.length === 0) return { ok: false, why: 'missing', found: [] };
  const groups = new Set(hits.map((c) => c.group ?? ''));
  if (groups.size > 1) return { ok: false, why: 'ambiguous', found: hits };
  return { ok: true, pick: hits[0]! };
}

/**
 * Splits "A, B, C" into names, keeping a name that itself has a comma
 * ("Peggy Carter, Secret Agent") whole when it is one of `known`. `;` and
 * " and " also separate.
 */
export function splitNames(text: string, known: readonly string[] = []): string[] {
  const knownSet = new Set(known.map(normName));
  const out: string[] = [];
  for (const chunk of String(text).split(/;|\s+and\s+/i)) {
    const parts = chunk
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);
    let i = 0;
    while (i < parts.length) {
      let took = 1;
      for (let j = parts.length; j > i + 1; j--) {
        if (knownSet.has(parseRef(parts.slice(i, j).join(', ')).name)) {
          took = j - i;
          break;
        }
      }
      out.push(parts.slice(i, i + took).join(', '));
      i += took;
    }
  }
  return out;
}

/** "Island #35" when the name is shared by another visible card, else the name. */
export function showName(card: { id: number; name?: string } | null | undefined, dupes: ReadonlySet<string> | null): string {
  const n = card?.name ?? '?';
  return dupes && dupes.has(normName(n)) ? `${n} #${card!.id}` : n;
}

/** The names that occur on more than one card in `cards`. */
export function duplicateNames(cards: Iterable<{ name?: string; hidden?: unknown } | null | undefined>): Set<string> {
  const seen = new Map<string, number>();
  for (const c of cards) {
    if (!c || c.hidden === true || !c.name) continue;
    const k = normName(c.name);
    seen.set(k, (seen.get(k) ?? 0) + 1);
  }
  return new Set([...seen].filter(([, n]) => n > 1).map(([k]) => k));
}

// ---------------------------------------------------------------------------
// Naming one ability of a permanent (M63, D420)

const LOYALTY = /^[+\-−–]?\d+$/;
const signFix = (s: string) => String(s).replace(/[−–]/g, '-').trim();

/**
 * The ways a step names a permanent and one of its abilities:
 * "Jace, the Mind Sculptor: +2", "Jace, the Mind Sculptor +2",
 * "Jace, the Mind Sculptor (+2)", "Clue Token: draw a card". Every {name,
 * ability} split worth trying, the whole text (no ability) first.
 */
export function abilitySplits(text: string): Array<{ name: string; ability: string | null }> {
  const t = String(text ?? '').trim();
  const out: Array<{ name: string; ability: string | null }> = [{ name: t, ability: null }];
  const loyalty = /^(.*?)\s*(?:\(\s*([+\-−–]?\d+)\s*\)|\s([+\-−–]\d+|0))\s*$/.exec(t);
  if (loyalty && loyalty[1]) out.push({ name: loyalty[1].replace(/[:\s]+$/, ''), ability: signFix(loyalty[2] ?? loyalty[3]!) });
  for (let i = t.indexOf(':'); i > 0; i = t.indexOf(':', i + 1)) {
    const ability = t.slice(i + 1).trim().replace(/^["'“]|["'”]$/g, '');
    if (ability) out.push({ name: t.slice(0, i).trim(), ability });
  }
  for (const sep of [' -- ', ' — ', ' - ']) {
    const i = t.indexOf(sep);
    if (i > 0) out.push({ name: t.slice(0, i).trim(), ability: t.slice(i + sep.length).trim() });
  }
  return out;
}

/** The cost part of an engine ability label: "+2" of "+2: Look at…". */
export const abilityCost = (label: unknown): string | null => {
  const s = String(label ?? '').replace(/\([^)]*\)/g, '');
  const i = s.indexOf(':');
  return i > 0 ? s.slice(0, i).trim() : null;
};

/**
 * matchAbility(selector, labels): a loyalty cost ("+2", "-1", "0", "2" for
 * "+2") picks the label that starts with it; otherwise the label in full, then
 * a word or phrase only one label contains, decides.
 */
export function matchAbility(selector: string, labels: readonly string[]): { ok: true; index: number } | { ok: false; why: 'missing' | 'ambiguous' } {
  if (labels.length === 1) return { ok: true, index: 0 };
  const rawSel = String(selector ?? '').trim().toLowerCase();
  if (rawSel.length >= 2) {
    const pre = labels.map((l, i) => (String(l).trim().toLowerCase().startsWith(rawSel) ? i : -1)).filter((i) => i >= 0);
    if (pre.length === 1) return { ok: true, index: pre[0]! };
  }
  const sel = signFix(selector);
  const both = /^([+\-]?\d+)\s*:?\s+(\S.*)$/.exec(sel);
  if (both) {
    const costs = labels.map((l) => signFix(abilityCost(l) ?? ''));
    const same = labels.map((_, i) => i).filter((i) => costs[i] === both[1] || (/^\d+$/.test(both[1]!) && both[1] !== '0' && costs[i] === `+${both[1]}`));
    if (same.length) {
      const sub = matchAbility(both[2]!, same.map((i) => labels[i]!));
      if (sub.ok) return { ok: true, index: same[sub.index]! };
      if (normName(labels[same[0]!]) === normName(sel) && same.length === 1) return { ok: true, index: same[0]! };
    }
  }
  if (LOYALTY.test(sel)) {
    const costs = labels.map((l) => signFix(abilityCost(l) ?? ''));
    let hits = costs.map((c, i) => (c === sel || (sel === '0' && c === '+0') ? i : -1)).filter((i) => i >= 0);
    if (hits.length === 0 && /^\d+$/.test(sel) && sel !== '0') hits = costs.map((c, i) => (c === `+${sel}` ? i : -1)).filter((i) => i >= 0);
    if (hits.length === 1) return { ok: true, index: hits[0]! };
    if (hits.length > 1) return { ok: false, why: 'ambiguous' };
  }
  const n = normName(sel);
  const exact = labels.map((l, i) => (normName(l) === n ? i : -1)).filter((i) => i >= 0);
  if (exact.length === 1) return { ok: true, index: exact[0]! };
  if (n.length >= 3) {
    const part = labels.map((l, i) => (normName(l).includes(n) ? i : -1)).filter((i) => i >= 0);
    if (part.length === 1) return { ok: true, index: part[0]! };
    if (part.length > 1) return { ok: false, why: 'ambiguous' };
    const words = n.split(' ').filter((w) => w.length >= 3);
    if (words.length) {
      const all = labels.map((l, i) => (words.every((w) => normName(l).split(' ').includes(w)) ? i : -1)).filter((i) => i >= 0);
      if (all.length === 1) return { ok: true, index: all[0]! };
      if (all.length > 1) return { ok: false, why: 'ambiguous' };
    }
  }
  return { ok: false, why: 'missing' };
}

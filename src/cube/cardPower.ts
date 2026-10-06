/*
 * ForgeCoach — cube/cardPower.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The cube lab's matchup-model card strengths (mtg-table J062, model M0: a
 * pooled Bradley–Terry model over every card copy in both decks, with a
 * feature prior), shipped as public/cubes/card-power.json. On held-out drafts
 * it predicts games better than the per-cube shrunk win rates of meta.json
 * (log-loss 0.6525 against 0.6690, J062's report), because it credits each
 * card for itself rather than for the deck it sat in.
 *
 *   {"schema":1, "model":"M0",
 *    "source":{"job":"J062","nights":"1-2","games":48202,"tau":0.06},
 *    "pointsPerLogit":25,
 *    "cards":{"<name>":{"power":0.2263,"sd":0.0308,"games":7304,"cubes":["vintage",…]},
 *             "<land>":{"power":…,"sd":…,"games":…,"cubes":[…],"land":true},
 *             "<AI:RemoveDeck:Random>":{…,"ai":"random"},
 *             "<AI:RemoveDeck:All>":{"unrated":"limited","games":…,"cubes":[…]}}}
 *
 * power: logits per copy, relative to the average nonland card of the committed
 * cubes; points = power × pointsPerLogit (win-rate points at even odds); sd: the
 * Laplace posterior SD (mtg-table D342: the one to use); tau: the prior SD of a
 * card's power, so (sd / tau)² is how much of the prior's uncertainty is left.
 * `unrated: "limited"` is Forge's AI:RemoveDeck:All — the AI never builds the card,
 * so the model's number for it is its feature prior, NOT a rating (mtg-table D343):
 * such an entry carries no power at all, and the validator drops one that does.
 *
 * `fromPowerTsv` turns J062's power.tsv into this shape (scripts/card-power.ts runs
 * it); `parseCardPower` validates a file strictly (throws on the envelope, drops a
 * bad card row and counts it).
 */

export interface CardPower {
  /** Logits per copy against the average nonland card; null when unrated. */
  power: number | null;
  /** Posterior SD of `power`; null when unrated. */
  sd: number | null;
  /** Games with the card in exactly one deck. */
  games: number;
  /** The cubes the card was measured in (ids as in cube/cubes.ts). */
  cubes: string[];
  land: boolean;
  /** Forge's AI deck hint: 'random' (AI:RemoveDeck:Random, still rated) or 'limited' (AI:RemoveDeck:All, not rated). */
  ai: 'random' | 'limited' | null;
  unrated: boolean;
}

export interface CardPowerData {
  schema: 1;
  model: 'M0';
  source: { job: string; nights: string; games: number; tau: number };
  pointsPerLogit: number;
  cards: Map<string, CardPower>;
  /** Card rows the validator dropped. */
  dropped: number;
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const finite = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const CUBE_ID = /^[a-z][a-z0-9-]{0,39}$/;
const NAME_MAX = 141;

/** Validate a parsed card-power.json; throws an Error saying what is wrong with the envelope. */
export function parseCardPower(raw: unknown): CardPowerData {
  if (!isObj(raw)) throw new Error('card-power.json is not a JSON object.');
  if (raw.schema !== 1) throw new Error(`card-power.json schema ${String(raw.schema)} is not supported (this page reads schema 1).`);
  if (raw.model !== 'M0') throw new Error(`card-power.json model ${String(raw.model)} is not M0.`);
  const s = raw.source;
  if (!isObj(s) || typeof s.job !== 'string' || !/^J\d{3,}$/.test(s.job) || typeof s.nights !== 'string' || !/^\d+(-\d+)?$/.test(s.nights)
    || !finite(s.games) || s.games <= 0 || !finite(s.tau) || s.tau <= 0 || s.tau > 1) {
    throw new Error('card-power.json source is not {job: "J###", nights: "1-2", games > 0, 0 < tau <= 1}.');
  }
  if (!finite(raw.pointsPerLogit) || raw.pointsPerLogit <= 0 || raw.pointsPerLogit > 100) throw new Error('card-power.json pointsPerLogit is not a positive number.');
  if (!isObj(raw.cards)) throw new Error('card-power.json cards is not an object.');
  const cards = new Map<string, CardPower>();
  let dropped = 0;
  for (const [name, v] of Object.entries(raw.cards)) {
    const c = cardRow(name, v);
    if (c) cards.set(name, c); else dropped++;
  }
  if (!cards.size) throw new Error('card-power.json has no valid card.');
  return { schema: 1, model: 'M0', source: { job: s.job, nights: s.nights, games: s.games, tau: s.tau }, pointsPerLogit: raw.pointsPerLogit, cards, dropped };
}

function cardRow(name: string, v: unknown): CardPower | null {
  if (!name || name.length > NAME_MAX || /[\u0000-\u001f]/.test(name) || !isObj(v)) return null;
  if (!finite(v.games) || v.games < 0 || !Number.isInteger(v.games)) return null;
  if (!Array.isArray(v.cubes) || !v.cubes.every((c) => typeof c === 'string' && CUBE_ID.test(c))) return null;
  const land = v.land === undefined ? false : v.land === true ? true : null;
  if (land === null) return null;
  const base = { games: v.games, cubes: [...(v.cubes as string[])], land };
  if (v.unrated !== undefined) {
    if (v.unrated !== 'limited') return null;
    // Never a verdict: whatever else the row says, it carries no power.
    return { ...base, power: null, sd: null, ai: 'limited', unrated: true };
  }
  if (!finite(v.power) || Math.abs(v.power) > 2 || !finite(v.sd) || v.sd <= 0 || v.sd > 2) return null;
  if (v.ai !== undefined && v.ai !== 'random') return null;
  return { ...base, power: v.power, sd: v.sd, ai: v.ai === 'random' ? 'random' : null, unrated: false };
}

/** The JSON shape of one row (what fromPowerTsv writes and parseCardPower reads). */
type JsonRow = { power?: number; sd?: number; games: number; cubes: string[]; land?: true; ai?: 'random'; unrated?: 'limited' };

/**
 * J062's power.tsv (header comments, then `name power sdPost sdBoot points prior games land ai cubes`)
 * as the card-power.json object. Throws on a file that is not that table.
 */
export function fromPowerTsv(tsv: string, source: { job: string; nights: string }): Record<string, unknown> {
  const lines = tsv.split('\n').map((l) => l.replace(/\r$/, ''));
  const comments = lines.filter((l) => l.startsWith('#')).join('\n');
  const tau = Number(/\btau\s+([0-9.]+)/.exec(comments)?.[1]);
  const games = Number(/\b([0-9]+)\s+games\b/.exec(comments)?.[1]);
  const ppl = Number(/points\s*=\s*power\s*x\s*([0-9.]+)/.exec(comments)?.[1]);
  if (!(tau > 0) || !(games > 0) || !(ppl > 0)) throw new Error('power.tsv: the header comments do not give tau, the games and points = power x N');
  const head = lines.find((l) => l && !l.startsWith('#'));
  const cols = head?.split('\t') ?? [];
  const want = ['name', 'power', 'sdPost', 'points', 'games', 'land', 'ai', 'cubes'];
  for (const w of want) if (!cols.includes(w)) throw new Error(`power.tsv: no "${w}" column`);
  const at = (f: string[], c: string): string => f[cols.indexOf(c)] ?? '';
  const cards: Record<string, JsonRow> = {};
  for (const l of lines.slice(lines.indexOf(head as string) + 1)) {
    if (!l.trim()) continue;
    const f = l.split('\t');
    const name = at(f, 'name');
    const row: JsonRow = { games: Number(at(f, 'games')), cubes: at(f, 'cubes').split(',').filter(Boolean) };
    if (at(f, 'land') === '1') row.land = true;
    const ai = at(f, 'ai');
    if (ai === 'limited') row.unrated = 'limited';
    else {
      row.power = Number(at(f, 'power'));
      row.sd = Number(at(f, 'sdPost'));
      if (ai === 'random') row.ai = 'random';
      else if (ai) throw new Error(`power.tsv: ${name}: ai "${ai}" is neither limited nor random`);
    }
    if (!cardRow(name, { ...row })) throw new Error(`power.tsv: the row for "${name}" does not validate`);
    // key order: power, sd, games, cubes, then the flags
    cards[name] = Object.fromEntries(['power', 'sd', 'games', 'cubes', 'land', 'ai', 'unrated'].filter((k) => k in row).map((k) => [k, row[k as keyof JsonRow]])) as JsonRow;
  }
  return { schema: 1, model: 'M0', source: { job: source.job, nights: source.nights, games, tau }, pointsPerLogit: ppl, cards };
}

// ---------------------------------------------------------------------------
// Loading

type Fetch = (url: string) => Promise<Pick<Response, 'ok' | 'status' | 'json'>>;

let shipped: Promise<CardPowerData | null> | null = null;

/** The shipped card-power.json (fetched once), or null when it is missing or unreadable. */
export function loadCardPower(base: string, fetcher: Fetch = (u) => fetch(u)): Promise<CardPowerData | null> {
  shipped ??= (async () => {
    try {
      const res = await fetcher(`${base}cubes/card-power.json`);
      if (!res.ok) return null;
      return parseCardPower(await res.json());
    } catch {
      return null;
    }
  })();
  return shipped;
}

/** Tests: forget the cached load. */
export function resetCardPowerCache(): void {
  shipped = null;
}

/** "+1.2" / "−0.8" / "0.0", one decimal. */
export function signed(x: number): string {
  const r = Math.round(x * 10) / 10;
  return r > 0 ? `+${r.toFixed(1)}` : r < 0 ? `−${Math.abs(r).toFixed(1)}` : '0.0';
}

/** "+5.7 pts (95% +4.1 to +7.2)". */
export function pointsLine(v: { points: number; lo: number; hi: number }): string {
  return `${signed(v.points)} pts (95% ${signed(v.lo)} to ${signed(v.hi)})`;
}

/** "nights 1–2" / "night 3". */
export function nightsLabel(d: Pick<CardPowerData, 'source'>): string {
  const [a, b] = d.source.nights.split('-');
  return b && b !== a ? `nights ${a}–${b}` : `night ${a}`;
}

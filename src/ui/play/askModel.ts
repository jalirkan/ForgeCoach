/*
 * ForgeCoach — ui/play/askModel.ts
 * Copyright (C) 2026 the mtg-table authors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Adapted from mtg-table web/src/render/AskModal.tsx (defaultDraft,
 * answerFromDraft, defaultAnswer, nullIsLegal, askOptions) and
 * web/src/render/picker.ts (toggleChoice), with validation, per-kind skip
 * actions and the opening-hand helpers added for ForgeCoach's play mode.
 *
 * Pure: no DOM, no React. Everything the AskDialog buttons send goes through
 * `answerFromDraft` / `skipAction` here, so the tests in askModel.test.ts drive
 * exactly the values the UI would put on the wire.
 *
 * The rules this file keeps (mtg-table docs/protocol.md §5):
 *   - answers address options by their ask-local `id` (§5.1) — never a card id;
 *   - `order` addresses `dest ++ source`, `sideboard` addresses `main ++ side`,
 *     as ONE index space (§5.1, §5.3);
 *   - `order`, `choose_list` and `manipulate_list` are never answered `null`
 *     (§5.3/§5.4): their Forge call sites dereference the result, so "skip"
 *     sends the documented default instead;
 *   - a numeric `text` ask's one-click way out is `null` (§5.4, M25/M29);
 *   - the client checks only the numbers the engine sent (min/max, totals,
 *     per-target max, atLeastOne) — it never invents a rules bound.
 */
import type { AnswerValue, AskBody, AskOption, InputBody } from '../../protocol.ts';

// ---------------------------------------------------------------------------
// Drafts — what the player has built so far
// ---------------------------------------------------------------------------

export type AskDraft =
  /** `ability_menu`, `options` — one option index (-1 = none yet). */
  | { shape: 'index'; index: number }
  /** `confirm`. */
  | { shape: 'bool'; yes: boolean }
  /** `text`. */
  | { shape: 'text'; text: string }
  /** `choose_list`, `choose_entities`, `manipulate_list`, `sideboard`. */
  | { shape: 'indices'; indices: number[] }
  /** `order` — `{ordered, remember}` over `dest ++ source`. */
  | { shape: 'order'; ordered: number[]; remember: boolean }
  /** `assign_damage`, `assign_amount` — option index → amount. */
  | { shape: 'amounts'; amounts: Record<string, number> };

export type AbilityOption = AskOption & { canPlay: boolean; isSpell: boolean };
export type DamageTarget = AskOption & { lethal?: number | null; defender?: boolean };
export type AmountTarget = AskOption & { max?: number | null };

/** Every option of an ask, flattened in the order the answer indexes them (§5.1). */
export function askOptions(ask: AskBody): AskOption[] {
  switch (ask.kind) {
    case 'ability_menu':
    case 'options':
    case 'choose_list':
    case 'choose_entities':
      return ask.options;
    case 'order':
      return [...ask.dest, ...ask.source];
    case 'sideboard':
      return [...ask.main, ...ask.side];
    case 'assign_damage':
    case 'assign_amount':
      return ask.targets;
    case 'manipulate_list':
      return ask.cards;
    case 'confirm':
    case 'text':
      return [];
  }
}

export function range(n: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(i);
  return out;
}

/**
 * How many of `dest ++ source` may end up in the answer. `min`/`max` are
 * Forge's `remainingMin`/`remainingMax` — bounds on what is LEFT in source,
 * `-1` = unconstrained (§5.3).
 */
export function orderBounds(ask: { dest: unknown[]; source: unknown[]; min: number; max: number }): {
  lo: number;
  hi: number;
} {
  const total = ask.dest.length + ask.source.length;
  let lo = ask.max >= 0 ? total - ask.max : 0;
  let hi = ask.min >= 0 ? total - ask.min : total;
  lo = Math.max(0, Math.min(lo, total));
  hi = Math.max(lo, Math.min(hi, total));
  return { lo, hi };
}

/** Bounds on how many options a list choice takes; `max < 0` = unbounded. */
export function choiceBounds(ask: { min: number; max: number; options: unknown[] }): { lo: number; hi: number } {
  const n = ask.options.length;
  const lo = Math.max(0, ask.min);
  const hi = ask.max < 0 ? n : Math.min(ask.max, n);
  return { lo, hi };
}

function damageDefault(targets: DamageTarget[], total: number): Record<string, number> {
  const n = targets.length;
  if (n === 0) return {};
  if (n === 1) return { '0': total };
  // Blockers in the engine's order, each up to its `lethal`; whatever is left
  // stays on the last blocker. Never on the defender (index 0) by default.
  const out: Record<string, number> = {};
  let left = total;
  for (let i = 1; i < n && left > 0; i++) {
    const lethal = targets[i]!.lethal;
    if (typeof lethal !== 'number' || lethal <= 0) continue;
    const give = Math.min(lethal, left);
    out[String(i)] = give;
    left -= give;
  }
  if (left > 0) {
    const last = String(n - 1);
    out[last] = (out[last] ?? 0) + left;
  }
  return out;
}

function amountDefault(targets: AmountTarget[], total: number, atLeastOne: boolean): Record<string, number> {
  const n = targets.length;
  if (n === 0) return {};
  const cap = (i: number): number => {
    const m = targets[i]!.max;
    return typeof m === 'number' && m >= 0 ? m : Infinity;
  };
  const out: Record<string, number> = {};
  let left = total;
  if (atLeastOne && total >= n) {
    for (let i = 0; i < n; i++) out[String(i)] = 1;
    left -= n;
  }
  for (let i = 0; i < n && left > 0; i++) {
    const have = out[String(i)] ?? 0;
    const give = Math.min(left, Math.max(0, cap(i) - have));
    if (give > 0) out[String(i)] = have + give;
    left -= give;
  }
  // Every cap is full and something is left: the engine's numbers do not add
  // up, so put the rest on the first target rather than lose it.
  if (left > 0) out['0'] = (out['0'] ?? 0) + left;
  return out;
}

/**
 * The always-legal draft (§5.4) — what "skip" sends for the kinds with no
 * usable `null`, and what a broken draft falls back to.
 */
export function defaultDraft(ask: AskBody): AskDraft {
  switch (ask.kind) {
    case 'ability_menu': {
      const playable = ask.options.findIndex((o) => o.canPlay);
      return { shape: 'index', index: playable >= 0 ? ask.options[playable]!.id : -1 };
    }
    case 'options': {
      const n = ask.options.length;
      const d = ask.defaultIndex;
      return { shape: 'index', index: n === 0 ? -1 : d >= 0 && d < n ? d : 0 };
    }
    case 'confirm':
      return { shape: 'bool', yes: ask.defaultYes };
    case 'text':
      return { shape: 'text', text: ask.initial };
    case 'choose_list': {
      if (ask.reveal) return { shape: 'indices', indices: [] };
      const want = Math.max(0, Math.min(ask.min, ask.options.length));
      const pre = validPreselection(ask);
      return { shape: 'indices', indices: pre.length > 0 ? pre : range(want) };
    }
    case 'choose_entities':
      return { shape: 'indices', indices: range(Math.max(0, Math.min(ask.min, ask.options.length))) };
    case 'order': {
      // The first k of `dest ++ source`: what is already in dest, clamped into
      // the window remainingMin/remainingMax leave open (report 07 §6.7).
      const { lo, hi } = orderBounds(ask);
      return { shape: 'order', ordered: range(Math.max(lo, Math.min(ask.dest.length, hi))), remember: false };
    }
    case 'manipulate_list':
      return { shape: 'indices', indices: range(ask.cards.length) };
    case 'sideboard':
      return { shape: 'indices', indices: range(ask.main.length) };
    case 'assign_damage':
      return { shape: 'amounts', amounts: damageDefault(ask.targets, ask.total) };
    case 'assign_amount':
      return { shape: 'amounts', amounts: amountDefault(ask.targets, ask.total, ask.atLeastOne) };
  }
}

function validPreselection(ask: { preselected: number[]; options: unknown[]; min: number; max: number }): number[] {
  const n = ask.options.length;
  const pre = [...new Set(ask.preselected.filter((i) => Number.isInteger(i) && i >= 0 && i < n))];
  const lo = Math.max(0, ask.min);
  const hi = ask.max < 0 ? n : ask.max;
  return pre.length >= lo && pre.length <= hi ? pre : [];
}

/**
 * The draft the dialog OPENS on. Differs from {@link defaultDraft} only where
 * pre-filling a choice for the player would be presumptuous: a list choice
 * opens on the engine's own preselection (or nothing), not on "the first N".
 */
export function initialDraft(ask: AskBody): AskDraft {
  switch (ask.kind) {
    case 'choose_list':
      if (ask.reveal) return { shape: 'indices', indices: [] };
      return { shape: 'indices', indices: validPreselection(ask) };
    case 'choose_entities':
      return { shape: 'indices', indices: [] };
    default:
      return defaultDraft(ask);
  }
}

/** The `answer.value` for a draft (§5.2). A draft of the wrong shape falls back to the default. */
export function answerFromDraft(ask: AskBody, draft: AskDraft): AnswerValue {
  switch (ask.kind) {
    case 'ability_menu':
    case 'options':
      if (draft.shape !== 'index') break;
      return draft.index < 0 ? null : draft.index;
    case 'confirm':
      if (draft.shape !== 'bool') break;
      return draft.yes;
    case 'text':
      if (draft.shape !== 'text') break;
      return ask.numeric ? draft.text.trim() : draft.text;
    case 'choose_list':
      if (draft.shape !== 'indices') break;
      return ask.reveal ? [] : [...draft.indices];
    case 'choose_entities':
    case 'manipulate_list':
    case 'sideboard':
      if (draft.shape !== 'indices') break;
      return [...draft.indices];
    case 'order':
      if (draft.shape !== 'order') break;
      return { ordered: [...draft.ordered], remember: draft.remember };
    case 'assign_damage':
    case 'assign_amount': {
      if (draft.shape !== 'amounts') break;
      const out: Record<string, number> = {};
      for (const [key, value] of Object.entries(draft.amounts)) if (value > 0) out[key] = value;
      return out;
    }
  }
  return answerFromDraft(ask, defaultDraft(ask));
}

/** The one-click always-legal answer. A numeric `text` ask's is `null` (M25/M29). */
export function defaultAnswer(ask: AskBody): AnswerValue {
  if (ask.kind === 'text' && ask.numeric) return null;
  return answerFromDraft(ask, defaultDraft(ask));
}

/** May this kind be answered with a literal `null`? (§5.3/§5.4) */
export function nullIsLegal(ask: AskBody): boolean {
  return ask.kind !== 'order' && ask.kind !== 'choose_list' && ask.kind !== 'manipulate_list';
}

/**
 * What a click on option `id` does to a multi-select draft. `max === 1` is a
 * radio (clicking another option MOVES the choice); above 1 an over-count
 * click is refused rather than silently dropping an earlier pick.
 */
export function toggleChoice(chosen: readonly number[], id: number, max: number): number[] {
  const on = chosen.includes(id);
  if (max === 1) return on ? [] : [id];
  if (on) return chosen.filter((x) => x !== id);
  if (max >= 0 && chosen.length >= max) return [...chosen];
  return [...chosen, id];
}

export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  if (from < 0 || from >= list.length || to < 0 || to >= list.length || from === to) return [...list];
  const next = [...list];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved as T);
  return next;
}

export function amountsTotal(amounts: Record<string, number>): number {
  let sum = 0;
  for (const v of Object.values(amounts)) sum += v > 0 ? v : 0;
  return sum;
}

/** The per-target cap an amount row may reach (engine `max`, then the total). */
export function amountCap(ask: AskBody, id: number): number {
  if (ask.kind === 'assign_amount') {
    const m = ask.targets.find((t) => t.id === id)?.max;
    if (typeof m === 'number' && m >= 0) return Math.min(m, ask.total);
    return ask.total;
  }
  if (ask.kind === 'assign_damage') return ask.total;
  return 0;
}

/** Set one row, clamped to [0, cap]. Never redistributes other rows. */
export function setAmount(ask: AskBody, amounts: Record<string, number>, id: number, n: number): Record<string, number> {
  const v = Math.max(0, Math.min(Number.isFinite(n) ? Math.floor(n) : 0, amountCap(ask, id)));
  return { ...amounts, [String(id)]: v };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export interface Validation {
  ok: boolean;
  /** One short sentence: what is still needed, or what the answer will do. */
  hint: string;
}

const ok = (hint = ''): Validation => ({ ok: true, hint });
const no = (hint: string): Validation => ({ ok: false, hint });

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/** Human count phrase for a [lo, hi] choice. */
export function countPhrase(lo: number, hi: number, noun = 'option'): string {
  if (hi <= 0) return 'Nothing to choose';
  if (lo === hi) return `Choose ${plural(lo, noun)}`;
  if (lo === 0) return `Choose up to ${plural(hi, noun)}`;
  return `Choose ${lo}–${hi} ${noun}s`;
}

function validIndices(indices: readonly number[], n: number): boolean {
  return new Set(indices).size === indices.length && indices.every((i) => Number.isInteger(i) && i >= 0 && i < n);
}

/** Is this draft a legal thing to send, by the numbers the engine sent? */
export function validateDraft(ask: AskBody, draft: AskDraft): Validation {
  switch (ask.kind) {
    case 'ability_menu': {
      if (draft.shape !== 'index' || draft.index < 0) return no('Choose an ability');
      const o = ask.options.find((x) => x.id === draft.index);
      if (!o) return no('Choose an ability');
      if (!o.canPlay) return no('That one can’t be played right now');
      return ok();
    }
    case 'options': {
      if (draft.shape !== 'index' || draft.index < 0 || draft.index >= ask.options.length) return no('Choose one');
      return ok();
    }
    case 'confirm':
      return ok();
    case 'text': {
      if (draft.shape !== 'text') return no('Type an answer');
      const t = draft.text.trim();
      if (ask.numeric) {
        if (t === '') return no('Enter a number');
        if (!/^-?\d+$/.test(t)) return no('Whole numbers only');
        return ok('A number outside what the effect allows will be asked again');
      }
      if (t === '') return no('Type an answer');
      return ok();
    }
    case 'choose_list':
    case 'choose_entities': {
      if (ask.kind === 'choose_list' && ask.reveal) return ok();
      if (draft.shape !== 'indices') return no('Choose');
      const n = ask.options.length;
      if (!validIndices(draft.indices, n)) return no('Choose again');
      const { lo, hi } = choiceBounds(ask);
      const k = draft.indices.length;
      if (k < lo) return no(lo === hi ? `Choose ${lo - k} more` : `Choose at least ${lo}`);
      if (k > hi) return no(`At most ${hi}`);
      if (k === 0) return ok('Nothing chosen');
      return ok(`${k} chosen`);
    }
    case 'order': {
      if (draft.shape !== 'order') return no('Order the items');
      const n = ask.dest.length + ask.source.length;
      if (!validIndices(draft.ordered, n)) return no('Order again');
      const { lo, hi } = orderBounds(ask);
      const k = draft.ordered.length;
      if (k < lo) return no(`Add ${lo - k} more`);
      if (k > hi) return no(`Remove ${k - hi}`);
      return ok();
    }
    case 'manipulate_list': {
      if (draft.shape !== 'indices') return no('Arrange the cards');
      const n = ask.cards.length;
      if (draft.indices.length !== n || !validIndices(draft.indices, n)) return no('Every card must stay in the list');
      return ok();
    }
    case 'sideboard': {
      if (draft.shape !== 'indices') return no('Build the deck');
      const n = ask.main.length + ask.side.length;
      if (!validIndices(draft.indices, n)) return no('Build the deck again');
      if (draft.indices.length === 0) return no('The deck is empty');
      const delta = draft.indices.length - ask.main.length;
      const swapped = draft.indices.filter((i) => i >= ask.main.length).length;
      if (swapped === 0 && delta === 0) return ok(`${draft.indices.length} cards · no changes`);
      return ok(`${draft.indices.length} cards${delta === 0 ? '' : ` (${delta > 0 ? '+' : ''}${delta})`} · ${plural(swapped, 'card')} in from the sideboard`);
    }
    case 'assign_damage':
    case 'assign_amount': {
      if (draft.shape !== 'amounts') return no('Assign the amounts');
      const targets = ask.targets as AmountTarget[];
      const n = targets.length;
      for (const [key, v] of Object.entries(draft.amounts)) {
        const i = Number(key);
        if (!Number.isInteger(i) || i < 0 || i >= n) return no('Assign again');
        if (!Number.isInteger(v) || v < 0) return no('Whole numbers only');
        if (v > amountCap(ask, i)) return no(`${targets[i]!.label}: at most ${amountCap(ask, i)}`);
      }
      if (ask.kind === 'assign_amount' && ask.atLeastOne) {
        const empty = targets.find((t) => (draft.amounts[String(t.id)] ?? 0) < 1);
        if (empty) return no(`Each must get at least 1 — ${empty.label}`);
      }
      const sum = amountsTotal(draft.amounts);
      if (sum < ask.total) return no(`${ask.total - sum} left to assign`);
      if (sum > ask.total) return no(`${sum - ask.total} too many`);
      return ok(`All ${ask.total} assigned`);
    }
  }
}

// ---------------------------------------------------------------------------
// The secondary button — the player's way out
// ---------------------------------------------------------------------------

export interface SkipAction {
  label: string;
  value: AnswerValue;
  /** Tooltip: what the engine will do with it. */
  title: string;
}

/**
 * The "decline / skip" button for this ask, or `null` when the kind's primary
 * buttons already cover every way out (confirm's two labels, a reveal's OK).
 *
 * `null` is sent where §5.4 allows it; for `order`, `choose_list` and
 * `manipulate_list` the documented default goes instead.
 */
export function skipAction(ask: AskBody): SkipAction | null {
  switch (ask.kind) {
    case 'ability_menu':
      return { label: 'Cancel', value: null, title: 'Never mind — nothing is played or paid' };
    case 'confirm':
      return null;
    case 'options':
      return { label: 'Skip', value: null, title: 'Let Forge use its default' };
    case 'text':
      return ask.numeric
        ? { label: 'Cancel', value: null, title: 'Cancel the custom number — always ends the question' }
        : { label: 'Skip', value: null, title: 'Answer nothing' };
    case 'choose_list': {
      if (ask.reveal) return null;
      const { lo, hi } = choiceBounds(ask);
      if (lo === 0) return { label: hi === 1 ? 'Decline' : 'Choose none', value: [], title: 'Choose nothing' };
      // Unsatisfiable on the engine's own numbers: never leave the player stuck.
      if (lo > ask.options.length) return { label: 'Continue', value: defaultAnswer(ask), title: 'Send Forge’s default' };
      return null;
    }
    case 'choose_entities':
      return { label: ask.min <= 0 ? 'Choose none' : 'Skip', value: null, title: 'Decline — Forge chooses nothing or its default' };
    case 'order':
      return { label: 'Default order', value: defaultAnswer(ask), title: 'Use the order Forge proposed' };
    case 'manipulate_list':
      return { label: 'Keep order', value: defaultAnswer(ask), title: 'Leave the cards as they are' };
    case 'sideboard':
      return { label: 'Keep deck', value: null, title: 'No sideboarding — play the same deck' };
    case 'assign_damage':
      return { label: 'Auto-assign', value: null, title: 'Let Forge assign the damage' };
    case 'assign_amount':
      return { label: 'Skip', value: null, title: 'Let Forge decide' };
  }
}

// ---------------------------------------------------------------------------
// Presentation helpers (still pure)
// ---------------------------------------------------------------------------

/** Forge's prompts sometimes carry doubled spaces ("in  Forge AI's"). */
export function tidy(text: string): string {
  return text.replace(/[ \t]+/g, ' ').trim();
}

const COLOR_SYMBOL: Record<string, string> = {
  white: 'W',
  blue: 'U',
  black: 'B',
  red: 'R',
  green: 'G',
  colorless: 'C',
};

/** `"white"` → `"W"`; null when the label is not a colour name. */
export function colorSymbol(label: string): string | null {
  return COLOR_SYMBOL[label.trim().toLowerCase()] ?? null;
}

/** `getInteger`'s list: every option a number, plus at most one "Other…" text option (§5.3). */
export function isNumberList(options: readonly AskOption[]): boolean {
  if (options.length === 0) return false;
  let text = 0;
  for (const o of options) {
    if (o.kind === 'text') text++;
    else if (o.kind !== 'number') return false;
  }
  return text <= 1;
}

export function isColorList(options: readonly AskOption[]): boolean {
  return options.length > 0 && options.every((o) => o.kind === 'color' || colorSymbol(o.label) !== null);
}

/** Every option is a card with a serialised card object. */
export function isCardList(options: readonly AskOption[]): boolean {
  return options.length > 0 && options.every((o) => o.card !== undefined);
}

/** The name to look card data up by, never one the engine concealed. */
export function lookupName(option: AskOption): string | null {
  const c = option.card as { name?: string; hidden?: boolean; faceDownHidden?: boolean } | undefined;
  if (c) {
    if (c.hidden || c.faceDownHidden) return null;
    if (c.name) return c.name;
    return null;
  }
  if (option.label === '???' || option.label === '') return null;
  if (option.kind === 'card' || option.kind === 'other') {
    // Sideboard PaperCards: "Forest (TRK)".
    const m = /^(.*?) \([A-Z0-9]{2,6}\)$/.exec(option.label);
    if (m) return m[1]!;
    if (option.kind === 'card') return option.label;
  }
  return null;
}

export interface OptionGroup {
  key: string;
  label: string;
  /** Ask-local ids, in engine order. */
  ids: number[];
  /** The first option of the group — what the group is drawn as. */
  option: AskOption;
}

/**
 * Collapse runs of identical options (fourteen Forests in a library search,
 * forty basic lands in a sideboard pool) into one row with a count. Identity
 * is the engine's label plus whether it is a card; concealed `"???"` options
 * are never merged.
 */
export function groupOptions(options: readonly AskOption[]): OptionGroup[] {
  const groups: OptionGroup[] = [];
  const byKey = new Map<string, OptionGroup>();
  for (const o of options) {
    const mergeable = o.label !== '???' && o.label !== '' && (o.kind === 'card' || o.kind === 'other');
    const key = mergeable ? `${o.kind}\u0000${o.label}` : `#${o.id}`;
    const g = byKey.get(key);
    if (g) g.ids.push(o.id);
    else {
      const ng: OptionGroup = { key, label: o.label, ids: [o.id], option: o };
      byKey.set(key, ng);
      groups.push(ng);
    }
  }
  return groups;
}

/** Click on a grouped option: pick the next unpicked copy, or (radio) select the first. */
export function toggleGroup(chosen: readonly number[], ids: readonly number[], max: number): number[] {
  const inGroup = ids.filter((id) => chosen.includes(id));
  if (max === 1) return inGroup.length > 0 ? [] : [ids[0]!];
  const next = ids.find((id) => !chosen.includes(id));
  if (next !== undefined && (max < 0 || chosen.length < max)) return [...chosen, next];
  // Full (or every copy taken): a click takes one back.
  if (inGroup.length > 0) {
    const drop = inGroup[inGroup.length - 1]!;
    return chosen.filter((x) => x !== drop);
  }
  return [...chosen];
}

/** Take one copy of a group back out of a selection. */
export function removeFromGroup(chosen: readonly number[], ids: readonly number[]): number[] {
  const inGroup = ids.filter((id) => chosen.includes(id));
  if (inGroup.length === 0) return [...chosen];
  const drop = inGroup[inGroup.length - 1]!;
  return chosen.filter((x) => x !== drop);
}

// ---------------------------------------------------------------------------
// The opening decisions — these are `input`s, not asks
// ---------------------------------------------------------------------------

/**
 * Keep/mulligan and play/draw are NOT asks on mtg-table's wire: Forge's
 * `InputConfirm` reaches the bridge as an `input` whose OK/Cancel buttons carry
 * the labels (protocol §5.3, "confirm's one reachable call site"), e.g.
 * `buttons: {ok: "Keep", cancel: "Mulligan"}`. They are answered with an
 * `act` of `buttonOk` / `buttonCancel`. This recognises them by those labels
 * so the play view can raise them as first-class dialogs.
 */
export type OpeningKind = 'mulligan' | 'play_draw';

/**
 * Forge updates an input's buttons and its prompt in separate frames, so the
 * recordings carry transient mixes — Keep/Mulligan buttons under the coin-toss
 * prompt, under "Waiting for Forge AI...", or under turn 1's priority prompt
 * (mtg-table fixtures human-auto-2026 seq 6/10, human-ability-42 seq 9). Only
 * a pre-game snapshot (`phase === null`, §3.1) with a matching or empty
 * prompt counts; pass `state` whenever you have it.
 */
export function openingKind(input: InputBody | null | undefined, state?: { phase: string | null } | null): OpeningKind | null {
  if (!input) return null;
  if (state && state.phase !== null) return null;
  const okLabel = input.buttons.ok.label.trim().toLowerCase();
  const cancelLabel = input.buttons.cancel.label.trim().toLowerCase();
  if (!input.buttons.ok.enabled || !input.buttons.cancel.enabled) return null;
  const prompt = input.prompt.trim();
  if (okLabel.startsWith('keep') && cancelLabel.startsWith('mulligan')) {
    if (prompt === '' || /keep|mulligan/i.test(prompt)) return 'mulligan';
    return null;
  }
  if (okLabel === 'play' && cancelLabel === 'draw') {
    if (prompt === '' || /play or draw/i.test(prompt)) return 'play_draw';
    return null;
  }
  return null;
}

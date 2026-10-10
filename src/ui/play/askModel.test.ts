/*
 * ForgeCoach — ui/play/askModel.test.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The ask model, driven by REAL asks mtg-table recorded (askFixtures.json):
 * every kind's default is legal and of the shape protocol §5.2 declares, the
 * answer each recorded seat actually sent is reachable from the dialog (it
 * validates and round-trips through answerFromDraft, or it is the skip
 * button's value), and the index-space rules of §5.1/§5.3 hold.
 */
import { describe, expect, test } from 'vitest';
import { ASK_KINDS, type AnswerValue, type AskBody } from '../../protocol.ts';
import { FIXTURE_ASKS, FIXTURE_OPENINGS, fixtureAsk } from './askFixtures.ts';
import {
  answerFromDraft,
  askOptions,
  defaultAnswer,
  defaultDraft,
  groupOptions,
  initialDraft,
  isColorList,
  isNumberList,
  lookupName,
  moveItem,
  nullIsLegal,
  openingKind,
  orderBounds,
  removeFromGroup,
  setAmount,
  skipAction,
  toggleChoice,
  toggleGroup,
  validateDraft,
  type AskDraft,
} from './askModel.ts';

/** The draft a player would have built to send `value`, or null if `value` is a skip. */
function draftFor(ask: AskBody, value: AnswerValue): AskDraft | null {
  if (value === null) return null;
  switch (ask.kind) {
    case 'ability_menu':
    case 'options':
      return { shape: 'index', index: value as number };
    case 'confirm':
      return { shape: 'bool', yes: value as boolean };
    case 'text':
      return { shape: 'text', text: value as string };
    case 'choose_list':
    case 'choose_entities':
    case 'manipulate_list':
    case 'sideboard':
      return { shape: 'indices', indices: value as number[] };
    case 'order': {
      const v = value as { ordered: number[]; remember: boolean };
      return { shape: 'order', ordered: v.ordered, remember: v.remember };
    }
    case 'assign_damage':
    case 'assign_amount':
      return { shape: 'amounts', amounts: value as Record<string, number> };
  }
}

function shapeOf(v: AnswerValue): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'object') return 'ordered' in v ? 'order' : 'map';
  return typeof v;
}

const EXPECTED_SHAPE: Record<AskBody['kind'], string[]> = {
  ability_menu: ['number', 'null'],
  confirm: ['boolean', 'null'],
  options: ['number', 'null'],
  text: ['string', 'null'],
  choose_list: ['array'],
  order: ['order'],
  choose_entities: ['array', 'null'],
  assign_damage: ['map', 'null'],
  assign_amount: ['map', 'null'],
  manipulate_list: ['array'],
  sideboard: ['array', 'null'],
};

test('the fixtures carry all eleven kinds', () => {
  const kinds = new Set(FIXTURE_ASKS.map((f) => f.ask.kind));
  for (const k of ASK_KINDS) expect(kinds, k).toContain(k);
});

describe.each(FIXTURE_ASKS.map((f) => [f.id, f] as const))('%s', (_id, f) => {
  const { ask, answer } = f;

  test('the default draft is legal and has the §5.2 shape', () => {
    const d = defaultDraft(ask);
    // `text` opens on `initial`, which is "" when Forge has none (§5.2) — its
    // always-legal way out is the skip button's null, not the draft.
    if (ask.kind === 'text' && ask.initial === '') expect(skipAction(ask)?.value).toBeNull();
    else expect(validateDraft(ask, d).ok).toBe(true);
    expect(EXPECTED_SHAPE[ask.kind]).toContain(shapeOf(answerFromDraft(ask, d)));
    expect(EXPECTED_SHAPE[ask.kind]).toContain(shapeOf(defaultAnswer(ask)));
  });

  test('the recorded answer is reachable from the dialog', () => {
    const d = draftFor(ask, answer);
    if (d === null) {
      // A recorded null must be exactly what the skip button sends.
      expect(skipAction(ask)?.value).toBeNull();
      return;
    }
    expect(validateDraft(ask, d)).toMatchObject({ ok: true });
    expect(answerFromDraft(ask, d)).toEqual(answer);
  });

  test('the skip button never sends null for a kind that dereferences it (§5.4)', () => {
    const s = skipAction(ask);
    if (!nullIsLegal(ask) && s) expect(s.value).not.toBeNull();
    if (s && s.value !== null) {
      // …and whatever it sends instead is itself legal.
      const d = draftFor(ask, s.value);
      expect(d && validateDraft(ask, d).ok).toBe(true);
    }
  });

  test('default indices are ask-local and in range (§5.1)', () => {
    const n = askOptions(ask).length;
    const v = defaultAnswer(ask);
    const ids: number[] = Array.isArray(v)
      ? (v as number[])
      : v !== null && typeof v === 'object'
        ? 'ordered' in v
          ? (v as { ordered: number[] }).ordered
          : Object.keys(v).map(Number)
        : typeof v === 'number'
          ? [v]
          : [];
    for (const i of ids) {
      expect(i).toBeGreaterThanOrEqual(0);
      expect(i).toBeLessThan(n);
    }
  });
});

describe('ability_menu', () => {
  const ask = fixtureAsk('human-ability-42#a4').ask;
  test('opens on the first playable ability and cancel is null', () => {
    expect(answerFromDraft(ask, initialDraft(ask))).toBe(0);
    expect(skipAction(ask)).toMatchObject({ label: 'Cancel', value: null });
  });
  test('an unplayable ability is not sendable', () => {
    if (ask.kind !== 'ability_menu') throw new Error();
    const blocked: AskBody = { ...ask, options: ask.options.map((o, i) => ({ ...o, canPlay: i !== 1 })) };
    expect(validateDraft(blocked, { shape: 'index', index: 1 }).ok).toBe(false);
    expect(validateDraft(blocked, { shape: 'index', index: 0 }).ok).toBe(true);
  });
});

describe('confirm', () => {
  test('answers true/false with the engine labels; no extra skip', () => {
    const ask = fixtureAsk('human-amount-7#a2').ask;
    if (ask.kind !== 'confirm') throw new Error();
    expect(ask.yesLabel).toBe('OK');
    expect(answerFromDraft(ask, { shape: 'bool', yes: false })).toBe(false);
    expect(defaultAnswer(ask)).toBe(ask.defaultYes);
    expect(skipAction(ask)).toBeNull();
  });
});

describe('text', () => {
  const ask = fixtureAsk('human-number-7#a2').ask;
  test('numeric: empty and non-numbers are refused, the default is null (M25/M29)', () => {
    expect(validateDraft(ask, { shape: 'text', text: '' }).ok).toBe(false);
    expect(validateDraft(ask, { shape: 'text', text: 'ten' }).ok).toBe(false);
    expect(validateDraft(ask, { shape: 'text', text: '1.5' }).ok).toBe(false);
    expect(validateDraft(ask, { shape: 'text', text: ' 12 ' }).ok).toBe(true);
    expect(answerFromDraft(ask, { shape: 'text', text: ' 12 ' })).toBe('12');
    expect(defaultAnswer(ask)).toBeNull();
    expect(skipAction(ask)?.value).toBeNull();
  });
  test('free text needs something typed; suggestions are plain strings', () => {
    const named = fixtureAsk('sample-handwritten#a5').ask;
    expect(validateDraft(named, { shape: 'text', text: '  ' }).ok).toBe(false);
    expect(answerFromDraft(named, { shape: 'text', text: 'Bold Biochemist' })).toBe('Bold Biochemist');
  });
});

describe('choose_list', () => {
  test('a reveal answers [] and offers only OK', () => {
    for (const id of ['human-amount-7#a7', 'human-trample-7#a2']) {
      const ask = fixtureAsk(id).ask;
      expect(answerFromDraft(ask, initialDraft(ask))).toEqual([]);
      expect(validateDraft(ask, initialDraft(ask)).ok).toBe(true);
      expect(skipAction(ask)).toBeNull();
    }
  });
  test('a concealed reveal is never looked up by name', () => {
    const ask = fixtureAsk('human-trample-7#a2').ask;
    expect(askOptions(ask)[0]!.label).toBe('???');
    expect(lookupName(askOptions(ask)[0]!)).toBeNull();
  });
  test('choose a colour: opens empty, radio semantics, min 1 enforced', () => {
    const ask = fixtureAsk('human-ability-42#a16').ask;
    expect(isColorList(askOptions(ask))).toBe(true);
    const d = initialDraft(ask);
    expect(d).toEqual({ shape: 'indices', indices: [] });
    expect(validateDraft(ask, d).ok).toBe(false);
    expect(skipAction(ask)).toBeNull();
    expect(toggleChoice([0], 2, 1)).toEqual([2]);
    expect(validateDraft(ask, { shape: 'indices', indices: [2] }).ok).toBe(true);
    expect(validateDraft(ask, { shape: 'indices', indices: [1, 2] }).ok).toBe(false);
  });
  test('optional costs (min 0): decline sends [], never null', () => {
    const ask = fixtureAsk('human-ability-42#a1').ask;
    expect(skipAction(ask)).toMatchObject({ value: [] });
    expect(validateDraft(ask, initialDraft(ask)).ok).toBe(true);
  });
  test("getInteger's list is recognised: numbers plus one Other…", () => {
    const ask = fixtureAsk('human-number-7#a1').ask;
    expect(isNumberList(askOptions(ask))).toBe(true);
    expect(isNumberList(askOptions(fixtureAsk('human-ability-42#a16').ask))).toBe(false);
  });
  test('max > 1 refuses an over-count click rather than dropping a pick', () => {
    expect(toggleChoice([0, 1], 2, 2)).toEqual([0, 1]);
    expect(toggleChoice([0, 1], 1, 2)).toEqual([0]);
  });
});

describe('order — dest ++ source is one index space (§5.3)', () => {
  test('replacement effects: one of two must be applied first', () => {
    const ask = fixtureAsk('human-auto-42#a15').ask;
    if (ask.kind !== 'order') throw new Error();
    expect(orderBounds(ask)).toEqual({ lo: 1, hi: 2 });
    expect(defaultAnswer(ask)).toEqual({ ordered: [0], remember: false });
    expect(validateDraft(ask, { shape: 'order', ordered: [], remember: false }).ok).toBe(false);
    expect(validateDraft(ask, { shape: 'order', ordered: [1], remember: true }).ok).toBe(true);
    expect(answerFromDraft(ask, { shape: 'order', ordered: [1, 0], remember: true })).toEqual({ ordered: [1, 0], remember: true });
  });
  test('triggers: dest item is index 0, source items follow; all must be placed', () => {
    const ask = fixtureAsk('sample-handwritten#a13').ask;
    if (ask.kind !== 'order') throw new Error();
    const all = askOptions(ask);
    expect(all[0]!.label).toBe(ask.dest[0]!.label);
    expect(all.slice(1).map((o) => o.label)).toEqual(ask.source.map((o) => o.label));
    expect(orderBounds(ask)).toEqual({ lo: 3, hi: 3 });
    expect(defaultAnswer(ask)).toEqual({ ordered: [0, 1, 2], remember: false });
    expect(validateDraft(ask, { shape: 'order', ordered: [0, 2], remember: false })).toMatchObject({ ok: false, hint: 'Add 1 more' });
    expect(skipAction(ask)?.value).toEqual({ ordered: [0, 1, 2], remember: false });
  });
  test('moveItem reorders without losing anything', () => {
    expect(moveItem([0, 1, 2], 2, 0)).toEqual([2, 0, 1]);
    expect(moveItem([0, 1, 2], 0, 5)).toEqual([0, 1, 2]);
  });
});

describe('choose_entities', () => {
  const f = fixtureAsk('human-search-7#a1');
  test('library search: delayedReveal is context, options are the choice', () => {
    const ask = f.ask;
    if (ask.kind !== 'choose_entities') throw new Error();
    expect(ask.delayedReveal?.cards.length).toBeGreaterThan(ask.options.length);
    expect(validateDraft(ask, initialDraft(ask)).ok).toBe(true); // min 0
    expect(skipAction(ask)?.value).toBeNull();
  });
  test('fourteen identical Forests collapse into one group, picked one copy at a time', () => {
    const groups = groupOptions(askOptions(f.ask));
    expect(groups).toHaveLength(1);
    expect(groups[0]!.ids).toHaveLength(14);
    const ids = groups[0]!.ids;
    expect(toggleGroup([], ids, 1)).toEqual([ids[0]]);
    expect(toggleGroup([ids[0]!], ids, 1)).toEqual([]);
    expect(toggleGroup([ids[0]!], ids, 3)).toEqual([ids[0], ids[1]]);
    expect(removeFromGroup([ids[0]!, ids[1]!], ids)).toEqual([ids[0]]);
  });
});

describe('assign_damage — the defender is index 0 (§5.3)', () => {
  test('two blockers: the default fills lethal in order and leaves the defender alone', () => {
    const ask = fixtureAsk('human-ability-42#a14').ask;
    if (ask.kind !== 'assign_damage') throw new Error();
    expect(ask.targets[0]!.defender).toBe(true);
    expect(defaultAnswer(ask)).toEqual({ '1': 1, '2': 2 });
    expect(skipAction(ask)).toMatchObject({ label: 'Auto-assign', value: null });
  });
  test('trample: assigning to the defender is index 0, and the total must be exact', () => {
    const ask = fixtureAsk('human-trample-7#a1').ask;
    const d: AskDraft = { shape: 'amounts', amounts: { '0': 1, '1': 2 } };
    expect(validateDraft(ask, d).ok).toBe(true);
    expect(answerFromDraft(ask, d)).toEqual({ '0': 1, '1': 2 });
    expect(validateDraft(ask, { shape: 'amounts', amounts: { '1': 2 } })).toMatchObject({ ok: false, hint: '1 left to assign' });
    expect(validateDraft(ask, { shape: 'amounts', amounts: { '1': 4 } }).ok).toBe(false);
  });
  test('zero rows are dropped from the answer', () => {
    const ask = fixtureAsk('human-trample-7#a1').ask;
    expect(answerFromDraft(ask, { shape: 'amounts', amounts: { '0': 0, '1': 3 } })).toEqual({ '1': 3 });
  });
});

describe('assign_amount', () => {
  const ask = fixtureAsk('human-amount-7#a1').ask;
  test('mana of any colours: per-target max is honoured, total must be exact', () => {
    if (ask.kind !== 'assign_amount') throw new Error();
    expect(isColorList(ask.targets)).toBe(true);
    expect(defaultAnswer(ask)).toEqual({ '0': 2 });
    expect(validateDraft(ask, { shape: 'amounts', amounts: { '1': 1, '4': 1 } }).ok).toBe(true);
    expect(validateDraft(ask, { shape: 'amounts', amounts: { '0': 1 } }).ok).toBe(false);
    expect(setAmount(ask, {}, 0, 9)).toEqual({ '0': 2 });
    expect(setAmount(ask, { '0': 2 }, 0, -1)).toEqual({ '0': 0 });
  });
  test('atLeastOne: every target needs one, and the default respects it', () => {
    if (ask.kind !== 'assign_amount') throw new Error();
    const strict: AskBody = { ...ask, atLeastOne: true, total: 5, targets: ask.targets.slice(0, 3).map((t) => ({ ...t, max: 3 })) };
    expect(defaultAnswer(strict)).toEqual({ '0': 3, '1': 1, '2': 1 });
    expect(validateDraft(strict, { shape: 'amounts', amounts: { '0': 3, '1': 2 } }).ok).toBe(false);
  });
});

describe('manipulate_list', () => {
  const ask = fixtureAsk('sample-handwritten#a21').ask;
  test('the answer is the full list in its new order; never null', () => {
    expect(validateDraft(ask, { shape: 'indices', indices: [2, 0, 1] }).ok).toBe(true);
    expect(validateDraft(ask, { shape: 'indices', indices: [2, 0] }).ok).toBe(false);
    expect(validateDraft(ask, { shape: 'indices', indices: [2, 2, 0] }).ok).toBe(false);
    expect(skipAction(ask)?.value).toEqual([0, 1, 2]);
  });
});

describe('sideboard — main ++ side is one index space', () => {
  const ask = fixtureAsk('human-sideboard-7#a1').ask;
  test('the recorded swap: one main card out, one sideboard card in', () => {
    if (ask.kind !== 'sideboard') throw new Error();
    const v = fixtureAsk('human-sideboard-7#a1').answer as number[];
    expect(v).toContain(ask.main.length); // the first sideboard card is index main.length
    expect(validateDraft(ask, { shape: 'indices', indices: v }).hint).toMatch(/1 card in from the sideboard/);
    // Keep deck is the deck itself, never null: the bridge reads null as an empty deck (Forge then asks forever).
    expect(skipAction(ask)).toMatchObject({ label: 'Keep deck', value: Array.from({ length: ask.main.length }, (_, i) => i) });
    expect(validateDraft(ask, { shape: 'indices', indices: [] }).ok).toBe(false);
  });
  test('PaperCard labels are looked up without their set code', () => {
    const groups = groupOptions(askOptions(ask));
    expect(groups.length).toBeLessThan(askOptions(ask).length);
    expect(lookupName({ id: 0, label: 'Giant Growth (MSH)', kind: 'other' })).toBe('Giant Growth');
  });
});

describe('opening inputs (not asks)', () => {
  test('keep/mulligan and play/draw are recognised by their button labels', () => {
    expect(openingKind(FIXTURE_OPENINGS.mulligan.input)).toBe('mulligan');
    expect(openingKind(FIXTURE_OPENINGS.playDraw.input)).toBe('play_draw');
    expect(openingKind(FIXTURE_OPENINGS.mulligan.input, FIXTURE_OPENINGS.mulligan.state)).toBe('mulligan');
    expect(openingKind(null)).toBeNull();
  });
  test('transient frames (buttons and prompt out of step) are not raised', () => {
    const keep = FIXTURE_OPENINGS.mulligan.input;
    // human-auto-2026 seq 6: Keep/Mulligan buttons under the coin-toss prompt.
    expect(openingKind({ ...keep, prompt: 'Human, you have won the coin toss.\n\nWould you like to play or draw?' })).toBeNull();
    // human-ability-42 seq 9: waiting on the opponent's mulligan.
    expect(openingKind({ ...keep, prompt: 'Waiting for Forge AI...' })).toBeNull();
    // human-auto-2026 seq 9: the right prompt, but the game has started.
    expect(openingKind(keep, { phase: 'MAIN1' })).toBeNull();
    expect(
      openingKind({ ...FIXTURE_OPENINGS.mulligan.input, buttons: { ok: { label: 'OK', enabled: true }, cancel: { label: 'Cancel', enabled: false } } }),
    ).toBeNull();
  });
});

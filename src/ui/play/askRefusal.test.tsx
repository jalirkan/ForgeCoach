/*
 * ForgeCoach — ui/play/askRefusal.test.tsx
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * mtg-table amendments M68 (D426) and M69 (D427) in the question dialog, on
 * the real engine's refusals: src/play/testdata/m68-frames.json is mtg-table's
 * fixtures/adversary/m68-frames.json, unchanged — for nine ask kinds, the first
 * asking, each illegal answer and the re-ask that refused it with its reason.
 *
 *   - every kind shows the engine's reason in one place (`refusalLine`, the
 *     shell's `[data-refused]` line), and a first asking shows none;
 *   - M68's bounds are checked before sending: a numeric text ask's min/max,
 *     the sideboard's mainMin/sideMax, an assign_amount target's min;
 *   - M69: an ability_menu with one option is a one-line confirm.
 */
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vitest';
import type { AskBody, AssignAmountAsk, SideboardAsk, TextAsk } from '../../protocol.ts';
import { AskDialog } from './AskDialog.tsx';
import { planAskKey, type AskKeyContext } from './askKeys.ts';
import {
  amountFloor,
  answerFromDraft,
  defaultDraft,
  initialDraft,
  loneAbility,
  range,
  refusalLine,
  setAmount,
  skipAction,
  validateDraft,
} from './askModel.ts';

type Chain = { source: string; frames: Array<{ type: string; dir: string; body: AskBody & { value?: unknown } }> };
const CHAINS = JSON.parse(readFileSync(new URL('../../play/testdata/m68-frames.json', import.meta.url), 'utf8')) as Record<string, Chain>;
const asksOf = (kind: string): AskBody[] => CHAINS[kind]!.frames.filter((f) => f.type === 'ask').map((f) => f.body as AskBody);
const first = <K extends AskBody['kind']>(kind: K): Extract<AskBody, { kind: K }> => asksOf(kind)[0] as Extract<AskBody, { kind: K }>;
const render = (ask: AskBody): string =>
  renderToStaticMarkup(<AskDialog ask={ask} state={null} onAnswer={() => undefined} onPreviewCard={() => undefined} onConcede={() => undefined} />);
/** The text of the dialog's refusal line, or null. */
const refusedText = (html: string): string | null => {
  const m = /<p class="ask-refused"[^>]*data-refused=""[^>]*>([^<]*)<\/p>/.exec(html);
  return m ? m[1]!.replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&amp;/g, '&') : null;
};

describe('M68: the engine’s reason, on every kind', () => {
  test('the fixture carries the nine kinds the adversary refused', () => {
    expect(Object.keys(CHAINS).sort()).toEqual(
      ['ability_menu', 'assign_amount', 'assign_damage', 'choose_entities', 'choose_list', 'confirm', 'order', 'sideboard', 'text'].sort(),
    );
  });

  test.each(Object.keys(CHAINS))('%s: none on a first asking, the reason on every re-ask, in the one place', (kind) => {
    const asks = asksOf(kind);
    expect(asks.length).toBeGreaterThan(1);
    expect(refusalLine(asks[0]!)).toBeNull();
    expect(render(asks[0]!)).not.toContain('data-refused');
    for (const again of asks.slice(1)) {
      const line = refusalLine(again);
      expect(line).not.toBeNull();
      expect(line).toContain(again.reason!);
      expect(refusedText(render(again))).toBe(line);
    }
  });

  test('the lead says what was refused', () => {
    expect(refusalLine(asksOf('assign_amount')[1]!)).toBe('That split wasn’t allowed: Assign exactly 2 (this answer assigns 3).');
    expect(refusalLine(asksOf('assign_damage')[2]!)).toMatch(/^That split wasn’t allowed: Assign exactly 2 damage/);
    expect(refusalLine(asksOf('ability_menu')[1]!)).toBe('That choice wasn’t allowed: Option 1 is not one of the choices.');
    expect(refusalLine(asksOf('text')[1]!)).toBe('That answer wasn’t allowed: 100 is out of range; enter a number from 0 to 99.');
    expect(refusalLine(asksOf('sideboard')[4]!)).toBe('That answer wasn’t allowed: The main deck needs at least 40 cards (this answer has 39).');
  });

  test('an engine before M68 (no reason) and an empty reason show nothing', () => {
    const again = structuredClone(asksOf('choose_list')[1]!);
    delete again.reason;
    expect(refusalLine(again)).toBeNull();
    expect(refusalLine({ ...again, reason: '' })).toBeNull();
  });

  test('a confirm with no card still gets a body for the line', () => {
    const again = asksOf('confirm')[1]!;
    expect(again.kind === 'confirm' && again.card).toBeFalsy();
    expect(refusedText(render(again))).toBe('That answer wasn’t allowed: That answer could not be read: expected true or false.');
  });
});

describe('M68: a numeric text ask’s min / max', () => {
  const ask = first('text');
  const v = (text: string, a: TextAsk = ask) => validateDraft(a, { shape: 'text', text });

  test('the engine’s bounds', () => {
    expect([ask.min, ask.max, ask.numeric]).toEqual([0, 99, true]);
  });
  test('inside: sendable, and the hint says the range', () => {
    expect(v('3')).toEqual({ ok: true, hint: 'A number from 0 to 99' });
    expect(v('0').ok).toBe(true);
    expect(v('99').ok).toBe(true);
  });
  test('outside, or not a number: Confirm off, and the line says what to enter', () => {
    expect(v('100')).toEqual({ ok: false, hint: 'Enter a number from 0 to 99' });
    // Forge's isNumeric: no sign, so -1 is never a number it takes.
    expect(v('-1')).toEqual({ ok: false, hint: 'Enter a whole number from 0 to 99' });
    expect(v('many')).toEqual({ ok: false, hint: 'Enter a whole number from 0 to 99' });
    expect(v('')).toMatchObject({ ok: false });
    const html = render({ ...ask, initial: '100' });
    expect(html).toContain('Enter a number from 0 to 99');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*data-answer="confirm"/);
  });
  test('one bound only', () => {
    expect(v('5', { ...ask, min: 7, max: null })).toEqual({ ok: false, hint: 'Enter a number 7 or more' });
    expect(v('500', { ...ask, min: null, max: 20 })).toEqual({ ok: false, hint: 'Enter a number 20 or less' });
  });
  test('an engine before M68 (no bounds): any whole number goes, and the engine checks', () => {
    const old = structuredClone(ask);
    delete old.min;
    delete old.max;
    expect(v('100', old)).toEqual({ ok: true, hint: 'A number outside what the effect allows will be asked again' });
    expect(v('x', old)).toEqual({ ok: false, hint: 'Whole numbers only' });
  });
  test('free text ignores bounds', () => {
    expect(v('anything', { ...ask, numeric: false, min: 0, max: 1 }).ok).toBe(true);
  });
});

describe('M68: the sideboard’s mainMin / sideMax', () => {
  const ask = first('sideboard');
  const v = (indices: number[], a: SideboardAsk = ask) => validateDraft(a, { shape: 'indices', indices });

  test('the engine’s rule, and the deck as it was is legal', () => {
    expect([ask.mainMin, ask.sideMax, ask.main.length, ask.side.length]).toEqual([40, 15, 40, 15]);
    expect(v(range(40)).ok).toBe(true);
    expect(skipAction(ask)!.value).toEqual(range(40));
  });
  test('too few in the deck: Confirm off, and how many to add', () => {
    expect(v(range(39))).toEqual({ ok: false, hint: 'The deck needs at least 40 cards: add 1' });
    // a swap keeps 40
    expect(v([...range(39), 40]).ok).toBe(true);
  });
  test('too many left in the sideboard', () => {
    const tight = { ...ask, mainMin: 30, sideMax: 10 };
    expect(v(range(40), tight)).toEqual({ ok: false, hint: 'At most 10 cards can stay in the sideboard: move 5 into the deck' });
    expect(v(range(45), tight).ok).toBe(true);
  });
  test('null and absent: not enforced', () => {
    expect(v(range(39), { ...ask, mainMin: null, sideMax: null }).ok).toBe(true);
    const old = structuredClone(ask);
    delete old.mainMin;
    delete old.sideMax;
    expect(v(range(20), old).ok).toBe(true);
  });
  test('the section heads say the rule', () => {
    const html = render(ask);
    expect(html).toContain('40 cards · at least 40');
    expect(html).toContain('15 cards · at most 15');
  });
});

describe('M68: an assign_amount target’s min / max', () => {
  const base = first('assign_amount');
  // The real ask: every target 0..2, total 2. A target with a least of its own:
  const ask: AssignAmountAsk = { ...base, total: 3, targets: base.targets.map((t, i) => (i === 1 ? { ...t, min: 1, max: 2 } : t)) };
  const v = (amounts: Record<string, number>, a: AssignAmountAsk = ask) => validateDraft(a, { shape: 'amounts', amounts });

  test('the real ask’s bounds are the dialog’s', () => {
    expect(base.targets.every((t) => t.min === 0 && t.max === 2)).toBe(true);
    expect(v({ '0': 3 }, base)).toEqual({ ok: false, hint: 'white: at most 2' });
    expect(v({ '0': 2 }, base).ok).toBe(true);
  });
  test('a target below its least: Confirm off, and which one', () => {
    expect(amountFloor(ask, 1)).toBe(1);
    expect(v({ '0': 2, '2': 1 })).toEqual({ ok: false, hint: 'blue: at least 1' });
    expect(v({ '0': 2, '1': 1 }).ok).toBe(true);
  });
  test('the default and the stepper respect it', () => {
    const d = defaultDraft(ask);
    expect(d.shape === 'amounts' && d.amounts['1']).toBeGreaterThanOrEqual(1);
    expect(validateDraft(ask, d).ok).toBe(true);
    expect(setAmount(ask, { '1': 1 }, 1, 0)['1']).toBe(1);
    expect(render(ask)).toContain('from 1 to 2');
  });
  test('atLeastOne keeps its own words', () => {
    const one = { ...base, atLeastOne: true, targets: base.targets.slice(0, 2).map((t) => ({ ...t, min: 1 })) };
    expect(v({ '0': 2 }, one)).toEqual({ ok: false, hint: 'Each must get at least 1 — blue' });
    expect(v({ '0': 1, '1': 1 }, one).ok).toBe(true);
  });
});

describe('M69: one ability is a one-line confirm', () => {
  const ask = first('ability_menu');

  test('the real one-option menu', () => {
    expect(ask.options.length).toBe(1);
    expect(loneAbility(ask)).toBe(ask.options[0]);
    expect(answerFromDraft(ask, initialDraft(ask))).toBe(0);
    expect(skipAction(ask)).toMatchObject({ label: 'Cancel', value: null });
  });

  test('drawn as one line with Cancel and its verb, not a list to pick from', () => {
    const html = render(ask);
    expect(html).toContain('data-lone-ability');
    expect(html).not.toContain('ask-opt');
    expect(html).toContain('Activate?');
    expect(html).toMatch(/data-answer="skip"[^>]*>Cancel/);
    expect(html).toMatch(/<button[^>]*class="btn btn-primary ask-btn"(?![^>]*disabled)[^>]*data-answer="confirm"[^>]*>Activate/);
    expect(html).toContain(ask.options[0]!.label.split(':')[0]);
  });

  test('Space never confirms it (the pass key by habit; a look must not commit), Enter does, Esc cancels', () => {
    const ctx: AskKeyContext = { placement: 'slot', minimized: false, canConfirm: true, digits: 0, escSkips: true, spaceConfirms: false };
    for (const targetTag of ['section', 'body', 'div']) {
      expect(planAskKey({ key: ' ', code: 'Space', targetTag, inAsk: true }, ctx)).toEqual({ kind: 'none' });
      expect(planAskKey({ key: 'Enter', targetTag, inAsk: true }, ctx)).toEqual({ kind: 'confirm' });
    }
    expect(planAskKey({ key: ' ', code: 'Space', targetTag: 'section', inAsk: true }, { ...ctx, placement: 'modal' })).toEqual({ kind: 'none' });
    expect(planAskKey({ key: 'Escape' }, ctx)).toEqual({ kind: 'skip' });
    // every other question keeps Space
    expect(planAskKey({ key: ' ', code: 'Space', targetTag: 'section', inAsk: true }, { ...ctx, spaceConfirms: undefined })).toEqual({ kind: 'confirm' });
    // the button says Enter, not Space; the menu with two abilities still says Space
    const html = render(ask);
    expect(html).toMatch(/data-answer="confirm"[^>]*title="Activate \(Enter\)"[^>]*>Activate<kbd[^>]*>Enter<\/kbd>/);
    expect(html).not.toContain('>Space</kbd>');
    const two: AskBody = { ...ask, options: [...ask.options, { ...ask.options[0]!, id: 1, label: 'Another' }] };
    expect(render(two)).toContain('>Space</kbd>');
  });

  test('a lone ability that can’t be played: no way to send it, Cancel still there', () => {
    const off: AskBody = { ...ask, options: ask.options.map((o) => ({ ...o, canPlay: false })) };
    expect(validateDraft(off, initialDraft(off)).ok).toBe(false);
    const html = render(off);
    expect(html).toContain('Can’t be played right now');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*data-answer="confirm"/);
    expect(html).toContain('data-answer="skip"');
  });

  test('two or more abilities keep the menu', () => {
    const two: AskBody = { ...ask, options: [...ask.options, { ...ask.options[0]!, id: 1, label: 'Another' }] };
    expect(loneAbility(two)).toBeNull();
    expect(render(two)).toContain('ask-opt');
  });
});

/*
 * ForgeCoach — ui/play/assignDamage.test.tsx
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The divide-damage bar follows the engine's rule (mtg-table amendment M67,
 * D424), on real asks from mtg-table's assign probe (askFixtures.json,
 * `human-ws-5#a5` and `#a7`, cut from fixtures/assign-probe/m67-frames.json),
 * rendered by the real AskDialog (which draws the bar for this kind):
 *
 *   - a blocked creature without trample: no row for the defending player
 *     (2026-10-10, turn 23: Skyclave Apparition's 2 damage went to the bot),
 *     and the default split is all on the blockers;
 *   - asked again after a refused split: the engine's reason is in the
 *     sentence line;
 *   - a trampler: the defender's row, the trample words and rule line, and
 *     the default puts the excess there;
 *   - an engine before M67 (no `defenderAllowed`): no defender row at all —
 *     absent is "the bridge does not say", never yes — even for a trampler.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vitest';
import type { AskBody, AssignDamageAsk, Card, GameStateBody } from '../../protocol.ts';
import { AskDialog } from './AskDialog.tsx';
import { fixtureAsk } from './askFixtures.ts';
import { askReasonOf } from '../../protocol.ts';
import { damageRows, defaultAnswer, defenderAllowed, validateDraft } from './askModel.ts';

const damageAsk = (id: string): { ask: AssignDamageAsk; state: GameStateBody | null } => {
  const f = fixtureAsk(id);
  if (f.ask.kind !== 'assign_damage') throw new Error(`${id} is not assign_damage`);
  return { ask: f.ask, state: f.state };
};
const render = (ask: AskBody, state: GameStateBody | null): string =>
  renderToStaticMarkup(<AskDialog ask={ask} state={state} onAnswer={() => undefined} onPreviewCard={() => undefined} onConcede={() => undefined} />);
/** The target names the bar drew. */
const names = (html: string): string[] => [...html.matchAll(/<span class="dmg-name" title="[^"]*">([^<]*)<\/span>/g)].map((m) => m[1]!);
const defenderName = (ask: AssignDamageAsk): string => ask.targets.find((t) => t.defender === true)!.label;
const confirmDisabled = (html: string): boolean => /<button[^>]*data-answer="confirm"[^>]*disabled=""/.test(html);

/** The ask as an engine before M67 sent it. */
const preM67 = (ask: AssignDamageAsk): AssignDamageAsk => {
  const old = structuredClone(ask);
  delete old.defenderAllowed;
  delete old.reason;
  return old;
};
/** The state with the attacker's keywords set. */
const withKeywords = (state: GameStateBody, cardId: number, keywords: string[]): GameStateBody => {
  const s = structuredClone(state);
  for (const p of s.players) for (const c of p.zones.battlefield?.cards ?? []) if (c.id === cardId) (c as Card).keywords = keywords;
  return s;
};

describe('assign_damage: the divide-damage bar follows the engine (M67)', () => {
  test('a blocked creature without trample: no row for the defending player, the default all on the blockers', () => {
    const { ask, state } = damageAsk('human-ws-5#a5');
    const first = { ...ask, reason: null };
    expect(ask.defenderAllowed).toBe(false);
    expect(defenderAllowed(ask)).toBe(false);
    expect(damageRows(ask).some((t) => t.defender)).toBe(false);
    const html = render(first, state);
    expect(html).toContain('class="damage-bar"');
    expect(html).toContain('Combat · Divide damage');
    expect(names(html)).not.toContain(defenderName(ask));
    expect(names(html).length).toBe(ask.targets.length - 1);
    expect(html).not.toContain('data-defender');
    expect(html).not.toContain('data-refused');
    expect(html).toContain('divide it among the blockers.');
    expect(confirmDisabled(html)).toBe(false);
    const v = defaultAnswer(ask) as Record<string, number>;
    expect(v['0']).toBeUndefined();
    expect(Object.values(v).reduce((a, b) => a + b, 0)).toBe(ask.total);
    // 2026-10-10's answer -- everything on the player -- is not one the bar sends
    expect(validateDraft(ask, { shape: 'amounts', amounts: { '0': ask.total } })).toMatchObject({ ok: false });
    // the split the engine applied in that game is
    expect(validateDraft(ask, { shape: 'amounts', amounts: fixtureAsk('human-ws-5#a5').answer as Record<string, number> }).ok).toBe(true);
  });

  test('asked again after a refused split: the engine’s reason is in the sentence line', () => {
    const { ask, state } = damageAsk('human-ws-5#a5');
    const reason = askReasonOf(ask);
    expect(reason).toMatch(/exactly 2/);
    const html = render(ask, state);
    const sentence = /<p class="dmg-sentence">([\s\S]*?)<\/p>/.exec(html)?.[1] ?? '';
    expect(sentence).toContain('data-refused');
    expect(sentence).toContain('Not allowed:');
    expect(sentence).toContain(reason!);
    const trample = damageAsk('human-ws-5#a7');
    expect(render(trample.ask, trample.state)).toContain('needs 1');
  });

  test('a trampler: the defender’s row, the trample words, and the default puts the excess there', () => {
    const { ask, state } = damageAsk('human-ws-5#a7');
    expect(ask.defenderAllowed).toBe(true);
    const tramples = withKeywords(state!, ask.attackerId!, ['TRAMPLE']);
    const html = render(ask, tramples);
    expect(names(html)).toContain(defenderName(ask));
    expect(html).toContain('data-defender');
    expect(html).toContain('spillover');
    expect(html).not.toContain('data-locked'); // the default gives every blocker lethal
    expect(html).toContain('assign lethal to each before it tramples over.');
    expect(html).toContain('Trample · every blocker must be lethal to spill over');
    const v = defaultAnswer(ask) as Record<string, number>;
    const blockers = ask.targets.filter((t) => !t.defender);
    for (const t of blockers) expect(v[String(t.id)]).toBe(t.lethal);
    expect(v['0']).toBe(ask.total - blockers.reduce((a, t) => a + (t.lethal ?? 0), 0));
    // the split the engine applied in that game is one the bar accepts
    expect(validateDraft(ask, { shape: 'amounts', amounts: fixtureAsk('human-ws-5#a7').answer as Record<string, number> }).ok).toBe(true);
    // damage on the player while a blocker is short of lethal is not
    expect(validateDraft(ask, { shape: 'amounts', amounts: { '0': 5, '1': 1 } }).ok).toBe(false);
  });

  test('an engine before M67: no defender row, even for an attacker with TRAMPLE (absent is never yes)', () => {
    const { ask, state } = damageAsk('human-ws-5#a5');
    const old = preM67(ask);
    expect(defenderAllowed(old)).toBe(false);
    const trampling = withKeywords(state!, ask.attackerId!, ['TRAMPLE']);
    expect(names(render(old, trampling))).not.toContain(defenderName(ask));
    expect(render(old, trampling)).not.toContain('data-defender');
    expect((defaultAnswer(old) as Record<string, number>)['0']).toBeUndefined();
    expect(validateDraft(old, { shape: 'amounts', amounts: { '0': 1, '1': 1 } }).ok).toBe(false);
  });
});

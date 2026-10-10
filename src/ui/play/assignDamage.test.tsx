/*
 * ForgeCoach — ui/play/assignDamage.test.tsx
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The combat-damage dialog follows the engine's rule (mtg-table amendment
 * M67, D424), on real asks from mtg-table's assign probe (askFixtures.json,
 * `human-ws-5#a5` and `#a7`, cut from fixtures/assign-probe/m67-frames.json):
 *
 *   - a blocked creature without trample: no row for the defending player
 *     (2026-10-10, turn 23: Skyclave Apparition's 2 damage went to the bot),
 *     and the default split is all on the blockers;
 *   - asked again after a refused split: the engine's reason is on screen;
 *   - a trampler: the defender's row, and the default puts the excess there;
 *   - an engine before M67 (no `defenderAllowed`): the row only for an
 *     attacker whose own keywords carry TRAMPLE.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vitest';
import type { AskBody, AssignDamageAsk, Card, GameStateBody } from '../../protocol.ts';
import { AskDialog } from './AskDialog.tsx';
import { fixtureAsk } from './askFixtures.ts';
import { damageRefusal, damageRows, defaultAnswer, defenderAllowed, validateDraft } from './askModel.ts';

const damageAsk = (id: string): { ask: AssignDamageAsk; state: GameStateBody | null } => {
  const f = fixtureAsk(id);
  if (f.ask.kind !== 'assign_damage') throw new Error(`${id} is not assign_damage`);
  return { ask: f.ask, state: f.state };
};
const render = (ask: AskBody, state: GameStateBody | null): string =>
  renderToStaticMarkup(<AskDialog ask={ask} state={state} onAnswer={() => undefined} onPreviewCard={() => undefined} onConcede={() => undefined} />);
/** The row labels the dialog drew. */
const rowLabels = (html: string): string[] => [...html.matchAll(/<span class="ask-row-label">([^<]*)<\/span>/g)].map((m) => m[1]!);
const defenderName = (ask: AssignDamageAsk): string => ask.targets.find((t) => t.defender === true)!.label;

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

describe('assign_damage follows the engine (M67)', () => {
  test('a blocked creature without trample: no row for the defending player, the default all on the blockers', () => {
    const { ask, state } = damageAsk('human-ws-5#a5');
    const first = { ...ask, reason: null };
    expect(ask.defenderAllowed).toBe(false);
    expect(defenderAllowed(ask, ['TRAMPLE'])).toBe(false); // the engine's word wins
    expect(damageRows(ask, false).some((t) => t.defender)).toBe(false);
    const html = render(first, state);
    expect(rowLabels(html)).not.toContain(defenderName(ask));
    expect(rowLabels(html).length).toBe(ask.targets.length - 1);
    expect(html).not.toContain('Defending');
    expect(html).not.toContain('data-refused');
    const v = defaultAnswer(ask) as Record<string, number>;
    expect(v['0']).toBeUndefined();
    expect(Object.values(v).reduce((a, b) => a + b, 0)).toBe(ask.total);
    // 2026-10-10's answer -- everything on the player -- is not one the dialog sends
    expect(validateDraft(ask, { shape: 'amounts', amounts: { '0': ask.total } })).toMatchObject({ ok: false });
    // the split the engine applied in that game is
    expect(validateDraft(ask, { shape: 'amounts', amounts: fixtureAsk('human-ws-5#a5').answer as Record<string, number> }).ok).toBe(true);
  });

  test('asked again after a refused split: the engine’s reason is on screen', () => {
    const { ask, state } = damageAsk('human-ws-5#a5');
    const reason = damageRefusal(ask);
    expect(reason).toMatch(/exactly 2/);
    const html = render(ask, state);
    expect(html).toContain('data-refused');
    expect(html).toContain('That split wasn’t allowed:');
    expect(html).toContain(reason!);
    const trample = damageAsk('human-ws-5#a7');
    expect(render(trample.ask, trample.state)).toContain('needs 1');
  });

  test('a trampler: the defender’s row, and the default puts the excess there', () => {
    const { ask, state } = damageAsk('human-ws-5#a7');
    expect(ask.defenderAllowed).toBe(true);
    const html = render(ask, state);
    expect(rowLabels(html)).toContain(defenderName(ask));
    expect(html).toContain('Defending');
    const v = defaultAnswer(ask) as Record<string, number>;
    const blockers = ask.targets.filter((t) => !t.defender);
    for (const t of blockers) expect(v[String(t.id)]).toBe(t.lethal);
    expect(v['0']).toBe(ask.total - blockers.reduce((a, t) => a + (t.lethal ?? 0), 0));
    // the split the engine applied in that game is one the dialog accepts
    expect(validateDraft(ask, { shape: 'amounts', amounts: fixtureAsk('human-ws-5#a7').answer as Record<string, number> }).ok).toBe(true);
  });

  test('an engine before M67: the defender’s row only for an attacker with TRAMPLE', () => {
    const { ask, state } = damageAsk('human-ws-5#a5');
    const old = preM67(ask);
    expect(defenderAllowed(old, [])).toBe(false);
    expect(defenderAllowed(old, ['TRAMPLE'])).toBe(true);
    expect(rowLabels(render(old, state!))).not.toContain(defenderName(ask));
    const trampling = withKeywords(state!, ask.attackerId!, ['TRAMPLE']);
    expect(rowLabels(render(old, trampling))).toContain(defenderName(ask));
    // and the default never puts damage on the defender without the engine's word
    expect((defaultAnswer(old) as Record<string, number>)['0']).toBeUndefined();
  });
});

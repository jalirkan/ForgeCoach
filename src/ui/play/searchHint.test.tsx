/*
 * ForgeCoach — ui/play/searchHint.test.tsx
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The search hint's place in the decision slot (under the slot's text, never
 * a grid area of its own) and its key: S, which no board binding takes, so
 * SearchHint.tsx's own listener never fights the play keys.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { GameStateBody, InputBody } from '../../protocol.ts';
import { DecisionSlot } from './DecisionSlot.tsx';
import { describeInput, type InputMode, type InputView } from './inputView.ts';
import { attentionOf, passToggles } from './decisionModel.ts';
import { KEY_BINDINGS, PLAY_KEYS, planPlayKey } from './playKeys.ts';
import { ASK_NOW } from './SearchHint.tsx';

const INPUT: InputBody = {
  prompt: 'Priority: Justin\nTurn: 3 (Justin)\nPhase: Main phase, precombat\nStack: Empty',
  focusCardId: null,
  focusCard: null,
  buttons: { ok: { label: 'OK', enabled: true }, cancel: { label: 'End Turn', enabled: true }, focus: 'ok' },
  selectable: { cardIds: [], min: 0, max: 0, mode: 'none' },
  highlighted: [],
  weak: [],
  openZones: [],
};
const STATE = { turn: 3, round: 2, phase: 'MAIN1', activePlayer: 0, priority: 0, players: [], stack: [], stackCards: [], combat: null, events: [] } as unknown as GameStateBody;

describe('the search hint in the decision slot', () => {
  it('has a row of its own under the slot’s text, and nothing is there without one', () => {
    const view = describeInput(INPUT, STATE, 0, { ask: null });
    const attention = attentionOf({ connected: true, over: false, ask: null, input: INPUT, view, state: STATE, seat: 0, oppName: 'Forge AI', inputSeq: 7 });
    const toggles = passToggles({ yielding: null, seat: 0, view, canAct: true });
    const render = (hint: JSX.Element | null) =>
      renderToStaticMarkup(
        <DecisionSlot view={view} busy={null} pool={null} canUndo={false} undoDepth={0} onOk={() => undefined} onCancel={() => undefined} onAct={() => undefined}
          onHelp={() => undefined} flash={null} wide attention={attention} toggles={toggles} hint={hint} />,
      );
    const html = render(<div className="ds-hint"><button className="ab-tool ds-ask-now">{ASK_NOW}</button></div>);
    const text = html.slice(html.indexOf('class="ab-text"'), html.indexOf('class="ab-go"'));
    expect(text).toContain('class="ds-hint-slot"><div class="ds-hint"');
    expect(text).toContain('Ask now');
    expect(render(null)).not.toContain('ds-hint');
  });
});

describe('S asks the search AI', () => {
  const MODES: InputMode[] = ['main', 'priority', 'attack', 'block', 'target', 'pay', 'stack'];
  const view = (mode: InputMode): InputView => ({
    mode, title: '', detail: null, engineText: '',
    ok: { label: 'OK', enabled: true, meaning: null }, cancel: { label: 'Cancel', enabled: true, meaning: null },
    primary: 'ok', payCost: null, payFor: null, needClick: false, clickWhat: 'card', blockingAttackerId: null,
  });
  it('no board binding takes S, in any mode', () => {
    expect(KEY_BINDINGS.some((b) => b.keys.includes('s'))).toBe(false);
    for (const mode of MODES) {
      expect(planPlayKey({ key: 's', targetTag: 'BODY' }, { view: view(mode), askOpen: false, over: false, canUndo: true, poolColors: [], overlay: false })).toBeNull();
    }
  });
  it('the keyboard help lists it', () => {
    expect(PLAY_KEYS.some((r) => r.chord === 'S' && /search AI/.test(r.what))).toBe(true);
  });
});

/*
 * ForgeCoach — ui/play/decisionSlot.test.tsx
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The decision slot's controls as the playtest monkey and the e2e find them
 * (.actionbar, data-engine-button, data-primary, .ab-eot), the keys printed on
 * them, its attention state, and an ask rendered inside it (no portal).
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { AskBody, GameStateBody, InputBody } from '../../protocol.ts';
import { DecisionSlot, OppWaitingLine } from './DecisionSlot.tsx';
import { AskDialog } from './AskDialog.tsx';
import { describeInput } from './inputView.ts';
import { attentionOf, passToggles, type AttentionView } from './decisionModel.ts';

// J109 3.1 (friend, a phone, seq 1791): priority in the other player's beginning of combat.
const PRIORITY: InputBody = {
  prompt: 'Priority: Sam\nTurn: 12 (Justin)\nPhase: Beginning of Combat Step\nStack: Empty',
  focusCardId: null,
  focusCard: null,
  buttons: { ok: { label: 'OK', enabled: true }, cancel: { label: 'End Turn', enabled: true }, focus: 'ok' },
  selectable: { cardIds: [], min: 0, max: 0, mode: 'none' },
  highlighted: [],
  weak: [],
  openZones: [],
};
const STATE = {
  turn: 12,
  round: 6,
  phase: 'COMBAT_BEGIN',
  activePlayer: 0,
  priority: 1,
  players: [],
  stack: [],
  stackCards: [],
  combat: null,
  events: [],
} as unknown as GameStateBody;
const PAY: InputBody = {
  ...PRIORITY,
  prompt: 'Raging Goblin - Creature 1 / 1\n\nPay Mana Cost: {R}',
  buttons: { ok: { label: 'Auto', enabled: true }, cancel: { label: 'Cancel', enabled: true }, focus: 'ok' },
};

function slot(input: InputBody | null, opts: { wide: boolean; attention?: AttentionView; ask?: AskBody; nudged?: boolean }): string {
  const view = describeInput(input, STATE, 1, { ask: opts.ask ?? null });
  const attention = opts.attention ?? attentionOf({ connected: true, over: false, ask: opts.ask ?? null, input, view, state: STATE, seat: 1, oppName: 'Sam', inputSeq: 7 });
  const toggles = passToggles({ yielding: null, seat: 1, view, canAct: !opts.ask });
  const ask = opts.ask ? <AskDialog ask={opts.ask} state={STATE} onAnswer={() => undefined} placement="slot" /> : null;
  return renderToStaticMarkup(
    <DecisionSlot
      view={view}
      busy={null}
      pool={null}
      canUndo={false}
      undoDepth={0}
      onOk={() => undefined}
      onCancel={() => undefined}
      onAct={() => undefined}
      onHelp={() => undefined}
      flash={null}
      wide={opts.wide}
      attention={attention}
      nudged={opts.nudged}
      toggles={toggles}
      ask={ask}
    />,
  );
}
const enabled = (html: string, re: RegExp) => [...html.matchAll(/<button[^>]*>/g)].map((m) => m[0]).filter((b) => re.test(b) && !/\sdisabled=""/.test(b));

describe('the slot at priority with Forge’s End Turn', () => {
  it('a phone: OK is the big button and End Turn is To EOT (one button, never a dead end)', () => {
    const html = slot(PRIORITY, { wide: false });
    expect(enabled(html, /data-engine-button="ok"/)).toHaveLength(1);
    expect(enabled(html, /data-engine-button="cancel"/)).toHaveLength(0);
    expect(enabled(html, /class="ab-eot"/)).toHaveLength(1);
  });
  it('a desktop: End Turn is its own button too, and the auto-pass toggles carry .ab-eot', () => {
    const html = slot(PRIORITY, { wide: true });
    expect(enabled(html, /data-engine-button="ok"/)).toHaveLength(1);
    expect(enabled(html, /data-engine-button="cancel"/)).toHaveLength(1);
    expect(enabled(html, /class="ds-toggle ab-eot"/)).toHaveLength(1);
    expect(html).toContain('Before my turn');
    expect(html).toContain('My next turn');
  });
  it('prints the keys: Pass priority [Space], the engine’s Cancel [Esc], the toggles E / B / T', () => {
    const html = slot(PRIORITY, { wide: true });
    expect(html).toMatch(/data-primary="1"[\s\S]*Pass priority[\s\S]*?<kbd class="ds-kbd" aria-hidden="true">Space<\/kbd>/);
    expect(html).toMatch(/data-engine-button="cancel"[\s\S]*?>Esc<\/kbd>/);
    for (const k of ['E', 'B', 'T']) expect(html).toContain(`aria-hidden="true">${k}</kbd>`);
  });
  it('the slot keeps the e2e’s classes: .actionbar, the mode, the eyebrow and the title', () => {
    const html = slot(PRIORITY, { wide: true });
    expect(html).toMatch(/class="actionbar decision-slot ab-priority is-pending"/);
    expect(html).toContain('ab-eyebrow is-yours');
    expect(html).toMatch(/class="ab-title-text">/);
  });
});

describe('paying', () => {
  it('Auto pay [A] is the primary, Cancel [Esc] beside it', () => {
    const html = slot(PAY, { wide: true });
    expect(html).toMatch(/data-primary="1"[\s\S]*?Auto pay[\s\S]*?>A<\/kbd>/);
    expect(html).toMatch(/data-engine-button="cancel"[\s\S]*?Cancel[\s\S]*?>Esc<\/kbd>/);
  });
});

describe('attention', () => {
  it('pending: the DECISION eyebrow and the arrival pulse; nudged: "Your move — "', () => {
    const html = slot(PRIORITY, { wide: true, nudged: true });
    expect(html).toContain('data-attention="pending"');
    expect(html).toContain('ds-arrive');
    expect(html).toContain('>Decision<');
    expect(html).toContain('Your move — ');
    expect(html).toContain('is-nudged');
  });
  it('the opponent’s move: "Waiting for Sam…" as the title, no pulse, no nudge', () => {
    const html = slot(null, { wide: true, nudged: true, attention: { attention: 'opponent', line: 'Waiting for Sam…', key: null } });
    expect(html).toContain('data-attention="opponent"');
    expect(html).toContain('>Waiting<');
    expect(html).toContain('Waiting for Sam…');
    expect(html).not.toContain('ds-arrive');
    expect(html).not.toContain('Your move');
  });
  it('the waiting line on the board: the words with a dot, nothing without a line', () => {
    expect(renderToStaticMarkup(<OppWaitingLine line="Waiting for Forge AI…" />)).toMatch(
      /class="opp-waiting"[^>]*role="status"[\s\S]*opp-waiting-dot[\s\S]*Waiting for Forge AI…/,
    );
    expect(renderToStaticMarkup(<OppWaitingLine line={null} />)).toBe('');
  });
});

describe('a question inside the slot', () => {
  const ask: AskBody = {
    askId: 'a1',
    kind: 'options',
    timeoutMs: 0,
    title: 'Choose',
    prompt: 'Choose a mode',
    options: [
      { id: 0, label: 'Deal 2 damage', kind: 'text' },
      { id: 1, label: 'Gain 3 life', kind: 'text' },
    ],
    defaultIndex: 0,
    card: null,
  } as unknown as AskBody;
  it('renders in place (no portal, no aria-modal) with the e2e classes and the digits printed', () => {
    const html = slot(null, { wide: true, ask });
    expect(html).toContain('class="ask-layer is-slot"');
    expect(html).toContain('ask-dialog is-slot');
    expect(html).not.toContain('aria-modal');
    expect(html).toContain('ask-title');
    expect(html).toContain('ask-actions');
    expect(html).toMatch(/Deal 2 damage[\s\S]*?ask-optkey" aria-hidden="true">1</);
    expect(html).toMatch(/Gain 3 life[\s\S]*?ask-optkey" aria-hidden="true">2</);
    expect(html).toContain('data-answer="confirm"');
  });
  it('the modal (the default) stays a modal: aria-modal and no slot class', () => {
    const html = renderToStaticMarkup(<AskDialog ask={ask} state={STATE} onAnswer={() => undefined} />);
    expect(html).toContain('aria-modal="true"');
    expect(html).not.toContain('is-slot');
  });
});

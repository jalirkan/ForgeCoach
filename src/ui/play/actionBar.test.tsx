/*
 * ForgeCoach — ui/play/actionBar.test.tsx
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The action bar's controls as the playtest monkey finds them (data-engine-button, .ab-eot).
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { GameStateBody, InputBody } from '../../protocol.ts';
import { ActionBar } from './ActionBar.tsx';
import { describeInput } from './inputView.ts';

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
const STATE = { turn: 12, round: 6, phase: 'COMBAT_BEGIN', activePlayer: 0, priority: 1, players: [], stack: [], stackCards: [], combat: null, events: [] } as unknown as GameStateBody;

function bar(wide: boolean): string {
  const view = describeInput(PRIORITY, STATE, 1);
  return renderToStaticMarkup(
    <ActionBar view={view} busy={null} pool={null} canUndo={false} undoDepth={0} onOk={() => undefined} onCancel={() => undefined} onAct={() => undefined} onHelp={() => undefined} flash={null} wide={wide} />,
  );
}
const enabled = (html: string, re: RegExp) => [...html.matchAll(/<button[^>]*>/g)].map((m) => m[0]).filter((b) => re.test(b) && !/\sdisabled=""/.test(b));

describe('ActionBar at priority with Forge’s End Turn', () => {
  it('a phone: OK is the big button and End Turn is To EOT (one button, never a dead end)', () => {
    const html = bar(false);
    expect(enabled(html, /data-engine-button="ok"/)).toHaveLength(1);
    expect(enabled(html, /data-engine-button="cancel"/)).toHaveLength(0);
    expect(enabled(html, /class="ab-eot"/)).toHaveLength(1);
  });
  it('a desktop: End Turn is its own button too', () => {
    const html = bar(true);
    expect(enabled(html, /data-engine-button="ok"/)).toHaveLength(1);
    expect(enabled(html, /data-engine-button="cancel"/)).toHaveLength(1);
    expect(enabled(html, /class="ab-eot"/)).toHaveLength(1);
  });
});

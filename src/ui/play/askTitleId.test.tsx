/*
 * ForgeCoach — ui/play/askTitleId.test.tsx
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * A question's title id is a plain token. The opening dialogs keyed their
 * shell on the engine's whole prompt, so the title's id (and the dialog's
 * aria-labelledby) carried a newline, commas and a full stop:
 *
 *   ask-title-play_draw-Play-Human, you have won the coin toss.\n\nWould you like to play or draw?
 *
 * and a selector built from it threw in an accessibility reader. The id is now
 * the kind plus a short hash of the key: letters, digits, `_` and `-` only,
 * the same for the same question, and the dialog still names its title.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vitest';
import { AskDialog, OpeningDialog } from './AskDialog.tsx';
import { FIXTURE_ASKS, FIXTURE_OPENINGS } from './askFixtures.ts';
import { askTitleId } from './askModel.ts';

const PLAIN = /^[A-Za-z0-9_-]+$/;

/** The title's id and the dialog's aria-labelledby, as rendered (entities decoded). */
function ids(html: string): { id: string; labelledBy: string } {
  const decode = (s: string) => s.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#10;/g, '\n');
  const title = /<h2 class="ask-title" id="([^"]*)"/.exec(html);
  const dialog = /aria-labelledby="([^"]*)"/.exec(html);
  expect(title, 'the title carries an id').not.toBeNull();
  expect(dialog, 'the dialog names its title').not.toBeNull();
  return { id: decode(title![1]!), labelledBy: decode(dialog![1]!) };
}

describe('the ask title id', () => {
  test('a multi-line title gives a plain id', () => {
    const key = 'play_draw-Play-Human, you have won the coin toss.\n\nWould you like to play or draw?';
    const id = askTitleId(key);
    expect(id).toMatch(PLAIN);
    expect(id.startsWith('ask-title-play_draw-')).toBe(true);
    expect(askTitleId(key)).toBe(id);
    expect(askTitleId(key.replace('play or draw', 'draw or play'))).not.toBe(id);
  });

  test('the play-or-draw question: plain id, and the dialog is labelled by it', () => {
    const { input, state } = FIXTURE_OPENINGS.playDraw;
    expect(input.prompt).toContain('\n');
    const html = renderToStaticMarkup(<OpeningDialog input={input} state={state} onChoose={() => undefined} />);
    const { id, labelledBy } = ids(html);
    expect(id).toMatch(PLAIN);
    expect(labelledBy).toBe(id);
  });

  test('the mulligan question too', () => {
    const { input, state } = FIXTURE_OPENINGS.mulligan;
    const html = renderToStaticMarkup(<OpeningDialog input={input} state={state} onChoose={() => undefined} />);
    const { id, labelledBy } = ids(html);
    expect(id).toMatch(PLAIN);
    expect(labelledBy).toBe(id);
  });

  test('every recorded ask', () => {
    for (const f of FIXTURE_ASKS) {
      const html = renderToStaticMarkup(<AskDialog ask={f.ask} state={f.state} onAnswer={() => undefined} />);
      if (!html.includes('class="ask-title"')) continue;
      const { id, labelledBy } = ids(html);
      expect(id, f.id).toMatch(PLAIN);
      expect(labelledBy, f.id).toBe(id);
    }
  });
});

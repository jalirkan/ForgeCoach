/*
 * ForgeCoach — ui/play/logDrawer.test.tsx
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The drawer's turn blocks, rendered to static markup from a real recording
 * (human-auto-42): triggers fold under a ▶ closed by default and open when
 * the reader opened them; card names are bold; the selectors the playtest
 * reads (.log-turn-no) stay.
 */
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { gameEventLog } from '../../eventLog.ts';
import { parseLog } from '../../log.ts';
import { TurnBlock } from './LogDrawer.tsx';

const auto = parseLog(gunzipSync(readFileSync(new URL('../../../public/samples/human-auto-42.jsonl.gz', import.meta.url))).toString('utf8'));
const turns = gameEventLog(auto);
const t9 = turns.find((t) => t.turn === 9)!;
const html = (open: string[] = []) => renderToStaticMarkup(<TurnBlock t={t9} log={auto} current={false} openFolds={new Set(open)} onToggle={() => {}} />);

describe('TurnBlock', () => {
  it('renders the turn header with the selector the playtest reads', () => {
    expect(html()).toContain('<span class="log-turn-no">T9</span>');
  });

  it('renders a trigger run as one collapsed ▶ row, its text not on the page', () => {
    const h = html();
    expect(h).toContain('log-fold-head');
    expect(h).toContain('aria-expanded="false"');
    expect(h).toContain('▶');
    expect(h).toContain('A.I.M. Scientists</b><span> triggered</span>');
    // The rules text of the trigger is folded away…
    expect(h).not.toContain('it connives');
    // …and the spell cast before it is a plain line with its name in bold.
    expect(h).toContain('<button type="button" class="log-card">A.I.M. Scientists</button>');
    expect(h.match(/class="log-line k-cast/g)).toHaveLength(1);
  });

  it('shows the folded lines once the reader opened the fold', () => {
    const key = `9:${t9.lines.findIndex((l) => l.kind === 'trigger')}`;
    const h = html([key]);
    expect(h).toContain('aria-expanded="true"');
    expect(h).toContain('▼');
    expect(h).toContain('it connives');
    expect(h).toContain('log-line k-trigger');
  });

  it('puts a phase sub-head only where the phase changes', () => {
    const t13 = turns.find((t) => t.turn === 13)!;
    const h = renderToStaticMarkup(<TurnBlock t={t13} log={auto} current={false} openFolds={new Set()} onToggle={() => {}} />);
    const heads = [...h.matchAll(/class="log-section-head">([^<]+)</g)].map((m) => m[1]);
    expect(heads.length).toBeGreaterThan(1);
    for (let i = 1; i < heads.length; i++) expect(heads[i]).not.toBe(heads[i - 1]);
  });
});

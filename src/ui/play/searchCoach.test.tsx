/*
 * ForgeCoach — ui/play/searchCoach.test.tsx
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The search AI in the decision panel (Ask now, like Skip, with S) and in the
 * Coach panel (the selector; idle / asking / answered / error / no hint for
 * this decision), rendered from each state.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { GameStateBody } from '../../protocol.ts';
import type { SearchHint } from '../../searchHint.ts';
import type { HintPhase } from '../../play/hintRunner.ts';
import { AskNowRow, budgetLine, CoachPicker, LINE_HEAD, NO_HINT, otherChoices, SearchCoachBody, thinkingLine, type SearchCoach } from './SearchHint.tsx';

const card = (id: number, name: string, controller = 0) => ({ id, name, setCode: null, manaCost: null, types: 'Creature', power: '2', toughness: '2', loyalty: null, damage: 0, counters: {}, tapped: false, sick: false, attacking: false, blocking: false, faceDown: false, token: false, alt: null, attachedToId: null, attachmentIds: [], controller, owner: controller, zone: 'hand', abilities: [], keywords: [] });
const STATE = {
  gameId: 'g', turn: 3, round: 2, phase: 'MAIN1', activePlayer: 0, priority: 0, stack: [], stackCards: [], combat: null, events: [],
  players: [
    { id: 0, name: 'You', life: 20, zones: { hand: { cards: [card(5, 'Shock'), card(6, 'Grizzly Bears')] }, battlefield: { cards: [] } } },
    { id: 1, name: 'Forge AI', life: 20, zones: { hand: { count: 3, cards: [] }, battlefield: { cards: [] } } },
  ],
} as unknown as GameStateBody;
const HINT: SearchHint = {
  status: 'ok', type: 'spell', pick: 'cast:5', strength: 'close', runnerUp: 'pass', landFirst: null,
  options: [
    { token: 'cast:5', label: 'cast Shock #5', verdict: 'best', winRate: 0.6, same: [] },
    { token: 'pass', label: 'pass', verdict: 'tie', winRate: 0.6, same: [] },
    { token: 'cast:6', label: 'cast Grizzly Bears #6', verdict: 'worse', winRate: 0.5, same: [] },
  ],
  knowledge: 'basic-lands', measure: 'leaf', stateSeq: 9, message: null, ms: 2420, budgetMs: 3000, line: null,
};

const coachIn = (phase: HintPhase, over: Partial<SearchCoach> = {}): SearchCoach => ({
  kind: 'search', setKind: () => undefined, available: true, info: { available: true, engine: 'ready', budgetMs: 3000 }, phase, ask: () => undefined, searchKey: true, state: STATE, seat: 0, ...over,
});

describe('the decision panel: Ask now', () => {
  const row = (c: SearchCoach, claude: (() => void) | null = null) => renderToStaticMarkup(<AskNowRow coach={c} claudeAsk={claude} />);
  it('idle: a real button like Skip, with S', () => {
    const html = row(coachIn({ state: 'idle', key: 'd' }));
    expect(html).toMatch(/<button[^>]*class="ab-tool ds-ask-now"[^>]*data-ask-now="search"/);
    expect(html).toContain('Ask now');
    expect(html).toMatch(/<kbd[^>]*>S<\/kbd>/);
    expect(html).toContain('data-search-hint="idle"');
  });
  it('asking: the button waits, and the line says the engine is thinking', () => {
    const html = row(coachIn({ state: 'asking', key: 'd', since: 0 }));
    expect(html).toMatch(/<button[^>]*disabled=""/);
    expect(html).toContain('The engine is thinking (about 3.0 s)…');
  });
  it('answered: the move in board words, under the button, never an id', () => {
    const html = row(coachIn({ state: 'answered', key: 'd', hint: HINT }));
    expect(html).toContain('Cast Shock, or cast nothing now');
    expect(html).toContain('too close to call');
    expect(html).not.toMatch(/#5|cast:5/);
  });
  it('error: why, in the engine’s words', () => {
    expect(row(coachIn({ state: 'error', key: 'd', message: 'The engine is busy with another hint — try again in a few seconds.' }))).toContain('busy with another hint');
  });
  it('nothing where the search AI does not judge, or with the coach off', () => {
    expect(row(coachIn({ state: 'none', key: null }))).toBe('');
    expect(row(coachIn({ state: 'idle', key: 'd' }, { kind: 'off' }))).toBe('');
    expect(row(coachIn({ state: 'idle', key: 'd' }, { available: false }))).toBe('');
  });
  it('with Claude chosen, Ask now asks Claude (no S on it), and only when the panel has a moment to ask', () => {
    const html = row(coachIn({ state: 'idle', key: 'd' }, { kind: 'claude' }), () => undefined);
    expect(html).toContain('data-ask-now="claude"');
    expect(html).not.toMatch(/<kbd/);
    expect(row(coachIn({ state: 'idle', key: 'd' }, { kind: 'claude' }), null)).toBe('');
  });
});

describe('the Coach panel', () => {
  it('the selector: three choices, the chosen one checked, with what it does', () => {
    const html = renderToStaticMarkup(<CoachPicker kind="search" onKind={() => undefined} />);
    expect(html.match(/role="radio"/g)).toHaveLength(3);
    expect(html).toMatch(/aria-checked="true"[^>]*>Search AI</);
    expect(html).toContain('Free; it answers by itself.');
    expect(renderToStaticMarkup(<CoachPicker kind="claude" onKind={() => undefined} />)).toContain('only with Auto-coach on');
  });
  const body = (c: SearchCoach, myMove = true) => renderToStaticMarkup(<SearchCoachBody coach={c} myMove={myMove} />);
  it('no hint for a decision it does not judge; waiting when nothing is yours to decide', () => {
    expect(body(coachIn({ state: 'none', key: null }))).toContain(NO_HINT);
    expect(body(coachIn({ state: 'none', key: null }), false)).toContain('Waiting for your next decision');
  });
  it('asking: busy, with the engine’s start when it is not up yet', () => {
    expect(body(coachIn({ state: 'asking', key: 'd', since: 0 }))).toContain('data-search-coach="asking"');
    expect(thinkingLine({ available: true, engine: 'starting', budgetMs: 3000 })).toContain('about 10 s the first time');
  });
  it('answered: the move, how sure, the other choices it weighed, and the budget used', () => {
    const html = body(coachIn({ state: 'answered', key: 'd', hint: HINT }));
    expect(html).toContain('Your main phase');
    expect(html).toContain('Cast Shock, or cast nothing now');
    expect(html).toContain('Cast Grizzly Bears<span class="muted"> · worse</span>');
    expect(html).toContain('Looked 2.4 s of a 3.0 s budget.');
    expect(html).toContain('Knows only what you know (hidden cards as lands).');
    expect(otherChoices(HINT, STATE, 0)).toEqual([{ line: 'Cast Grizzly Bears', verdict: 'worse' }]);
    expect(budgetLine({ ms: null, budgetMs: null }, 3000)).toBe('A 3.0 s look.');
  });
  it('error, and off when the engine offers no hints', () => {
    expect(body(coachIn({ state: 'error', key: 'd', message: 'Search hints are off on your PC (the bridge is not built).' }))).toContain('Search hints are off');
    expect(body(coachIn({ state: 'idle', key: 'd' }, { available: false }))).toContain('needs the engine on your PC with hints on');
  });
});

describe('the pick’s line (mtg-table D454)', () => {
  const LINED: SearchHint = { ...HINT, line: [
    { kind: 'target', text: 'Shock → Grizzly Bears', ids: [5, 6] },
    { kind: 'then', text: 'then cast Grizzly Bears', ids: [6] },
    { kind: 'choose', text: 'choose → Lightning Bolt', ids: [77] },
  ] };
  const body = (h: SearchHint) => renderToStaticMarkup(<SearchCoachBody coach={coachIn({ state: 'answered', key: 'd', hint: h })} myMove />);
  it('the Coach panel prints the engine’s own choices under the move, as small steps', () => {
    const html = body(LINED);
    expect(html).toContain('data-search-line');
    expect(html).toContain(LINE_HEAD);
    expect(html).toMatch(/<li data-step-kind="target">Shock → Grizzly Bears<\/li><li data-step-kind="then">Then cast Grizzly Bears<\/li>/);
    expect(html.indexOf('data-search-line')).toBeGreaterThan(html.indexOf('pc-search-pick'));
    expect(html.indexOf('data-search-line')).toBeLessThan(html.indexOf('pc-search-others'));
  });
  it('a step naming a card the board does not show by name is not printed', () => {
    expect(body(LINED)).not.toContain('Lightning Bolt');
  });
  it('no line, or an empty one: no steps', () => {
    expect(body(HINT)).not.toContain('data-search-line');
    expect(body({ ...HINT, line: [] })).not.toContain('data-search-line');
  });
  it('the decision panel keeps one line; the steps ride in its title', () => {
    const html = renderToStaticMarkup(<AskNowRow coach={coachIn({ state: 'answered', key: 'd', hint: LINED })} claudeAsk={null} />);
    expect(html).not.toContain('data-search-line');
    expect(html).toContain(`${LINE_HEAD}: Shock → Grizzly Bears; Then cast Grizzly Bears.`);
  });
});

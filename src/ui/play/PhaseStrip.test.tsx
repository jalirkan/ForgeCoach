/*
 * ForgeCoach — ui/play/PhaseStrip.test.tsx
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The strip as the playtest monkey and the e2e find it: `.pstrip[data-round]`,
 * the vertical column's YOU / OPP halves as buttons (`data-turn`, `data-stop`),
 * disabled when stops cannot be changed, the enlarged current cell, the header
 * and the "On the play" chip, and the phone row's underline marks.
 */
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { parseLog } from '../../log.ts';
import type { GameStateBody } from '../../protocol.ts';
import { PhaseStrip } from './PhaseStrip.tsx';
import { PlayBoardContext, type PlayBoard } from './playBoard.ts';
import { describeInput } from './inputView.ts';

function board(over: Partial<GameStateBody> = {}): GameStateBody {
  return {
    gameId: 'g',
    turn: 5,
    round: 3,
    phase: 'MAIN1',
    activePlayer: 0,
    priority: 0,
    gameOver: null,
    stack: [],
    stackCards: [],
    combat: null,
    events: [],
    yield: null,
    players: [
      { id: 0, name: 'Pacho', isAi: false, life: 20, poison: 0, counters: {}, manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 }, zones: {} as never, phaseStops: { own: ['MAIN1', 'MAIN2'], opp: ['END_OF_TURN'] } },
      { id: 1, name: 'Forge AI', isAi: true, life: 20, poison: 0, counters: {}, manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 }, zones: {} as never },
    ],
    ...over,
  } as GameStateBody;
}

const buttons = (html: string) => [...html.matchAll(/<button[^>]*>/g)].map((m) => m[0]);
const halves = (html: string) => buttons(html).filter((b) => /data-turn=/.test(b));
const log = parseLog(gunzipSync(readFileSync(new URL('../../../public/samples/human-comfort-13.jsonl.gz', import.meta.url))).toString('utf8'));

describe('PhaseStrip, vertical', () => {
  const render = (interactive: boolean, state = board()) =>
    renderToStaticMarkup(<PhaseStrip orientation="vertical" state={state} seat={0} interactive={interactive} onAct={() => undefined} log={log} />);

  it('draws a YOU and an OPP half per step as buttons, disabled when stops cannot be toggled', () => {
    const idle = render(false);
    const hs = halves(idle);
    expect(hs).toHaveLength(26); // 13 steps × 2 halves
    expect(hs.every((b) => /\sdisabled=""/.test(b))).toBe(true);
    expect(hs.filter((b) => /data-turn="own"/.test(b))).toHaveLength(13);
    expect(hs.filter((b) => /data-turn="opp"/.test(b))).toHaveLength(13);

    const live = halves(render(true));
    // Only UNTAP stays disabled: never toggleable.
    const disabled = live.filter((b) => /\sdisabled=""/.test(b));
    expect(disabled).toHaveLength(2);
    expect(disabled.every((b) => /data-phase="UNTAP"/.test(b))).toBe(true);
  });

  it('fills the halves that are stops and keeps .pstrip[data-round]', () => {
    const html = render(true);
    expect(html).toMatch(/<nav[^>]*class="pstrip pstrip-v turn-you"[^>]*data-round="3"/);
    const stop = (phase: string, turn: string) => halves(html).find((b) => b.includes(`data-phase="${phase}"`) && b.includes(`data-turn="${turn}"`))!;
    expect(stop('MAIN1', 'own')).toContain('data-stop="true"');
    expect(stop('MAIN1', 'opp')).toContain('data-stop="false"');
    expect(stop('END_OF_TURN', 'opp')).toContain('data-stop="true"');
    expect(stop('UNTAP', 'own')).toContain('data-stop="false"');
  });

  it('enlarges only the current cell, with its name and instruction', () => {
    const html = render(true);
    expect([...html.matchAll(/class="pcell[^"]*is-current[^"]*"/g)]).toHaveLength(1);
    expect(html).toContain('aria-current="step"');
    expect(html).toContain('Main 1</b><span class="pcell-line">Cast or pass.');
    const blk = render(true, board({ phase: 'COMBAT_DECLARE_BLOCKERS' }));
    expect(blk).toContain('Blk</b><span class="pcell-line">Declare blockers');
    expect(blk).not.toContain('pcell-line">Cast or pass.');
  });

  it('heads the column with whose turn, the turn, the active player, priority and who was on the play', () => {
    const mine = render(true);
    expect(mine).toContain('Your turn');
    expect(mine).toContain('T5');
    expect(mine).toContain('Pacho');
    expect(mine).toContain('data-who="you"');
    expect(mine).toMatch(/pv-play" data-who="opp"[^>]*>On the play/); // human-comfort-13: Forge went first
    const theirs = render(true, board({ activePlayer: 1, priority: 1 }));
    expect(theirs).toContain('Opp turn');
    expect(theirs).toContain('Forge AI');
    expect(theirs).toMatch(/pv-prio is-opp" data-who="opp"/);
    expect(mine).toContain('combat');
    expect(mine).toContain('ending');
    expect(mine).toContain('YOU');
    expect(mine).toContain('OPP');
  });

  it('reads the board seam when mounted in the play screen, and obeys canAct', () => {
    const value = (canAct: boolean): PlayBoard => ({
      state: board(),
      input: null,
      ask: null,
      seat: 0,
      log,
      view: describeInput(null, board(), 0),
      connected: true,
      over: false,
      act: () => undefined,
      canAct,
    });
    const mount = (canAct: boolean) =>
      renderToStaticMarkup(
        <PlayBoardContext.Provider value={value(canAct)}>
          <PhaseStrip orientation="vertical" />
        </PlayBoardContext.Provider>,
      );
    expect(halves(mount(true)).filter((b) => !/\sdisabled=""/.test(b))).toHaveLength(24);
    expect(halves(mount(false)).filter((b) => !/\sdisabled=""/.test(b))).toHaveLength(0);
    expect(mount(true)).toContain('On the play');
  });

  it('renders with no state yet (pre-game) and with no provider', () => {
    const html = renderToStaticMarkup(<PhaseStrip orientation="vertical" />);
    expect(html).toContain('Pre-game');
    expect(halves(html).every((b) => /\sdisabled=""/.test(b))).toBe(true);
  });
});

describe('PhaseStrip, horizontal (unchanged)', () => {
  it('is the row of two-letter codes, the default, with data-round', () => {
    const html = renderToStaticMarkup(<PhaseStrip state={board()} seat={0} interactive onAct={() => undefined} variant="bar" />);
    expect(html).toMatch(/class="pstrip pstrip-bar turn-you"[^>]*data-round="3"/);
    expect(html).not.toContain('data-turn=');
    expect(html).toContain('>M1<');
    expect(html).not.toContain('>UT<');
  });

  it('the phone row marks each half with an underline (gold = you, blue = opp)', () => {
    const html = renderToStaticMarkup(<PhaseStrip state={board()} seat={0} interactive onAct={() => undefined} variant="bar" />);
    expect(html).toContain('class="pbar-under"');
    expect([...html.matchAll(/<i class="is-own is-on"/g)]).toHaveLength(2); // M1, M2
    expect([...html.matchAll(/<i class="is-opp is-on"/g)]).toHaveLength(1); // ET
    const side = renderToStaticMarkup(<PhaseStrip state={board()} seat={0} interactive onAct={() => undefined} variant="side" />);
    expect(side).not.toContain('pbar-under');
  });
});

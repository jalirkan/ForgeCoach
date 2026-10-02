import { describe, expect, it } from 'vitest';
import type { GameStateBody } from '../../protocol.ts';
import { settlePending, stopKey, stripModel, toggleStopAct, yieldWords } from './phaseStrip.ts';
import { buttonWords, canPassAhead, passMenu, primaryView } from './actionWords.ts';
import { describeInput } from './inputView.ts';

function board(over: Partial<GameStateBody> = {}, stops: { own: string[]; opp: string[] } | null = { own: ['MAIN1', 'MAIN2'], opp: ['END_OF_TURN'] }): GameStateBody {
  return {
    gameId: 'g',
    turn: 13,
    round: 7,
    phase: 'COMBAT_DECLARE_BLOCKERS',
    activePlayer: 1,
    priority: 0,
    gameOver: null,
    stack: [],
    stackCards: [],
    combat: null,
    events: [],
    yield: null,
    players: [
      { id: 0, name: 'Pacho', isAi: false, life: 2, poison: 0, counters: {}, manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 }, zones: {} as never, ...(stops ? { phaseStops: stops } : {}) },
      { id: 1, name: 'Forge AI', isAi: true, life: 7, poison: 0, counters: {}, manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 }, zones: {} as never },
    ],
    ...over,
  } as GameStateBody;
}

describe('stripModel', () => {
  it('lights the current step in the colour of whose turn it is', () => {
    const m = stripModel(board(), 0, { interactive: true });
    expect(m.yourTurn).toBe(false);
    expect(m.activeName).toBe('Forge AI');
    expect(m.priority).toBe('you');
    expect(m.turn).toBe(13);
    const cur = m.cells.filter((c) => c.current);
    expect(cur.map((c) => c.short)).toEqual(['DB']);
    expect(m.cells.filter((c) => c.past).map((c) => c.short)).toEqual(['UT', 'UP', 'DR', 'M1', 'BC', 'DA']);
  });

  it('marks the seat’s own stops and the opponent-turn stops from phaseStops', () => {
    const m = stripModel(board(), 0, { interactive: true });
    expect(m.cells.filter((c) => c.stopOwn).map((c) => c.short)).toEqual(['M1', 'M2']);
    expect(m.cells.filter((c) => c.stopOpp).map((c) => c.short)).toEqual(['ET']);
    expect(m.live).toBe(true);
    expect(m.canToggle).toBe(true);
  });

  it('shows Forge’s defaults, read-only, when the stream has no stops', () => {
    const m = stripModel(board({}, null), 0, { interactive: true });
    expect(m.live).toBe(false);
    expect(m.canToggle).toBe(false);
    expect(m.cells.filter((c) => c.stopOwn).map((c) => c.short)).toEqual(['M1', 'DB', 'M2']);
    expect(m.cells.every((c) => !c.toggleable)).toBe(true);
    expect(toggleStopAct(m, 'MAIN1', 'own')).toBeNull();
  });

  it('is read-only while not interactive (a question open, the game over)', () => {
    const m = stripModel(board(), 0, { interactive: false });
    expect(m.canToggle).toBe(false);
    expect(toggleStopAct(m, 'MAIN1', 'own')).toBeNull();
  });

  it('has no stop for UNTAP', () => {
    const m = stripModel(board(), 0, { interactive: true });
    const untap = m.cells.find((c) => c.phase === 'UNTAP')!;
    expect(untap.toggleable).toBe(false);
    expect(toggleStopAct(m, 'UNTAP', 'own')).toBeNull();
  });

  it('draws a pass-to marker from state.yield', () => {
    const m = stripModel(board({ yield: { kind: 'marker', playerId: 1, phase: 'END_OF_TURN' } }), 0);
    expect(m.cells.find((c) => c.marker)?.short).toBe('ET');
    expect(m.cells.find((c) => c.marker)?.marker).toBe('opp');
    expect(yieldWords(m.yielding, 0)).toBe('Passing to their end step');
    expect(yieldWords({ kind: 'endOfTurn', playerId: null, phase: null }, 0)).toBe('Passing to end of turn');
  });
});

describe('toggling a phase stop', () => {
  it('sends setPhaseStop with the opposite of what is shown, keyed by turn', () => {
    const m = stripModel(board(), 0, { interactive: true });
    expect(toggleStopAct(m, 'MAIN1', 'own')).toEqual({ action: 'setPhaseStop', phase: 'MAIN1', turn: 'own', stop: false });
    expect(toggleStopAct(m, 'MAIN1', 'opp')).toEqual({ action: 'setPhaseStop', phase: 'MAIN1', turn: 'opp', stop: true });
    expect(toggleStopAct(m, 'END_OF_TURN', 'opp')).toEqual({ action: 'setPhaseStop', phase: 'END_OF_TURN', turn: 'opp', stop: false });
  });

  it('shows a pending toggle until the state confirms it, and a second tap undoes it', () => {
    const pending = new Map([[stopKey('COMBAT_BEGIN', 'own'), true]]);
    const m = stripModel(board(), 0, { interactive: true, pending });
    const bc = m.cells.find((c) => c.phase === 'COMBAT_BEGIN')!;
    expect(bc.stopOwn).toBe(true);
    expect(bc.pending).toBe(true);
    expect(toggleStopAct(m, 'COMBAT_BEGIN', 'own')!.stop).toBe(false);
    // Not yet confirmed: still pending.
    expect(settlePending(pending, board(), 0).size).toBe(1);
    // The next state carries it: settled.
    expect(settlePending(pending, board({}, { own: ['MAIN1', 'COMBAT_BEGIN', 'MAIN2'], opp: [] }), 0).size).toBe(0);
  });
});

describe('action words', () => {
  const prio = (prompt: string, ok = 'OK', cancel = 'End Turn') =>
    describeInput(
      { prompt, buttons: { ok: { label: ok, enabled: true }, cancel: { label: cancel, enabled: true } }, selectable: { mode: 'none', cardIds: [], min: 0, max: 0 } } as never,
      board({ activePlayer: 1, phase: 'UPKEEP' }),
      0,
    );

  it('says "Pass priority" with the engine label as the sub-line', () => {
    const v = prio('Priority: Upkeep');
    expect(v.mode).toBe('priority');
    expect(primaryView(v)).toEqual({ which: 'ok', words: 'Pass priority', engine: 'OK', enabled: true });
    expect(canPassAhead(v)).toBe(true);
  });

  it('offers every pass-ahead target the protocol has', () => {
    const v = prio('Priority: Upkeep');
    expect(passMenu(v).map((m) => m.body)).toEqual([
      { action: 'passPriority' },
      { action: 'yieldTo', kind: 'endOfTurn' },
      { action: 'yieldTo', kind: 'marker', phase: 'UPKEEP', turn: 'own' },
      { action: 'yieldTo', kind: 'marker', phase: 'END_OF_TURN', turn: 'opp' },
    ]);
  });

  it('makes the engine Cancel the big button while a yield runs', () => {
    const v = describeInput(
      { prompt: 'Yielding until end of turn.', buttons: { ok: { label: 'OK', enabled: false }, cancel: { label: 'Cancel', enabled: true } }, selectable: { mode: 'none', cardIds: [], min: 0, max: 0 } } as never,
      board(),
      0,
    );
    expect(primaryView(v)).toMatchObject({ which: 'cancel', words: 'Stop skipping', engine: 'Cancel', enabled: true });
    expect(canPassAhead(v)).toBe(false);
  });

  it('keeps the engine label when it already says it', () => {
    const v = prio('Priority: Upkeep', 'OK', 'End Turn');
    expect(buttonWords(v, v.cancel)).toBe('Skip to end of turn');
  });
});

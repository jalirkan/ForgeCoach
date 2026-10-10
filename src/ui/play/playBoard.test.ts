/*
 * ForgeCoach — ui/play/playBoard.test.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The board seam: `canAct` over its whole truth table, and `usePlayBoard()`
 * being null outside the play screen (so GameView and replay are unchanged).
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vitest';
import { canActOf, PlayBoardContext, usePlayBoard, type PlayBoard } from './playBoard.ts';

describe('canActOf', () => {
  const bools = [false, true];
  const rows: { connected: boolean; hasAsk: boolean; over: boolean; inputSeen: boolean }[] = [];
  for (const connected of bools) for (const hasAsk of bools) for (const over of bools) for (const inputSeen of bools) rows.push({ connected, hasAsk, over, inputSeen });

  test('is the full 16-row table', () => {
    expect(rows).toHaveLength(16);
  });

  test.each(rows)('connected=$connected ask=$hasAsk over=$over inputSeen=$inputSeen', ({ connected, hasAsk, over, inputSeen }) => {
    const expected = connected && !hasAsk && !over && inputSeen;
    expect(canActOf({ connected, ask: hasAsk ? { askId: 'a1' } : null, over, inputSeen })).toBe(expected);
  });

  test('exactly one row can act', () => {
    const n = rows.filter((r) => canActOf({ connected: r.connected, ask: r.hasAsk ? { askId: 'a1' } : null, over: r.over, inputSeen: r.inputSeen })).length;
    expect(n).toBe(1);
  });
});

describe('usePlayBoard', () => {
  function Probe() {
    const b = usePlayBoard();
    return createElement('span', null, b === null ? 'null' : `seat=${b.seat} canAct=${b.canAct}`);
  }

  test('is null outside a provider', () => {
    expect(renderToStaticMarkup(createElement(Probe))).toBe('<span>null</span>');
  });

  test('is the provided value inside one', () => {
    const value = { seat: 0, canAct: true } as unknown as PlayBoard;
    expect(renderToStaticMarkup(createElement(PlayBoardContext.Provider, { value }, createElement(Probe)))).toBe('<span>seat=0 canAct=true</span>');
  });
});

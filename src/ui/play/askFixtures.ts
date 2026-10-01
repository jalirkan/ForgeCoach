/*
 * ForgeCoach — ui/play/askFixtures.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Real asks recorded by mtg-table (fixtures/games/human-*.jsonl, plus the
 * hand-written synthetic sample for `options` and `manipulate_list`, the two
 * kinds Forge never dispatches in that configuration — protocol §5.2), copied
 * into askFixtures.json so the tests and the gallery need no mtg-table
 * checkout. The data is mtg-table's (GPL-3.0-or-later, Copyright (C) 2026 the
 * mtg-table authors). Regenerate it rather than editing it by hand.
 *
 * Dev/test only: import AskGallery lazily so this JSON stays out of the main bundle.
 */
import type { AnswerValue, AskBody, GameStateBody, InputBody } from '../../protocol.ts';
import raw from './askFixtures.json?raw';

export interface FixtureAsk {
  /** `<fixture file>#<askId>`. */
  id: string;
  note: string;
  ask: AskBody;
  /** What the recorded seat actually answered. */
  answer: AnswerValue;
  /** The snapshot just before the ask, kept only when the ask names a card id. */
  state: GameStateBody | null;
}

export interface FixtureOpening {
  id: string;
  input: InputBody;
  state: GameStateBody;
}

interface FixtureFile {
  asks: FixtureAsk[];
  openings: { playDraw: FixtureOpening; mulligan: FixtureOpening };
}

const data = JSON.parse(raw) as FixtureFile;

export const FIXTURE_ASKS: readonly FixtureAsk[] = data.asks;
export const FIXTURE_OPENINGS = data.openings;

export function fixtureAsk(id: string): FixtureAsk {
  const f = FIXTURE_ASKS.find((a) => a.id === id);
  if (!f) throw new Error(`no fixture ask ${id}`);
  return f;
}

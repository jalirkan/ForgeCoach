/*
 * ForgeCoach — live.ts  (CONTRACT STUB — the live agent replaces the bodies)
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Read-only follow of a running mtg-table bridge (protocol §2).
 */
import type { GameLog } from './log.ts';

export const DEFAULT_LIVE_URL = 'ws://127.0.0.1:8642';
export type LiveStatus = 'connecting' | 'open' | 'closed' | 'error';
export interface LiveHandle {
  close(): void;
}
/** Connects; calls onLog with a growing GameLog (throttled) as frames arrive. Never sends an act. */
export function connectLive(
  _url: string,
  _h: { onLog(log: GameLog): void; onStatus(s: LiveStatus, detail?: string): void },
): LiveHandle {
  throw new Error('not implemented');
}

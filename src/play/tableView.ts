/*
 * ForgeCoach — play/tableView.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The board's line about the other person at a table of two (mtg-table M59,
 * D403): whether they are thinking, and for how long the clock gives them;
 * whether they are away, and when this seat may claim the win; how long this
 * seat's own decision has left. Read from the `table` frame alone, on the
 * bridge's clock (`skewMs`: the bridge's time minus this browser's when the
 * frame came), never from cards.
 *
 * Pure: the caller ticks `nowMs` (once a second is plenty).
 */
import type { TableBody, TableSeat } from '../protocol.ts';

export interface TableLine {
  /** `them`: about the other player; `you`: this seat's own clock. */
  who: 'them' | 'you';
  /** `thinking` and `clock` are calm; `away` and `low` ask for attention. */
  tone: 'thinking' | 'away' | 'clock' | 'low';
  text: string;
  /** This seat may send `claimWin` now. */
  canClaim: boolean;
}

/** Below this, this seat's own clock turns urgent. */
export const LOW_CLOCK_MS = 30_000;

/** `m:ss` (or `h:mm:ss`), never negative. */
export function clock(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

function seatsOf(t: TableBody): { me: TableSeat | null; them: TableSeat | null } {
  const me = t.seats.find((s) => s.seat === t.you) ?? null;
  const them = t.seats.find((s) => s.seat !== t.you) ?? null;
  return { me, them };
}

/**
 * The lines to show now, the other player's first. Empty when there is
 * nothing to say (the engine is busy resolving, nobody's clock runs).
 */
export function tableLines(t: TableBody | null, skewMs: number, nowMs: number, themName?: string): TableLine[] {
  if (!t) return [];
  const bridgeNow = nowMs + skewMs;
  // The skew is measured one way (the frame's flight time is in it): never show more than a full clock.
  const cap = (ms: number) => (t.decisionTimeoutMs > 0 ? Math.min(ms, t.decisionTimeoutMs) : ms);
  const { me, them } = seatsOf(t);
  const out: TableLine[] = [];
  const name = themName || them?.name || 'Your opponent';
  if (them) {
    if (them.awaySince !== null) {
      const gone = clock(bridgeNow - them.awaySince);
      if (t.canClaimWin) {
        out.push({ who: 'them', tone: 'away', canClaim: true, text: `${name} has been away for ${gone}. You can keep waiting, or claim the win.` });
      } else {
        const wait = them.deciding ? 'The game waits for their decision' : 'The game goes on until it needs them';
        const claim = t.claimWinAt !== null ? `; you can claim the win in ${clock(t.claimWinAt - bridgeNow)}` : '';
        out.push({ who: 'them', tone: 'away', canClaim: false, text: `${name} is away (${gone}). ${wait}${claim}.` });
      }
    } else if (them.deciding) {
      const left = them.decisionDeadline !== null ? ` · ${clock(cap(them.decisionDeadline - bridgeNow))} left` : '';
      out.push({ who: 'them', tone: 'thinking', canClaim: false, text: `${name} is thinking${left}` });
    }
  }
  if (me && me.deciding && me.decisionDeadline !== null) {
    const left = cap(me.decisionDeadline - bridgeNow);
    out.push({
      who: 'you',
      tone: left <= LOW_CLOCK_MS ? 'low' : 'clock',
      canClaim: false,
      text: left <= LOW_CLOCK_MS ? `${clock(left)} left for this decision — then the engine takes the default` : `Your decision · ${clock(left)} left`,
    });
  }
  return out;
}

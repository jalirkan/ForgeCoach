/*
 * ForgeCoach — ui/coachWait.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The coach panel's "thinking…" line for Claude Code on the PC (mtg-table's
 * coach helper). The CLI streams its thinking with empty text, so nothing
 * shows until the first word; this line fills that gap from stream timing
 * alone: from the request (or the helper's `running` line after a queue) to
 * the first text delta (`Answer.thinkingSince`). DOM-free.
 */
import type { Answer } from './answers.ts';

export type WaitFacts = Pick<Answer, 'status' | 'text' | 'source' | 'thinkingSince'>;

/** True while Claude Code on the PC has the question and no word has arrived. */
export function isHelperThinking(a: WaitFacts | undefined | null): boolean {
  return !!a && a.status === 'streaming' && !a.text && a.source === 'helper' && a.thinkingSince !== null;
}

/** "Claude Code is thinking…", with the seconds so far once there is one; null when it is not thinking. */
export function thinkingLine(a: WaitFacts | undefined | null, now: number): string | null {
  if (!isHelperThinking(a)) return null;
  const secs = Math.max(0, Math.floor((now - a!.thinkingSince!) / 1000));
  return secs >= 1 ? `Claude Code is thinking… ${secs} s` : 'Claude Code is thinking…';
}

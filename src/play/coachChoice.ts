/*
 * ForgeCoach — play/coachChoice.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Which coach sits beside the board in a game against the bot (the Coach
 * panel's selector): the search AI (the engine on your PC plays the decision
 * out for a few seconds: free, so it answers by itself at every decision it
 * can judge), Claude (the existing coach, through Claude Code on your PC or
 * your API key: it spends usage, so it asks by itself only when its own
 * Auto-coach switch is on), or nobody. The search AI is the default.
 *
 * Kept per viewer in localStorage beside the panel's other choices
 * (`forgecoach.autoCoach`). Pure: storage is injected.
 */

export type CoachKind = 'search' | 'claude' | 'off';
export const COACH_KIND_KEY = 'forgecoach.coachKind';
export const DEFAULT_COACH_KIND: CoachKind = 'search';

export const COACH_KINDS: readonly { id: CoachKind; label: string; blurb: string }[] = [
  { id: 'search', label: 'Search AI', blurb: 'The engine on your PC plays each decision out for a few seconds and says what it would do. Free; it answers by itself.' },
  { id: 'claude', label: 'Claude', blurb: 'Claude explains a plan in steps, through Claude Code on your PC or your API key. It spends usage, so it asks by itself only with Auto-coach on.' },
  { id: 'off', label: 'Off', blurb: 'No coach. Nothing is asked.' },
];

export function parseCoachKind(v: string | null | undefined): CoachKind {
  return v === 'search' || v === 'claude' || v === 'off' ? v : DEFAULT_COACH_KIND;
}

export function readCoachKind(get: (k: string) => string | null): CoachKind {
  try {
    return parseCoachKind(get(COACH_KIND_KEY));
  } catch {
    return DEFAULT_COACH_KIND;
  }
}

/** What each choice turns on. Claude asks by itself only when it is the coach AND its Auto-coach switch is on. */
export function coachPlan(kind: CoachKind, claudeAutoSwitch: boolean, searchAvailable: boolean): { searchAuto: boolean; claudeShown: boolean; claudeAuto: boolean; searchKey: boolean } {
  return {
    searchAuto: kind === 'search' && searchAvailable,
    claudeShown: kind === 'claude',
    claudeAuto: kind === 'claude' && claudeAutoSwitch,
    // S asks the search AI wherever it is offered, unless the coach is off.
    searchKey: kind !== 'off' && searchAvailable,
  };
}

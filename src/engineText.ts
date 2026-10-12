/*
 * ForgeCoach — engineText.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Forge's own strings — input prompts, ask prompts and option labels, notices,
 * stack text — carry its internal card ids ("Opt (12) - Human scries 1.",
 * "Select creatures to block Thallid (41)", "[[Island (38)]]") and now and
 * then a bookkeeping tail ("(Exiled=0)"). The board never shows those numbers,
 * so a player cannot use them (common-sense pass items 1, 3, 11): every
 * engine string a player reads goes through `withoutEngineIds` at the place
 * it is drawn. The wire keeps the ids; code that needs one reads it from the
 * raw string first.
 *
 * Pure. Numbers that mean something to a player stay: "(2 more can be
 * targeted)", "{18}", "3/3", "Discard 1 card(s)".
 */

/** Engine ids and "(Key=value)" bookkeeping out of an engine string, whitespace tidied. */
export function withoutEngineIds(text: string | null | undefined): string {
  return String(text ?? '')
    .replace(/\[\[([^\]]*)\]\]/g, '$1')
    .replace(/\s*\([A-Za-z][\w ]*=[^()]*\)/g, '')
    .replace(/([^\s(])\s*\(\d+\)(?!\s*more\b)/g, '$1')
    .replace(/\s#\d+\b/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+([.,;:])/g, '$1')
    .replace(/[ \t]+$/gm, '')
    .trim();
}

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

/**
 * Engine ids and "(Key=value)" bookkeeping out of an engine string, whitespace
 * tidied. `piece`: a piece of a longer line (CoachText's text between two
 * card references) — its leading and trailing spaces are kept.
 */
export function withoutEngineIds(text: string | null | undefined, opts: { piece?: boolean } = {}): string {
  const t = String(text ?? '')
    .replace(/\[\[([^\]]*)\]\]/g, '$1')
    .replace(/\s*\([A-Za-z][\w ]*=[^()]*\)/g, '')
    .replace(/([^\s(])\s*\(\d+\)(?!\s*more\b)/g, '$1')
    .replace(/\s#\d+\b/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+([.,;:])/g, '$1');
  return opts.piece ? t : t.replace(/[ \t]+$/gm, '').trim();
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The verbs Forge's stack sentences put after a player ("Human draws a card"): a creature type never takes one. */
const SUBJECT_VERBS = [
  'adds', 'attaches', 'chooses', 'creates', 'deals', 'discards', 'draws', 'exiles', 'gains', 'gets', 'investigates', 'looks',
  'loses', 'may', 'mills', 'pays', 'proliferates', 'puts', 'returns', 'reveals', 'sacrifices', 'scries', 'searches',
  'shuffles', 'surveils', 'taps', 'untaps', 'connives', 'explores', 'learns', 'venture', 'ventures',
].join('|');

/** "puts" → "put", "draws" → "draw", "scries" → "scry", "searches" → "search": the verb after "You". */
function baseVerb(v: string): string {
  if (/ies$/.test(v)) return v.slice(0, -3) + 'y';
  if (/(ch|sh|ss|x|z)es$/.test(v)) return v.slice(0, -2);
  if (/s$/.test(v) && !/ss$/.test(v)) return v.slice(0, -1);
  return v;
}

/**
 * Forge's sentences name the seats by their engine labels ("Human puts a +1/+1
 * counter on Carrion Feeder.", "Forge AI searches their library…"). The board
 * says "you" and the bot's picked name (play/aiName.ts `seatNamer`): the
 * viewing seat's label as the subject of a sentence becomes "You" with the
 * verb agreeing ("You put…", "You draw a card") and "Human's" → "your";
 * another seat's label becomes its board name. `seats`: each seat's engine
 * label and board name.
 */
export function withBoardNames(text: string, seats: ReadonlyArray<{ engine: string; board: string; you: boolean }>): string {
  let t = String(text ?? '');
  for (const s of seats) {
    if (!s.engine || s.engine === s.board) continue;
    const name = escapeRe(s.engine);
    if (s.you) {
      // Only where the label is the subject of a sentence (or a possessive): "Human" is also a
      // creature type ("a 1/1 Human Soldier", "a Human creature"), which stays as it is.
      t = t.replace(new RegExp(`\\b${name}[’']s\\b`, 'g'), 'your');
      t = t.replace(new RegExp(`(^|[.!?]\\s+|\\n|[-—–]\\s+)${name}\\s+(${SUBJECT_VERBS})\\b`, 'g'), (_m, lead: string, verb: string) => `${lead}You ${baseVerb(verb)}`);
    } else {
      t = t.replace(new RegExp(`\\b${name}\\b`, 'g'), s.board);
    }
  }
  return t;
}

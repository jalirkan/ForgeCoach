/*
 * ForgeCoach — coachAnswer.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Reads the labelled lines of a coach answer (prompt.ts's answer format): the
 * one-line **Answer:** of the answer-first layout, the **Rule:** the line
 * follows and the coach's stated **Confidence:** (high, medium or low). The
 * coach panel shows them as a header; the bench reads the stated confidence
 * for its calibration table. Pure, DOM-free.
 *
 * While an answer streams, only complete lines (ending in a newline) are read,
 * so a half-written "**Confidence:** hi" is never shown as a value.
 */

export type StatedConfidence = 'high' | 'medium' | 'low';
export const STATED_CONFIDENCES: readonly StatedConfidence[] = ['high', 'medium', 'low'];

export interface CoachAnswerParts {
  /** The one-line answer (answer-first layout), or null. */
  answer: string | null;
  /** The heuristic named on the **Rule:** line, or null. */
  rule: string | null;
  confidence: StatedConfidence | null;
  /** The words after the confidence level ("another line is close"), or null. */
  confidenceWhy: string | null;
  /** The text without the lines read above (what the panel still renders as markdown). */
  body: string;
}

const LABELLED = /^\s*(?:[-*>]\s+)?(?:\*\*|__)?\s*(answer|rule|confidence)\s*:\s*(?:\*\*|__)?\s*(.*?)\s*$/i;

const clean = (s: string) =>
  s
    .replace(/\*\*|__/g, '')
    .replace(/^[`"“]+|[`"”]+$/g, '')
    .trim();

/** The level named first in `s` ("Low — a close call" → low; "med" → medium). */
export function confidenceLevel(s: string): StatedConfidence | null {
  const m = /\b(high|medium|med|moderate|low)\b/i.exec(s);
  if (!m) return null;
  const w = m[1]!.toLowerCase();
  return w === 'high' ? 'high' : w === 'low' ? 'low' : 'medium';
}

/**
 * The labelled lines of `text`. `complete` is false while the answer is still
 * streaming: the last line is then ignored unless it ends in a newline.
 * The first **Answer:** / **Rule:** / **Confidence:** line of each kind wins.
 */
export function parseCoachAnswer(text: string, opts: { complete?: boolean } = {}): CoachAnswerParts {
  const complete = opts.complete ?? true;
  const lines = text.split('\n');
  const lastComplete = complete || text.endsWith('\n') ? lines.length : lines.length - 1;
  const out: CoachAnswerParts = { answer: null, rule: null, confidence: null, confidenceWhy: null, body: text };
  const drop = new Set<number>();
  for (let i = 0; i < lastComplete; i++) {
    const m = LABELLED.exec(lines[i]!);
    if (!m) continue;
    const label = m[1]!.toLowerCase();
    const value = clean(m[2] ?? '');
    if (!value) continue;
    if (label === 'answer' && out.answer === null) {
      out.answer = value;
      drop.add(i);
    } else if (label === 'rule' && out.rule === null) {
      out.rule = value.replace(/[.;]+$/, '');
      drop.add(i);
    } else if (label === 'confidence' && out.confidence === null) {
      const level = confidenceLevel(value);
      if (!level) continue;
      out.confidence = level;
      const why = value.replace(/^\s*\(?\s*(high|medium|med|moderate|low)\b\s*\)?\s*[—–:,.;-]*\s*/i, '').replace(/[.]+$/, '');
      out.confidenceWhy = why || null;
      drop.add(i);
    }
  }
  if (drop.size) out.body = lines.filter((_, i) => !drop.has(i)).join('\n').replace(/^\s*\n/, '');
  return out;
}

/** Just the stated confidence and rule of a finished reply (the bench's view). */
export function statedOf(text: string): { confidence?: StatedConfidence; rule?: string } {
  const p = parseCoachAnswer(text, { complete: true });
  const out: { confidence?: StatedConfidence; rule?: string } = {};
  if (p.confidence) out.confidence = p.confidence;
  if (p.rule) out.rule = p.rule;
  return out;
}

// ---------------------------------------------------------------------------
// The short style (prompt.ts 'short', live play's default)

/** One command line of a short answer: "Play: Cast Shock → their Bears" is {label: 'Play', text: 'Cast Shock → their Bears'}. */
export interface TerseLine {
  label: string;
  text: string;
}

export interface TerseAnswerParts {
  /** The command lines before the "---", in order (Play, Mana, Attack, Block, Hold, Keep, If you draw …). */
  commands: TerseLine[];
  /** The one short reason ("Why:"), or null. */
  why: string | null;
  rule: string | null;
  confidence: StatedConfidence | null;
  confidenceWhy: string | null;
  /** What goes behind "More": everything after the "---" but the rule and confidence lines. */
  more: string;
  /** True when the answer reads as the short style (at least one command or a Why line). */
  terse: boolean;
  /** The "---" has arrived: the main lines are finished. */
  mainDone: boolean;
}

// "Play: …", "**Mana:** …", "- Block: …", "If you draw a land: …". A label is a few words starting with a letter.
const COMMAND = /^\s*(?:[-*>]\s+|\d+[.)]\s+)?(?:\*\*|__)?\s*([A-Za-z][A-Za-z /'’-]{0,30}?)\s*(?:\*\*|__)?\s*:\s*(?:\*\*|__)?\s*(.*?)\s*$/;
const BARE = /^\s*(?:[-*>]\s+)?(?:\*\*|__)?\s*(keep|mulligan|pass)\s*(?:\*\*|__)?\s*\.?\s*$/i;
const SEPARATOR = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;
const MORE_LABELS = new Set(['rule', 'confidence', 'details', 'detail', 'trap', 'their turn', 'alternative', 'assumptions']);

/**
 * Reads a short-style answer. The main view shows `commands` and `why`; `more`
 * (with the rule and confidence) stays behind a toggle, so the details never
 * stream into the main view. While streaming (`complete` false) the last line
 * is shown as it grows, but only once its label and colon have arrived.
 * A Rule or Confidence line before the "---" is read too, never shown as a command.
 */
export function parseTerseAnswer(text: string, opts: { complete?: boolean } = {}): TerseAnswerParts {
  const complete = opts.complete ?? true;
  const lines = text.replace(/\r/g, '').split('\n');
  const sep = lines.findIndex((l) => SEPARATOR.test(l));
  const main = sep >= 0 ? lines.slice(0, sep) : lines;
  const tail = sep >= 0 ? lines.slice(sep + 1) : [];
  const commands: TerseLine[] = [];
  let why: string | null = null;
  const moreFromMain: string[] = [];
  for (let i = 0; i < main.length; i++) {
    const raw = main[i]!;
    if (!raw.trim()) continue;
    const partial = !complete && sep < 0 && i === main.length - 1;
    const bare = BARE.exec(raw);
    if (bare) {
      if (!partial) commands.push({ label: bare[1]![0]!.toUpperCase() + bare[1]!.slice(1).toLowerCase(), text: '' });
      continue;
    }
    const m = COMMAND.exec(raw);
    if (!m) {
      if (!partial) moreFromMain.push(raw);
      continue;
    }
    const label = clean(m[1]!).replace(/\s+/g, ' ');
    const value = clean(m[2] ?? '');
    const key = label.toLowerCase();
    if (key === 'why') {
      if (why === null && value) why = value;
    } else if (MORE_LABELS.has(key)) {
      moreFromMain.push(raw);
    } else if (value || !partial) {
      commands.push({ label: label[0]!.toUpperCase() + label.slice(1), text: value });
    }
  }
  const stated = parseCoachAnswer([...moreFromMain, ...tail].join('\n'), { complete });
  const more = stated.body.trim();
  return {
    commands,
    why,
    rule: stated.rule,
    confidence: stated.confidence,
    confidenceWhy: stated.confidenceWhy,
    more,
    terse: commands.length > 0 || why !== null,
    mainDone: sep >= 0 || complete,
  };
}

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

/**
 * The option an answer names by number — "2", "2 — Plains", "Option 2 (Plains)",
 * "#2. Plains" — with the words after the number (the label, if any), or null
 * when the answer does not start with an option number. The prompt numbers
 * the engine's options from 1 and asks for the number and the label.
 */
export function optionNumberOf(answer: string): { n: number; rest: string } | null {
  const t = answer.replace(/\*\*|__|`/g, '').trim();
  const m = /^(?:option\s*)?\(?#?(\d{1,3})\)?(?=$|[\s.:)\-–—,])[\s.:)\-–—,]*(.*)$/i.exec(t);
  if (!m) return null;
  const rest = m[2]!.trim().replace(/^\((.*)\)$/, '$1').replace(/[.;]+$/, '').trim();
  return { n: Number(m[1]), rest };
}

/** Just the stated confidence and rule of a finished reply (the bench's view). */
export function statedOf(text: string): { confidence?: StatedConfidence; rule?: string } {
  const p = parseCoachAnswer(text, { complete: true });
  const out: { confidence?: StatedConfidence; rule?: string } = {};
  if (p.confidence) out.confidence = p.confidence;
  if (p.rule) out.rule = p.rule;
  return out;
}

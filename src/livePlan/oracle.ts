/*
 * ForgeCoach — livePlan/oracle.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Card text by NAME for the plan modules (the wire never carries rules text),
 * from ForgeCoach's own card data (cards.ts: Scryfall). Ported from mtg-table
 * tools/llm-seat (lib/oracle.mjs, D419): reminder text is dropped, and a card
 * of two faces (adventure, split, modal or transforming) reads
 * "<face>: <text> // <face>: <text>", so "cast Stomp" can be matched to
 * Bonecrusher Giant and the model sees both halves by name.
 */
import type { CardInfo } from '../cards.ts';
import { normName } from './parse.ts';

export interface Oracle {
  /** The card's text, reminder text dropped, faces named; null when unknown. */
  text(name: string): string | null;
  /** A named face's own mana cost ("Stomp" of Bonecrusher Giant: "{1}{R}"), or null. */
  faceCost(name: string, face: string): string | null;
  /** The names of the card's faces when it has two or more, else []. */
  faces(name: string): string[];
}

/** Reminder text (parenthesised) goes: the model knows the keywords, and it is a third of the bytes. */
export const stripReminder = (t: string): string =>
  String(t)
    .replace(/\s*\([^)]*\)/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .trim();

function faceText(info: CardInfo): string {
  const named = (info.faces ?? []).filter((f) => f.name && f.oracleText);
  if (named.length >= 2) return named.map((f) => `${f.name}: ${stripReminder(f.oracleText)}`).join(' // ');
  if (named.length === 1) return stripReminder(named[0]!.oracleText);
  return stripReminder(info.oracleText);
}

/** An oracle over ForgeCoach's card data (the names the log uses, and each face's name). */
export function oracleFromCards(cards: ReadonlyMap<string, CardInfo>): Oracle {
  const byNorm = new Map<string, CardInfo>();
  const put = (k: string, info: CardInfo) => {
    if (!k) return;
    const had = byNorm.get(k);
    if (!had || (!had.found && info.found)) byNorm.set(k, info);
  };
  for (const [name, info] of cards) {
    put(normName(name), info);
    if (info.scryfallName) put(normName(info.scryfallName), info);
    for (const f of info.faces ?? []) put(normName(f.name), info);
  }
  const find = (name: string): CardInfo | null => {
    const info = cards.get(name) ?? byNorm.get(normName(name)) ?? null;
    return info && info.found ? info : null;
  };
  return {
    text(name) {
      const info = find(name);
      return info ? faceText(info) : null;
    },
    faceCost(name, face) {
      const info = find(name);
      const f = (info?.faces ?? []).find((x) => normName(x.name) === normName(face));
      return f && f.manaCost ? f.manaCost : null;
    },
    faces(name) {
      const info = find(name);
      const named = (info?.faces ?? []).filter((f) => f.name);
      return named.length >= 2 ? named.map((f) => f.name) : [];
    },
  };
}

export const NO_ORACLE: Oracle = { text: () => null, faceCost: () => null, faces: () => [] };

/**
 * Does this oracle text have an activated ability that is not a mana ability?
 * A HINT for which permanents to offer as "activate" on an engine without
 * `state.activatable` (M63): the engine is still the judge.
 */
export function hasNonManaActivated(text: string | null): boolean {
  if (!text) return false;
  for (const line of text.split('\n')) {
    const clean = line.replace(/\([^)]*\)/g, '');
    if (/^\s*(?:[^—\n]{1,40}\s—\s*)?(Equip|Reconfigure|Fortify|Level up|Crew|Outlast|Adapt|Monstrosity)\b/i.test(clean)) return true;
    const m = /^([^"]*?):\s*(.*)$/.exec(clean);
    if (!m) continue;
    const cost = m[1]!;
    if (!/\{|\bTap\b|\bSacrifice\b|\bDiscard\b|\bPay\b|\bExile\b|\bRemove\b/i.test(cost)) continue;
    if (/^(Equip|Level up|Ninjutsu|Cycling|Channel|Reinforce|Transfigure|Fortify|Reconfigure)/i.test(cost.trim())) {
      if (/^(Equip|Reconfigure|Fortify|Level up)/i.test(cost.trim())) return true;
      continue;
    }
    if (/^Add\b/i.test(m[2]!.trim())) continue;
    return true;
  }
  return false;
}

/** Whether the ability's cost taps the permanent ("{T}"), so a tapped one cannot use it. */
export const needsTap = (text: string | null): boolean => /\{T\}[^:\n]*:/.test(text ?? '');

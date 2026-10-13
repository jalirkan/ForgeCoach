/*
 * ForgeCoach — ui/cardRefs.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Engine ids in the coach's words, read the way the board shows the card
 * (common-sense pass items 3/11). The coach's prompts give the model every
 * card's engine id ("Construct Token #297", the game log's "[297]") so its
 * steps can say which of two same-named cards it means; the board never shows
 * that number. Here an id becomes what the player can see: in combat the
 * badge's number (a blocked attacker and its blockers; an attacker nothing
 * blocks wears none), else — only when another visible card has the same name —
 * its power/toughness, "tapped" / "untapped", or its place in the row
 * ("2nd from left"). The id itself is never shown; it stays in the data so
 * the named card can be lit on the board while its step is hovered.
 *
 * Pure. Only what the viewing seat's state shows: a hidden or unknown id
 * keeps the words before it and loses the number, nothing is guessed.
 */
import type { AnyCard, Card, GameStateBody } from '../protocol.ts';
import { isHidden } from '../protocol.ts';
import type { CardCombatMark } from './cardContext.ts';
import { combatMarks } from './play/combatLines.ts';

export interface CardRefLook {
  /** The state the board shows now. */
  state: GameStateBody | null;
  /** The board's combat badges (PlayView's, with clicks not yet confirmed); absent: read from the state. */
  combat?: ReadonlyMap<number, Pick<CardCombatMark, 'n' | 'role'>>;
}

/** A card the text names by id, in the board's words. */
export interface CardRef {
  /** The engine id (data only: never rendered). */
  id: number;
  /** The words shown: the name as written ("Construct Token"), '' when the text had only the id. */
  text: string;
  /** What tells it apart on the board: the combat badge number, "4/4", "tapped", "2nd from left"; null when the name alone is enough. */
  tag: string | null;
  /** The tag is the combat lane's badge number. */
  combat: boolean;
}

export type RefSeg = string | CardRef;

/** "#297", or the game log's "[297]". */
const ID_TOKEN = /\s?(?:#(\d+)|\[(\d+)\])(?![\w/])/g;

function visibleCards(state: GameStateBody): Card[] {
  const out: Card[] = [];
  for (const p of state.players) for (const z of Object.values(p.zones)) for (const c of z.cards as AnyCard[]) if (!isHidden(c)) out.push(c as Card);
  for (const c of (state.stackCards ?? []) as AnyCard[]) if (!isHidden(c)) out.push(c as Card);
  return out;
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
const ORD = ['', '1st', '2nd', '3rd'];
const ordinal = (n: number) => ORD[n] ?? `${n}th`;

/** What tells this card apart from the visible cards that share its name; null when nothing needs to. */
export function boardTag(card: Card, look: CardRefLook): { tag: string | null; combat: boolean } {
  const state = look.state;
  if (!state) return { tag: null, combat: false };
  const marks = look.combat ?? combatMarks(state);
  const m = marks.get(card.id);
  // Only a block pair wears a number (combatLines.ts): an attacker nothing blocks is told apart as outside combat.
  if (m && m.n !== null && card.zone === 'battlefield') return { tag: String(m.n), combat: true };
  if (card.zone !== 'battlefield' || !card.name) return { tag: null, combat: false };
  const row = state.players.flatMap((p) => p.zones.battlefield.cards as AnyCard[]).filter((c): c is Card => !isHidden(c) && norm((c as Card).name) === norm(card.name));
  if (row.length < 2) return { tag: null, combat: false };
  const pt = (c: Card) => (c.power !== null && c.toughness !== null ? `${c.power}/${c.toughness}` : null);
  const mine = pt(card);
  if (mine && row.filter((c) => pt(c) === mine).length === 1) return { tag: mine, combat: false };
  if (row.filter((c) => c.tapped === card.tapped).length === 1) return { tag: card.tapped ? 'tapped' : 'untapped', combat: false };
  const side = row.filter((c) => c.controller === card.controller);
  const at = side.findIndex((c) => c.id === card.id);
  return { tag: side.length > 1 && at >= 0 ? `${ordinal(at + 1)} from left` : null, combat: false };
}

/**
 * The text split at every engine id: plain strings, and each referenced card
 * with the name written before its id (when it is that card's name) and its
 * board tag. Without a look (no board), ids are only taken out.
 */
export function splitCardRefs(text: string, look: CardRefLook | null): RefSeg[] {
  const src = String(text ?? '');
  const out: RefSeg[] = [];
  const byId = new Map<number, Card>();
  if (look?.state) for (const c of visibleCards(look.state)) byId.set(c.id, c);
  let last = 0;
  ID_TOKEN.lastIndex = 0;
  for (let m = ID_TOKEN.exec(src); m; m = ID_TOKEN.exec(src)) {
    const id = Number(m[1] ?? m[2]);
    let before = src.slice(last, m.index);
    const card = byId.get(id);
    if (!card || !card.name) {
      if (before) out.push(before);
      last = m.index + m[0].length;
      continue;
    }
    // the name written just before the id, as the card's name or without its " Token"
    const names = [card.name, card.name.replace(/\s+token$/i, '')].filter(Boolean);
    let named = '';
    for (const n of names) {
      if (before.toLowerCase().endsWith(n.toLowerCase())) {
        named = before.slice(before.length - n.length);
        before = before.slice(0, before.length - n.length);
        break;
      }
    }
    if (before) out.push(before);
    const t = boardTag(card, look!);
    out.push({ id, text: named, tag: t.tag, combat: t.combat });
    last = m.index + m[0].length;
  }
  if (last < src.length) out.push(src.slice(last));
  // merge neighbouring strings
  return out.reduce<RefSeg[]>((acc, s) => {
    const prev = acc[acc.length - 1];
    if (typeof s === 'string' && typeof prev === 'string') acc[acc.length - 1] = prev + s;
    else acc.push(s);
    return acc;
  }, []);
}

/** The text as plain words: ids out, each referenced card as "<name> <tag>". */
export function cardRefText(text: string, look: CardRefLook | null): string {
  return splitCardRefs(text, look)
    .map((s) => (typeof s === 'string' ? s : [s.text, s.tag].filter(Boolean).join(' ')))
    .join('')
    .replace(/[ \t]{2,}/g, ' ');
}

/**
 * Every visible card a piece of coach text names: the ids it gives, and the
 * battlefield and hand cards whose full name it spells out without an id
 * (every copy, since a name alone does not say which). For lighting them on
 * the board.
 */
export function namedCardIds(text: string, look: CardRefLook | null): number[] {
  if (!look?.state) return [];
  const ids = new Set<number>();
  const plain: string[] = [];
  // a name written with its id means that card only: names are looked for in the rest
  for (const s of splitCardRefs(text, look)) if (typeof s === 'string') plain.push(s);
  else {
    ids.add(s.id);
    plain.push(' | ');
  }
  const low = ` ${norm(plain.join('').replace(/[^\p{L}\p{N}'’,\- ]/gu, ' '))} `;
  for (const p of look.state.players)
    for (const zone of ['battlefield', 'hand'] as const)
      for (const c of p.zones[zone].cards as AnyCard[]) {
        if (isHidden(c) || !(c as Card).name) continue;
        const n = norm((c as Card).name.replace(/[^\p{L}\p{N}'’,\- ]/gu, ' '));
        if (n.length >= 3 && (low.includes(` ${n} `) || low.includes(` ${n},`))) ids.add(c.id);
      }
  return [...ids];
}

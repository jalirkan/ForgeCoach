/*
 * ForgeCoach — ui/zoneView.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The zone viewer's model (graveyard, exile, command, and the library cards
 * this seat may see): sort orders — Recency / Name / CMC / Type — and the
 * type summary line ("2 Instants · 1 Creature"). Pure.
 *
 * Only the cards the redacted state carries: a concealed card stays a card
 * back (and sorts last, by its place in the zone), and a library is never
 * more than `library.cards` — the ones a continuous effect lets this seat see.
 */
import type { AnyCard, Card } from '../protocol.ts';
import { isHidden } from '../protocol.ts';

export type ZoneSort = 'recency' | 'name' | 'cmc' | 'type';
export const ZONE_SORTS: { id: ZoneSort; label: string }[] = [
  { id: 'recency', label: 'Recency' },
  { id: 'name', label: 'Name' },
  { id: 'cmc', label: 'CMC' },
  { id: 'type', label: 'Type' },
];

/** Mana value of a cost string: `{2}{W}{W}` → 4, `{X}{R}` → 1, `{2/W}` → 2, `{W/U}` → 1. */
export function manaValue(cost: string | null | undefined): number {
  if (!cost) return 0;
  let n = 0;
  for (const m of cost.matchAll(/\{([^}]+)\}/g)) {
    const s = m[1]!.toUpperCase();
    if (/^\d+$/.test(s)) n += Number(s);
    else if (/^[XYZ]$/.test(s)) n += 0;
    else if (/^2\//.test(s)) n += 2;
    else n += 1;
  }
  return n;
}

const TYPE_ORDER = ['Creature', 'Planeswalker', 'Battle', 'Instant', 'Sorcery', 'Artifact', 'Enchantment', 'Land'] as const;
const PLURAL: Record<string, string> = { Sorcery: 'Sorceries' };

/** The headline type of a type line: the first of TYPE_ORDER it contains, else its first word. */
export function mainType(types: string | null | undefined): string {
  const t = types ?? '';
  for (const k of TYPE_ORDER) if (new RegExp(`\\b${k}\\b`).test(t)) return k;
  return t.replace(/^(Legendary|Basic|Snow|World|Tribal|Kindred)\s+/g, '').split(/[\s-]/)[0] || 'Card';
}

/** Cards in the order the zone holds them, oldest first (the wire's order). */
export function sortZone(cards: readonly AnyCard[], sort: ZoneSort): AnyCard[] {
  const at = new Map(cards.map((c, i) => [c.id, i]));
  const recency = (a: AnyCard, b: AnyCard) => at.get(b.id)! - at.get(a.id)!; // newest first
  const shown = cards.filter((c) => !isHidden(c)) as Card[];
  const hidden = cards.filter((c) => isHidden(c));
  const name = (c: Card) => (c.name || c.alt?.name || '').toLowerCase();
  let sorted: Card[];
  switch (sort) {
    case 'name':
      sorted = [...shown].sort((a, b) => name(a).localeCompare(name(b)) || recency(a, b));
      break;
    case 'cmc':
      sorted = [...shown].sort((a, b) => manaValue(a.manaCost) - manaValue(b.manaCost) || name(a).localeCompare(name(b)));
      break;
    case 'type': {
      const rank = (c: Card) => {
        const i = (TYPE_ORDER as readonly string[]).indexOf(mainType(c.types));
        return i < 0 ? TYPE_ORDER.length : i;
      };
      sorted = [...shown].sort((a, b) => rank(a) - rank(b) || name(a).localeCompare(name(b)));
      break;
    }
    default:
      sorted = [...shown].sort(recency);
  }
  return [...sorted, ...[...hidden].sort(recency)];
}

/** "2 Instants · 1 Creature · 1 face-down card", most common first. */
export function typeSummary(cards: readonly AnyCard[]): string {
  const counts = new Map<string, number>();
  let hidden = 0;
  for (const c of cards) {
    if (isHidden(c)) hidden++;
    else {
      const t = mainType((c as Card).types);
      counts.set(t, (counts.get(t) ?? 0) + 1);
    }
  }
  const parts = [...counts]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([t, n]) => `${n} ${n === 1 ? t : PLURAL[t] ?? `${t}s`}`);
  if (hidden) parts.push(`${hidden} hidden card${hidden === 1 ? '' : 's'}`);
  return parts.join(' · ');
}

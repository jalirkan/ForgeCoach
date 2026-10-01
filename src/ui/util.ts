/*
 * ForgeCoach — ui/util.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Small pure helpers the components share.
 */
import type { AnyCard, Card, GameStateBody } from '../protocol.ts';
import { isHidden } from '../protocol.ts';
import type { GameLog } from '../log.ts';

export interface StateFrame {
  frameIndex: number;
  state: GameStateBody;
}

/** Every state frame of the log, in order. */
export function stateFrames(log: GameLog): StateFrame[] {
  const out: StateFrame[] = [];
  log.frames.forEach((f, i) => {
    if (f.type === 'state') out.push({ frameIndex: i, state: f.body as GameStateBody });
  });
  return out;
}

/** Every visible card name anywhere in the log (for prefetching card data). */
export function allCardNames(log: GameLog, from = 0): string[] {
  const names = new Set<string>();
  const add = (c: AnyCard) => {
    if (isHidden(c)) return;
    const card = c as Card;
    // Tokens and engine-made effect cards have no Scryfall printing to fetch.
    if (card.token || / Effect$/.test(card.name ?? '')) return;
    if (card.name) names.add(card.name);
    if (card.alt?.name) names.add(card.alt.name);
  };
  for (let i = from; i < log.frames.length; i++) {
    const f = log.frames[i]!;
    if (f.type !== 'state') continue;
    const s = f.body as GameStateBody;
    for (const p of s.players ?? []) {
      for (const z of Object.values(p.zones)) for (const c of z.cards) add(c);
    }
    for (const c of s.stackCards ?? []) add(c);
  }
  return [...names];
}

/** Visible card names in one state. */
export function stateCardNames(s: GameStateBody): string[] {
  const names = new Set<string>();
  for (const p of s.players ?? []) {
    for (const z of Object.values(p.zones)) {
      for (const c of z.cards) if (!isHidden(c) && (c as Card).name) names.add((c as Card).name);
    }
  }
  return [...names];
}

export type TypeKind =
  | 'land'
  | 'creature'
  | 'planeswalker'
  | 'artifact'
  | 'enchantment'
  | 'instant'
  | 'sorcery'
  | 'battle'
  | 'other';

export function typeKind(types: string | null | undefined): TypeKind {
  const t = (types ?? '').toLowerCase();
  if (t.includes('creature')) return 'creature';
  if (t.includes('planeswalker')) return 'planeswalker';
  if (t.includes('land')) return 'land';
  if (t.includes('battle')) return 'battle';
  if (t.includes('instant')) return 'instant';
  if (t.includes('sorcery')) return 'sorcery';
  if (t.includes('artifact')) return 'artifact';
  if (t.includes('enchantment')) return 'enchantment';
  return 'other';
}

/** "Legendary Creature - Human Spy" → "Creature — Human Spy" (drop supertypes for compactness). */
export function shortType(types: string | null | undefined): string {
  if (!types) return '';
  const [main, sub] = types.split(/\s+[-—]\s+/);
  const kept = (main ?? '')
    .split(/\s+/)
    .filter((w) => !/^(Legendary|Basic|Snow|World|Token)$/i.test(w))
    .join(' ');
  return sub ? `${kept} — ${sub}` : kept;
}

/** "{2}{U}{U}" → ["2","U","U"]. */
export function costSymbols(cost: string | null | undefined): string[] {
  if (!cost) return [];
  const out: string[] = [];
  const re = /\{([^}]+)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(cost))) out.push(m[1]!);
  if (out.length === 0 && cost.trim()) {
    // Forge occasionally writes "2 U U" without braces.
    for (const part of cost.trim().split(/\s+/)) out.push(part);
  }
  return out;
}

const BASIC_COLOR: Record<string, string> = {
  plains: 'W',
  island: 'U',
  swamp: 'B',
  mountain: 'R',
  forest: 'G',
};

/** Colour letters of a card, from its cost or (for lands) its basic types or produced mana. */
export function cardColors(card: Card, produced?: string[], infoColors?: string[]): string[] {
  const set = new Set<string>();
  for (const s of costSymbols(card.manaCost)) {
    for (const ch of s.split('/')) if ('WUBRG'.includes(ch)) set.add(ch);
  }
  if (set.size === 0 && infoColors) for (const c of infoColors) set.add(c);
  if (set.size === 0 && typeKind(card.types) === 'land') {
    const t = card.types.toLowerCase();
    for (const [k, v] of Object.entries(BASIC_COLOR)) if (t.includes(k)) set.add(v);
    if (set.size === 0 && produced) for (const c of produced) if ('WUBRG'.includes(c)) set.add(c);
  }
  return 'WUBRG'.split('').filter((c) => set.has(c));
}

export function colorClass(colors: string[]): string {
  if (colors.length === 0) return 'c-none';
  if (colors.length > 1) return 'c-multi';
  return `c-${colors[0]}`;
}

const COUNTER_LABEL: Record<string, string> = {
  P1P1: '+1/+1',
  M1M1: '−1/−1',
  LOYALTY: 'Loyalty',
};

export function counterLabel(k: string): string {
  return COUNTER_LABEL[k] ?? k.charAt(0) + k.slice(1).toLowerCase().replace(/_/g, ' ');
}

export function keywordLabel(k: string): string {
  return k
    .toLowerCase()
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/** Copy to clipboard with a textarea fallback for older/insecure contexts. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

export function readLS(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeLS(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* storage unavailable */
  }
}

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

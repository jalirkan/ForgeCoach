/*
 * ForgeCoach — draft/aiFlags.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Cards Forge flags `AI:RemoveDeck`: its AI plays them badly (`All`) or
 * leaves them out of random decks (`Random`). The cube documents list them
 * in prose ("Rated `All`: Prismatic Strands, …" or a bullet per flag); a
 * meta.json card may also carry `remAIDeck: true`. The match screen warns
 * about the `All` cards in the AI's deck, as a real table would.
 */
import { mentionedCards } from '../cube/parseCube.ts';
import type { CubeMeta } from '../cube/meta.ts';

export interface AiFlags {
  /** AI:RemoveDeck:All — the AI can't pilot these well. */
  all: Set<string>;
  /** AI:RemoveDeck:Random — kept out of random AI decks. */
  random: Set<string>;
}

/** The flags a cube document states, matched to its card names. */
export function aiFlagsFromDoc(text: string, names: string[]): AiFlags {
  const all = new Set<string>();
  const random = new Set<string>();
  const lines = text.split(/\r?\n/);
  let inBlock = false;
  for (const line of lines) {
    const mentions = /RemoveDeck|RemAIDeck/i.test(line);
    if (mentions) inBlock = true;
    else if (!line.trim()) {
      inBlock = false;
      continue;
    } else if (!/^\s*[-*]/.test(line)) inBlock = false;
    if (!inBlock && !mentions) continue;
    // Split the line at each `All` / `Random` marker; names after a marker carry that flag.
    const parts = line.split(/`?(?:AI:RemoveDeck:)?(All|Random)`?(?=[\s:)(])/);
    let flag: 'All' | 'Random' | null = null;
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i] ?? '';
      if (i % 2 === 1) {
        flag = p as 'All' | 'Random';
        continue;
      }
      if (!flag) continue;
      for (const n of mentionedCards(p, names)) (flag === 'All' ? all : random).add(n);
    }
  }
  for (const n of all) random.delete(n);
  return { all, random };
}

/** Adds the meta's flags (a card list entry with `remAIDeck: true`) to the document's. */
export function withMetaFlags(flags: AiFlags, meta: CubeMeta | null): AiFlags {
  const all = new Set(flags.all);
  for (const c of meta?.cube.cards ?? []) if ((c as { remAIDeck?: unknown }).remAIDeck === true) all.add(c.name);
  return { all, random: new Set([...flags.random].filter((n) => !all.has(n))) };
}

export const noFlags = (): AiFlags => ({ all: new Set(), random: new Set() });

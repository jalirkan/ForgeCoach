/*
 * ForgeCoach — ambience/layout.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Where each slot sits in a strip and how wide it is. Pure.
 *
 * Order: by arrival (the first land's biome on the left), or — when the pack
 * asks for `strip.order: "preference"` — biomes that prefer the left first and
 * those that prefer the right last, arrival order within each group.
 * Width: a flex weight that grows a little with the stage (a richer scene
 * takes more room) times the pack's per-biome weight.
 */
import type { SlotState } from './model.ts';
import type { ScenePack } from './manifest.ts';

export interface SlotLayout {
  slot: SlotState;
  /** Stage to draw (the override from the preview page, else the slot's own). */
  stage: number;
  grow: number;
}

export function slotLayout(slots: SlotState[], pack: ScenePack | null, stageOverride: number | null = null): SlotLayout[] {
  const rank = (s: SlotState) => {
    if (pack?.strip.order !== 'preference') return 0;
    const pref = pack.biomes[s.biome]?.slot.prefer ?? 'any';
    return pref === 'left' ? 0 : pref === 'right' ? 2 : 1;
  };
  const ordered = [...slots].sort((a, b) => rank(a) - rank(b) || a.index - b.index);
  return ordered.map((slot) => {
    const stage = stageOverride !== null && slot.stage > 0 ? stageOverride : slot.stage;
    const weight = pack?.biomes[slot.biome]?.slot.weight ?? 1;
    // A withered slot (its lands gone) keeps a sliver of room.
    const grow = (stage > 0 ? 1 + 0.18 * (stage - 1) : 0.45) * weight;
    return { slot, stage, grow: Math.round(grow * 100) / 100 };
  });
}

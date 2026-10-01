/*
 * ForgeCoach — guide.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Deck play guides, editable in the UI, stored in localStorage (an in-memory
 * map stands in where there is no localStorage, e.g. node tests).
 *
 * Built-in guides are seeded on first read. Saving over a built-in keeps the
 * edit; deleting a built-in restores its default text instead of removing it.
 */
export interface Guide {
  id: string;
  name: string;
  text: string;
}

export const RAKDOS_GUIDE_ID = 'builtin:rakdos-sacrifice-cube';

export const RAKDOS_GUIDE_TEXT = `Rakdos sacrifice (cube practice deck).

Decklist: Viscera Seer, Carrion Feeder, Gravecrawler, Stitcher's Supplier, Blood Artist, Zulaport Cutthroat, Priest of Forgotten Gods, Young Pyromancer, Ophiomancer, Bloodghast, Juri, Master of the Revue, Mayhem Devil, Woe Strider, Midnight Reaper, Pia Nalaar, Pia and Kiran Nalaar, Hangarback Walker, Skullclamp, Goblin Bombardment, Village Rites, Deadly Dispute, Lightning Bolt, Fatal Push, Blood Crypt, Bloodstained Mire, Marsh Flats, Scalding Tarn, 7 Swamp, 6 Mountain.

How to play it:
- Lead with fodder; hold the payoffs (Blood Artist, Zulaport Cutthroat, Mayhem Devil) until there is an instant-speed sacrifice outlet on the board (Viscera Seer, Goblin Bombardment, or Village Rites / Deadly Dispute in hand).
- Respond to removal by sacrificing the target.
- Juri is a Fireball once she's big: her death trigger deals damage equal to her power to any target.
- Skullclamp only on 1-toughness creatures (they die at once and draw two).
- Gravecrawler + Goblin Bombardment + a Zombie (Stitcher's Supplier, Carrion Feeder) is a 1-mana ping loop.
- Don't chump-block with Stitcher's Supplier while the Gravecrawler loop matters.
- Keep count of sacrifice outlets on board: 0 = play it like a creature deck, 1 = the engine is on, 2 = count the drains, the game ends soon.`;

const BUILTINS: readonly Guide[] = Object.freeze([
  Object.freeze({ id: RAKDOS_GUIDE_ID, name: 'Rakdos sacrifice (cube)', text: RAKDOS_GUIDE_TEXT }),
]);

const GUIDES_KEY = 'forgecoach.guides.v1';
const ACTIVE_KEY = 'forgecoach.activeGuide.v1';

// --- storage with an in-memory fallback -----------------------------------

const memory = new Map<string, string>();

function storage(): Storage | null {
  try {
    const ls = (globalThis as { localStorage?: Storage }).localStorage;
    if (!ls) return null;
    const probe = '__forgecoach_probe__';
    ls.setItem(probe, '1');
    ls.removeItem(probe);
    return ls;
  } catch {
    return null;
  }
}

function read(key: string): string | null {
  const ls = storage();
  if (ls) {
    try {
      return ls.getItem(key);
    } catch {
      /* fall through */
    }
  }
  return memory.has(key) ? memory.get(key)! : null;
}

function write(key: string, value: string | null): void {
  const ls = storage();
  if (ls) {
    try {
      if (value === null) ls.removeItem(key);
      else ls.setItem(key, value);
      return;
    } catch {
      /* quota or privacy mode: keep it in memory */
    }
  }
  if (value === null) memory.delete(key);
  else memory.set(key, value);
}

// --- guides ----------------------------------------------------------------

function isGuide(x: unknown): x is Guide {
  const g = x as Guide;
  return !!g && typeof g.id === 'string' && typeof g.name === 'string' && typeof g.text === 'string';
}

/** User-saved guides (including edited built-ins), in saved order. */
function stored(): Guide[] {
  const raw = read(GUIDES_KEY);
  if (!raw) return [];
  try {
    const v = JSON.parse(raw) as unknown;
    return Array.isArray(v) ? v.filter(isGuide) : [];
  } catch {
    return [];
  }
}

function store(gs: Guide[]): void {
  write(GUIDES_KEY, JSON.stringify(gs));
}

export function isBuiltinGuide(id: string): boolean {
  return BUILTINS.some((b) => b.id === id);
}

/** The shipped default of a built-in guide, or null. */
export function defaultGuide(id: string): Guide | null {
  const b = BUILTINS.find((x) => x.id === id);
  return b ? { ...b } : null;
}

/** Built-ins first (edited copy if the user saved one), then the user's own guides. */
export function listGuides(): Guide[] {
  const saved = stored();
  const byId = new Map(saved.map((g) => [g.id, g]));
  const out: Guide[] = BUILTINS.map((b) => ({ ...(byId.get(b.id) ?? b) }));
  for (const g of saved) if (!isBuiltinGuide(g.id)) out.push({ ...g });
  return out;
}

export function getGuide(id: string): Guide | null {
  return listGuides().find((g) => g.id === id) ?? null;
}

export function saveGuide(g: Guide): void {
  if (!isGuide(g) || g.id === '') throw new Error('A guide needs an id, a name and text.');
  const saved = stored();
  const i = saved.findIndex((x) => x.id === g.id);
  const copy = { id: g.id, name: g.name, text: g.text };
  if (i >= 0) saved[i] = copy;
  else saved.push(copy);
  store(saved);
}

/** Removes a user guide; for a built-in, throws away the edits (the default comes back). */
export function deleteGuide(id: string): void {
  store(stored().filter((g) => g.id !== id));
  if (!isBuiltinGuide(id) && activeGuideId() === id) setActiveGuideId(null);
}

/** A fresh id for a new user guide. */
export function newGuideId(): string {
  return `user:${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** The guide the user picked for coaching (null = none). */
export function activeGuideId(): string | null {
  const id = read(ACTIVE_KEY);
  if (!id) return null;
  return listGuides().some((g) => g.id === id) ? id : null;
}

export function setActiveGuideId(id: string | null): void {
  write(ACTIVE_KEY, id);
}

/** Text of the active guide, for buildCoachPrompt / buildReviewPrompt. */
export function activeGuideText(): string | undefined {
  const id = activeGuideId();
  return id ? (getGuide(id)?.text ?? undefined) : undefined;
}

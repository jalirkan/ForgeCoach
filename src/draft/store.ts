/*
 * ForgeCoach — draft/store.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The draft in progress (and the last finished one, until a new draft
 * starts), saved in this browser after every pick so a refresh resumes it.
 * Storage is injected for tests; without it, localStorage, and nothing at all
 * in private mode (the draft still works, it just doesn't survive a refresh).
 */
import type { DeckState } from './deck.ts';
import type { Draft } from './draft.ts';

export const DRAFT_KEY = 'forgecoach.draft.v1';

/** What the page keeps beside the draft once it is over. */
export interface DraftAfter {
  /** The SavedPool (cube/pools.ts) made from your picks. */
  poolId?: string;
  /** The AI's deck: never shown on the page (hidden information), sent to the match launcher. */
  aiDeck?: { name: string; main: Array<[number, string]>; sideboard: Array<[number, string]> };
}

export interface SavedDraft {
  draft: Draft;
  hints: boolean;
  /** The table's name (editable on the set-up screen). */
  title?: string;
  /** Seconds per pick, or 0 for no timer. */
  timer?: number;
  /** Pool cards you moved to the SIDE column while drafting. */
  side?: string[];
  /** The deck being built after the draft. */
  deck?: DeckState;
  after?: DraftAfter;
}

type KV = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function store(s?: KV | null): KV | null {
  if (s) return s;
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function valid(x: unknown): x is SavedDraft {
  if (!x || typeof x !== 'object') return false;
  const d = (x as SavedDraft).draft;
  return !!d && d.v === 1 && (d.format === 'grid' || d.format === 'winston' || d.format === 'booster') && Array.isArray(d.dealt) && !!d.picks && Array.isArray(d.picks.you);
}

export function loadDraft(s?: KV | null): SavedDraft | null {
  const st = store(s);
  if (!st) return null;
  try {
    const raw = JSON.parse(st.getItem(DRAFT_KEY) ?? 'null') as unknown;
    return valid(raw) ? raw : null;
  } catch {
    return null;
  }
}

export function saveDraft(d: SavedDraft, s?: KV | null): void {
  const st = store(s);
  if (!st) return;
  try {
    st.setItem(DRAFT_KEY, JSON.stringify(d));
  } catch {
    /* quota or private mode: the draft lives on in memory */
  }
}

export function clearDraft(s?: KV | null): void {
  try {
    store(s)?.removeItem(DRAFT_KEY);
  } catch {
    /* ignore */
  }
}

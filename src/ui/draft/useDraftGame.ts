/*
 * ForgeCoach — ui/draft/useDraftGame.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The draft against the AI as React state: the saved draft (resumed after a
 * refresh), the cube's scoring context, the AI's Grid and Winston turns
 * played out one beat at a time (Booster bots pick with you), and what
 * happens when the draft ends: your pool saved for the deck assistant, your
 * deck started, the AI's deck built and kept out of sight.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { buildDecks } from '../../cube/builder.ts';
import { cubeInfo } from '../../cube/cubes.ts';
import { newPool, savePool } from '../../cube/pools.ts';
import { labCards } from '../../draft/cards.ts';
import { initialDeck, type DeckState } from '../../draft/deck.ts';
import { aiStep, apply, knownAiCards, newDraft, toAct, type Draft, type DraftAction, type DraftEvent, type Format } from '../../draft/draft.ts';
import { matchDeck } from '../../draft/launch.ts';
import { newSeed } from '../../draft/rng.ts';
import { clearDraft, loadDraft, saveDraft, type SavedDraft } from '../../draft/store.ts';
import { useCubeData, type CubeData } from '../deck/useCubeData.ts';

/** How long the AI's grid line stays lit before it leaves. */
export const LINE_BEAT_MS = 1100;

export interface StartOptions {
  cubeId: string;
  format: Format;
  youFirst: boolean;
  hints: boolean;
  seats: number;
  timer: number;
  title: string;
}

interface Pending extends StartOptions {
  pending: true;
}

export interface DraftGame {
  saved: SavedDraft | null;
  draft: Draft | null;
  data: CubeData;
  /** The AI is deciding (its beat is running). */
  aiBusy: boolean;
  /** The AI's last decision, for the banner (null once it has faded). */
  aiNote: DraftEvent | null;
  /** A grid line the AI just took (shown before it leaves the board). */
  aiLine: number | null;
  start: (o: StartOptions) => void;
  act: (a: DraftAction) => void;
  update: (patch: Partial<Omit<SavedDraft, 'draft'>>) => void;
  setDeck: (d: DeckState) => void;
  abandon: () => void;
}

export function useDraftGame(): DraftGame {
  const [saved, setSaved] = useState<SavedDraft | null>(() => loadDraft());
  const raw = saved?.draft as unknown as (Draft & { pending?: undefined }) | Pending | undefined;
  const pending = raw && 'pending' in raw && raw.pending ? (raw as Pending) : null;
  const draft = pending ? null : ((raw as Draft | undefined) ?? null);
  const data = useCubeData(pending?.cubeId ?? draft?.cubeId ?? null);
  const ctx = data.ctx;
  const cards = useMemo(() => (ctx ? labCards(ctx) : null), [ctx]);
  const [aiNote, setAiNote] = useState<DraftEvent | null>(null);
  const [aiLine, setAiLine] = useState<number | null>(null);
  const savedRef = useRef(saved);
  savedRef.current = saved;
  const cardsRef = useRef(cards);
  cardsRef.current = cards;

  const commit = useCallback((s: SavedDraft | null) => {
    savedRef.current = s;
    setSaved(s);
    if (s) saveDraft(s);
    else clearDraft();
  }, []);

  const start = useCallback(
    (o: StartOptions) => {
      // The cube's names come with its context: the draft is dealt once that has loaded (below).
      setSaved({ draft: { pending: true, ...o } as unknown as Draft, hints: o.hints, title: o.title, timer: o.timer });
    },
    [],
  );

  useEffect(() => {
    if (!pending || !ctx || ctx.cube.cards.length === 0) return;
    const nd = newDraft({ cubeId: pending.cubeId, format: pending.format, youFirst: pending.youFirst, seats: pending.seats, cube: ctx.cube.cards.map((c) => c.name), seed: newSeed() });
    commit({ draft: nd, hints: pending.hints, title: pending.title, timer: pending.timer, side: [] });
  }, [pending, ctx, commit]);

  const ready = !!draft && !!cards;
  const aiTurn = ready && draft.format !== 'booster' && toAct(draft) === 'ai';

  // The AI's Grid and Winston turns, one decision per beat.
  useEffect(() => {
    if (!aiTurn || !draft || !cards) return;
    const t = setTimeout(
      () => {
        const cur = savedRef.current;
        if (!cur || cur.draft !== draft) return;
        const next = aiStep(draft, cards);
        const e = next.log[next.log.length - 1] ?? null;
        if (next.format === 'grid' && e?.kind === 'line' && e.line !== undefined) {
          setAiLine(e.line);
          setAiNote(e);
          setTimeout(() => {
            setAiLine(null);
            const now = savedRef.current;
            if (now && now.draft === draft) commit({ ...now, draft: next });
          }, LINE_BEAT_MS);
          return;
        }
        setAiNote(e);
        commit({ ...cur, draft: next });
      },
      draft.log.length === 0 ? 700 : e0Delay(draft),
    );
    return () => clearTimeout(t);
  }, [aiTurn, draft, cards, commit]);

  useEffect(() => {
    if (!aiNote) return;
    const t = setTimeout(() => setAiNote(null), 2600);
    return () => clearTimeout(t);
  }, [aiNote]);

  // The draft is over: your pool for the deck assistant, your deck, and the AI's deck (never shown).
  useEffect(() => {
    if (!saved || !draft?.done || !ctx || saved.after?.poolId) return;
    const info = cubeInfo(draft.cubeId);
    const label = draft.format === 'grid' ? 'Grid' : draft.format === 'winston' ? 'Winston' : 'Booster';
    const p = newPool(draft.cubeId, `${saved.title || info?.title || draft.cubeId} · ${label} vs AI`);
    const pool = savePool({ ...p, cards: [...draft.picks.you], opp: knownAiCards(draft), format: draft.format === 'booster' ? null : draft.format, updatedAt: Date.now() });
    const ai = buildDecks(ctx, draft.picks.ai)[0];
    const side = saved.side ?? [];
    const deck = initialDeck(draft.picks.you);
    for (const n of side) {
      const i = deck.main.indexOf(n);
      if (i >= 0) deck.side.push(...deck.main.splice(i, 1));
    }
    commit({
      ...saved,
      deck: saved.deck ?? deck,
      after: { poolId: pool.id, aiDeck: ai ? matchDeck(`AI · ${info?.title ?? 'cube'} draft`, ai, draft.picks.ai) : undefined },
    });
  }, [saved, draft, ctx, commit]);

  const act = useCallback(
    (a: DraftAction) => {
      const cur = savedRef.current;
      if (!cur || toAct(cur.draft) !== 'you') return;
      try {
        commit({ ...cur, draft: apply(cur.draft, a, Date.now(), cardsRef.current ?? undefined) });
      } catch {
        /* a stale tap: ignore */
      }
    },
    [commit],
  );

  return {
    saved,
    draft: ready ? draft : null,
    data,
    aiBusy: aiTurn || aiLine !== null,
    aiNote,
    aiLine,
    start,
    act,
    update: (patch) => savedRef.current && commit({ ...savedRef.current, ...patch }),
    setDeck: (deck) => savedRef.current && commit({ ...savedRef.current, deck }),
    abandon: () => commit(null),
  };
}

/** A Winston pass is quick; a take lingers. */
function e0Delay(d: Draft): number {
  const last = d.log[d.log.length - 1];
  return last?.who === 'ai' && last.kind !== 'pass' ? 900 : 650;
}

/*
 * ForgeCoach — ui/draft/useDraftGame.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The draft against the AI as React state: the saved draft (resumed after a
 * refresh), the cube's scoring context, the AI's turns played out one beat at
 * a time, and what happens when the draft ends (your pool saved for the deck
 * assistant, the AI's deck built and kept out of sight).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { buildDecks } from '../../cube/builder.ts';
import { cubeInfo } from '../../cube/cubes.ts';
import { newPool, savePool } from '../../cube/pools.ts';
import { labCards } from '../../draft/cards.ts';
import { aiStep, apply, knownAiCards, newDraft, toAct, type Draft, type DraftAction, type DraftEvent, type Format } from '../../draft/draft.ts';
import { matchDeck } from '../../draft/launch.ts';
import { newSeed } from '../../draft/rng.ts';
import { clearDraft, loadDraft, saveDraft, type DraftAfter, type SavedDraft } from '../../draft/store.ts';
import { useCubeData, type CubeData } from '../deck/useCubeData.ts';

/** How long each AI decision stays on screen before the next. */
export const BEAT_MS = { pass: 700, take: 1100, line: 1100, blind: 1000, forced: 1000 } as const;

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
  start: (o: { cubeId: string; format: Format; youFirst: boolean; hints: boolean }) => void;
  act: (a: DraftAction) => void;
  setHints: (on: boolean) => void;
  abandon: () => void;
  setAfter: (a: DraftAfter) => void;
}

export function useDraftGame(): DraftGame {
  const [saved, setSaved] = useState<SavedDraft | null>(() => loadDraft());
  const draft = saved?.draft ?? null;
  const data = useCubeData(draft?.cubeId ?? null);
  const ctx = data.ctx;
  const cards = useMemo(() => (ctx ? labCards(ctx) : null), [ctx]);
  const [aiNote, setAiNote] = useState<DraftEvent | null>(null);
  const [aiLine, setAiLine] = useState<number | null>(null);
  const savedRef = useRef(saved);
  savedRef.current = saved;

  const commit = useCallback((s: SavedDraft | null) => {
    setSaved(s);
    if (s) saveDraft(s);
    else clearDraft();
  }, []);

  const start = useCallback(
    ({ hints, ...o }: { cubeId: string; format: Format; youFirst: boolean; hints: boolean }) => {
      // The cube's names come with the context; the draft is dealt once it is loaded (see below).
      commit({ draft: { pending: true, ...o } as unknown as Draft, hints });
    },
    [commit],
  );

  // Deal a pending draft once its cube is loaded.
  useEffect(() => {
    const d = saved?.draft as unknown as { pending?: boolean; cubeId: string; format: Format; youFirst: boolean } | undefined;
    if (!d?.pending || !ctx || ctx.cube.cards.length === 0) return;
    const nd = newDraft({ cubeId: d.cubeId, format: d.format, youFirst: d.youFirst, cube: ctx.cube.cards.map((c) => c.name), seed: newSeed() });
    commit({ draft: nd, hints: saved?.hints ?? true });
  }, [saved, ctx, commit]);

  const ready = !!draft && !(draft as unknown as { pending?: boolean }).pending && !!cards;
  const aiTurn = ready && toAct(draft) === 'ai';

  // The AI's turn, one decision per beat.
  useEffect(() => {
    if (!aiTurn || !draft || !cards) return;
    const t = setTimeout(() => {
      const cur = savedRef.current;
      if (!cur || cur.draft !== draft) return;
      const next = aiStep(draft, cards);
      const e = next.log[next.log.length - 1] ?? null;
      if (next.format === 'grid' && e?.kind === 'line' && e.line !== undefined) {
        // Show the AI's line on the old grid for a beat, then let it go.
        setAiLine(e.line);
        setAiNote(e);
        setTimeout(() => {
          setAiLine(null);
          commit({ ...cur, draft: next });
        }, BEAT_MS.line);
        return;
      }
      setAiNote(e);
      commit({ ...cur, draft: next });
    }, draft.log.length === 0 ? 600 : 450);
    return () => clearTimeout(t);
  }, [aiTurn, draft, cards, commit]);

  // The banner fades a while after the AI's last word.
  useEffect(() => {
    if (!aiNote) return;
    const t = setTimeout(() => setAiNote(null), 2600);
    return () => clearTimeout(t);
  }, [aiNote]);

  // The draft is over: save your pool for the deck assistant and build the AI's deck (never shown).
  useEffect(() => {
    if (!saved || !draft?.done || !ctx || saved.after?.poolId) return;
    const info = cubeInfo(draft.cubeId);
    const p = newPool(draft.cubeId, `${info?.title ?? draft.cubeId} · vs AI · ${new Date(draft.startedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`);
    const pool = savePool({ ...p, cards: [...draft.picks.you], opp: knownAiCards(draft), format: draft.format, updatedAt: Date.now() });
    const ai = buildDecks(ctx, draft.picks.ai)[0];
    commit({ ...saved, after: { poolId: pool.id, aiDeck: ai ? matchDeck(`AI · ${info?.title ?? 'cube'} draft`, ai, draft.picks.ai) : undefined } });
  }, [saved, draft, ctx, commit]);

  const act = useCallback(
    (a: DraftAction) => {
      const cur = savedRef.current;
      if (!cur || toAct(cur.draft) !== 'you') return;
      try {
        commit({ ...cur, draft: apply(cur.draft, a) });
      } catch {
        /* an illegal tap (a stale button): ignore */
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
    setHints: (on) => savedRef.current && commit({ ...savedRef.current, hints: on }),
    abandon: () => commit(null),
    setAfter: (a) => savedRef.current && commit({ ...savedRef.current, after: { ...savedRef.current.after, ...a } }),
  };
}

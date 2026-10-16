/*
 * ForgeCoach — ui/draft/useFriendRoom.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * One seat of a draft room (draft/room.ts, mtg-table D400) as React state, and
 * as the `DraftGame` the pick screen already knows how to show: the room's state
 * from its live stream, the other seat in place of the AI, a pick sent to the
 * room (which checks it and answers with the new state — nothing is applied
 * here first). Hints, the side column and the deck stay in this browser.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { initialDeck, type DeckState } from '../../draft/deck.ts';
import type { DraftAction, DraftEvent, GridDraft } from '../../draft/draft.ts';
import { checkRoomCube, reconnectNote, roomCardsSeen, RoomClient, RoomError, saveRoom, toGridDraft, type RoomState, type SavedRoom } from '../../draft/room.ts';
import { isFunnelHost, servedByTunnel } from '../../play/seatUrl.ts';
import type { SavedDraft } from '../../draft/store.ts';
import { useCubeData, type CubeData } from '../deck/useCubeData.ts';
import { cubeInfo } from '../../cube/cubes.ts';
import type { DraftGame } from './useDraftGame.ts';

export type RoomLink = 'connecting' | 'live' | 'reconnecting' | 'gone';

/**
 * A cube this browser does not have (the owner's own, cube/custom.ts), fetched
 * once from the room (D444 `GET /room/<id>/cube`) and checked against the
 * state's hash: `cards` (checked: the pick helper, the hash and the replay
 * check use it), `none` (an older room, or it could not be read: the stand-in
 * from what the room has shown), `bad` (the list is not the room's: refused).
 */
export type RoomCubeState = { kind: 'loading' } | { kind: 'cards'; cards: string[] } | { kind: 'none'; why: string | null } | { kind: 'bad'; problem: string };

export interface FriendRoom {
  entry: SavedRoom;
  state: RoomState | null;
  link: RoomLink;
  /** Why the link is reconnecting or gone, or the last refused pick. */
  note: string | null;
  draft: GridDraft | null;
  data: CubeData;
  game: DraftGame | null;
  opponent: string;
  /** Null for a cube this browser has. */
  roomCube: RoomCubeState | null;
  setDeck: (d: DeckState) => void;
  update: (patch: Partial<SavedRoom>) => void;
  /** Show a state the room answered with (a newer version wins). */
  take: (s: RoomState) => void;
}

export function useFriendRoom(entry0: SavedRoom): FriendRoom {
  const [entry, setEntry] = useState(entry0);
  const client = useMemo(() => new RoomClient(entry0.base, entry0.id, entry0.token), [entry0.base, entry0.id, entry0.token]);
  const [state, setState] = useState<RoomState | null>(null);
  const [link, setLink] = useState<RoomLink>('connecting');
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [theirs, setTheirs] = useState<DraftEvent | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  // Newer versions win; the same version may carry fresh presence ("online").
  const take = useCallback((s: RoomState) => {
    setState((prev) => (!prev || s.version >= prev.version ? s : prev));
  }, []);

  useEffect(() => {
    setLink('connecting');
    // mtg-table D408: on a page that came through a Cloudflare tunnel, a sign-in redirect or a few failed
    // reconnects in a row most likely mean the Access session ran out: say "reload".
    let tunnel = false;
    let funnel = false;
    try {
      tunnel = typeof location !== 'undefined' && servedByTunnel(location);
      funnel = tunnel && isFunnelHost(location.host);   // mtg-table D409: Tailscale Funnel has no sign-in
    } catch {
      /* no page */
    }
    let failures = 0;
    return client.stream(take, (st, why) => {
      setLink(st);
      failures = st === 'reconnecting' ? failures + 1 : 0;
      setNote(st === 'live' ? null : st === 'reconnecting' ? reconnectNote(tunnel, failures, why ?? null, funnel) : (why ?? null));
    });
  }, [client, take]);

  const update = useCallback((patch: Partial<SavedRoom>) => {
    setEntry((e) => {
      const next = { ...e, ...patch, savedAt: Date.now() };
      saveRoom(next);
      return next;
    });
  }, []);

  // A cube this browser does not have (the owner's own, cube/custom.ts): the room's whole list (D444), checked
  // against its hash; on an older room, the cards the room has shown so far.
  const cubeId = state?.cube.id ?? entry.cubeId;
  const foreign = !!state && !cubeInfo(cubeId);
  const [roomCube, setRoomCube] = useState<RoomCubeState | null>(null);
  const cubeAsked = useRef(false);
  useEffect(() => {
    if (!foreign || !state || cubeAsked.current) return;
    cubeAsked.current = true;
    setRoomCube({ kind: 'loading' });
    const want = { id: state.id, cube: state.cube };
    client
      .cube()
      .then(async (c) => {
        if (!c) return setRoomCube({ kind: 'none', why: null });
        if (!globalThis.crypto?.subtle) return setRoomCube({ kind: 'none', why: 'this browser can’t check the list' });
        const r = await checkRoomCube(c, want);
        setRoomCube(r.ok ? { kind: 'cards', cards: r.cards } : { kind: 'bad', problem: r.problem });
      })
      .catch((e: unknown) => setRoomCube({ kind: 'none', why: e instanceof Error ? e.message : String(e) }));
  }, [foreign, state, client]);
  const listed = roomCube?.kind === 'cards' ? roomCube.cards : null;
  const standIn = useMemo(() => {
    if (!state || !foreign || !roomCube || roomCube.kind === 'loading' || roomCube.kind === 'bad') return null;
    return { title: state.cube.title, names: listed ?? roomCardsSeen(state) };
  }, [state, foreign, roomCube, listed]);
  const data = useCubeData(cubeId, standIn);
  const draft = useMemo(() => (state ? toGridDraft(state) : null), [state]);
  const opponent = state ? state.seats[(1 - state.you) as 0 | 1].name : 'your friend';

  // The other seat's line, for the banner, when it arrives.
  const seenLog = useRef<number | null>(null);
  useEffect(() => {
    if (!draft) return;
    const n = draft.log.length;
    if (seenLog.current !== null && n > seenLog.current) {
      const e = draft.log[n - 1];
      if (e?.who === 'ai') setTheirs(e);
    }
    seenLog.current = n;
  }, [draft]);
  useEffect(() => {
    if (!theirs) return;
    const t = setTimeout(() => setTheirs(null), 2600);
    return () => clearTimeout(t);
  }, [theirs]);

  const act = useCallback(
    (a: DraftAction) => {
      const s = stateRef.current;
      if (!s || a.kind !== 'line' || s.toAct !== s.you || busy) return;
      setBusy(true);
      client
        .pick(a.line, s.version)
        .then((ns) => {
          take(ns);
          setNote(null);
        })
        .catch((e: unknown) => {
          if (e instanceof RoomError) {
            if (e.state) take(e.state);
            setNote(e.code === 'stale' ? 'The room moved on — here it is now.' : e.message);
          } else setNote('The pick did not reach the room. Try again.');
        })
        .finally(() => setBusy(false));
    },
    [client, busy, take],
  );

  const setDeck = useCallback((deck: DeckState) => update({ deck }), [update]);

  const game: DraftGame | null = useMemo(() => {
    if (!draft || !state) return null;
    const saved: SavedDraft = { draft, hints: entry.hints, side: entry.side, title: state.cube.title, timer: 0, deck: entry.deck };
    return {
      saved,
      draft,
      data,
      aiBusy: busy || state.toAct !== state.you,
      aiNote: theirs,
      aiLine: null,
      start: () => {},
      act,
      update: (patch) => {
        const p: Partial<SavedRoom> = {};
        if (patch.hints !== undefined) p.hints = patch.hints;
        if (patch.side !== undefined) p.side = patch.side;
        if (patch.deck !== undefined) p.deck = patch.deck;
        update(p);
      },
      setDeck,
      abandon: () => {},
      canUndo: false,
      undo: () => {},
    };
  }, [draft, state, entry.hints, entry.side, entry.deck, data, busy, theirs, act, update, setDeck]);

  return { entry, state, link, note, draft, data, game, opponent, roomCube: foreign ? roomCube : null, setDeck, update, take };
}

/** The deck to start from once the draft is over: the saved one, else the whole pool with the side column set aside. */
export function startingDeck(entry: SavedRoom, pool: string[]): DeckState {
  if (entry.deck) return entry.deck;
  const deck = initialDeck(pool);
  for (const n of entry.side) {
    const i = deck.main.indexOf(n);
    if (i >= 0) deck.side.push(...deck.main.splice(i, 1));
  }
  return deck;
}

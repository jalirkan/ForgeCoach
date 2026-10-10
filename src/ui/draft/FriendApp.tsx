/*
 * ForgeCoach — ui/draft/FriendApp.tsx
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Draft with a friend (#draft/friend): a two-person grid draft held by
 * mtg-table's draft room on the owner's machine (draft/room.ts, mtg-table
 * D400). Make a room and send the link; open a link and join; draft on the
 * same pick screen as Draft vs AI with the friend in the AI's chair; then
 * build a deck from your own pool in the same deck editor.
 *
 *   #draft/friend                        your rooms, and Create a room
 *   #draft/friend/join?room=<id>&t=<T>   a friend's link (the token is moved to
 *                                        this browser's storage and dropped from
 *                                        the address bar)
 *   #draft/friend/r/<id>/<seat>[/build]  a room this browser holds a seat in
 *   #play/friend                         the game the room started (App.tsx, mtg-table D402/D404)
 *
 * Phase 2 (mtg-table D404): once the deck is built, Hand in this deck sends it
 * to the room, which checks it against this player's own picks. When both are
 * in, the room starts a game between the two on the owner's engine and hands
 * this seat its own seat token for it; Take your seat goes to the board.
 *
 * Phase 3 (mtg-table D406, D407): the room runs a best of three. After each
 * game both players hand in a deck again — the same, or sideboarded from their
 * own picks — and the loser of the game chooses to play or draw in the next.
 * Each player chooses, game by game, whether their seat is recorded (the human
 * test set on the owner's computer, and their own engine review); the owner
 * picks the default when making the room. A player's review is theirs alone:
 * the room hands it to this seat only, and it opens here.
 *
 * The coach is optional and private: it runs in this browser, through this
 * player's own helper or key, and nothing it says goes to the room.
 */
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import '../deck/deck.css';
import '../forge-theme.css';
import './draft.css';
import './friend.css';
import { DRAFT_CUBES, cubeInfo } from '../../cube/cubes.ts';
import { newPool, savePool } from '../../cube/pools.ts';
import { deckCount, exportList, forForge, toMatchDeck } from '../../draft/deck.ts';
import {
  cleanName, createRoom, cubeHash, forgetRoom, friendLinks, loadRooms, ownerRoomBase, parseJoinHash, replayMatches, RoomClient, RoomError, roomSupport,
  saveRoom, type RoomState, type SavedRoom,
} from '../../draft/room.ts';
import { FRIEND_TABLE_HASH, loadFriendTable, saveFriendTable, tableFromRoom } from '../../play/friendTable.ts';
import { isFunnelHost } from '../../play/seatUrl.ts';
import { useCubeData } from '../deck/useCubeData.ts';
import { IconChevronLeft } from '../Icons.tsx';
import { SettingsDialog } from '../SettingsDialog.tsx';
import { DeckEditor } from './DeckEditor.tsx';
import { DeckExport } from '../DeckExport.tsx';
import { PickScreen } from './PickScreen.tsx';
import { RoomOwnerControls } from './RoomOwnerControls.tsx';
import { startingDeck, useFriendRoom } from './useFriendRoom.ts';
import { loadFriendReview } from '../play/useFriendReview.ts';
import type { GameLog } from '../../log.ts';
import { BugFab, useBugContext } from '../bug/BugReport.tsx';
import { EMPTY_SNAPSHOT } from '../../bug/report.ts';

const ReviewApp = lazy(() => import('../review/ReviewApp.tsx'));

const NAME_KEY = 'forgecoach.friendName';

function readName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? '';
  } catch {
    return '';
  }
}
function keepName(n: string) {
  try {
    localStorage.setItem(NAME_KEY, n);
  } catch {
    /* private mode */
  }
}

type Route = { kind: 'lobby' } | { kind: 'join' } | { kind: 'room'; id: string; seat: 0 | 1; build: boolean };

function routeOf(hash: string): Route {
  if (/^#draft\/friend\/join\?/.test(hash)) return { kind: 'join' };
  const m = /^#draft\/friend\/r\/(r[A-Za-z0-9_-]{8})\/([01])(\/build)?$/.exec(hash);
  if (m) return { kind: 'room', id: m[1]!, seat: Number(m[2]) as 0 | 1, build: !!m[3] };
  return { kind: 'lobby' };
}

const roomHash = (id: string, seat: 0 | 1, build = false) => `#draft/friend/r/${id}/${seat}${build ? '/build' : ''}`;

async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function CopyLink({ label, url }: { label: string; url: string }) {
  const [done, setDone] = useState<'copied' | 'select' | null>(null);
  return (
    <div className="fr-link">
      <div className="fx-label">{label}</div>
      <div className="fr-link-row">
        <input readOnly value={url} aria-label={`${label}: your friend’s link`} onFocus={(e) => e.currentTarget.select()} />
        <button
          className="btn-gold"
          onClick={() => {
            void copy(url).then((ok) => setDone(ok ? 'copied' : 'select'));
          }}
        >
          {done === 'copied' ? 'Copied' : 'Copy'}
        </button>
      </div>
      {done === 'select' && <p className="fr-small">Copying is blocked here: select the link and copy it by hand.</p>}
    </div>
  );
}

export default function FriendApp({ onExit }: { onExit: () => void }) {
  const [hash, setHash] = useState(() => location.hash);
  const [settings, setSettings] = useState(false);
  useEffect(() => {
    const on = () => setHash(location.hash);
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  const go = useCallback((h: string, replace = false) => {
    if (replace) history.replaceState(null, '', h);
    else history.pushState(null, '', h);
    setHash(h);
    window.scrollTo(0, 0);
  }, []);
  const route = routeOf(hash);
  // Report a bug (mtg-table D411): from a room's page it goes to the room (its owner's machine).
  useBugContext(() => ({ ...EMPTY_SNAPSHOT, surface: 'room', extra: { screen: route.kind }, room: route.kind === 'room' ? { id: route.id, seat: route.seat } : null }));
  let body;
  if (route.kind === 'join') body = <JoinScreen hash={hash} go={go} />;
  else if (route.kind === 'room') {
    const entry = loadRooms().find((r) => r.id === route.id && r.seat === route.seat);
    body = entry ? (
      <RoomScreen key={`${entry.id}/${entry.seat}`} entry={entry} build={route.build} go={go} onSettings={() => setSettings(true)} />
    ) : (
      <Message title="No seat in this room here" text="This browser holds no seat in that room. Open the link you were sent (or the one you made) in this browser." onBack={() => go('#draft/friend')} />
    );
  } else body = <Lobby go={go} onExit={onExit} />;
  return (
    <>
      {body}
      <SettingsDialog open={settings} onClose={() => setSettings(false)} />
      <BugFab />
    </>
  );
}

function Message({ title, text, onBack }: { title: string; text: string; onBack: () => void }) {
  return (
    <div className="fx setup fr">
      <header className="setup-top">
        <button className="link-back" onClick={onBack}>
          <IconChevronLeft size={14} /> Draft with a friend
        </button>
      </header>
      <section className="panel fr-panel">
        <h1 className="pk-title">{title}</h1>
        <p>{text}</p>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The lobby: your rooms, and Create a room

function Lobby({ go, onExit }: { go: (h: string, replace?: boolean) => void; onExit: () => void }) {
  const [rooms, setRooms] = useState(() => loadRooms());
  const [cubeId, setCubeId] = useState(DRAFT_CUBES[0]?.id ?? 'synergy');
  const [name, setName] = useState(readName);
  const [first, setFirst] = useState<'random' | '0' | '1'>('random');
  const [record, setRecord] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const data = useCubeData(cubeId);
  const names = useMemo(() => data.cube?.cards.map((c) => c.name) ?? null, [data.cube]);
  const clean = cleanName(name);

  const create = async () => {
    if (!names || !clean) return;
    setBusy(true);
    setError(null);
    try {
      const sup = await roomSupport();
      if (!sup.on || sup.roomPort === null) {
        setError(`The draft room is not running (${sup.reason ?? 'no answer'}). On the computer that holds the draft, start it with: ./scripts/play.sh --engine-only --lan --draft-room`);
        return;
      }
      const info = cubeInfo(cubeId);
      const c = await createRoom({ cubeId, cubeTitle: info?.title ?? cubeId, cards: names, name: clean, ...(first === 'random' ? {} : { firstSeat: Number(first) as 0 | 1 }), record });
      keepName(clean);
      const entry: SavedRoom = {
        id: c.id, base: ownerRoomBase(location, c.roomPort), token: c.token, seat: 0, cubeId, cubeTitle: info?.title ?? cubeId,
        friendLinks: friendLinks(c), hints: true, side: [], savedAt: Date.now(),
      };
      saveRoom(entry);
      go(roomHash(c.id, 0));
    } catch (e) {
      setError(e instanceof RoomError ? e.message : 'Making the room failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fx setup fr">
      <header className="setup-top">
        <button className="link-back" onClick={() => (location.hash = '#draft/setup')}>
          <IconChevronLeft size={14} /> Draft vs AI
        </button>
        <span />
        <button className="link-back is-right" onClick={onExit}>
          Back to the start
        </button>
      </header>
      <div className="setup-head">
        <div className="fx-label setup-kicker">Grid draft · two people</div>
        <h1 className="fr-title">Draft with a friend</h1>
        <p className="fr-lede">
          You and a friend grid-draft a cube, each in your own browser. Your computer holds the draft and checks every pick. Then each of you builds a deck from your own pool.
        </p>
      </div>

      {rooms.length > 0 && (
        <section className="panel fr-panel">
          <div className="fx-label">Your rooms</div>
          <ul className="fr-rooms">
            {rooms.map((r) => (
              <li key={`${r.id}/${r.seat}`}>
                <span>
                  <i>{r.cubeTitle}</i> · {r.seat === 0 ? 'you made it' : 'you joined'} · <span className="fr-small">{r.id}</span>
                </span>
                <span className="fr-room-btns">
                  <button
                    className="btn-line is-danger"
                    onClick={() => {
                      forgetRoom(r.id);
                      setRooms(loadRooms());
                    }}
                  >
                    Forget
                  </button>
                  <button className="btn-gold" onClick={() => go(roomHash(r.id, r.seat))}>
                    Open
                  </button>
                </span>
                {/* mtg-table D408: the owner's revokes, for a room this browser made. */}
                <RoomOwnerControls
                  entry={r}
                  onLinks={(friendLinks) => saveRoom({ ...r, friendLinks, savedAt: Date.now() })}
                  onClosed={() => {
                    forgetRoom(r.id);
                    setRooms(loadRooms());
                  }}
                  showLinks={(links) => links.map((l) => <CopyLink key={l.url} label={l.label} url={l.url} />)}
                />
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="panel fr-panel">
        <div className="fx-label">Create a room</div>
        <label className="fr-field">
          <span>Cube</span>
          <select value={cubeId} onChange={(e) => setCubeId(e.target.value)} aria-label="Cube">
            {DRAFT_CUBES.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>
        </label>
        <label className="fr-field">
          <span>Your name</span>
          <input value={name} maxLength={24} onChange={(e) => setName(e.target.value)} placeholder="Justin" aria-label="Your name" />
        </label>
        <label className="fr-field">
          <span>Who picks first in grid 1</span>
          <select value={first} onChange={(e) => setFirst(e.target.value as 'random' | '0' | '1')} aria-label="Who picks first">
            <option value="random">A coin toss</option>
            <option value="0">Me</option>
            <option value="1">My friend</option>
          </select>
        </label>
        <label className="fr-check">
          <input type="checkbox" checked={record} onChange={(e) => setRecord(e.target.checked)} aria-label="Record our games by default" />
          <span>
            Record our games by default — for the human test set on this computer, and each player’s own engine review. Each of you can still turn your own seat off, game by game; nothing leaves this computer.
          </span>
        </label>
        <p className="fr-small">18 grids of 9 cards, all face up. In each grid one of you takes a row or a column, the other takes a line from what is left, and the first pick alternates. Then a best of three with your decks, sideboarding between games.</p>
        {error && <p className="fr-error" role="alert">{error}</p>}
        <div className="fr-actions">
          <button className="btn-gold" disabled={busy || !names || !clean} onClick={() => void create()}>
            {busy ? 'Making the room…' : !names ? 'Loading the cube…' : 'Create room'}
          </button>
        </div>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// A friend's link

function JoinScreen({ hash, go }: { hash: string; go: (h: string, replace?: boolean) => void }) {
  const link = useMemo(() => parseJoinHash(hash), [hash]);
  const [name, setName] = useState(readName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [who, setWho] = useState<{ host: string; cube: string } | null>(null);
  const base = link?.server ?? location.origin;
  const client = useMemo(() => (link ? new RoomClient(base, link.room, link.token) : null), [link, base]);
  useEffect(() => {
    if (!client) return;
    client.get().then(
      (s) => {
        // A seat this browser already joined: straight in, the token out of the address bar.
        if (s.seats[s.you].joined && loadRooms().some((r) => r.id === s.id && r.seat === s.you)) go(roomHash(s.id, s.you), true);
        else setWho({ host: s.seats[(1 - s.you) as 0 | 1].name, cube: s.cube.title });
      },
      (e: unknown) => setError(e instanceof RoomError ? (e.code === 'gone' ? 'This room does not exist any more (rooms expire a day after their last pick).' : e.message) : 'The room cannot be reached.'),
    );
  }, [client, go]);
  if (!link || !client) return <Message title="This link is not a room" text="The link is incomplete. Ask your friend to copy it again." onBack={() => go('#draft/friend')} />;
  const clean = cleanName(name);
  const join = async () => {
    if (!clean) return;
    setBusy(true);
    setError(null);
    try {
      const s = await client.join(clean);
      keepName(clean);
      saveRoom({ id: s.id, base, token: link.token, seat: s.you, cubeId: s.cube.id, cubeTitle: s.cube.title, hints: true, side: [], savedAt: Date.now() });
      go(roomHash(s.id, s.you), true);
    } catch (e) {
      setError(e instanceof RoomError ? e.message : 'Joining failed.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="fx setup fr">
      <div className="setup-head">
        <div className="fx-label setup-kicker">Grid draft · two people</div>
        <h1 className="fr-title">{who ? `${who.host} invites you to draft` : 'Joining a draft…'}</h1>
        {who && <p className="fr-lede">The {who.cube}: 18 grids of 9 cards, all face up. Your picks are checked by {who.host}’s computer, which holds the draft.</p>}
      </div>
      <section className="panel fr-panel">
        <label className="fr-field">
          <span>Your name</span>
          <input value={name} maxLength={24} onChange={(e) => setName(e.target.value)} placeholder="Sam" aria-label="Your name" autoFocus />
        </label>
        {error && <p className="fr-error" role="alert">{error}</p>}
        <div className="fr-actions">
          <button className="btn-gold" disabled={busy || !clean || !!error} onClick={() => void join()}>
            {busy ? 'Joining…' : 'Join'}
          </button>
        </div>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The room

function RoomScreen({ entry, build, go, onSettings }: { entry: SavedRoom; build: boolean; go: (h: string, replace?: boolean) => void; onSettings: () => void }) {
  const room = useFriendRoom(entry);
  const { state, link, note, data, game, opponent } = room;
  const ctx = data.ctx;
  const names = useMemo(() => data.cube?.cards.map((c) => c.name) ?? null, [data.cube]);
  const [sameCube, setSameCube] = useState<boolean | null>(null);
  useEffect(() => {
    if (!names || !state || !globalThis.crypto?.subtle) return;
    void cubeHash(names).then((h) => setSameCube(h === state.cube.hash));
  }, [names, state?.cube.hash]); // eslint-disable-line react-hooks/exhaustive-deps
  const replay = useMemo(() => (state?.done && names ? replayMatches(state, names) : null), [state, names]);
  // D407: this seat's own engine review of a finished game, opened over the room.
  const [review, setReview] = useState<{ log: GameLog; report: unknown; title: string } | null>(null);
  const [reviewNote, setReviewNote] = useState<string | null>(null);
  const openReview = useCallback(
    (matchId: string, n: number) => {
      setReviewNote(null);
      void loadFriendReview({ base: room.entry.base, id: room.entry.id, token: room.entry.token }, matchId, null).then((r) => {
        if ('error' in r) setReviewNote(r.error);
        else setReview({ log: r.log, report: r.report, title: `game ${n} with ${room.opponent}` });
      });
    },
    [room.entry.base, room.entry.id, room.entry.token, room.opponent],
  );

  // Report a bug (mtg-table D411): this seat's view of the room (a Grid draft hides nothing; the other deck is a name and a count).
  useBugContext(() => ({ ...EMPTY_SNAPSHOT, surface: 'room', extra: { screen: build ? 'build' : 'room', link, note, opponent, state }, room: { id: entry.id, seat: entry.seat } }));

  // The draft is over: the pool goes to the deck assistant once, like a draft against the AI.
  useEffect(() => {
    if (!state?.done || room.entry.poolId) return;
    const mine = state.seats[state.you].picks;
    const p = newPool(state.cube.id, `${state.cube.title} · Grid vs ${opponent}`);
    const pool = savePool({ ...p, cards: [...mine], opp: [...state.seats[(1 - state.you) as 0 | 1].picks], format: 'grid', updatedAt: Date.now() });
    room.update({ poolId: pool.id });
  }, [state?.done]); // eslint-disable-line react-hooks/exhaustive-deps

  if (review) {
    return (
      <Suspense fallback={<div className="fx dr-wait"><span className="spinner spinner-lg" /></div>}>
        <ReviewApp log={review.log} title={review.title} report={review.report} onClose={() => setReview(null)} closeLabel="Back to the room" onSettings={onSettings} />
      </Suspense>
    );
  }
  if (link === 'gone' && !state) {
    return <Message title="This room is gone" text={note ?? 'The room expired, or this link is not right for it.'} onBack={() => go('#draft/friend')} />;
  }
  if (!state || !game || !ctx) {
    return (
      <div className="fx dr-wait">
        <span className="spinner spinner-lg" />
        <p className="serif-i">{link === 'reconnecting' ? `Reaching the room… (${note ?? 'retrying'})` : data.error ?? 'Opening the room…'}</p>
      </div>
    );
  }
  const other = (1 - state.you) as 0 | 1;
  const cubeNote = sameCube === false ? 'Your copy of this cube differs from the room’s: some card details may be missing.' : null;
  const linkNote = link === 'reconnecting' ? `Reconnecting to the room… ${note ?? ''}` : link === 'gone' ? (note ?? 'The room has gone.') : null;

  if (!state.seats[other].joined) {
    return (
      <div className="fx setup fr">
        <header className="setup-top">
          <button className="link-back" onClick={() => go('#draft/friend')}>
            <IconChevronLeft size={14} /> Your rooms
          </button>
        </header>
        <div className="setup-head">
          <div className="fx-label setup-kicker">{state.cube.title} · room {state.id}</div>
          <h1 className="fr-title">Waiting for your friend</h1>
          <p className="fr-lede">Send your friend one of these links. It opens the draft in their browser; they type a name and join. The draft starts as soon as they are in.</p>
        </div>
        <section className="panel fr-panel">
          {(room.entry.friendLinks ?? []).length ? (
            room.entry.friendLinks!.map((l) => <CopyLink key={l.url} label={l.label} url={l.url} />)
          ) : (
            <p>This browser did not make the room, so it has no link for the other seat.</p>
          )}
          {room.entry.friendLinks && !room.entry.friendLinks.some((l) => l.label === 'On your Wi-Fi' || l.label === 'Over the internet') && (
            <p className="fr-small">No Wi-Fi link: the draft room answers this computer only. For a friend on your network, restart it with ./scripts/play.sh --engine-only --lan --draft-room.</p>
          )}
          {room.entry.friendLinks?.some((l) => l.label === 'Over the internet' && isFunnelHost(new URL(l.url).host)) && (
            <p className="fr-small">
              Over the internet through Tailscale Funnel: send your friend just this one link. They open it in any browser — nothing to install, no sign-in.
              There is no login in front of it, so whoever has the link has the seat: send it privately, and close the room when you are done.
            </p>
          )}
          {room.entry.friendLinks?.some((l) => l.label === 'Over the internet' && !isFunnelHost(new URL(l.url).host)) && (
            <p className="fr-small">
              Over the internet, in two steps: first send your friend just the address ({new URL(room.entry.friendLinks.find((l) => l.label === 'Over the internet' && !isFunnelHost(new URL(l.url).host))!.url).origin}/) so they sign in with
              Cloudflare (their email, then the PIN it sends). Then send the link, to open in the same browser — the sign-in drops everything after the #.
            </p>
          )}
          <p className="fr-small">Anyone with the link can take that seat, so send it to your friend only. The room expires a day after its last pick.</p>
          <RoomOwnerControls
            entry={room.entry}
            onLinks={(friendLinks) => room.update({ friendLinks })}
            onClosed={() => {
              forgetRoom(room.entry.id);
              go('#draft/friend');
            }}
          />
          {linkNote && <p className="fr-error">{linkNote}</p>}
        </section>
      </div>
    );
  }

  if (!state.done) {
    return <PickScreen game={game} draft={game.draft!} opponent={opponent} notice={linkNote ?? note ?? cubeNote} onLeave={() => go('#draft/friend')} onSettings={onSettings} />;
  }

  const pool = state.seats[state.you].picks;
  const deck = startingDeck(room.entry, pool);
  const deckName = `${state.seats[state.you].name}’s ${state.cube.title} deck`;
  if (build) {
    return (
      <DeckEditor
        ctx={ctx}
        cubeId={state.cube.id}
        pool={pool}
        deck={deck}
        onDeck={room.setDeck}
        onSubmit={() => go(roomHash(state.id, state.you))}
        onBack={() => go(roomHash(state.id, state.you))}
        kicker={`Draft with ${opponent} · complete`}
        deckName={deckName}
      />
    );
  }
  // Cards Forge has no script for yet stay off the sideboard the room hands the engine; in the main deck they are named below.
  const { deck: md, blocked } = forForge(toMatchDeck(deckName, deck), ctx?.cube.forgeMissing);
  // This seat's own deck and picks only: the friend's list never comes to this page.
  const list = exportList(deckName, deck);
  return (
    <div className="fx setup fr">
      <header className="setup-top">
        <button className="link-back" onClick={() => go('#draft/friend')}>
          <IconChevronLeft size={14} /> Your rooms
        </button>
      </header>
      <div className="setup-head">
        <div className="fx-label setup-kicker">{state.cube.title} · draft complete</div>
        <h1 className="fr-title">You drafted {pool.length} cards</h1>
        <p className="fr-lede">
          {opponent} has {state.seats[other].picks.length}. Each of you builds a deck from your own pool, and only you see yours.
        </p>
        {replay !== null && (
          <p className="fr-small">
            {replay
              ? `Checked: this is exactly the draft the cube deals from seed ${state.seed}, every pick in turn.`
              : 'Warning: this draft does not match what this page deals from the room’s seed (a different copy of the cube?).'}
          </p>
        )}
      </div>
      <section className="panel fr-panel">
        <div className="fx-label">Your deck</div>
        <p>
          {deckCount(deck)} cards in the main deck{room.entry.deck ? '' : ' (not built yet: every card you drafted)'}.
        </p>
        <div className="fr-actions">
          <button className={room.entry.deck ? 'btn-line' : 'btn-gold'} onClick={() => go(roomHash(state.id, state.you, true))}>
            {state.match && !state.match.over && (state.games ?? []).some((x) => x.match === state.match!.n) ? 'Sideboard: edit your deck' : room.entry.deck ? 'Edit your deck' : 'Build your deck'}
          </button>
        </div>
        <DeckExport list={list} title="Export to another game" className="fr-export" />
      </section>
      {reviewNote && <p className="fr-error" role="alert">{reviewNote}</p>}
      <HandIn state={state} room={room} deckText={md} blocked={blocked} opponent={opponent} onOpenReview={openReview} />
    </div>
  );
}

/** The main-deck cards Forge has no script for yet: what to do, and that the exported list still has them. */
export function ForgeBlocked({ names }: { names: string[] }) {
  return (
    <p className="fr-error" role="alert">
      Forge 2.0.14 has no card script yet for {names.join(', ')}. Move {names.length === 1 ? 'it' : 'them'} to your sideboard to play this deck through Forge; Export to another game keeps
      {names.length === 1 ? ' it' : ' them'}.
    </p>
  );
}

// ---------------------------------------------------------------------------
// Phase 2 (mtg-table D404): the deck goes to the room, the room starts the game

/** One seat's deck as the room says it: handed in for the next game, or in the game being started or played (its name and size only). */
function deckLine(d: { ready: boolean; name: string | null; cards: number | null }, game: string | undefined) {
  const what = d.name ? (
    <>
      <i>{d.name}</i>
      {d.cards !== null ? ` (${d.cards} cards)` : ''}
    </>
  ) : (
    'a deck'
  );
  if (d.ready) return <>handed in {what}</>;
  if (d.name && (game === 'starting' || game === 'ready')) return <>playing {what}</>;
  return 'not handed in yet';
}

/** D406: a finished game, as one line from this seat's side. */
function playedLine(g: { winner: 0 | 1 | null; reason: string | null }, you: 0 | 1, opponent: string): string {
  if (g.winner === null) return 'a draw — played again';
  const how = g.reason === 'Conceded' ? ' (conceded)' : '';
  return g.winner === you ? `you won${g.reason === 'Conceded' ? ` (${opponent} conceded)` : ''}` : `${opponent} won${how}`;
}

const REVIEW_WORDS: Record<string, string> = {
  off: 'not recorded — no engine review',
  waiting: 'your engine review: waiting to be queued',
  queued: 'your engine review: queued (it runs when the room’s computer is idle)',
  running: 'your engine review: running…',
  done: 'your engine review is ready',
  failed: 'your engine review failed',
};

function HandIn({ state, room, deckText: md, blocked, opponent, onOpenReview }: {
  state: RoomState; room: ReturnType<typeof useFriendRoom>; deckText: ReturnType<typeof toMatchDeck>;
  /** Main-deck cards Forge has no script for yet (draft/deck.ts forForge): the room's engine would refuse the deck. */
  blocked: string[];
  opponent: string;
  onOpenReview: (matchId: string, game: number) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [problems, setProblems] = useState<string[] | null>(null);
  const [saving, setSaving] = useState(false);
  // The box follows the click at once; the room's answer (its state) settles it.
  const [wantRecord, setWantRecord] = useState<boolean | null>(null);
  const client = useMemo(() => new RoomClient(room.entry.base, room.entry.id, room.entry.token), [room.entry.base, room.entry.id, room.entry.token]);
  const back = roomHash(state.id, state.you);
  const offered = tableFromRoom(room.entry.base, state, back);
  const kept = loadFriendTable();
  // A game this browser saw end, or one the room has scored: its token is spent.
  const spent = !!offered && ((!!kept && kept.url === offered.url && kept.over === true) || !!state.game?.result);
  const table = spent ? null : offered;
  // Keep the seat for #play/friend the moment the room hands it over (a reload, the board, a dropped phone).
  useEffect(() => {
    if (!table) return;
    const cur = loadFriendTable();
    if (!cur || cur.url !== table.url) saveFriendTable(table);
  }, [table?.url]); // eslint-disable-line react-hooks/exhaustive-deps
  // Straight to the board when the game this screen watched start becomes ready.
  const seen = useRef(state.game?.state ?? null);
  useEffect(() => {
    const was = seen.current;
    seen.current = state.game?.state ?? null;
    if (was === 'starting' && state.game?.state === 'ready' && table) location.hash = FRIEND_TABLE_HASH;
  }, [state.game?.state, table]);

  if (state.decks === undefined) {
    return (
      <section className="panel fr-panel">
        <div className="fx-label">Play the two decks</div>
        <p className="fr-small">The room’s computer runs an mtg-table that does not take decks yet. Update it to play these decks against each other through Forge; for now, copy your list.</p>
      </section>
    );
  }
  const you = state.you;
  const them = (1 - you) as 0 | 1;
  const mine = state.decks[you];
  const theirs = state.decks[them];
  const g = state.game ?? null;
  const m = state.match ?? null;
  const games = state.games ?? [];
  const bo3 = state.match !== undefined;
  // While a game runs the room refuses a deck (409 "playing"); it says so, and the button stays for after it.
  const playing = g?.state === 'starting' || (g?.state === 'ready' && !g.result && !spent);
  const size = md.main.reduce((n, [k]) => n + k, 0);
  const next = m?.next ?? { game: 1, chooser: null, newMatch: true };
  const midMatch = !!m && !m.over && games.some((x) => x.match === m.n);
  const record = state.record ?? null;
  const handIn = async () => {
    setBusy(true);
    setProblems(null);
    try {
      room.take(await client.submitDeck(md));
    } catch (e) {
      if (e instanceof RoomError) {
        if (e.state) room.take(e.state);
        setProblems(e.problems.length ? e.problems : [e.message]);
      } else setProblems(['The deck did not reach the room. Try again.']);
    } finally {
      setBusy(false);
    }
  };
  const setRecord = async (v: boolean) => {
    setWantRecord(v);
    setSaving(true);
    try {
      room.take(await client.setRecord(v));
    } catch (e) {
      setProblems([e instanceof RoomError ? e.message : 'Your choice did not reach the room. Try again.']);
    } finally {
      setSaving(false);
      setWantRecord(null);
    }
  };
  const chooserWords = next.chooser === null ? (next.game === 1 ? 'A coin toss decides who chooses to play or draw.' : 'The last game was a draw: a coin toss decides who chooses to play or draw.')
    : next.chooser === you ? `You lost the last game, so you choose to play or draw.` : `${opponent} lost the last game, so ${opponent} chooses to play or draw.`;
  const handLabel = busy ? 'Handing in…' : mine.ready ? 'Hand in again (changed)'
    : m?.over ? 'Hand in a deck for a new match'
    : midMatch ? `Keep this deck for game ${next.game}`
    : g?.state === 'ready' && !bo3 ? 'Hand in a deck for a rematch' : 'Hand in this deck';
  return (
    <section className="panel fr-panel" aria-label="Play the two decks">
      <div className="fx-label">{bo3 ? 'Best of three' : 'Play the two decks'}</div>
      {m && (
        <p className="fr-score" role="status" aria-label="Match score">
          {m.over
            ? m.winner === you ? `You won the match ${m.wins[you]} – ${m.wins[them]}.` : `${opponent} won the match ${m.wins[them]} – ${m.wins[you]}.`
            : `Match ${m.n}: you ${m.wins[you]} – ${m.wins[them]} ${opponent}.`}
        </p>
      )}
      <p>
        {midMatch
          ? <>Game {next.game} next. Sideboard if you like — edit your deck above with any of your own picks and basic lands — or keep it; when both decks are in, the game starts. {chooserWords}</>
          : <>Hand your deck to the room: it is checked against your own picks (basic lands are free) and stays private — {opponent} sees its name and size, never the list. When both decks are in, the room starts {bo3 ? 'game 1 of a best of three' : 'a game'} between you on its computer.{bo3 ? ` Between games you may sideboard. ${chooserWords}` : ''}</>}
      </p>
      <ul className="fr-rooms">
        <li>
          <span>You: {deckLine(mine, playing ? g?.state : undefined)}</span>
        </li>
        <li>
          <span>
            {opponent}: {deckLine(theirs, playing ? g?.state : undefined)}
          </span>
        </li>
      </ul>
      {record && (
        <label className="fr-check">
          <input type="checkbox" checked={wantRecord ?? record.you} disabled={saving} onChange={(e) => void setRecord(e.target.checked)} aria-label="Record my seat of the next game" />
          <span>
            Record my seat of {playing ? 'the following' : `game ${next.game}`} — for the human test set on the room’s computer, and my own engine review (only I see it). {record.default ? 'The room records by default.' : 'The room does not record by default.'} Nothing leaves that computer.
          </span>
        </label>
      )}
      {g?.state === 'starting' && (
        <p role="status">
          <span className="spinner spinner-sm" /> Starting game {g.game ?? g.n} on the room’s computer… (10–30 seconds)
        </p>
      )}
      {spent && !bo3 && <p className="fr-small">Game {g!.n} is over. For a rematch, both of you hand in a deck again — the same or changed.</p>}
      {(g?.state === 'failed' || g?.state === 'unavailable') && (
        <p className="fr-error" role="alert">
          Game {g.game ?? g.n} {g.error && /without a result/.test(g.error) ? 'ended without a result' : 'did not start'}: {g.error ?? 'the engine did not start'}. Hand in both decks again to {g.error && /without a result/.test(g.error) ? 'play it again' : 'retry'}.
        </p>
      )}
      {problems && (
        <div className="fr-error" role="alert">
          <p>The room refused this:</p>
          <ul>
            {problems.slice(0, 8).map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
      )}
      <div className="fr-actions">
        {table && (
          <button className="btn-gold" onClick={() => (location.hash = FRIEND_TABLE_HASH)}>
            Take your seat — game {g!.game ?? g!.n}
          </button>
        )}
        {!playing && (
          <button className={table ? 'btn-line' : 'btn-gold'} disabled={busy || size < 40 || blocked.length > 0} onClick={() => void handIn()} title={size < 40 ? 'A deck has at least 40 cards' : undefined}>
            {handLabel}
          </button>
        )}
      </div>
      {size < 40 && !playing && <p className="fr-small">Your main deck has {size} cards; a deck needs at least 40.</p>}
      {blocked.length > 0 && !playing && <ForgeBlocked names={blocked} />}
      {table && <p className="fr-small">The seat is yours alone: it opens with a token the room gave this browser for this game. If you lose the connection, take your seat again — {opponent} waits, and may claim the win after two minutes.</p>}
      {games.length > 0 && (
        <>
          <div className="fx-label">Games</div>
          <ul className="fr-rooms fr-games" aria-label="Games played">
            {games.map((x) => (
              <li key={x.matchId}>
                <span>
                  {games.some((y) => y.match !== x.match) ? `Match ${x.match} · ` : ''}Game {x.game}: {playedLine(x, you, opponent)} · <span className="fr-small">{REVIEW_WORDS[x.review] ?? x.review}</span>
                </span>
                {x.review === 'done' && (
                  <span className="fr-room-btns">
                    <button className="btn-line" onClick={() => onOpenReview(x.matchId, x.game)}>
                      Open your review
                    </button>
                  </span>
                )}
              </li>
            ))}
          </ul>
          <p className="fr-small">Your engine review is built from your own seat of the game and only you see it; {opponent} never does, and you never see theirs.</p>
        </>
      )}
    </section>
  );
}

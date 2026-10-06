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
 *
 * The coach is optional and private: it runs in this browser, through this
 * player's own helper or key, and nothing it says goes to the room.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import '../deck/deck.css';
import '../forge-theme.css';
import './draft.css';
import './friend.css';
import { CUBES, cubeInfo } from '../../cube/cubes.ts';
import { newPool, savePool } from '../../cube/pools.ts';
import { deckCount, toMatchDeck } from '../../draft/deck.ts';
import {
  cleanName, createRoom, cubeHash, forgetRoom, friendLinks, loadRooms, ownerRoomBase, parseJoinHash, replayMatches, RoomClient, RoomError, roomSupport,
  saveRoom, type SavedRoom,
} from '../../draft/room.ts';
import { useCubeData } from '../deck/useCubeData.ts';
import { IconChevronLeft } from '../Icons.tsx';
import { SettingsDialog } from '../SettingsDialog.tsx';
import { DeckEditor } from './DeckEditor.tsx';
import { PickScreen } from './PickScreen.tsx';
import { startingDeck, useFriendRoom } from './useFriendRoom.ts';

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
  const [cubeId, setCubeId] = useState(CUBES[0]?.id ?? 'synergy');
  const [name, setName] = useState(readName);
  const [first, setFirst] = useState<'random' | '0' | '1'>('random');
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
      const c = await createRoom({ cubeId, cubeTitle: info?.title ?? cubeId, cards: names, name: clean, ...(first === 'random' ? {} : { firstSeat: Number(first) as 0 | 1 }) });
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
            {CUBES.map((c) => (
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
        <p className="fr-small">18 grids of 9 cards, all face up. In each grid one of you takes a row or a column, the other takes a line from what is left, and the first pick alternates.</p>
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

  // The draft is over: the pool goes to the deck assistant once, like a draft against the AI.
  useEffect(() => {
    if (!state?.done || room.entry.poolId) return;
    const mine = state.seats[state.you].picks;
    const p = newPool(state.cube.id, `${state.cube.title} · Grid vs ${opponent}`);
    const pool = savePool({ ...p, cards: [...mine], opp: [...state.seats[(1 - state.you) as 0 | 1].picks], format: 'grid', updatedAt: Date.now() });
    room.update({ poolId: pool.id });
  }, [state?.done]); // eslint-disable-line react-hooks/exhaustive-deps

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
          {(entry.friendLinks ?? []).length ? (
            entry.friendLinks!.map((l) => <CopyLink key={l.url} label={l.label} url={l.url} />)
          ) : (
            <p>This browser did not make the room, so it has no link for the other seat.</p>
          )}
          {entry.friendLinks && !entry.friendLinks.some((l) => l.label === 'On your Wi-Fi') && (
            <p className="fr-small">No Wi-Fi link: the draft room answers this computer only. For a friend on your network, restart it with ./scripts/play.sh --engine-only --lan --draft-room.</p>
          )}
          <p className="fr-small">Anyone with the link can take that seat, so send it to your friend only. The room expires a day after its last pick.</p>
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
  if (build) {
    return (
      <DeckEditor
        ctx={ctx}
        pool={pool}
        deck={deck}
        onDeck={room.setDeck}
        onSubmit={() => go(roomHash(state.id, state.you))}
        onBack={() => go(roomHash(state.id, state.you))}
        kicker={`Draft with ${opponent} · complete`}
      />
    );
  }
  const md = toMatchDeck(`${state.seats[state.you].name}’s ${state.cube.title} deck`, deck);
  const text = [...md.main.map(([n, c]) => `${n} ${c}`), ...(md.sideboard?.length ? ['', 'Sideboard', ...md.sideboard.map(([n, c]) => `${n} ${c}`)] : [])].join('\n');
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
          <button className="btn-line" onClick={() => void copy(text)}>
            Copy the list
          </button>
          <button className="btn-gold" onClick={() => go(roomHash(state.id, state.you, true))}>
            {room.entry.deck ? 'Edit your deck' : 'Build your deck'}
          </button>
        </div>
        <p className="fr-small">Playing the two decks against each other through Forge comes next. For now, copy your list, or open the pool in Draft &amp; build.</p>
      </section>
    </div>
  );
}

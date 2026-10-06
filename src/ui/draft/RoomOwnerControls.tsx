/*
 * ForgeCoach — ui/draft/RoomOwnerControls.tsx
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The room owner's two revokes (mtg-table D408), through the coach helper on
 * this machine (never the room's port, never a tunnel):
 *
 *   New link for your friend — the friend's seat gets a new token; the old
 *     link stops working at once (their open page is told), their name and
 *     picks stay. The new links replace the saved ones.
 *   Close room — the room is gone for both seats, now and after a restart.
 *
 * Shown only for a seat this browser made (seat 0) and only when the helper's
 * /health says `roomRevoke: 1`; an older mtg-table shows nothing.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { closeRoom, newFriendLink, RoomError, roomSupport, type SavedRoom } from '../../draft/room.ts';

export function RoomOwnerControls({
  entry,
  onLinks,
  onClosed,
  showLinks,
}: {
  entry: SavedRoom;
  /** The new links, to save with the room. */
  onLinks: (links: Array<{ label: string; url: string }>) => void;
  onClosed: () => void;
  /** Where the new links are shown, when the caller does not show them itself. */
  showLinks?: (links: Array<{ label: string; url: string }>) => ReactNode;
}) {
  const [can, setCan] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Array<{ label: string; url: string }> | null>(null);

  useEffect(() => {
    if (entry.seat !== 0) return;
    let live = true;
    void roomSupport().then((s) => {
      if (live) setCan(s.on && s.revoke === true);
    });
    return () => {
      live = false;
    };
  }, [entry.seat]);

  if (entry.seat !== 0 || !can) return null;

  const run = async (what: 'link' | 'close') => {
    const ask = what === 'link'
      ? 'Make a new link for your friend? The link you sent stops working at once; send them the new one.'
      : 'Close this room for both of you? Neither link will work again, and the draft cannot be resumed.';
    if (!window.confirm(ask)) return;
    setBusy(true);
    setError(null);
    try {
      if (what === 'link') {
        const links = await newFriendLink(entry.id);
        onLinks(links);
        setDone(links);
      } else {
        await closeRoom(entry.id);
        onClosed();
      }
    } catch (e) {
      if (e instanceof RoomError && e.code === 'gone' && what === 'close') onClosed();
      else setError(e instanceof RoomError ? e.message : 'That did not reach the coach helper.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fr-owner">
      <span className="fr-room-btns">
        <button className="btn-line" disabled={busy} onClick={() => void run('link')} title="The old link stops working at once">
          New link for your friend
        </button>
        <button className="btn-line is-danger" disabled={busy} onClick={() => void run('close')} title="Gone for both of you, for good">
          Close room
        </button>
      </span>
      {done && (
        <>
          <p className="fr-small">The old link no longer works. Send your friend this one, privately:</p>
          {showLinks?.(done)}
        </>
      )}
      {error && <p className="fr-error">{error}</p>}
    </div>
  );
}

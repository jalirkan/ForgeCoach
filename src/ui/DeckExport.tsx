/*
 * ForgeCoach — ui/DeckExport.tsx
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Export a deck to another game, the same way on every deck screen (the deck
 * assistant's builder, Draft vs AI's deck editor and match screen, Draft with
 * a friend's deck editor and room screen). The text is cube/deckExport.ts's.
 *
 *   CopyDeckButton  one tap: the plain list to the clipboard, "Copied" after.
 *                   Where the page may not use the clipboard (a plain-http
 *                   page on a LAN or a phone is not a secure context) it falls
 *                   back to a selected text box to copy by hand.
 *   DeckExport      the panel: the count ("40 cards + 5 sideboard"), the copy
 *                   button, Download .txt / Forge .dck / Cockatrice .cod,
 *                   Share… where the device has it, and Show the list.
 *
 * It always exports the list it is handed, which every caller builds from the
 * deck on screen — this player's own deck and pool, never anyone else's.
 */
import { useEffect, useId, useRef, useState } from 'react';
import { codFileText, countLine, deckListText, deckSlug, dckFileText, type DeckList } from '../cube/deckExport.ts';
import { IconCheck, IconCopy, IconFile, IconList, IconExternal } from './Icons.tsx';
import { cx } from './util.ts';
import './deckExport.css';

/** The plain list to the clipboard: the async API on a secure page, else the old copy command. False: copy it by hand. */
export async function copyDeckText(text: string): Promise<boolean> {
  try {
    if (typeof window !== 'undefined' && window.isSecureContext && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the copy command */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '0';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

export function downloadText(fileName: string, text: string, type = 'text/plain') {
  const url = URL.createObjectURL(new Blob([text], { type: `${type};charset=utf-8` }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** A read-only box with the list selected, for when copying is blocked. */
function ListBox({ text, note }: { text: string; note?: string }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const t = ref.current;
    if (!t || !note) return;
    t.focus();
    t.select();
  }, [note]);
  return (
    <div className="dx-box">
      {note && <p className="dx-note" role="alert">{note}</p>}
      <textarea
        ref={ref}
        className="dx-text"
        readOnly
        value={text}
        rows={Math.min(14, text.split('\n').length)}
        aria-label="Deck list"
        onFocus={(e) => e.currentTarget.select()}
      />
    </div>
  );
}

const BLOCKED = 'Copying is blocked on this page. The list is selected below: press and hold (or Ctrl/⌘+C) to copy it.';

/** One tap: copy the list. On failure, a dialog with the list selected. */
export function CopyDeckButton({ list, className, label = 'Copy deck list', short }: { list: DeckList; className?: string; label?: string; short?: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'manual'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  const text = deckListText(list);
  const go = async () => {
    const ok = await copyDeckText(text);
    setState(ok ? 'copied' : 'manual');
    if (ok) {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setState('idle'), 2200);
    }
  };
  return (
    <>
      <button type="button" className={cx('dx-copy', className, state === 'copied' && 'is-copied')} onClick={() => void go()} data-testid="copy-deck" title={countLine(list)}>
        {state === 'copied' ? <IconCheck size={16} /> : <IconCopy size={16} />}
        <span>{state === 'copied' ? 'Copied' : short ?? label}</span>
      </button>
      <span className="dx-sr" role="status" aria-live="polite">
        {state === 'copied' ? `Copied: ${countLine(list)}` : ''}
      </span>
      {state === 'manual' && (
        <div className="dx-modal" role="dialog" aria-modal="true" aria-label="Copy the deck list" onClick={(e) => e.target === e.currentTarget && setState('idle')}>
          <div className="dx-modal-card">
            <div className="fx-label">Deck list · {countLine(list)}</div>
            <ListBox text={text} note={BLOCKED} />
            <div className="dx-row">
              <button type="button" className="btn-line" onClick={() => downloadText(`${deckSlug(list.name)}.txt`, text)}>
                Download .txt
              </button>
              <button type="button" className="btn-gold" onClick={() => setState('idle')}>
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/** The export panel. `children` adds lines below (the builder's "Play it vs Forge"). */
export function DeckExport({ list, title = 'Export your deck', className, children }: { list: DeckList; title?: string; className?: string; children?: React.ReactNode }) {
  const [show, setShow] = useState(false);
  const [shared, setShared] = useState<string | null>(null);
  const id = useId();
  const text = deckListText(list);
  const slug = deckSlug(list.name);
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
  const share = async () => {
    try {
      await navigator.share({ title: list.name, text });
      setShared(null);
    } catch (e) {
      if ((e as Error)?.name !== 'AbortError') setShared('Sharing did not work here: copy the list instead.');
    }
  };
  return (
    <section className={cx('dx', className)} aria-labelledby={`${id}-h`} data-testid="deck-export">
      <div className="dx-head">
        <div className="fx-label" id={`${id}-h`}>
          {title}
        </div>
        <div className="dx-count" data-testid="deck-export-count">
          {countLine(list)}
        </div>
      </div>
      <CopyDeckButton list={list} className="btn-gold dx-primary" />
      <p className="dx-hint">Pastes into Arena, MTGO, Moxfield, Cockatrice or untap.in. Basic lands included; the sideboard is the rest of your pool.</p>
      <div className="dx-row">
        <button type="button" className="dx-small" onClick={() => downloadText(`${slug}.txt`, text)}>
          <IconFile size={14} /> .txt
        </button>
        <button type="button" className="dx-small" onClick={() => downloadText(`${slug}.dck`, dckFileText(list))} title="Forge deck file">
          <IconFile size={14} /> Forge .dck
        </button>
        <button type="button" className="dx-small" onClick={() => downloadText(`${slug}.cod`, codFileText(list), 'application/xml')} title="Cockatrice deck file">
          <IconFile size={14} /> Cockatrice .cod
        </button>
        {canShare && (
          <button type="button" className="dx-small" onClick={() => void share()}>
            <IconExternal size={14} /> Share…
          </button>
        )}
        <button type="button" className={cx('dx-small', show && 'is-on')} aria-expanded={show} onClick={() => setShow((v) => !v)}>
          <IconList size={14} /> {show ? 'Hide list' : 'Show list'}
        </button>
      </div>
      {shared && <p className="dx-note">{shared}</p>}
      {show && <ListBox text={text} />}
      {children}
    </section>
  );
}

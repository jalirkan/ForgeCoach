/*
 * ForgeCoach — ui/play/AskGallery.tsx
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Dev-only gallery: every ask kind, from real mtg-table recordings
 * (askFixtures.ts), plus the keep/mulligan and play/draw inputs. Mount it
 * lazily (it pulls in the fixture JSON). Deep links: `#ask-gallery/<n>`
 * opens fixture n, `#ask-gallery/mulligan` / `#ask-gallery/play-draw` the
 * opening dialogs.
 */
import { useEffect, useState } from 'react';
import type { AnswerValue } from '../../protocol.ts';
import { AskDialog, OpeningDialog } from './AskDialog.tsx';
import { FIXTURE_ASKS, FIXTURE_OPENINGS } from './askFixtures.ts';
import { askOptions } from './askModel.ts';
import './ask.css';

type Open = { type: 'ask'; index: number } | { type: 'mulligan' } | { type: 'play-draw' } | null;

function fromHash(): Open {
  const m = /^#ask-gallery\/(.+)$/.exec(window.location.hash);
  if (!m) return null;
  if (m[1] === 'mulligan') return { type: 'mulligan' };
  if (m[1] === 'play-draw') return { type: 'play-draw' };
  const n = Number(m[1]);
  return Number.isInteger(n) && n >= 0 && n < FIXTURE_ASKS.length ? { type: 'ask', index: n } : null;
}

function setHash(open: Open) {
  const suffix = open === null ? '' : open.type === 'ask' ? `/${open.index}` : `/${open.type}`;
  history.replaceState(null, '', `#ask-gallery${suffix}`);
}

export function AskGallery() {
  const [open, setOpen] = useState<Open>(fromHash);
  const [sent, setSent] = useState<{ what: string; value: string; recorded?: string } | null>(null);
  useEffect(() => {
    const on = () => setOpen(fromHash());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  const show = (o: Open) => {
    setOpen(o);
    setHash(o);
  };
  const done = (what: string, value: AnswerValue | string, recorded?: AnswerValue) => {
    setSent({ what, value: JSON.stringify(value), recorded: recorded === undefined ? undefined : JSON.stringify(recorded) });
    show(null);
  };
  const preview = (id: number) => setSent({ what: 'preview', value: `card #${id}` });

  const fixture = open?.type === 'ask' ? FIXTURE_ASKS[open.index] : undefined;

  return (
    <div className="ask-gallery">
      <header className="ask-gallery-head">
        <h1>Ask gallery</h1>
        <p className="muted">
          Every ask kind from real mtg-table recordings. Click one to open it; Enter confirms, Esc minimises.
        </p>
      </header>
      <ul className="ask-gallery-grid">
        <li>
          <button type="button" className="ask-gallery-item" onClick={() => show({ type: 'play-draw' })}>
            <span className="tag tag-accent">input</span>
            <b>Play or draw</b>
            <span className="muted">{FIXTURE_OPENINGS.playDraw.id}</span>
          </button>
        </li>
        <li>
          <button type="button" className="ask-gallery-item" onClick={() => show({ type: 'mulligan' })}>
            <span className="tag tag-accent">input</span>
            <b>Keep or mulligan</b>
            <span className="muted">{FIXTURE_OPENINGS.mulligan.id}</span>
          </button>
        </li>
        {FIXTURE_ASKS.map((f, i) => (
          <li key={f.id}>
            <button type="button" className="ask-gallery-item" onClick={() => show({ type: 'ask', index: i })}>
              <span className="tag tag-prio">{f.ask.kind}</span>
              <b>{f.note.replace(/^[a-z_]+: /, '')}</b>
              <span className="muted">
                {f.id} · {askOptions(f.ask).length} options · recorded {JSON.stringify(f.answer).slice(0, 40)}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {sent && (
        <div className="ask-gallery-sent" role="status">
          <b>{sent.what}</b> <code>{sent.value}</code>
          {sent.recorded !== undefined && (
            <span className="muted">
              {' '}
              · recorded <code>{sent.recorded}</code>
            </span>
          )}
        </div>
      )}
      {fixture && (
        <AskDialog
          ask={fixture.ask}
          state={fixture.state}
          onAnswer={(v) => done(`answer ${fixture.ask.askId}`, v, fixture.answer)}
          onPreviewCard={preview}
        />
      )}
      {open?.type === 'mulligan' && (
        <OpeningDialog
          input={FIXTURE_OPENINGS.mulligan.input}
          state={FIXTURE_OPENINGS.mulligan.state}
          onChoose={(b) => done('act', b === 'ok' ? 'buttonOk' : 'buttonCancel')}
          onPreviewCard={preview}
        />
      )}
      {open?.type === 'play-draw' && (
        <OpeningDialog
          input={FIXTURE_OPENINGS.playDraw.input}
          state={FIXTURE_OPENINGS.playDraw.state}
          onChoose={(b) => done('act', b === 'ok' ? 'buttonOk' : 'buttonCancel')}
          onPreviewCard={preview}
        />
      )}
    </div>
  );
}

export default AskGallery;

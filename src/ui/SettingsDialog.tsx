/*
 * ForgeCoach — ui/SettingsDialog.tsx
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { useEffect, useState } from 'react';
import { DEFAULT_COACH_SOURCE, MODELS, loadSettings, saveSettings, type CoachSource, type CoachThinking, type ModelId, type Settings } from '../claude.ts';
import { chooseSource, pageHelperTarget, type HelperStatus } from '../coachHelper.ts';
import { useCoachAvailability } from './hooks.ts';
import { IconExternal } from './Icons.tsx';
import { Sheet } from './Sheet.tsx';
import { cx } from './util.ts';

/** Coach thinking (D346): how long Claude Code on the PC may think before it answers. */
const THINKING: Array<{ id: CoachThinking; label: string; hint: string }> = [
  { id: 'default', label: 'Default', hint: 'As Claude Code chooses' },
  { id: 'low', label: 'Low', hint: 'A short think first' },
  { id: 'off', label: 'Off', hint: 'Answers soonest' },
];

const SOURCES: Array<{ id: CoachSource; label: string; hint: string }> = [
  { id: 'auto', label: 'Automatic', hint: 'Claude Code if found, else the key' },
  { id: 'helper', label: 'Claude Code', hint: 'On your PC, no key needed' },
  { id: 'apiKey', label: 'API key', hint: 'Your own Anthropic key' },
];

export function SettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [s, setS] = useState<Settings>(() => safeLoad());
  const [show, setShow] = useState(false);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (open) {
      setS(safeLoad());
      setSaved(false);
      setShow(false);
    }
  }, [open]);
  const save = () => {
    try {
      saveSettings({ ...s, apiKey: s.apiKey.trim() });
      setSaved(true);
      setTimeout(onClose, 450);
    } catch {
      /* storage blocked */
    }
  };
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Settings"
      subtitle="The coach runs on Claude Code on your PC (no key needed) or on your own Anthropic API key."
      width={520}
      footer={
        <>
          <button className="btn btn-quiet" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={save}>
            {saved ? 'Saved' : 'Save'}
          </button>
        </>
      }
    >
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <CoachSourceField s={s} setS={setS} />
        <label className="field">
          <span className="field-label">Anthropic API key</span>
          <div className="field-row">
            <input
              type={show ? 'text' : 'password'}
              value={s.apiKey}
              onChange={(e) => setS({ ...s, apiKey: e.target.value })}
              placeholder="sk-ant-…"
              autoComplete="off"
              spellCheck={false}
            />
            <button type="button" className="btn btn-quiet" onClick={() => setShow((x) => !x)}>
              {show ? 'Hide' : 'Show'}
            </button>
          </div>
          <span className="field-help">
            Stored only in this browser (localStorage). Requests go straight from your browser to Anthropic — ForgeCoach has no
            server. Use a key with a spending limit.{' '}
            <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer" className="link-ext">
              Get a key <IconExternal size={11} />
            </a>
          </span>
        </label>
        <fieldset className="field">
          <legend className="field-label">Model</legend>
          <div className="model-grid">
            {MODELS.map((m) => (
              <label key={m.id} className={cx('model-opt', s.model === m.id && 'is-on')}>
                <input type="radio" name="model" value={m.id} checked={s.model === m.id} onChange={() => setS({ ...s, model: m.id as ModelId })} />
                <span className="model-name">{m.label}</span>
                <span className="model-hint">{hint(m.id)}</span>
              </label>
            ))}
          </div>
          <span className="field-help">Claude Code uses the same choice (opus, sonnet or haiku).</span>
        </fieldset>
        <fieldset className="field">
          <legend className="field-label">Coach thinking</legend>
          <div className="model-grid" role="radiogroup" aria-label="Coach thinking">
            {THINKING.map((o) => {
              const on = (s.coachThinking ?? 'default') === o.id;
              return (
                <label key={o.id} className={cx('model-opt', on && 'is-on')}>
                  <input type="radio" name="coachThinking" value={o.id} checked={on} onChange={() => setS({ ...s, coachThinking: o.id })} />
                  <span className="model-name">{o.label}</span>
                  <span className="model-hint">{o.hint}</span>
                </label>
              );
            })}
          </div>
          <span className="field-help">
            For Claude Code on your PC. Haiku thinks at length before its first word; Off or Low gets it answering in seconds. Sonnet
            and Opus always think a little. Needs an mtg-table helper that offers it; the API key ignores it.
          </span>
        </fieldset>
        <label className="field check-row">
          <input type="checkbox" checked={s.answerFirst === true} onChange={(e) => setS({ ...s, answerFirst: e.target.checked })} />
          <span>
            <span className="field-label">Answer first</span>
            <span className="field-help">
              The coach starts with the play in one line, then explains — so you see what to do sooner. Off: the classic layout.
            </span>
          </span>
        </label>
        {s.apiKey && (
          <button
            type="button"
            className="link-btn danger"
            onClick={() => {
              setS({ ...s, apiKey: '' });
            }}
          >
            Forget the key
          </button>
        )}
      </form>
    </Sheet>
  );
}

/** Coach source: the helper's live status and the auto / helper / key choice. Mounted only while the dialog is open. */
function CoachSourceField({ s, setS }: { s: Settings; setS: (s: Settings) => void }) {
  const { helper, recheck } = useCoachAvailability(4000);
  const active = chooseSource(s, helper);
  return (
    <fieldset className="field">
      <legend className="field-label">Coach source</legend>
      <div className="helper-status" role="status" aria-live="polite">
        <span className={cx('helper-dot', helper?.state === 'ok' ? 'is-ok' : helper ? 'is-down' : 'is-checking')} aria-hidden="true" />
        <span className="helper-text">
          <HelperStatusText helper={helper} />
        </span>
        <button type="button" className="link-btn" onClick={recheck}>
          Check again
        </button>
      </div>
      <div className="model-grid" role="radiogroup" aria-label="Coach source">
        {SOURCES.map((o) => (
          <label key={o.id} className={cx('model-opt', s.coachSource === o.id && 'is-on')}>
            <input type="radio" name="coachSource" value={o.id} checked={s.coachSource === o.id} onChange={() => setS({ ...s, coachSource: o.id })} />
            <span className="model-name">{o.label}</span>
            <span className="model-hint">{o.hint}</span>
          </label>
        ))}
      </div>
      <span className="field-help">
        {active === 'helper'
          ? 'Answers come from Claude Code on your PC, through mtg-table’s coach helper — no API key needed.'
          : active === 'apiKey'
            ? 'Answers use your API key.'
            : s.coachSource === 'apiKey'
              ? 'Add a key below to ask the coach. “Copy prompt” works without one.'
              : 'Nothing to answer with yet: start the helper or add a key. “Copy prompt” works without either.'}
      </span>
    </fieldset>
  );
}

function HelperStatusText({ helper }: { helper: HelperStatus | null }) {
  if (!helper) return <>Looking for Claude Code on your PC…</>;
  if (helper.state === 'ok') {
    return (
      <>
        <b>Detected</b> — Claude Code{helper.claude ? ` ${helper.claude.replace(/\s*\(Claude Code\)\s*$/i, '')}` : ''} on your PC
      </>
    );
  }
  if (helper.reason === 'not_running') {
    return (
      <>
        <b>Not running</b> — start <code>./scripts/play.sh</code> in mtg-table (it starts the helper), or install Claude Code and log in.{' '}
        <span className="helper-addr">Looked at {pageHelperTarget().baseUrl}.</span>
      </>
    );
  }
  return (
    <>
      <b>{helper.reason === 'unauthorized' ? 'Refused' : 'Found, not ready'}</b> — {helper.message.replace(/`/g, '')}
    </>
  );
}

function hint(id: string): string {
  if (id.includes('opus')) return 'Best judgement';
  if (id.includes('sonnet')) return 'Fast and sharp';
  if (id.includes('haiku')) return 'Quickest, cheapest';
  return '';
}

function safeLoad(): Settings {
  try {
    return loadSettings();
  } catch {
    return { apiKey: '', model: MODELS[0].id, coachSource: DEFAULT_COACH_SOURCE, answerFirst: false, coachThinking: 'default' };
  }
}

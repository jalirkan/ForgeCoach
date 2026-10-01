/*
 * ForgeCoach — ui/SettingsDialog.tsx
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { useEffect, useState } from 'react';
import { MODELS, loadSettings, saveSettings, type ModelId, type Settings } from '../claude.ts';
import { IconExternal } from './Icons.tsx';
import { Sheet } from './Sheet.tsx';
import { cx } from './util.ts';

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
      subtitle="Coaching uses your own Anthropic API key."
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
        </fieldset>
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
    return { apiKey: '', model: MODELS[0].id };
  }
}

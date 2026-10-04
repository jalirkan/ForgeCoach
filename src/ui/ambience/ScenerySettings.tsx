/*
 * ForgeCoach — ui/ambience/ScenerySettings.tsx
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Settings → Board scenery: off (the default), the built-in scenery, or a
 * pack URL; board accents (spec 1.3, on by default with the scenery); and motion. Applies at once (its own storage key), so it needs no
 * part in the dialog's Save. Checking a pack loads the validator lazily.
 */
import { useState } from 'react';
import { loadSceneryPrefs, saveSceneryPrefs, type MotionPref, type SceneryMode, type SceneryPrefs } from '../../ambience/prefs.ts';
import { cx } from '../util.ts';

const MODES: Array<{ id: SceneryMode; label: string; hint: string }> = [
  { id: 'off', label: 'Off', hint: 'A plain board' },
  { id: 'procedural', label: 'Built-in', hint: 'Drawn in code' },
  { id: 'pack', label: 'Art pack', hint: 'From a URL you serve' },
];

export function ScenerySettings() {
  const [p, setP] = useState<SceneryPrefs>(() => loadSceneryPrefs());
  const [check, setCheck] = useState<{ busy: boolean; lines: string[]; ok: boolean | null }>({ busy: false, lines: [], ok: null });
  const set = (next: SceneryPrefs) => {
    setP(next);
    saveSceneryPrefs(next);
  };
  const runCheck = async () => {
    setCheck({ busy: true, lines: [], ok: null });
    const { fetchManifest } = await import('../../ambience/pack.ts');
    const r = await fetchManifest(p.packUrl, { fetch: (u, i) => fetch(u, i) });
    const biomes = r.pack ? Object.keys(r.pack.biomes).join(', ') : '';
    setCheck({ busy: false, ok: !!r.pack, lines: r.pack ? [`“${r.pack.name}”: ${biomes}.`, ...r.warnings.slice(0, 4)] : r.errors });
  };
  return (
    <fieldset className="field">
      <legend className="field-label">Board scenery</legend>
      <div className="model-grid" role="radiogroup" aria-label="Board scenery">
        {MODES.map((o) => (
          <label key={o.id} className={cx('model-opt', p.mode === o.id && 'is-on')}>
            <input type="radio" name="sceneryMode" value={o.id} checked={p.mode === o.id} onChange={() => set({ ...p, mode: o.id })} />
            <span className="model-name">{o.label}</span>
            <span className="model-hint">{o.hint}</span>
          </label>
        ))}
      </div>
      {p.mode === 'pack' && (
        <div className="field-row">
          <input
            type="url"
            value={p.packUrl}
            onChange={(e) => set({ ...p, packUrl: e.target.value })}
            placeholder="http://127.0.0.1:8650/"
            spellCheck={false}
            autoComplete="off"
            aria-label="Scenery pack URL"
          />
          <button type="button" className="btn btn-quiet" onClick={runCheck} disabled={!p.packUrl.trim() || check.busy}>
            {check.busy ? 'Checking…' : 'Check'}
          </button>
        </div>
      )}
      {check.lines.length > 0 && p.mode === 'pack' && (
        <ul className={cx('field-help', check.ok ? 'is-ok' : 'danger')} style={{ margin: '4px 0 0', paddingLeft: 18 }}>
          {check.lines.map((l, i) => (
            <li key={i}>{l}</li>
          ))}
        </ul>
      )}
      {p.mode !== 'off' && (
        <label className="field-help" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input type="checkbox" checked={p.accents} onChange={(e) => set({ ...p, accents: e.target.checked })} />
          Board accents: vines, frost, ash and the like at the corners of each side, beneath the cards
        </label>
      )}
      <label className="field-help" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        Motion
        <select value={p.motion} onChange={(e) => set({ ...p, motion: e.target.value as MotionPref })}>
          <option value="system">Follow the system</option>
          <option value="reduce">Stills only</option>
          <option value="full">Full</option>
        </select>
      </label>
      <span className="field-help">
        Lands you play grow scenes along your side of the board. Applies at once. <a href="#ambience">Preview and test packs</a>.
      </span>
    </fieldset>
  );
}

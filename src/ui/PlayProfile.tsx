/*
 * ForgeCoach — ui/PlayProfile.tsx
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The AI profile for plain Play vs Forge (mtg-table D381): POST /engine/start
 * takes `{"aiProfile"}` when the helper's /health says `engine_start_profile:
 * 1`. The picker shows only then; "As set up" sends no body (the engine's own
 * setup, as before). The choice is remembered in this browser. No deck is
 * named or sent: the AI's list stays hidden.
 */
import { useEffect, useState } from 'react';
import { AI_PROFILES, engineHealth, isAiProfile, type AiProfile } from '../draft/launch.ts';
import { cx, readLS, writeLS } from './util.ts';

const KEY = 'forgecoach.play.aiProfile';

/** The remembered profile for plain Play vs Forge; null = as set up. */
export function readPlayProfile(): AiProfile | null {
  const v = readLS(KEY);
  return isAiProfile(v) ? v : null;
}

/** Does the helper on this machine take a profile on /engine/start? Asked once on mount (and again when `again` changes). */
export function usePlayProfileOffered(again: unknown = null): boolean {
  const [offered, setOffered] = useState(false);
  useEffect(() => {
    let live = true;
    void engineHealth().then((h) => live && setOffered(h.canPickProfile === true));
    return () => {
      live = false;
    };
  }, [again]);
  return offered;
}

export function PlayProfilePicker({ disabled = false }: { disabled?: boolean }) {
  const [value, setValue] = useState<AiProfile | null>(readPlayProfile);
  const pick = (v: AiProfile | null) => {
    setValue(v);
    writeLS(KEY, v);
  };
  const opts: Array<{ id: AiProfile | null; label: string; blurb: string }> = [
    { id: null, label: 'As set up', blurb: 'The profile the engine was started or last launched with.' },
    ...AI_PROFILES.map((p) => ({ id: p.id, label: p.id, blurb: p.blurb })),
  ];
  const shown = opts.find((o) => o.id === value) ?? opts[0]!;
  return (
    <div className="play-profile">
      <div className="play-profile-row" role="radiogroup" aria-label="AI profile">
        <span className="tiny muted play-profile-k">AI profile</span>
        {opts.map((o) => (
          <button
            key={o.label}
            type="button"
            role="radio"
            aria-checked={value === o.id}
            className={cx('play-profile-opt', value === o.id && 'is-on')}
            onClick={() => pick(o.id)}
            disabled={disabled}
          >
            {o.label}
          </button>
        ))}
      </div>
      <p className="tiny muted play-profile-blurb">
        {shown.blurb} A profile is a play style, not a difficulty; a running match keeps its own until the engine starts again.
      </p>
    </div>
  );
}

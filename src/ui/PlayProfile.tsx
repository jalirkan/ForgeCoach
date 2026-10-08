/*
 * ForgeCoach — ui/PlayProfile.tsx
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The AI profile for plain Play vs Forge (mtg-table D381): POST /engine/start
 * takes `{"aiProfile"}` when the helper's /health says `engine_start_profile:
 * 1`. The picker shows only then; "As set up" sends no body (the engine's own
 * setup, as before). The choice is remembered in this browser. No deck is
 * named or sent: the AI's list stays hidden.
 *
 * The opponent AI (mtg-table D414): `{"aiPolicy"}` on the same call, when
 * /health says `engine_start_policy: 1`. The search AI (search-v2) unless the
 * player picked another; plain Forge is one tap away. A running match keeps its
 * own AI (the helper's warning says so).
 */
import { useEffect, useState } from 'react';
import { AI_POLICIES, AI_PROFILES, DEFAULT_POLICY, engineHealth, isAiProfile, type AiPolicy, type AiProfile } from '../draft/launch.ts';
import { cx, readLS, writeLS } from './util.ts';

const KEY = 'forgecoach.play.aiProfile';
const POLICY_KEY = 'forgecoach.play.aiPolicy';

const isAiPolicy = (x: unknown): x is AiPolicy => AI_POLICIES.some((p) => p.id === x);

/** The opponent AI for plain Play vs Forge: the one picked in this browser, else the search AI (D414). */
export function readPlayPolicy(): AiPolicy {
  const v = readLS(POLICY_KEY);
  return isAiPolicy(v) ? v : DEFAULT_POLICY;
}

/** What the helper on this machine lets plain Play pick: the profile (D381) and the opponent AIs (D414; [] = no choice). */
export function usePlayChoices(again: unknown = null): { profile: boolean; policies: AiPolicy[] } {
  const [c, setC] = useState<{ profile: boolean; policies: AiPolicy[] }>({ profile: false, policies: [] });
  useEffect(() => {
    let live = true;
    void engineHealth().then((h) => live && setC({ profile: h.canPickProfile === true, policies: h.canPickPolicy ? h.aiPolicies : [] }));
    return () => {
      live = false;
    };
  }, [again]);
  return c;
}

/** The opponent AI for plain Play vs Forge (D414): the AIs the helper offers, the search AI first picked. */
export function PlayPolicyPicker({ policies, disabled = false }: { policies: AiPolicy[]; disabled?: boolean }) {
  const [stored, setStored] = useState<AiPolicy>(readPlayPolicy);
  const value: AiPolicy = policies.includes(stored) ? stored : 'plain';
  const pick = (v: AiPolicy) => {
    setStored(v);
    writeLS(POLICY_KEY, v);
  };
  const opts = AI_POLICIES.filter((p) => policies.includes(p.id));
  const shown = opts.find((o) => o.id === value) ?? opts[0]!;
  return (
    <div className="play-profile">
      <div className="play-profile-row" role="radiogroup" aria-label="Opponent AI">
        <span className="tiny muted play-profile-k">Opponent</span>
        {opts.map((o) => (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={value === o.id}
            className={cx('play-profile-opt', value === o.id && 'is-on')}
            onClick={() => pick(o.id)}
            disabled={disabled}
          >
            {o.id === 'search' ? 'Search AI' : o.id === 'plain' ? 'Forge' : o.label}
          </button>
        ))}
      </div>
      <p className="tiny muted play-profile-blurb">{shown.blurb} A running match keeps its own AI until the engine starts again.</p>
    </div>
  );
}

/** The remembered profile for plain Play vs Forge; null = as set up. */
export function readPlayProfile(): AiProfile | null {
  const v = readLS(KEY);
  return isAiProfile(v) ? v : null;
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

/*
 * ForgeCoach — ui/hooks.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { useEffect, useState } from 'react';
import { loadSettings, onSettingsChange, type Settings } from '../claude.ts';
import { coachReady, detectHelper, onHelperStatus, peekHelper, type HelperStatus } from '../coachHelper.ts';

export function useMediaQuery(q: string): boolean {
  const [m, setM] = useState(() => typeof window !== 'undefined' && window.matchMedia(q).matches);
  useEffect(() => {
    const mq = window.matchMedia(q);
    const on = () => setM(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [q]);
  return m;
}

/** ←/→ and j/k (and Home/End) step through the timeline, unless typing. */
export function useStepKeys(step: (delta: number | 'first' | 'last') => void, enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) {
        if (!(t.tagName === 'INPUT' && (t as HTMLInputElement).type === 'range')) return;
        return; // the range input handles its own arrows
      }
      if (document.querySelector('.sheet-backdrop')) return;
      if (e.key === 'ArrowRight' || e.key === 'j') step(1);
      else if (e.key === 'ArrowLeft' || e.key === 'k') step(-1);
      else if (e.key === 'Home') step('first');
      else if (e.key === 'End') step('last');
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [step, enabled]);
}

/**
 * The saved settings and what is known about the coach helper (Claude Code on
 * the player's PC), kept current. Asks the helper once on mount (cached), and
 * every `pollMs` while given (the settings dialog shows it live).
 */
export function useCoachAvailability(pollMs?: number): { settings: Settings; helper: HelperStatus | null; ready: boolean; recheck: () => void } {
  const read = () => {
    let settings: Settings;
    try {
      settings = loadSettings();
    } catch {
      settings = { apiKey: '', model: 'claude-opus-5-5', coachSource: 'auto', answerFirst: false };
    }
    return { settings, helper: peekHelper() };
  };
  const [v, setV] = useState(read);
  useEffect(() => {
    const on = () => setV(read());
    const offA = onSettingsChange(on);
    const offB = onHelperStatus(on);
    void detectHelper();
    const t = pollMs ? setInterval(() => void detectHelper({ force: true }), pollMs) : null;
    return () => {
      offA();
      offB();
      if (t) clearInterval(t);
    };
  }, [pollMs]);
  return { ...v, ready: coachReady(v.settings, v.helper), recheck: () => void detectHelper({ force: true }) };
}

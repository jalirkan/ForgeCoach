/*
 * ForgeCoach — pwa/install.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * "Install ForgeCoach" in Settings. Chromium browsers fire
 * `beforeinstallprompt` once the site is installable, often before Settings is
 * ever opened, so main.tsx starts listening at load and keeps the event; the
 * Settings button calls its prompt(). iOS Safari has no such event: there the
 * hint is a line ("Share → Add to Home Screen"). Nothing at all where neither
 * applies, or once the site runs installed (display-mode standalone).
 */

/** The non-standard event Chromium fires (not in the DOM typings). */
export interface InstallPromptEvent extends Event {
  prompt(): Promise<unknown>;
  userChoice?: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export type InstallOffer = 'prompt' | 'ios' | null;

interface Win {
  addEventListener(type: string, fn: (e: Event) => void): void;
  matchMedia?: (q: string) => { matches: boolean };
  navigator: { userAgent: string; standalone?: boolean; maxTouchPoints?: number; platform?: string };
}

let deferred: InstallPromptEvent | null = null;
let installed = false;
let win: Win | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((fn) => fn());

/** Starts listening (once, at start-up). */
export function captureInstallPrompt(w: Win): void {
  win = w;
  w.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); // no mini-infobar: the offer lives in Settings
    deferred = e as InstallPromptEvent;
    notify();
  });
  w.addEventListener('appinstalled', () => {
    installed = true;
    deferred = null;
    notify();
  });
}

/** True when the page runs as the installed app. */
export function isStandalone(w: Win): boolean {
  if (w.navigator.standalone === true) return true;
  try {
    return !!w.matchMedia?.('(display-mode: standalone)').matches || !!w.matchMedia?.('(display-mode: fullscreen)').matches;
  } catch {
    return false;
  }
}

/** iOS / iPadOS Safari (not another browser's shell on iOS, which cannot add to the home screen the same way). */
export function isIosSafari(ua: string, maxTouchPoints = 0, platform = ''): boolean {
  const ios = /iPhone|iPad|iPod/.test(ua) || (platform === 'MacIntel' && maxTouchPoints > 1) || (/Macintosh/.test(ua) && maxTouchPoints > 1);
  return ios && /Safari\//.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS|GSA\//.test(ua);
}

/** What Settings can offer now. */
export function installOffer(w: Win | null = win, ev: InstallPromptEvent | null = deferred, done = installed): InstallOffer {
  if (!w || done || isStandalone(w)) return null;
  if (ev) return 'prompt';
  if (isIosSafari(w.navigator.userAgent, w.navigator.maxTouchPoints ?? 0, w.navigator.platform ?? '')) return 'ios';
  return null;
}

/** Shows the browser's install dialog; the kept event is spent either way. */
export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  const ev = deferred;
  if (!ev) return 'unavailable';
  deferred = null;
  try {
    await ev.prompt();
    const choice = ev.userChoice ? await ev.userChoice : { outcome: 'dismissed' as const };
    if (choice.outcome === 'accepted') installed = true;
    return choice.outcome;
  } catch {
    return 'dismissed';
  } finally {
    notify();
  }
}

export function onInstallChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Tests only. */
export function resetInstallForTests(): void {
  deferred = null;
  installed = false;
  win = null;
  listeners.clear();
}

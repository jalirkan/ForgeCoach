/*
 * ForgeCoach — main.tsx
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './ui/App.tsx';
import './ui/styles.css';
import './ui/skins.css';
import { initSkin } from './ui/skin.ts';
import { trackKeyboardInset } from './ui/keyboardInset.ts';
import { registerServiceWorker } from './pwa/register.ts';
import { captureInstallPrompt } from './pwa/install.ts';
import { installConsoleRing } from './bug/consoleRing.ts';

// The page's recent console errors, kept for a bug report (Report a bug, mtg-table D410); nothing leaves unless one is sent.
installConsoleRing(window);

// The skin (Settings → Look, or a ?skin= preview) goes on <html> before the first paint.
initSkin();

// The on-screen keyboard's height (--kb-inset), so a bottom sheet's input and buttons stay above it.
trackKeyboardInset(window, document.documentElement);

// A lazy page whose stylesheet failed to preload (offline, a blocked font
// server behind it) still renders, unstyled, rather than leaving a blank page:
// Vite rejects the page's import unless the event is cancelled.
window.addEventListener('vite:preloadError', (e) => {
  const err = (e as Event & { payload?: unknown }).payload;
  if (err instanceof Error && /Unable to preload CSS/i.test(err.message)) e.preventDefault();
});

// Installable: Settings offers the browser's install prompt (kept from here, it can fire before Settings opens),
// and a production build registers the service worker (pwa/sw.ts) at the site's base.
captureInstallPrompt(window);
registerServiceWorker({ prod: import.meta.env.PROD, base: import.meta.env.BASE_URL }, window);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

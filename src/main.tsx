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

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

/*
 * ForgeCoach — main.tsx
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './ui/App.tsx';
import './ui/styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

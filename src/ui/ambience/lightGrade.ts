/*
 * ForgeCoach — ui/ambience/lightGrade.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Puts the light pass's grade (ambience/light.ts) on a scenery host: the
 * battlefield on the board, a preview half on #ambience. The grade is three
 * custom properties and a class (scenery.css `.scn-lit`); null takes it off.
 */
import { gradeCss, type LightGrade } from '../../ambience/light.ts';

const PROPS = ['--scn-light-filter', '--scn-light-tint', '--scn-light-alpha'] as const;

export function applyGrade(el: HTMLElement, g: LightGrade | null): void {
  if (!g) {
    el.classList.remove('scn-lit');
    for (const p of PROPS) el.style.removeProperty(p);
    return;
  }
  const c = gradeCss(g);
  el.style.setProperty('--scn-light-filter', c.filter);
  el.style.setProperty('--scn-light-tint', c.tint);
  el.style.setProperty('--scn-light-alpha', c.tintAlpha);
  el.classList.add('scn-lit');
}

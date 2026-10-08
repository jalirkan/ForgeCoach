/*
 * ForgeCoach — ui/BlueNote.tsx
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * J111's two blue lines (draft/blueNote.ts) in the lab's gold: the AI
 * drafter's blue over-draft on Draft vs AI's pick screen, and the caveat
 * beside blue colour baselines and blue pairs' lab win rates. Renders
 * nothing for a cube J111 did not cover.
 */
import { BLUE_SOURCE, blueCaveat, blueOverdraftLine } from '../draft/blueNote.ts';
import './bluenote.css';

export function BlueOverdraftNote({ cubeId }: { cubeId: string | null | undefined }) {
  const text = blueOverdraftLine(cubeId);
  if (!text) return null;
  return (
    <p className="bn is-overdraft" role="note" title={BLUE_SOURCE}>
      <span className="bn-label">Lab note</span>
      {text}
    </p>
  );
}

export function BlueCaveat({ cubeId, colors }: { cubeId: string | null | undefined; colors: string | null | undefined }) {
  const text = blueCaveat(cubeId, colors);
  if (!text) return null;
  return (
    <p className="bn is-caveat" role="note" title={BLUE_SOURCE}>
      <span className="bn-label">Blue</span>
      {text}
    </p>
  );
}

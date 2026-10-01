/*
 * ForgeCoach — guide.ts  (CONTRACT STUB — the coach agent replaces the bodies)
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Deck play guides, editable in the UI, stored in localStorage.
 */
export interface Guide {
  id: string;
  name: string;
  text: string;
}
export function listGuides(): Guide[] {
  return [];
}
export function saveGuide(_g: Guide): void {}
export function deleteGuide(_id: string): void {}
/** The guide the user picked for coaching (null = none). */
export function activeGuideId(): string | null {
  return null;
}
export function setActiveGuideId(_id: string | null): void {}

/*
 * ForgeCoach — claude.ts  (CONTRACT STUB — the claude agent replaces the bodies)
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import type { Prompt } from './prompt.ts';

export const MODELS = [
  { id: 'claude-opus-5-5', label: 'Opus 5.5' },
  { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5' },
  { id: 'claude-haiku-4-5', label: 'Haiku 4.5' },
] as const;
export type ModelId = (typeof MODELS)[number]['id'];

export interface Settings {
  apiKey: string;
  model: ModelId;
}
export function loadSettings(): Settings {
  return { apiKey: '', model: 'claude-opus-5-5' };
}
export function saveSettings(_s: Settings): void {}

export interface StreamHandlers {
  onText(delta: string): void;
  onThinking?(delta: string): void;
}
export interface CoachResult {
  text: string;
  stopReason: string | null;
  refused: boolean;
  /** The model that actually answered (may differ after a server-side fallback). */
  model: string;
}
/** Streams Claude's answer to `prompt`. Rejects with a user-readable Error (no key, bad key, network). */
export async function askClaude(_prompt: Prompt, _h: StreamHandlers, _opts?: { signal?: AbortSignal; settings?: Settings }): Promise<CoachResult> {
  throw new Error('not implemented');
}

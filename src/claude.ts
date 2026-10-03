/*
 * ForgeCoach — claude.ts
 * Browser-side calls to the Claude API with the user's own key.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import type { APIError } from '@anthropic-ai/sdk';
import type { BetaMessageStreamParams } from '@anthropic-ai/sdk/resources/beta/messages/messages';
import type { Prompt } from './prompt.ts';

export const MODELS = [
  { id: 'claude-opus-5-5', label: 'Opus 5.5' },
  { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5' },
  { id: 'claude-haiku-4-5', label: 'Haiku 4.5' },
] as const;
export type ModelId = (typeof MODELS)[number]['id'];
export const DEFAULT_MODEL: ModelId = 'claude-opus-5-5';

export function isModelId(x: unknown): x is ModelId {
  return MODELS.some((m) => m.id === x);
}

// ---------------------------------------------------------------------------
// Settings (localStorage, guarded so it works in node and private windows)

export const SETTINGS_KEY = 'forgecoach.settings';

/**
 * Who answers the coach:
 * - 'auto' (default): Claude Code on your PC via mtg-table's coach helper when it is
 *   running, else your API key when one is set;
 * - 'helper': always the coach helper;
 * - 'apiKey': always your API key.
 */
export type CoachSource = 'auto' | 'helper' | 'apiKey';
export const COACH_SOURCES: readonly CoachSource[] = ['auto', 'helper', 'apiKey'];
export const DEFAULT_COACH_SOURCE: CoachSource = 'auto';

export function isCoachSource(x: unknown): x is CoachSource {
  return COACH_SOURCES.includes(x as CoachSource);
}

export interface Settings {
  apiKey: string;
  model: ModelId;
  coachSource: CoachSource;
  /**
   * Answer first: the coach starts with a one-line **Answer:** (and its
   * confidence and rule) before the explanation, so the play shows as soon as
   * that line has streamed. Off by default (absent = off).
   */
  answerFirst?: boolean;
}

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' || localStorage === null ? null : localStorage;
  } catch {
    return null;
  }
}

export function loadSettings(): Settings {
  // Settings saved before the coach helper existed have no coachSource → 'auto'.
  const out: Settings = { apiKey: '', model: DEFAULT_MODEL, coachSource: DEFAULT_COACH_SOURCE, answerFirst: false };
  try {
    const raw = storage()?.getItem(SETTINGS_KEY);
    if (!raw) return out;
    const v = JSON.parse(raw) as Partial<Settings>;
    if (typeof v.apiKey === 'string') out.apiKey = v.apiKey;
    if (isModelId(v.model)) out.model = v.model;
    if (isCoachSource(v.coachSource)) out.coachSource = v.coachSource;
    if (v.answerFirst === true) out.answerFirst = true;
  } catch {
    /* corrupt or unavailable storage → defaults */
  }
  return out;
}

const settingsListeners = new Set<() => void>();

/** Called after settings are saved (so open panels can re-read them). */
export function onSettingsChange(l: () => void): () => void {
  settingsListeners.add(l);
  return () => settingsListeners.delete(l);
}

export function saveSettings(s: Settings): void {
  try {
    storage()?.setItem(
      SETTINGS_KEY,
      JSON.stringify({
        apiKey: s.apiKey.trim(),
        model: isModelId(s.model) ? s.model : DEFAULT_MODEL,
        coachSource: isCoachSource(s.coachSource) ? s.coachSource : DEFAULT_COACH_SOURCE,
        answerFirst: s.answerFirst === true,
      }),
    );
  } catch {
    /* storage full or disabled — settings just won't persist */
  }
  for (const l of settingsListeners) l();
}

/** True when an API key is configured (in `s`, or in saved settings). */
export function hasKey(s: Settings = loadSettings()): boolean {
  return s.apiKey.trim().length > 0;
}

// ---------------------------------------------------------------------------
// Request

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
  /** Refusal category from `stop_details`, when refused (e.g. "cyber"); null if none given. */
  refusalCategory?: string | null;
  /** Set when a server-side fallback happened: the model that declined first. */
  fallbackFrom?: string;
}

const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

/**
 * The exact request body sent for `prompt` on `model`.
 * - Opus 5.5 / Sonnet 5.5: adaptive thinking (summarised so it can be shown), effort "medium",
 *   and server-side refusal fallback (`fallbacks: "default"` under its beta header).
 * - Haiku 4.5: no adaptive thinking or effort support → a fixed thinking budget, no fallback.
 */
export function buildRequest(prompt: Prompt, model: ModelId): BetaMessageStreamParams {
  const base = {
    model,
    system: [{ type: 'text' as const, text: prompt.system, cache_control: { type: 'ephemeral' as const } }],
    messages: [{ role: 'user' as const, content: prompt.user }],
  };
  if (model === 'claude-haiku-4-5') {
    return { ...base, max_tokens: 32000, thinking: { type: 'enabled', budget_tokens: 8000 } };
  }
  return {
    ...base,
    max_tokens: 64000,
    thinking: { type: 'adaptive', display: 'summarized' },
    output_config: { effort: 'medium' },
    betas: [FALLBACK_BETA],
    fallbacks: 'default',
  };
}

// ---------------------------------------------------------------------------
// SDK (loaded lazily so it only downloads on the first "Ask coach")

type SdkModule = typeof import('@anthropic-ai/sdk');
let sdkPromise: Promise<SdkModule['default']> | null = null;
/** The SDK once loaded; friendlyError uses it for instanceof checks (an SDK error can only exist after load). */
let sdk: SdkModule['default'] | null = null;

/** Dynamically imports the Anthropic SDK (cached). */
export function loadSdk(): Promise<SdkModule['default']> {
  return (sdkPromise ??= import('@anthropic-ai/sdk').then((m) => (sdk = m.default)));
}

// ---------------------------------------------------------------------------
// Errors

export type CoachErrorKind =
  | 'no_key'
  /** The coach helper (Claude Code on the player's PC) isn't reachable. */
  | 'helper_down'
  /** The coach helper is already answering something else and has no room to queue this (429). */
  | 'helper_busy'
  /** A newer question with the same supersede key took this one's place in the helper's queue. */
  | 'superseded'
  /** Claude Code on the player's PC isn't logged in. */
  | 'not_logged_in'
  | 'auth'
  | 'permission'
  | 'not_found'
  | 'rate_limit'
  | 'overloaded'
  | 'server'
  | 'bad_request'
  | 'network'
  | 'aborted'
  | 'unknown';

export class CoachError extends Error {
  constructor(
    message: string,
    readonly kind: CoachErrorKind,
    readonly status?: number,
  ) {
    super(message);
    this.name = kind === 'aborted' ? 'AbortError' : 'CoachError';
  }
}

function apiMessage(e: APIError): string {
  const body = e.error as { error?: { message?: string } } | undefined;
  return body?.error?.message ?? '';
}

/** Maps any thrown value to a CoachError with a user-readable message. */
export function friendlyError(e: unknown): CoachError {
  if (e instanceof CoachError) return e;
  const Anthropic = sdk;
  if (!Anthropic) {
    // SDK never loaded, so this can't be an SDK error.
    if (e instanceof Error && e.name === 'AbortError') return new CoachError('Request cancelled.', 'aborted');
    if (e instanceof TypeError) return new CoachError("Couldn't reach the Claude API (network or CORS error). Check your connection.", 'network');
    return new CoachError(e instanceof Error ? e.message : String(e), 'unknown');
  }
  if (e instanceof Anthropic.APIUserAbortError || (e instanceof Error && e.name === 'AbortError')) {
    return new CoachError('Request cancelled.', 'aborted');
  }
  if (e instanceof Anthropic.APIConnectionTimeoutError) {
    return new CoachError('The request to Claude timed out. Check your connection and try again.', 'network');
  }
  if (e instanceof Anthropic.APIConnectionError) {
    return new CoachError(
      "Couldn't reach the Claude API. Check your internet connection; a browser extension, VPN or firewall blocking api.anthropic.com (or CORS) can also cause this.",
      'network',
    );
  }
  if (e instanceof Anthropic.AuthenticationError) {
    return new CoachError('Your Anthropic API key was rejected (401). Check it in Settings — it should start with "sk-ant-".', 'auth', 401);
  }
  if (e instanceof Anthropic.PermissionDeniedError) {
    return new CoachError(`Your API key isn't allowed to make this request (403).${apiMessage(e) ? ' ' + apiMessage(e) : ''}`, 'permission', 403);
  }
  if (e instanceof Anthropic.NotFoundError) {
    return new CoachError("That model isn't available to your API key (404). Pick another model in Settings.", 'not_found', 404);
  }
  if (e instanceof Anthropic.RateLimitError) {
    return new CoachError('Rate limit reached (429). Wait a minute and try again, or pick a smaller model.', 'rate_limit', 429);
  }
  if (e instanceof Anthropic.BadRequestError) {
    const msg = apiMessage(e);
    if (/credit balance/i.test(msg)) {
      return new CoachError('Your Anthropic account is out of credits. Add credits in the Claude Console, then try again.', 'bad_request', 400);
    }
    return new CoachError(`Claude rejected the request (400)${msg ? `: ${msg}` : '.'}`, 'bad_request', 400);
  }
  if (e instanceof Anthropic.APIError) {
    const status = e.status;
    if (status === 529 || e.type === 'overloaded_error') {
      return new CoachError('Claude is overloaded right now (529). Try again in a moment, or pick another model.', 'overloaded', status ?? 529);
    }
    if (typeof status === 'number' && status >= 500) {
      return new CoachError(`The Claude API had a server error (${status}). Try again shortly.`, 'server', status);
    }
    return new CoachError(`Claude API error${status ? ` (${status})` : ''}: ${apiMessage(e) || e.message}`, 'unknown', status);
  }
  if (e instanceof TypeError) {
    // A raw fetch failure (e.g. CORS) that escaped the SDK.
    return new CoachError("Couldn't reach the Claude API (network or CORS error). Check your connection.", 'network');
  }
  return new CoachError(e instanceof Error ? e.message : String(e), 'unknown');
}

// ---------------------------------------------------------------------------
// Ask

/** Streams Claude's answer to `prompt`. Rejects with a user-readable Error (no key, bad key, network). */
export async function askClaude(prompt: Prompt, h: StreamHandlers, opts?: { signal?: AbortSignal; settings?: Settings }): Promise<CoachResult> {
  const settings = opts?.settings ?? loadSettings();
  const apiKey = settings.apiKey.trim();
  if (!apiKey) throw new CoachError('Add your Anthropic API key in Settings to ask the coach.', 'no_key');
  const model = isModelId(settings.model) ? settings.model : DEFAULT_MODEL;

  let text = '';
  try {
    const Anthropic = await loadSdk();
    const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 2 });
    const stream = client.beta.messages.stream(buildRequest(prompt, model), { signal: opts?.signal });
    for await (const event of stream) {
      if (event.type === 'content_block_delta') {
        if (event.delta.type === 'text_delta') {
          text += event.delta.text;
          h.onText(event.delta.text);
        } else if (event.delta.type === 'thinking_delta') {
          h.onThinking?.(event.delta.thinking);
        }
      }
    }
    const msg = await stream.finalMessage();
    const refused = msg.stop_reason === 'refusal';
    const result: CoachResult = { text, stopReason: msg.stop_reason, refused, model: msg.model };
    if (refused) result.refusalCategory = msg.stop_details?.category ?? null;
    let from: string | undefined;
    for (const b of msg.content) if (b.type === 'fallback') from ??= b.from.model;
    if (from) result.fallbackFrom = from;
    return result;
  } catch (e) {
    throw friendlyError(e);
  }
}

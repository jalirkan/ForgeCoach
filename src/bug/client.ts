/*
 * ForgeCoach — bug/client.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The client facts a bug report carries (mtg-table D410): the build, the look,
 * the settings that change what the page does (never the API key: only
 * whether one is set), the viewport and the browser, and where the page came
 * from. DOM-free: the window's pieces are passed in.
 */
import type { Settings } from '../claude.ts';
import type { SceneryPrefs } from '../ambience/prefs.ts';
import { servedByEngine, servedByRoom, servedByTunnel, isFunnelHost } from '../play/seatUrl.ts';
import type { ClientFacts } from './report.ts';

declare const __FORGECOACH_BUILD__: string | undefined;

/** The build this page is: the commit and the date it was built (vite.config.ts), or "dev". */
export function buildId(): string {
  try {
    return typeof __FORGECOACH_BUILD__ === 'string' && __FORGECOACH_BUILD__ ? __FORGECOACH_BUILD__ : 'dev';
  } catch {
    return 'dev';
  }
}

export interface ClientInputs {
  settings: Settings;
  scenery: SceneryPrefs | null;
  skin: string | null;
  location: { protocol: string; host: string; hostname: string; port: string; search: string; origin: string };
  roomBases: readonly string[];
  viewport: { w: number; h: number; dpr: number };
  userAgent: string;
  language: string | null;
  online: boolean | null;
  standalone: boolean;
  dev: boolean;
}

/** Where the page came from, in a word. */
export function servedBy(loc: ClientInputs['location'], roomBases: readonly string[], dev: boolean): string {
  if (dev) return 'dev';
  if (/(^|\.)github\.io$/.test(loc.hostname)) return 'pages';
  if (servedByTunnel(loc)) return isFunnelHost(loc.host) ? 'funnel' : 'tunnel';
  if (servedByRoom(loc, roomBases)) return 'room';
  if (servedByEngine(loc, roomBases)) return 'engine';
  return 'other';
}

export function clientFacts(i: ClientInputs): ClientFacts {
  const s = i.settings;
  return {
    build: buildId(),
    skin: i.skin,
    settings: {
      model: s.model,
      coachSource: s.coachSource,
      coachThinking: s.coachThinking ?? 'default',
      answerFirst: !!s.answerFirst,
      winChance: !!s.winChance,
      apiKeySet: !!s.apiKey,
      scenery: i.scenery ? { mode: i.scenery.mode, motion: i.scenery.motion, accents: i.scenery.accents, pack: !!i.scenery.packUrl } : null,
    },
    viewport: i.viewport,
    userAgent: i.userAgent.slice(0, 300),
    language: i.language,
    online: i.online,
    standalone: i.standalone,
    servedBy: servedBy(i.location, i.roomBases, i.dev),
  };
}

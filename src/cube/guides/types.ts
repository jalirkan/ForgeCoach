/*
 * ForgeCoach — cube/guides/types.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The shape of a "How to draft this cube" guide. Guides are data (one module
 * per cube in this folder), shown in the draft screens, the cube page and the
 * metagame page, and quoted (compactly) in the draft and deckbuilding coach
 * prompts. Every card a guide names must be in its cube (guides.test.ts).
 *
 * Lab numbers are never written into a guide: lab.ts reads them from the
 * cube's meta.json at runtime.
 */

export interface GuideArchetype {
  /** Stable id, e.g. "BR-sac". */
  id: string;
  /** Main colours, WUBRG order; '' for a deck that can be any colours. */
  colors: string;
  /** Colours it often adds (a third colour, a splash), WUBRG order. */
  also?: string;
  name: string;
  /** What the deck does and how it wins. */
  plan: string;
  /** 3–5 signpost and key cards, all in the cube. */
  cards: string[];
  /** What to take early. */
  pickEarly: string;
  /** The traps. */
  traps: string;
  /** Typical curve and land count, in words. */
  curve: string;
  /** Lab archetypes this one corresponds to: meta.json colours and, optionally, its primary themes. */
  lab?: { colors: string; themes?: string[] };
}

export interface CubeGuide {
  cubeId: string;
  /** Matches the cube document's title, for code that only has the parsed cube. */
  docTitle: RegExp;
  /** One line for the draft set-up screen. */
  teaser: string;
  /** The cube in one paragraph: speed, power level, what wins games. */
  summary: string;
  archetypes: GuideArchetype[];
  principles: {
    /** How to value removal, fixing, bombs and synergy pieces. */
    valuing: string[];
    /** Grid, Winston and Booster with two players. */
    formats: { grid: string; winston: string; booster: string };
    splash: string;
  };
  forge: {
    /** What the Forge AI does badly here, and what it means for your picks. */
    points: string[];
    /**
     * Cards in this cube that Forge 2.0.14's card scripts flag AI:RemoveDeck
     * (All: the AI plays them badly; Random: left out of random AI decks).
     */
    flagged: { all: string[]; random: string[] };
  };
}

/*
 * ForgeCoach — ui/LobbyTiles.tsx
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The start page's "Open a table" grid, after the board game's lobby: one
 * tile per way in — serif title, one muted line, a small glyph. The tiles
 * only route; every mode keeps its own screen and behaviour.
 */
import type { ReactNode } from 'react';
import { DRAFT_CUBES } from '../cube/cubes.ts';

export interface Tile {
  id: string;
  title: string;
  line: string;
  glyph: ReactNode;
  onClick: () => void;
  primary?: boolean;
}

const G = {
  play: <path d="M8 5v14l11-7z" fill="currentColor" />,
  draft: <path d="M5 4h9l5 5v11H5zM14 4v5h5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />,
  build: <path d="M4 7h16M4 12h16M4 17h10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />,
  cube: <path d="m12 3 8 4.5v9L12 21l-8-4.5v-9zM12 12l8-4.5M12 12v9M12 12 4 7.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />,
  review: <path d="M4 12a8 8 0 1 0 3-6.2M4 4v4h4M12 8v4l3 2" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />,
  practice: <path d="M12 3v3M12 18v3M3 12h3M18 12h3M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />,
  live: <path d="M12 12h.01M8.5 8.5a5 5 0 0 0 0 7M15.5 8.5a5 5 0 0 1 0 7M5.6 5.6a9 9 0 0 0 0 12.8M18.4 5.6a9 9 0 0 1 0 12.8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />,
};

const scrollTo = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

export function lobbyTiles(o: { onPlay: () => void; onDraftBuild: () => void; samples: number; playLine?: string }): Tile[] {
  return [
    { id: 'play', title: 'Play vs Bot', line: o.playLine ?? 'A full game against the bot, with the coach beside the board.', glyph: G.play, onClick: o.onPlay, primary: true },
    { id: 'draft', title: 'Draft vs Bot', line: 'Draft a cube against bots, or with a friend, then play your deck.', glyph: G.draft, onClick: () => (location.hash = '#draft') },
    { id: 'build', title: 'Draft & build', line: 'For a paper draft: track your pool, get each pick called, build the best 40.', glyph: G.build, onClick: o.onDraftBuild },
    { id: 'practice', title: 'Practice', line: 'Puzzles from your own games: what would you do here?', glyph: G.practice, onClick: () => (location.hash = '#practice') },
    { id: 'review', title: 'Review a game', line: `Step through a recorded game with the coach: ${o.samples} samples, or your own.`, glyph: G.review, onClick: () => scrollTo('lobby-review') },
    { id: 'cube', title: 'The cubes', line: `${DRAFT_CUBES.length} cubes: their cards, themes and the lab’s numbers.`, glyph: G.cube, onClick: () => (location.hash = `#cube/${DRAFT_CUBES[0]?.id ?? 'synergy'}`) },
    { id: 'live', title: 'Watch live', line: 'Follow a game on mtg-table’s own board, read-only.', glyph: G.live, onClick: () => scrollTo('lobby-live') },
  ];
}

export function LobbyTiles({ tiles }: { tiles: Tile[] }) {
  return (
    <section className="lobby-tiles" aria-label="Open a table">
      <h2 className="fx-label lobby-h">Open a table</h2>
      <div className="lobby-grid">
        {tiles.map((t) => (
          <button key={t.id} className={`lobby-tile${t.primary ? ' is-primary' : ''}`} onClick={t.onClick}>
            <span className="lobby-tile-t">{t.title}</span>
            <span className="lobby-tile-l">{t.line}</span>
            <svg className="lobby-tile-g" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
              {t.glyph}
            </svg>
          </button>
        ))}
      </div>
    </section>
  );
}

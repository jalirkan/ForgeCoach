/*
 * ForgeCoach — ui/draft/DraftApp.tsx
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Draft vs AI (#draft): set up a cube draft (Booster, Winston or Grid), draft
 * it against the cube lab's drafting AI, build your deck while the AI builds
 * its own out of sight, then set up the match.
 *
 *   #draft          set-up, or the pick screen of the draft in progress
 *   #draft/build    Build Your Deck
 *   #draft/match    the match set-up
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import '../deck/deck.css';
import '../forge-theme.css';
import './draft.css';
import { aiLabelFrom } from '../../draft/aiLabel.ts';
import { knownAiCards } from '../../draft/draft.ts';
import { initialDeck } from '../../draft/deck.ts';
import { SettingsDialog } from '../SettingsDialog.tsx';
import { DeckEditor } from './DeckEditor.tsx';
import { PickScreen } from './PickScreen.tsx';
import { deckColoursOf, DraftSetup, MatchSetup } from './Setup.tsx';
import { useDraftGame } from './useDraftGame.ts';

type View = 'setup' | 'draft' | 'build' | 'match';

function viewFromHash(): View | null {
  const m = /^#draft\/(setup|build|match)\b/.exec(location.hash);
  return (m?.[1] as View | undefined) ?? null;
}

export default function DraftApp({ onExit }: { onExit: () => void }) {
  const game = useDraftGame();
  const { saved, draft } = game;
  const [settings, setSettings] = useState(false);
  const [view, setView] = useState<View>(() => {
    const v = viewFromHash();
    if (v) return v;
    if (!saved) return 'setup';
    return saved.draft.done ? 'build' : 'draft';
  });
  const go = useCallback((v: View) => {
    setView(v);
    history.replaceState(null, '', v === 'draft' ? '#draft' : `#draft/${v}`);
    window.scrollTo(0, 0);
  }, []);
  // A finished draft moves on to the builder by itself.
  useEffect(() => {
    if (view === 'draft' && draft?.done) {
      const t = setTimeout(() => go('build'), 900);
      return () => clearTimeout(t);
    }
  }, [view, draft?.done, go]);
  // Nothing to show: back to set-up.
  useEffect(() => {
    if (!saved && view !== 'setup') go('setup');
  }, [saved, view, go]);

  const ctx = game.data.ctx;
  const deck = useMemo(() => saved?.deck ?? (draft?.done ? initialDeck(draft.picks.you) : null), [saved?.deck, draft]);
  const known = useMemo(() => (draft ? knownAiCards(draft) : []), [draft]);
  const pending = !!saved && 'pending' in (saved.draft as object);

  let body;
  if (view === 'setup' || !saved) {
    body = (
      <DraftSetup
        resume={saved && !pending ? saved.draft : null}
        hints={saved?.hints ?? true}
        onResume={() => go(saved?.draft.done ? 'build' : 'draft')}
        onAbandon={game.abandon}
        onBegin={(o) => {
          game.start(o);
          go('draft');
        }}
        onExit={onExit}
        onPaper={() => {
          location.hash = '#deck';
        }}
        onFriend={() => {
          location.hash = '#draft/friend';
        }}
      />
    );
  } else if (!draft || !ctx) {
    body = (
      <div className="fx dr-wait">
        <span className="spinner spinner-lg" />
        <p className="serif-i">{game.data.error ?? 'Shuffling the cube…'}</p>
      </div>
    );
  } else if (view === 'draft' || !draft.done) {
    body = <PickScreen game={game} draft={draft} onLeave={() => go('setup')} onSettings={() => setSettings(true)} />;
  } else if (view === 'match') {
    body = (
      <MatchSetup
        draft={draft}
        deck={deck}
        deckColours={deckColoursOf(deck, (n) => ctx.facts.get(n)?.colors ?? '')}
        after={saved.after}
        known={known}
        aiLabel={aiLabelFrom(known, ctx).text}
        meta={game.data.meta}
        cubeNames={ctx.cube.cards.map((c) => c.name)}
        title={saved.title || 'Practice draft'}
        onBack={() => go('build')}
        onAbandon={() => {
          game.abandon();
          go('setup');
        }}
      />
    );
  } else {
    body = <DeckEditor ctx={ctx} pool={draft.picks.you} deck={deck ?? initialDeck(draft.picks.you)} onDeck={game.setDeck} onSubmit={() => go('match')} onBack={() => go('setup')} />;
  }
  return (
    <>
      {body}
      <SettingsDialog open={settings} onClose={() => setSettings(false)} />
    </>
  );
}

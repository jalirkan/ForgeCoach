/*
 * ForgeCoach — ui/CoachText.tsx
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Coach text with its engine ids read as the board shows the card, and the
 * engine's own bookkeeping it quotes ("(X=0)", "Opt (12)") taken out
 * (cardRefs.ts): "block Construct Token #297" reads "block Construct Token ⑦"
 * in combat (the lane badge), "Construct Token 4/4" outside it, and hovering
 * the name lights the card on the board (boardFocus.ts). The ids come from
 * the coach's prompts, which keep them (the model needs them); the player
 * never sees one. A screen with a board provides the look
 * (`CardRefContext`); without one ids are only taken out.
 */
import { createContext, useContext, type ReactNode } from 'react';
import { setBoardFocus } from './boardFocus.ts';
import { splitCardRefs, type CardRefLook } from './cardRefs.ts';
import { SymbolText } from './Mana.tsx';
import { withoutEngineIds } from '../engineText.ts';

export const CardRefContext = createContext<CardRefLook | null>(null);
export const useCardRefLook = () => useContext(CardRefContext);

export function CoachText({ text, symbols = true }: { text: string; symbols?: boolean }): ReactNode {
  const look = useCardRefLook();
  const segs = splitCardRefs(text, look);
  return (
    <>
      {segs.map((s, i) =>
        typeof s === 'string' ? (
          // the coach quotes the engine's labels too ("Nyxborn Hydra - Creature 0 / 1 (X=0)"): its bookkeeping out
          symbols ? <SymbolText key={i} text={withoutEngineIds(s, { piece: true })} /> : withoutEngineIds(s, { piece: true })
        ) : (
          <span
            key={i}
            className="coach-card"
            data-coach-card=""
            onMouseEnter={() => setBoardFocus([s.id])}
            onMouseLeave={() => setBoardFocus(null)}
          >
            {s.text}
            {s.tag && (
              <span className={s.combat ? 'coach-card-n' : 'coach-card-tag'} title={s.combat ? `Number ${s.tag} in the combat lane` : undefined}>
                {s.tag}
              </span>
            )}
          </span>
        ),
      )}
    </>
  );
}

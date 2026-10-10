/*
 * ForgeCoach — ui/CardDetail.tsx
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The card sheet (Scryfall image + oracle text + what it is doing right now)
 * and the desktop hover preview.
 */
import { useEffect, useState } from 'react';
import type { AnyCard, Card, GameStateBody } from '../protocol.ts';
import { altFace, isHidden, keywordsOf } from '../protocol.ts';
import { cardIndex, cardName } from '../decisions.ts';
import type { CardInfo } from '../cards.ts';
import { imageForFace, isLookupName } from '../cards.ts';
import { useCardInfo } from './cardData.ts';
import { displayName } from './CardTile.tsx';
import { IconExternal } from './Icons.tsx';
import { ManaCost, SymbolText } from './Mana.tsx';
import { Sheet } from './Sheet.tsx';
import { counterLabel, keywordLabel } from './util.ts';

export function CardDetail({
  card,
  state,
  seat,
  onClose,
}: {
  card: AnyCard | null;
  state: GameStateBody | null;
  seat: number;
  onClose: () => void;
}) {
  const visible = card && !isHidden(card) ? (card as Card) : null;
  const lookup = visible ? visible.name || altFace(visible)?.name || null : null;
  const info = useCardInfo(lookup);
  return (
    <Sheet open={card !== null} onClose={onClose} width={720} className="card-sheet" title={visible ? displayName(visible) : 'Hidden card'}>
      {card && !visible && <p className="muted">This card is hidden from you.</p>}
      {visible && <CardDetailBody card={visible} info={info} state={state} seat={seat} />}
    </Sheet>
  );
}

function CardDetailBody({ card, info, state, seat }: { card: Card; info: CardInfo | undefined; state: GameStateBody | null; seat: number }) {
  const img = imageForFace(info, card.name || altFace(card)?.name)?.normal;
  const [imgLoaded, setImgLoaded] = useState(false);
  const [imgFailed, setImgFailed] = useState(false);
  useEffect(() => {
    setImgLoaded(false);
    setImgFailed(false);
  }, [img]);
  const idx = state ? cardIndex(state) : new Map<number, AnyCard>();
  const playerName = (id: number | null) => (id === null ? '—' : id === seat ? 'You' : state?.players.find((p) => p.id === id)?.name ?? `Player ${id}`);
  const kw = keywordsOf(card);
  const counters = Object.entries(card.counters ?? {}).filter(([, n]) => n > 0);
  const onBattlefield = card.zone === 'battlefield';
  const flags: { label: string; tone: string }[] = [];
  if (onBattlefield) {
    flags.push(card.tapped ? { label: 'Tapped', tone: 'warn' } : { label: 'Untapped', tone: 'ok' });
    if (card.sick) flags.push({ label: 'Summoning sick', tone: 'warn' });
  }
  if (card.attacking) flags.push({ label: 'Attacking', tone: 'bad' });
  if (card.blocking) flags.push({ label: 'Blocking', tone: 'info' });
  if (card.damage > 0) flags.push({ label: `${card.damage} damage marked`, tone: 'bad' });
  if (card.token) flags.push({ label: 'Token', tone: 'muted' });
  if (card.faceDown) flags.push({ label: 'Face down', tone: 'muted' });
  const faces = info?.faces && info.faces.length > 1 ? info.faces : null;
  const alt = altFace(card);
  return (
    <div className="cd">
      <div className="cd-image">
        {img && !imgFailed ? (
          <img src={img} alt={displayName(card)} className={imgLoaded ? 'is-loaded' : ''} onLoad={() => setImgLoaded(true)} onError={() => setImgFailed(true)} decoding="async" />
        ) : null}
        {!imgLoaded && <TextCard card={card} info={info} />}
      </div>
      <div className="cd-info">
        <div className="cd-flags">
          <span className="chip chip-muted">{card.zone}</span>
          {flags.map((f) => (
            <span key={f.label} className={`chip chip-${f.tone}`}>
              {f.label}
            </span>
          ))}
        </div>
        {faces ? (
          faces.map((f) => (
            <div key={f.name} className="cd-face">
              <div className="cd-line">
                <b>{f.name}</b> <ManaCost cost={f.manaCost} size="sm" />
              </div>
              <div className="cd-type">{f.typeLine}</div>
              <OracleText text={f.oracleText} />
            </div>
          ))
        ) : (
          <div className="cd-face">
            <div className="cd-line">
              <ManaCost cost={card.manaCost ?? info?.manaCost} />
            </div>
            <div className="cd-type">{info?.typeLine || card.types || '—'}</div>
            {info?.oracleText ? (
              <OracleText text={info.oracleText} />
            ) : (
              <p className="muted small">{info ? (info.found ? 'No rules text.' : 'Scryfall has no card by this name.') : 'Loading card text…'}</p>
            )}
          </div>
        )}
        {alt && (
          <div className="cd-section">
            <div className="cd-h">Face-down — really</div>
            <div>
              {alt.name} <ManaCost cost={alt.manaCost} size="sm" /> · {alt.types}
            </div>
          </div>
        )}
        <dl className="cd-stats">
          {card.power !== null && card.toughness !== null && (
            <>
              <dt>Power / toughness</dt>
              <dd>
                {card.power}/{card.toughness}
                {info?.power && (info.power !== card.power || info.toughness !== card.toughness) && (
                  <span className="muted"> (printed {info.power}/{info.toughness})</span>
                )}
              </dd>
            </>
          )}
          {card.loyalty !== null && (
            <>
              <dt>Loyalty</dt>
              <dd>{card.loyalty}</dd>
            </>
          )}
          {counters.length > 0 && (
            <>
              <dt>Counters</dt>
              <dd>{counters.map(([k, n]) => `${n} × ${counterLabel(k)}`).join(', ')}</dd>
            </>
          )}
          {kw.length > 0 && (
            <>
              <dt>Keywords now</dt>
              <dd>{kw.map(keywordLabel).join(', ')}</dd>
            </>
          )}
          {card.attachedToId !== null && (
            <>
              <dt>Attached to</dt>
              <dd>{cardName(idx.get(card.attachedToId))}</dd>
            </>
          )}
          {card.attachmentIds.length > 0 && (
            <>
              <dt>Attached</dt>
              <dd>{card.attachmentIds.map((id) => cardName(idx.get(id))).join(', ')}</dd>
            </>
          )}
          <dt>Controller</dt>
          <dd>
            {playerName(card.controller)}
            {card.owner !== card.controller && <span className="muted"> (owner {playerName(card.owner)})</span>}
          </dd>
        </dl>
        {card.abilities.length > 0 && (
          <div className="cd-section">
            <div className="cd-h">Abilities the engine offered</div>
            <ul className="cd-abilities">
              {card.abilities.map((a) => (
                <li key={a.id} className={a.canPlay ? 'can' : 'cant'}>
                  <span className="dot" /> <SymbolText text={a.text} />
                </li>
              ))}
            </ul>
          </div>
        )}
        {info?.scryfallUri && (
          <a className="link-ext" href={info.scryfallUri} target="_blank" rel="noreferrer">
            Scryfall <IconExternal size={12} />
          </a>
        )}
      </div>
    </div>
  );
}

function OracleText({ text }: { text: string }) {
  return (
    <div className="oracle">
      {text.split('\n').map((line, i) =>
        line === '//' ? (
          <hr key={i} />
        ) : (
          <p key={i}>
            <SymbolText text={line} />
          </p>
        ),
      )}
    </div>
  );
}

/** A text-only card face for when no image is available. */
function TextCard({ card, info }: { card: Card; info: CardInfo | undefined }) {
  return (
    <div className="text-card">
      <div className="text-card-head">
        <span>{displayName(card)}</span>
        <ManaCost cost={card.manaCost ?? info?.manaCost} size="sm" />
      </div>
      <div className="text-card-art" />
      <div className="text-card-type">{info?.typeLine || card.types}</div>
      <div className="text-card-body">{info?.oracleText ? <SymbolText text={info.oracleText.split('\n').slice(0, 5).join('\n')} /> : null}</div>
      {card.power !== null && card.toughness !== null && (
        <div className="text-card-pt">
          {card.power}/{card.toughness}
        </div>
      )}
    </div>
  );
}

/** Desktop-only floating image preview next to the hovered tile. */
export function HoverPreview({ name, rect }: { name: string | null; rect: DOMRect | null }) {
  const info = useCardInfo(name);
  const img = imageForFace(info, name)?.normal;
  const [shown, setShown] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setShown(false);
    if (!name) return;
    const t = setTimeout(() => setShown(true), 380);
    return () => clearTimeout(t);
  }, [name]);
  useEffect(() => {
    setLoaded(false);
    setFailed(false);
  }, [img]);
  if (!name || !rect || !shown) return null;
  // Tokens and other names Scryfall cannot have: nothing to preview beyond the tile itself.
  if (!isLookupName(name) || (info && !info.found)) return null;
  const W = 244;
  const H = 340;
  const right = rect.right + 12 + W < window.innerWidth;
  const left = right ? rect.right + 12 : Math.max(8, rect.left - 12 - W);
  const top = Math.min(Math.max(8, rect.top + rect.height / 2 - H / 2), window.innerHeight - H - 8);
  const showImg = img && !failed;
  return (
    <div className="hover-preview" style={{ left, top, width: W, height: H }} aria-hidden="true">
      {!(showImg && loaded) && <InfoCard name={info?.name || name} info={info} />}
      {showImg && <img src={img} alt="" className={loaded ? 'is-loaded' : ''} decoding="async" onLoad={() => setLoaded(true)} onError={() => setFailed(true)} />}
    </div>
  );
}

/** Card-shaped placeholder built from the text we already have (no image needed). */
function InfoCard({ name, info }: { name: string; info: CardInfo | undefined }) {
  return (
    <div className="text-card">
      <div className="text-card-head">
        <span>{name}</span>
        <ManaCost cost={info?.manaCost} size="sm" />
      </div>
      <div className="text-card-art" />
      <div className="text-card-type">{info?.typeLine || (info ? '' : 'Loading…')}</div>
      <div className="text-card-body">{info?.oracleText ? <SymbolText text={info.oracleText.split('\n').slice(0, 6).join('\n')} /> : null}</div>
    </div>
  );
}

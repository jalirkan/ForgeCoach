/*
 * ForgeCoach — ui/deck/CubeCard.tsx
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * A cube card drawn as the real card (Scryfall image), with a text face until
 * the image arrives, plus the deck assistant's overlays: in your pool, taken
 * by the opponent, a value chip, a recommended outline.
 */
import { memo, useState, type ReactNode } from 'react';
import { useCardInfo } from '../cardData.ts';
import { ManaCost } from '../Mana.tsx';
import { IconCheck, IconInfo } from '../Icons.tsx';
import { colorClass, cx } from '../util.ts';

export const CubeCard = memo(function CubeCard({
  name,
  colors,
  mark,
  chip,
  chipTone,
  highlight,
  onClick,
  onInfo,
  label,
  className,
}: {
  name: string;
  /** Colours for the frame strip (WUBRG letters). */
  colors?: string;
  mark?: 'mine' | 'opp' | null;
  chip?: ReactNode;
  chipTone?: 'good' | 'bad' | 'mid' | null;
  highlight?: boolean;
  onClick?: () => void;
  onInfo?: () => void;
  label?: string;
  className?: string;
}) {
  const info = useCardInfo(name);
  const img = info?.image?.normal ?? info?.faces?.[0]?.image?.normal;
  const [loaded, setLoaded] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const ok = img && loaded === img && failed !== img;
  const Tag = onClick ? 'button' : 'div';
  return (
    <div className={cx('cc', colorClass([...(colors ?? '')]), mark && `is-${mark}`, highlight && 'is-hl', className)}>
      <Tag className="cc-hit" onClick={onClick} aria-label={label ?? name} type={onClick ? 'button' : undefined}>
        <div className={cx('cc-face', ok && 'is-hidden')}>
          <div className="cc-name">{name}</div>
          {info?.manaCost && (
            <div className="cc-cost">
              <ManaCost cost={info.manaCost.split(' // ')[0]} size="sm" />
            </div>
          )}
          <div className="cc-type">{info?.typeLine?.split(' // ')[0] ?? ''}</div>
        </div>
        {img && failed !== img && (
          <img
            className={cx('cc-img', ok && 'is-on')}
            src={img}
            alt=""
            loading="lazy"
            decoding="async"
            draggable={false}
            ref={(el) => {
              if (el && el.complete && el.naturalWidth > 0 && loaded !== img) setLoaded(img);
            }}
            onLoad={() => setLoaded(img)}
            onError={() => setFailed(img)}
          />
        )}
        {mark === 'mine' && (
          <span className="cc-mark" aria-hidden="true">
            <IconCheck size={14} />
          </span>
        )}
        {mark === 'opp' && <span className="cc-mark cc-mark-opp">Opp</span>}
        {chip !== undefined && chip !== null && <span className={cx('cc-chip', chipTone && `is-${chipTone}`)}>{chip}</span>}
      </Tag>
      {onInfo && (
        <button type="button" className="cc-info" onClick={onInfo} aria-label={`About ${name}`}>
          <IconInfo size={13} />
        </button>
      )}
    </div>
  );
});

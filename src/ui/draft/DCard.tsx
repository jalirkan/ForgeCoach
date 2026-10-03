/*
 * ForgeCoach — ui/draft/DCard.tsx
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * A card in the draft: the real Scryfall image as the main element, with a
 * printed-looking face (frame in the card's colour, name, cost, type, text)
 * until the image arrives or when there is none. Plus the face-down back
 * used for Winston piles and the stack, and the `<> n` count badge.
 */
import { memo, useState, type CSSProperties, type ReactNode } from 'react';
import { useCardInfo } from '../cardData.ts';
import { ManaCost } from '../Mana.tsx';
import { cx } from '../util.ts';

export type CardState = 'sel' | 'dim' | 'hint' | 'ai' | 'new' | null;

function frameOf(colors: string[] | undefined, land: boolean): string {
  if (land) return 'f-land';
  if (!colors || colors.length === 0) return 'f-none';
  if (colors.length > 1) return 'f-multi';
  return `f-${colors[0]}`;
}

export const DCard = memo(function DCard({
  name,
  big,
  state,
  states,
  onClick,
  label,
  badge,
  className,
  style,
}: {
  name: string;
  /** Use the large image (fanned Winston piles, the grid on desktop). */
  big?: boolean;
  state?: CardState;
  states?: CardState[];
  onClick?: () => void;
  label?: string;
  badge?: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  const info = useCardInfo(name);
  const face = info?.faces?.[0];
  const img = big ? (info?.image?.large ?? info?.image?.normal ?? face?.image?.large ?? face?.image?.normal) : (info?.image?.normal ?? face?.image?.normal);
  const [loaded, setLoaded] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const ok = !!img && loaded === img && failed !== img;
  const type = (info?.typeLine ?? '').split(' // ')[0] ?? '';
  const land = /\bLand\b/.test(type) && !/\bCreature\b/.test(type);
  const Tag = onClick ? 'button' : 'div';
  const all = [state, ...(states ?? [])].filter(Boolean) as string[];
  return (
    <Tag
      className={cx('dcard', ...all.map((s) => `is-${s}`), className)}
      onClick={onClick}
      aria-label={label ?? name}
      type={onClick ? 'button' : undefined}
      style={style}
    >
      <span className={cx('dcard-face', frameOf(info?.colors, land), ok && 'is-hidden')} aria-hidden={ok}>
        <span className="dcard-head">
          <span className="dcard-name">{name}</span>
          {info?.manaCost && (
            <span className="dcard-cost">
              <ManaCost cost={info.manaCost.split(' // ')[0]} size="sm" />
            </span>
          )}
        </span>
        <span className="dcard-art" />
        <span className="dcard-type">{type || ' '}</span>
        <span className="dcard-text">{(face?.oracleText ?? info?.oracleText ?? '').split('\n//\n')[0]}</span>
        {info?.power !== undefined && info?.toughness !== undefined && (
          <span className="dcard-pt">
            {info.power}/{info.toughness}
          </span>
        )}
      </span>
      {img && failed !== img && (
        <img
          className={cx('dcard-img', ok && 'is-on')}
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
      {badge !== undefined && badge !== null && <span className="dcard-badge">{badge}</span>}
    </Tag>
  );
});

/** A face-down card. */
export function CardBack({ className, style }: { className?: string; style?: CSSProperties }) {
  return (
    <span className={cx('dback', className)} style={style} aria-hidden="true">
      <span className="dback-oval">
        <svg viewBox="0 0 24 24" width="38%" height="38%">
          <path d="M3 9h13l2-3h3v3l-3 2v2H8l-1 2h4v3H5v-3l1-2-3-1z" fill="currentColor" />
        </svg>
      </span>
    </span>
  );
}

/** The `<> 3` count badge of a stack. */
export function CountBadge({ n, className }: { n: number; className?: string }) {
  return (
    <span className={cx('cnt', className)} aria-label={`${n} cards`}>
      <span className="cnt-glyph" aria-hidden="true">
        ‹›
      </span>
      {n}
    </span>
  );
}

/** A face-down stack: up to four offset backs and a count badge. */
export function BackStack({ n, className, glow }: { n: number; className?: string; glow?: boolean }) {
  const layers = Math.max(1, Math.min(4, n));
  return (
    <span className={cx('bstack', glow && 'is-glow', n === 0 && 'is-empty', className)}>
      {n === 0 ? (
        <span className="bstack-empty" />
      ) : (
        Array.from({ length: layers }, (_, i) => <CardBack key={i} className="bstack-card" style={{ '--i': layers - 1 - i } as CSSProperties} />)
      )}
      {n > 0 && <CountBadge n={n} className="bstack-cnt" />}
    </span>
  );
}

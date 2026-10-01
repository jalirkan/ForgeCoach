/*
 * ForgeCoach — ui/Mana.tsx
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Mana symbols: a styled disc that always renders, with Scryfall's SVG on top
 * when it loads. Text containing {X} symbols renders them inline.
 */
import { memo, useState, type ReactNode } from 'react';
import { costSymbols } from './util.ts';

const SYMBOL_BASE = 'https://svgs.scryfall.io/card-symbols/';
let failures = 0;
const KNOWN = /^([WUBRGCXSTQE]|\d{1,2}|[WUBRG2C]\/[WUBRGP]|[WUBRG]\/[WUBRG]\/P)$/i;

function pipClass(sym: string): string {
  const s = sym.toUpperCase();
  if (/^[WUBRGC]$/.test(s)) return `pip pip-${s}`;
  if (s.includes('/')) {
    const cols = s.split('/').filter((x) => /^[WUBRG]$/.test(x));
    if (cols.length > 2) return 'pip pip-multi';
    if (cols.length === 2) return `pip pip-hybrid pip-h-${cols[0]}${cols[1]}`;
    if (cols.length === 1) return `pip pip-${cols[0]}`;
  }
  return 'pip pip-generic';
}

function pipText(sym: string): string {
  const s = sym.toUpperCase();
  if (s === 'T') return '↷';
  if (s === 'Q') return '↶';
  if (s.includes('/')) return s.split('/')[0]!;
  return s;
}

export const Pip = memo(function Pip({ sym, size }: { sym: string; size?: 'sm' | 'md' | 'lg' }) {
  const [imgOk, setImgOk] = useState<boolean | null>(failures >= 3 || !KNOWN.test(sym) ? false : null);
  const file = sym.toUpperCase().replace(/\//g, '');
  return (
    <span className={`${pipClass(sym)} pip-${size ?? 'md'}`} title={`{${sym}}`}>
      <span className="pip-t" style={imgOk ? { opacity: 0 } : undefined}>
        {pipText(sym)}
      </span>
      {imgOk !== false && (
        <img
          src={`${SYMBOL_BASE}${encodeURIComponent(file)}.svg`}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          style={{ opacity: imgOk ? 1 : 0 }}
          onLoad={() => setImgOk(true)}
          onError={() => {
            failures++;
            setImgOk(false);
          }}
        />
      )}
    </span>
  );
});

export const ManaCost = memo(function ManaCost({ cost, size }: { cost: string | null | undefined; size?: 'sm' | 'md' | 'lg' }) {
  const syms = costSymbols(cost);
  if (syms.length === 0) return null;
  return (
    <span className="mana-cost" aria-label={cost ?? ''}>
      {syms.map((s, i) => (
        <Pip key={i} sym={s} size={size} />
      ))}
    </span>
  );
});

/** Renders plain text with {X} mana/tap symbols as pips. No HTML is ever interpreted. */
export function SymbolText({ text, size = 'sm' }: { text: string; size?: 'sm' | 'md' }): ReactNode {
  const parts: ReactNode[] = [];
  const re = /\{([^}\s]{1,5})\}/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    parts.push(<Pip key={k++} sym={m[1]!} size={size} />);
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}

/** A row of single-colour pips, e.g. a mana pool or available sources. */
export function PipRow({ colors, size = 'sm' }: { colors: string[]; size?: 'sm' | 'md' }) {
  return (
    <span className="pip-row">
      {colors.map((c, i) => (
        <Pip key={i} sym={c} size={size} />
      ))}
    </span>
  );
}

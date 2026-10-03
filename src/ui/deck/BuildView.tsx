/*
 * ForgeCoach — ui/deck/BuildView.tsx
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The deck builder: the best three builds of the pool, the chosen one as
 * cards by mana value, its score and reasons, swaps with the score moving
 * live, export (text, Forge .dck) and the coach. The coach explains and
 * suggests; only the player's taps change the deck.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CubeContext } from '../../cube/score.ts';
import { cardValue } from '../../cube/score.ts';
import type { SavedPool } from '../../cube/pools.ts';
import {
  buildDecks,
  checkBuild,
  CURVE_LABELS,
  dckText,
  deckSlug,
  deckText,
  evaluateBuild,
  PART_LABEL,
  swapOptions,
  bucketOf,
  type DeckBuild,
  type ScoreParts,
  type SpellCount,
} from '../../cube/builder.ts';
import { buildDeckPrompt } from '../../cube/deckPrompt.ts';
import { BASIC_OF, COLOURS, type Colour } from '../../cube/colors.ts';
import { startAnswer, stopAnswer, useAnswer } from '../answers.ts';
import { AnswerBox } from '../CoachPanel.tsx';
import { cardsForPrompt, useCardInfo } from '../cardData.ts';
import { ManaCost, PipRow } from '../Mana.tsx';
import { Sheet } from '../Sheet.tsx';
import { IconCheck, IconChevronDown, IconCopy, IconFile, IconPlay, IconUndo } from '../Icons.tsx';
import { copyText, cx } from '../util.ts';
import { CubeCard } from './CubeCard.tsx';

const SPELL_OPTS: SpellCount[] = ['auto', 22, 23, 24];

function hash(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}

export function BuildView({
  ctx,
  pool,
  format,
  onInfo,
  onSettings,
  metaChip,
}: {
  ctx: CubeContext;
  pool: SavedPool;
  format: 'grid' | 'winston' | null;
  onInfo: (name: string) => void;
  onSettings: () => void;
  metaChip: React.ReactNode;
}) {
  const [spells, setSpells] = useState<SpellCount>('auto');
  const [builds, setBuilds] = useState<DeckBuild[] | null>(null);
  const [sel, setSel] = useState(0);
  const [edits, setEdits] = useState<Record<string, string[]>>({});
  const [swapOut, setSwapOut] = useState<string | null>(null);

  // Building takes a moment (every pair and splash): off the click, and again when the pool or the data changes.
  const cards = pool.cards;
  useEffect(() => {
    setBuilds(null);
    const t = setTimeout(() => {
      setBuilds(cards.length ? buildDecks(ctx, cards, { spells }) : []);
    }, 30);
    return () => clearTimeout(t);
  }, [ctx, cards, spells]);
  useEffect(() => {
    setSel(0);
    setEdits({});
  }, [cards, spells]);

  const base = builds?.[Math.min(sel, (builds?.length ?? 1) - 1)] ?? null;
  const edited = base ? edits[base.key] : undefined;
  const current = useMemo(
    () => (base && edited ? evaluateBuild(ctx, cards, base.colors, base.splash, edited, { landCount: base.landCount, n: base.spells.length, thin: base.thin }) : base),
    [base, edited, ctx, cards],
  );
  const problems = useMemo(() => (current ? checkBuild(current, cards, ctx) : []), [current, cards, ctx]);

  if (!cards.length) {
    return (
      <div className="bv-empty card-box notice">
        <p>Your pool is empty. Add the cards you drafted in <b>Pool</b> (tap them, or paste a list), then come back for the best 40.</p>
      </div>
    );
  }
  if (!builds) {
    return (
      <div className="bv-wait">
        <span className="spinner" /> Trying every colour pair and splash…
      </div>
    );
  }
  if (!current || !base) return <div className="bv-empty card-box notice">No build: the pool has no castable spells yet.</div>;

  const applySwap = (out: string, inn: string) => {
    const now = edited ?? base.spells;
    setEdits({ ...edits, [base.key]: now.map((s) => (s === out ? inn : s)) });
    setSwapOut(null);
  };

  return (
    <div className="bv">
      <div className="bv-head">
        <div className="bv-builds" role="tablist" aria-label="Builds">
          {builds.map((b, i) => (
            <button key={b.key} role="tab" aria-selected={i === sel} className={cx('bv-build', i === sel && 'is-on')} onClick={() => setSel(i)}>
              <span className="bv-build-top">
                <PipRow colors={[...b.colors]} />
                {b.splash && (
                  <span className="bv-splash">
                    + <PipRow colors={[b.splash]} />
                  </span>
                )}
                <span className="bv-build-score">{(i === sel ? current : b).score}</span>
              </span>
              <span className="bv-build-name">{b.name}</span>
              {i === 0 && <span className="bv-build-tag">Best</span>}
              {b.thin && <span className="bv-build-tag is-thin">{b.thin === 'three' ? '3 colours' : '18 lands'}</span>}
            </button>
          ))}
        </div>
        <div className="bv-opts">
          <span className="muted small">Spells</span>
          <div className="seg">
            {SPELL_OPTS.map((o) => (
              <button key={o} className={cx(spells === o && 'is-on')} onClick={() => setSpells(o)}>
                {o === 'auto' ? 'Auto' : o}
              </button>
            ))}
          </div>
          {metaChip}
        </div>
      </div>

      {current.thin && (
        <div className="bv-thin">
          <b>Thin pool.</b> No two colours have 23 playable spells here, so this build {current.thin === 'three' ? `plays three full colours on ${current.landCount} lands` : 'plays 22 spells and 18 lands'}. Draft
          more playables in your main colours if you still can.
        </div>
      )}
      <div className="bv-cols">
        <div className="bv-main">
          <DeckList b={current} ctx={ctx} onCard={setSwapOut} onInfo={onInfo} />
          {edited && (
            <div className="bv-edited">
              <span className="small">
                You changed this build: score {current.score} vs {base.score} suggested ({current.score - base.score >= 0 ? '+' : ''}
                {Math.round((current.score - base.score) * 10) / 10}).
              </span>
              <button className="btn btn-quiet btn-sm" onClick={() => setEdits(Object.fromEntries(Object.entries(edits).filter(([k]) => k !== base.key)))}>
                <IconUndo size={13} /> Reset
              </button>
            </div>
          )}
        </div>
        <aside className="bv-side">
          <ScoreCard b={current} problems={problems} />
          <div className="card-box bv-reasons">
            <div className="box-h">Why this build</div>
            <ul>
              {current.reasons.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
            {current.cuts.length > 0 && (
              <>
                <div className="box-h bv-cuts-h">Left out</div>
                <ul className="bv-cuts">
                  {current.cuts.map((c) => (
                    <li key={c.name}>
                      <button className="link-plain" onClick={() => onInfo(c.name)}>
                        {c.name}
                      </button>
                      <span className="muted">: {c.reason}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
          <ExportBox b={current} pool={cards} problems={problems} name={`${pool.name} — ${current.name}`} />
          <DeckCoach ctx={ctx} pool={pool} b={current} builds={builds} format={format} onSettings={onSettings} />
        </aside>
      </div>
      <SwapSheet ctx={ctx} pool={cards} b={current} out={swapOut} onClose={() => setSwapOut(null)} onSwap={applySwap} onInfo={onInfo} />
    </div>
  );
}

function DeckList({ b, ctx, onCard, onInfo }: { b: DeckBuild; ctx: CubeContext; onCard: (n: string) => void; onInfo: (n: string) => void }) {
  const rows = CURVE_LABELS.map((label, i) => ({ label, cards: b.spells.filter((s) => bucketOf(ctx.facts.get(s)?.mv ?? 0) === i) }));
  return (
    <div className="dl">
      {rows.map((r, i) =>
        r.cards.length ? (
          <section key={r.label} className="dl-row">
            <div className="dl-label">
              <span className="dl-mv">{r.label}</span>
              <span className="dl-n">
                {r.cards.length}
                <span className="muted">/{Math.round(b.curveTarget[i] ?? 0)}</span>
              </span>
            </div>
            <div className="dl-cards">
              {r.cards.map((s) => (
                <CubeCard
                  key={s}
                  name={s}
                  colors={ctx.facts.get(s)?.colors}
                  chip={Math.round(cardValue(s, ctx))}
                  chipTone={b.splashCards.includes(s) ? 'mid' : null}
                  onClick={() => onCard(s)}
                  onInfo={() => onInfo(s)}
                  label={`${s} — tap to swap`}
                />
              ))}
            </div>
          </section>
        ) : null,
      )}
      <section className="dl-row dl-lands">
        <div className="dl-label">
          <span className="dl-mv">Lands</span>
          <span className="dl-n">{b.landCount}</span>
        </div>
        <div className="dl-cards">
          {b.nonbasics.map((l) => (
            <CubeCard key={l} name={l} onInfo={() => onInfo(l)} />
          ))}
          <div className="dl-basics">
            {COLOURS.filter((c) => (b.basics[c] ?? 0) > 0).map((c) => (
              <div key={c} className={cx('basic', `c-${c}`)}>
                <PipRow colors={[c]} size="md" />
                <b>{b.basics[c as Colour]}</b>
                <span className="muted small">{BASIC_OF[c]}</span>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

function ScoreCard({ b, problems }: { b: DeckBuild; problems: string[] }) {
  const keys = (Object.keys(b.parts) as Array<keyof ScoreParts>).filter((k) => k !== 'quality' && b.parts[k] !== 0);
  const max = Math.max(6, ...keys.map((k) => Math.abs(b.parts[k])));
  return (
    <div className="card-box sc">
      <div className="sc-top">
        <div>
          <div className="sc-score">{b.score}</div>
          <div className="muted tiny">deck score</div>
        </div>
        <div className="sc-facts">
          <span>
            <b>{b.spells.length}</b> spells
          </span>
          <span>
            <b>{b.landCount}</b> lands
          </span>
          <span>
            <b>{b.creatures}</b> creatures
          </span>
          <span>
            <b>{b.interaction}</b> interaction
          </span>
          <span>
            avg <b>{b.avgMv}</b>
          </span>
        </div>
      </div>
      {problems.length === 0 ? (
        <div className="sc-legal is-ok">
          <IconCheck size={13} /> Legal 40
        </div>
      ) : (
        <div className="sc-legal is-bad">{problems.join(' · ')}</div>
      )}
      <div className="sc-parts">
        <div className="sc-part">
          <span className="sc-label">{PART_LABEL.quality}</span>
          <span className="sc-bar">
            <span className="sc-fill is-q" style={{ width: `${Math.min(100, b.parts.quality)}%` }} />
          </span>
          <span className="sc-v">{b.parts.quality}</span>
        </div>
        {keys.map((k) => (
          <div key={k} className="sc-part">
            <span className="sc-label">{PART_LABEL[k]}</span>
            <span className="sc-bar">
              <span className={cx('sc-fill', b.parts[k] > 0 ? 'is-pos' : 'is-neg')} style={{ width: `${(Math.abs(b.parts[k]) / max) * 100}%` }} />
            </span>
            <span className={cx('sc-v', b.parts[k] > 0 ? 'pos' : 'neg')}>
              {b.parts[k] > 0 ? '+' : '−'}
              {Math.abs(b.parts[k])}
            </span>
          </div>
        ))}
      </div>
      <div className="sc-curve" aria-label="Curve">
        {b.curve.map((n, i) => (
          <div key={i} className="sc-col">
            <div className="sc-colbar">
              <span className="sc-target" style={{ bottom: `${Math.min(100, ((b.curveTarget[i] ?? 0) / 9) * 100)}%` }} />
              <span className="sc-have" style={{ height: `${Math.min(100, (n / 9) * 100)}%` }} />
            </div>
            <span className="sc-coln">{n}</span>
            <span className="sc-coll muted">{CURVE_LABELS[i]}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function SwapRow({ name, delta, onPick }: { name: string; delta: number; onPick: () => void }) {
  const info = useCardInfo(name);
  return (
    <button className="swap-row" onClick={onPick}>
      <span className="swap-name">{name}</span>
      <span className="swap-cost">{info?.manaCost && <ManaCost cost={info.manaCost.split(' // ')[0]} size="sm" />}</span>
      <span className={cx('swap-d', delta > 0 ? 'pos' : delta < 0 ? 'neg' : '')}>
        {delta > 0 ? '+' : delta < 0 ? '−' : '±'}
        {Math.abs(delta)}
      </span>
    </button>
  );
}

function SwapSheet({
  ctx,
  pool,
  b,
  out,
  onClose,
  onSwap,
  onInfo,
}: {
  ctx: CubeContext;
  pool: string[];
  b: DeckBuild;
  out: string | null;
  onClose: () => void;
  onSwap: (out: string, inn: string) => void;
  onInfo: (n: string) => void;
}) {
  const opts = useMemo(() => (out ? swapOptions(ctx, pool, b, out) : []), [ctx, pool, b, out]);
  return (
    <Sheet open={out !== null} onClose={onClose} title={out ? `Swap out ${out}` : ''} subtitle="What each card from your pool would do to the deck score" width={520}>
      {out && (
        <>
          <div className="swap-out">
            <CubeCard name={out} colors={ctx.facts.get(out)?.colors} onClick={() => onInfo(out)} />
            <p className="small muted">Value {cardValue(out, ctx)}. Pick a replacement below; the score updates as soon as you do.</p>
          </div>
          <div className="swap-list">
            {opts.map((o) => (
              <SwapRow key={o.name} name={o.name} delta={o.delta} onPick={() => onSwap(out, o.name)} />
            ))}
            {opts.length === 0 && <p className="muted small">Nothing else in your pool is castable in these colours.</p>}
          </div>
        </>
      )}
    </Sheet>
  );
}

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function ExportBox({ b, pool, problems, name }: { b: DeckBuild; pool: string[]; problems: string[]; name: string }) {
  const [copied, setCopied] = useState<string | null>(null);
  const slug = deckSlug(name);
  const copy = async (what: string, text: string) => {
    setCopied((await copyText(text)) ? what : null);
    setTimeout(() => setCopied(null), 1800);
  };
  const cmd = `./scripts/play.sh --engine-only --deck decks/${slug}.dck --mirror`;
  return (
    <div className="card-box ex">
      <div className="box-h">Export</div>
      {problems.length > 0 && <p className="tiny muted">Not a legal 40 yet — exports anyway.</p>}
      <div className="ex-btns">
        <button className="btn btn-quiet" onClick={() => copy('text', deckText(b, pool))}>
          {copied === 'text' ? <IconCheck size={14} /> : <IconCopy size={14} />} Copy list
        </button>
        <button className="btn btn-quiet" onClick={() => copy('dck', dckText(b, pool, name))}>
          {copied === 'dck' ? <IconCheck size={14} /> : <IconCopy size={14} />} Copy .dck
        </button>
        <button className="btn btn-quiet" onClick={() => download(`${slug}.dck`, dckText(b, pool, name))}>
          <IconFile size={14} /> Download .dck
        </button>
      </div>
      <details className="ex-how">
        <summary>
          <IconPlay size={13} /> Play it vs Forge <IconChevronDown size={13} />
        </summary>
        <ol>
          <li>
            Save <code>{slug}.dck</code> into your mtg-table checkout’s <code>decks/</code> folder.
          </li>
          <li>
            Start the engine with it (<code>--mirror</code>: the AI plays a copy; or <code>--ai-deck decks/other.dck</code>):
            <div className="cmd">
              <code>{cmd}</code>
              <button className="icon-btn" aria-label="Copy command" onClick={() => copy('cmd', cmd)}>
                {copied === 'cmd' ? <IconCheck size={15} /> : <IconCopy size={15} />}
              </button>
            </div>
          </li>
          <li>
            Back on the start page, press <b>Play vs Forge</b>. Add a play guide for the deck from the coach’s <i>Play guide</i> menu.
          </li>
        </ol>
      </details>
    </div>
  );
}

function DeckCoach({
  ctx,
  pool,
  b,
  builds,
  format,
  onSettings,
}: {
  ctx: CubeContext;
  pool: SavedPool;
  b: DeckBuild;
  builds: DeckBuild[];
  format: 'grid' | 'winston' | null;
  onSettings: () => void;
}) {
  const [question, setQuestion] = useState('');
  const key = `deck:${pool.id}:${b.key}:${hash(b.spells.join('|') + '#' + question.trim())}`;
  const answer = useAnswer(key);
  const makePrompt = useCallback(async () => {
    const infos = await cardsForPrompt([...new Set(pool.cards)]);
    return buildDeckPrompt({ ctx, pool: pool.cards, build: b, alternatives: builds, infos, format, question });
  }, [ctx, pool.cards, b, builds, format, question]);
  return (
    <div className="dc">
      <textarea
        className="dc-q"
        rows={2}
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
        placeholder="Ask about this deck (optional) — e.g. “Is Archon worth the slot?”"
        aria-label="Question for the coach"
      />
      <AnswerBox
        answer={answer}
        askLabel="Ask the coach"
        idleText="The coach reads your pool, this build, its score and the lab’s numbers, with every card’s text — then explains the deck and suggests swaps. It never changes the deck itself."
        onAsk={() => void startAnswer(key, makePrompt)}
        onStop={() => stopAnswer(key)}
        makePrompt={makePrompt}
        onOpenSettings={onSettings}
      />
    </div>
  );
}

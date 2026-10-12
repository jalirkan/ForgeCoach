/*
 * ForgeCoach — ui/play/DamageBar.tsx
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Divide combat damage (an `assign_damage` ask, mtg-table protocol §5.3,
 * amendment M67 / D424) as a bar above the hand — the endstep study of
 * 2026-10-12, §3: "COMBAT · DIVIDE DAMAGE", the sentence, the attacker's tile
 * with "N left of M", one card per blocker with its lethal pips and a − N +
 * stepper, the defending player's row only when the engine allows it (locked
 * until every blocker has lethal), Reset [R] and Confirm [Space], which is
 * disabled while the split is illegal. Nothing is modal; the board stays in
 * view.
 *
 * Thin on purpose: every number, bound and verdict comes from damageBar.ts
 * (pure, tested in node). The keys are askKeys.ts's planner — Space confirms
 * (only a legal split), R resets; Esc, which hides a question elsewhere, does
 * nothing here because the bar covers nothing.
 *
 * Kept hooks (e2e and the playtest monkey): .damage-bar, [data-answer="confirm"],
 * [data-answer="skip"], [data-dmg="reset"], [data-dmg-target="<index>"],
 * [data-dmg-left], [data-refused], .dmg-step buttons (aria-label "Less to …" / "More to …").
 */
import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import type { AnswerValue, AnyCard, AssignDamageAsk, Card, GameStateBody } from '../../protocol.ts';
import { isHidden, keywordsOf } from '../../protocol.ts';
import { cardIndex } from '../../decisions.ts';
import { CardBack, CardFace } from '../CardTile.tsx';
import { useCardInfo } from '../cardData.ts';
import { IconCheck, IconLock, IconShield } from '../Icons.tsx';
import { cx, typeKind } from '../util.ts';
import { displayAsk, lookupName, refusalLine, skipAction } from './askModel.ts';
import { planAskKey } from './askKeys.ts';
import {
  autoSplit,
  barWords,
  canStep,
  checkSplit,
  answerOf,
  damageBarOf,
  defenderLocked,
  leftOf,
  pipsOf,
  step,
  type Amounts,
  type DamageRow,
} from './damageBar.ts';
import './damage.css';

export interface DamageBarProps {
  ask: AssignDamageAsk;
  /** The latest snapshot — only to name the attacker and read its keywords (the sentence's words). */
  state: GameStateBody | null;
  /** Send exactly one answer for `ask.askId`. */
  onAnswer: (value: AnswerValue) => void;
  onPreviewCard?: (cardId: number) => void;
}

/** A pointer press must not move focus onto a bar button: Space would then press it instead of confirming. */
const keepFocus = (e: ReactMouseEvent) => e.preventDefault();

export function DamageBar(props: DamageBarProps) {
  // Every label in the player's words: no engine card ids (askModel.ts `displayAsk`), as the dialog draws them.
  const ask = useMemo(() => displayAsk(props.ask), [props.ask]);
  // A re-ask is a new askId: a fresh split from the engine's numbers, never the refused one.
  return <DamageBarInner key={props.ask.askId} {...props} ask={ask} />;
}

function DamageBarInner({ ask, state, onAnswer, onPreviewCard }: DamageBarProps) {
  const model = useMemo(() => damageBarOf(ask), [ask]);
  const [amounts, setAmounts] = useState<Amounts>(() => autoSplit(model));
  const [sent, setSent] = useState(false);
  const sentRef = useRef(false);

  const atk = useMemo(() => {
    if (ask.attackerId === null || !state) return null;
    const c = cardIndex(state).get(ask.attackerId);
    return c && !isHidden(c) ? (c as Card) : null;
  }, [ask.attackerId, state]);
  const attackerName = atk?.name || null;
  const words = barWords(model, attackerName, keywordsOf(atk ?? undefined).includes('TRAMPLE'));

  const check = checkSplit(model, amounts);
  const left = leftOf(model, amounts);
  const locked = defenderLocked(model, amounts);
  const skip = skipAction(ask);
  const refused = refusalLine(ask);

  const send = (value: AnswerValue) => {
    if (sentRef.current) return;
    sentRef.current = true;
    setSent(true);
    onAnswer(value);
  };
  const confirm = () => {
    const a = answerOf(model, amounts);
    if (a) send(a);
  };
  const reset = () => setAmounts(autoSplit(model));
  const move = (index: number, delta: 1 | -1) => setAmounts((cur) => step(model, cur, index, delta));

  // The keys, through the question's planner (askKeys.ts): Space confirms a legal split, R resets.
  const live = useRef({ confirm, reset, canConfirm: check.ok && !sent });
  live.current = { confirm, reset, canConfirm: check.ok && !sent };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const l = live.current;
      const plan = planAskKey(
        {
          key: e.key,
          code: e.code,
          ctrlKey: e.ctrlKey,
          metaKey: e.metaKey,
          altKey: e.altKey,
          isComposing: e.isComposing,
          repeat: e.repeat,
          targetTag: t?.tagName,
          targetEditable: t?.isContentEditable,
          inSheet: !!t?.closest?.('.sheet'),
        },
        { placement: 'slot', minimized: false, canConfirm: l.canConfirm, digits: 0, escSkips: false, resets: true },
      );
      // Esc hides a question that covers the board; the bar covers nothing, so it is left alone.
      if (!plan || plan.kind === 'hide') return;
      e.preventDefault();
      e.stopPropagation();
      if (plan.kind === 'confirm') l.confirm();
      else if (plan.kind === 'reset') l.reset();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  return (
    <section className="damage-bar" role="dialog" aria-label="Divide combat damage" data-ask-id={ask.askId}>
      <div className="dmg-head">
        <div className="dmg-words">
          <div className="dmg-eyebrow">Combat · Divide damage</div>
          <p className="dmg-sentence">
            {words.sentence}
            {refused !== null && (
              <>
                {' '}
                {/* The engine refused the last split and asked again: the same one line every question shows (askModel `refusalLine`, M67/M68). */}
                <span className="dmg-refused" role="alert" data-refused="">
                  {refused}
                </span>
              </>
            )}
          </p>
          {words.rule && <p className="dmg-rule">{words.rule}</p>}
        </div>
        <div className="dmg-actions">
          {skip && (
            <button type="button" className="dmg-btn dmg-auto" data-answer="skip" disabled={sent} title={skip.title} onMouseDown={keepFocus} onClick={() => send(skip.value)}>
              Auto
            </button>
          )}
          <button type="button" className="dmg-btn dmg-reset" data-dmg="reset" disabled={sent} title="Back to the engine’s split (R)" onMouseDown={keepFocus} onClick={reset}>
            Reset
            <kbd className="dmg-kbd" aria-hidden="true">
              R
            </kbd>
          </button>
          <button
            type="button"
            className="dmg-btn dmg-confirm"
            data-answer="confirm"
            disabled={!check.ok || sent}
            title={check.ok ? 'Assign this damage (Space)' : (check.why ?? '')}
            onMouseDown={keepFocus}
            onClick={confirm}
          >
            Confirm
            <kbd className="dmg-kbd" aria-hidden="true">
              Space
            </kbd>
          </button>
        </div>
      </div>
      <div className="dmg-row">
        <AttackerTile name={attackerName} total={model.total} left={left} />
        {model.blockers.map((row) => (
          <BlockerCard key={row.index} row={row} amounts={amounts} model={model} sent={sent} onMove={move} onPreview={onPreviewCard} />
        ))}
        {model.defender && (
          <DefenderCard row={model.defender} n={amounts[String(model.defender.index)] ?? 0} locked={locked} model={model} amounts={amounts} sent={sent} onMove={move} />
        )}
        {!check.ok && check.why && (
          <p className="dmg-why" aria-live="polite">
            {check.why}
          </p>
        )}
      </div>
    </section>
  );
}

/** The attacker: its name, a pip per point of damage (the unassigned ones lit red), "N left of M". */
function AttackerTile({ name, total, left }: { name: string | null; total: number; left: number }) {
  return (
    <div className={cx('dmg-attacker', left === 0 ? 'is-done' : 'is-left')} data-dmg-left={left}>
      <span className="dmg-attacker-name" title={name ?? undefined}>
        {name ?? 'Attacker'}
      </span>
      {total > 0 && total <= 12 && (
        <span className="dmg-pips dmg-attacker-pips" aria-hidden="true">
          {Array.from({ length: total }, (_, i) => (
            <span key={i} className={cx('dmg-pip', i < left && 'is-short')} />
          ))}
        </span>
      )}
      <span className="dmg-left">
        <b>{left}</b> left
      </span>
      <span className="dmg-of">of {total}</span>
    </div>
  );
}

function BlockerCard({
  row,
  amounts,
  model,
  sent,
  onMove,
  onPreview,
}: {
  row: DamageRow;
  amounts: Amounts;
  model: ReturnType<typeof damageBarOf>;
  sent: boolean;
  onMove: (index: number, delta: 1 | -1) => void;
  onPreview?: (cardId: number) => void;
}) {
  const n = amounts[String(row.index)] ?? 0;
  const pips = pipsOf(row, amounts);
  const met = pips?.state === 'met';
  return (
    <div className={cx('dmg-target', pips && (met ? 'is-met' : 'is-short'))} data-dmg-target={row.index} data-lethal={row.lethal ?? undefined}>
      {met && (
        <span className="dmg-check" aria-label="lethal">
          <IconCheck size={12} />
        </span>
      )}
      <Face card={row.option.card} label={row.label} cardId={row.option.cardId} onPreview={onPreview} />
      <span className="dmg-name" title={row.label}>
        {row.label}
      </span>
      <span className="dmg-pips" aria-label={pips ? `lethal ${pips.lethal}` : undefined}>
        {pips &&
          Array.from({ length: Math.min(pips.lethal, 12) }, (_, i) => <span key={i} className={cx('dmg-pip', i < pips.filled ? (met ? 'is-met' : 'is-short') : null)} />)}
        {pips && pips.over > 0 && <span className="dmg-over">+{pips.over}</span>}
      </span>
      <Stepper label={row.label} n={n} less={!sent && canStep(model, amounts, row.index, -1)} more={!sent && canStep(model, amounts, row.index, 1)} onMove={(d) => onMove(row.index, d)} />
    </div>
  );
}

function DefenderCard({
  row,
  n,
  locked,
  model,
  amounts,
  sent,
  onMove,
}: {
  row: DamageRow;
  n: number;
  locked: boolean;
  model: ReturnType<typeof damageBarOf>;
  amounts: Amounts;
  sent: boolean;
  onMove: (index: number, delta: 1 | -1) => void;
}) {
  return (
    <div
      className={cx('dmg-target dmg-defender', locked && 'is-locked')}
      data-dmg-target={row.index}
      data-defender=""
      data-locked={locked ? '' : undefined}
      title={locked ? 'Locked until every blocker has lethal damage' : 'The damage that spills over to the defending player'}
    >
      <span className="dmg-shield" aria-hidden="true">
        <IconShield size={40} />
        {locked && <IconLock size={16} className="dmg-lock" />}
      </span>
      <span className="dmg-name" title={row.label}>
        {row.label}
      </span>
      <span className="dmg-sub">{locked ? 'locked' : 'spillover'}</span>
      <Stepper label={row.label} n={locked ? 0 : n} less={!sent && canStep(model, amounts, row.index, -1)} more={!sent && canStep(model, amounts, row.index, 1)} onMove={(d) => onMove(row.index, d)} />
    </div>
  );
}

function Stepper({ label, n, less, more, onMove }: { label: string; n: number; less: boolean; more: boolean; onMove: (d: 1 | -1) => void }) {
  return (
    <span className="dmg-step" role="group" aria-label={`Damage to ${label}`}>
      <button type="button" disabled={!less} onMouseDown={keepFocus} onClick={() => onMove(-1)} aria-label={`Less to ${label}`}>
        −
      </button>
      <output className="dmg-n" aria-live="polite">
        {n}
      </output>
      <button type="button" disabled={!more} onMouseDown={keepFocus} onClick={() => onMove(1)} aria-label={`More to ${label}`}>
        +
      </button>
    </span>
  );
}

/** A blocker's card: the board's own face, a back for a concealed one; a click opens its details. */
function Face({ card, label, cardId, onPreview }: { card: AnyCard | undefined; label: string; cardId: number | undefined; onPreview?: (id: number) => void }) {
  const hidden = label === '???' || (!!card && isHidden(card));
  const visible = card && !hidden ? (card as Card) : null;
  const info = useCardInfo(visible ? lookupName({ id: 0, label, kind: 'card', card: visible }) : null);
  const face = hidden ? (
    <CardBack />
  ) : visible ? (
    <CardFace card={visible} info={info} kind={typeKind(visible.types || info?.typeLine)} />
  ) : (
    <span className="dmg-face-text">{label}</span>
  );
  if (cardId === undefined || !onPreview || hidden) return <span className="dmg-face">{face}</span>;
  return (
    <button type="button" className="dmg-face is-previewable" onMouseDown={keepFocus} onClick={() => onPreview(cardId)} title={`View ${label}`} aria-label={`View ${label}`}>
      {face}
    </button>
  );
}

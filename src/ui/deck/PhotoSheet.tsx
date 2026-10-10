/*
 * ForgeCoach — ui/deck/PhotoSheet.tsx
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Add from photo: take or choose photos of the cards you drafted, have them
 * read (Claude Code on your PC through mtg-table's coach helper, or your API
 * key — `startAnswer` picks, as for the coach), then review a checklist.
 * Nothing enters the pool until the player confirms; a card seen in two
 * photos, or counted twice, asks before it counts twice. The photos live in
 * this sheet's memory only and are dropped when it closes.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { CubeContext } from '../../cube/score.ts';
import type { SavedPool } from '../../cube/pools.ts';
import {
  MAX_PHOTOS,
  PhotoAnswerError,
  SURE,
  buildReview,
  copyChoices,
  dropUnmatched,
  parseRecognition,
  photoPrompt,
  planAdd,
  renameRow,
  resolveUnmatched,
  rowConfidence,
  rowPhotos,
  rowQuestion,
  rowSeen,
  updateRow,
  type ReviewContext,
  type ReviewModel,
  type ReviewRow,
} from '../../cube/photoPool.ts';
import { loadSettings, onSettingsChange } from '../../claude.ts';
import { chooseSource, detectHelper, onHelperStatus, peekHelper, type ActiveSource } from '../../coachHelper.ts';
import { startAnswer, stopAnswer, useAnswer } from '../answers.ts';
import { Sheet } from '../Sheet.tsx';
import { IconCamera, IconPlus, IconTrash, IconUpload, IconX } from '../Icons.tsx';
import { cx } from '../util.ts';
import { CardPicker } from './sheets.tsx';
import { preparePhoto, releasePhoto, type PreparedPhoto } from './photoImage.ts';

type Stage = 'pick' | 'reading' | 'review';
type Picking = { kind: 'row'; id: string; name: string } | { kind: 'unmatched'; id: string; text: string } | null;

function useVisionSource(open: boolean): { source: ActiveSource | null; checking: boolean } {
  const [, bump] = useState(0);
  const [checking, setChecking] = useState(false);
  useEffect(() => {
    if (!open) return;
    const offH = onHelperStatus(() => bump((n) => n + 1));
    const offS = onSettingsChange(() => bump((n) => n + 1));
    setChecking(true);
    void detectHelper().finally(() => setChecking(false));
    return () => {
      offH();
      offS();
    };
  }, [open]);
  const s = loadSettings();
  return { source: chooseSource(s, peekHelper(), 'vision'), checking };
}

const pct = (x: number) => `${Math.round(x * 100)}%`;
const kb = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`);
const photoList = (ps: number[]) => (ps.length <= 1 ? `photo ${ps[0] ?? '?'}` : `photos ${ps.slice(0, -1).join(', ')} and ${ps[ps.length - 1]}`);

export function PhotoSheet({ open, onClose, ctx, pool, onChange }: { open: boolean; onClose: () => void; ctx: CubeContext; pool: SavedPool; onChange: (p: SavedPool) => void }) {
  const [photos, setPhotos] = useState<PreparedPhoto[]>([]);
  const [busy, setBusy] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [stage, setStage] = useState<Stage>('pick');
  const [target, setTarget] = useState<'mine' | 'opp'>('mine');
  const [model, setModel] = useState<ReviewModel | null>(null);
  const [picking, setPicking] = useState<Picking>(null);
  const [run, setRun] = useState(0);
  const camera = useRef<HTMLInputElement>(null);
  const chooser = useRef<HTMLInputElement>(null);
  const key = `photo-pool:${pool.id}`;
  const answer = useAnswer(stage === 'reading' || stage === 'review' ? key : null);
  const { source, checking } = useVisionSource(open);
  const cubeNames = useMemo(() => ctx.cube.cards.map((c) => c.name), [ctx]);
  const rctx: ReviewContext = useMemo(
    () => ({ pool: target === 'mine' ? pool.cards : pool.opp, other: target === 'mine' ? pool.opp : pool.cards, cubeNames }),
    [target, pool.cards, pool.opp, cubeNames],
  );

  // Photos live only as long as the sheet: drop them (and any read in flight) when it closes.
  const photosRef = useRef(photos);
  photosRef.current = photos;
  const reset = () => {
    stopAnswer(key);
    photosRef.current.forEach(releasePhoto);
    setPhotos([]);
    setModel(null);
    setStage('pick');
    setErr(null);
    setPicking(null);
  };
  useEffect(() => () => photosRef.current.forEach(releasePhoto), []);
  const closeRef = useRef<() => void>(() => {});
  closeRef.current = () => {
    reset();
    onClose();
  };
  // Stable, so the sheet does not re-run its open effect (focus) on every render.
  const [close] = useState(() => () => closeRef.current());

  const addFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setErr(null);
    const room = MAX_PHOTOS - photos.length;
    const list = [...files].slice(0, Math.max(0, room));
    if (files.length > room) setErr(`At most ${MAX_PHOTOS} photos at a time.`);
    setBusy((n) => n + list.length);
    for (const f of list) {
      try {
        const p = await preparePhoto(f);
        setPhotos((ps) => [...ps, p]);
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy((n) => n - 1);
      }
    }
  };

  const read = () => {
    if (!photos.length) return;
    setErr(null);
    setModel(null);
    setStage('reading');
    setRun((n) => n + 1);
    const images = photos.map((p) => p.image);
    void startAnswer(key, async () => ({ ...photoPrompt(ctx.cube.title, cubeNames, images.length), images }), { need: 'vision' });
  };

  // The answer is in: parse, validate against the cube, build the checklist.
  useEffect(() => {
    if (stage !== 'reading' || !answer) return;
    if (answer.status === 'error') {
      setErr(answer.error ?? 'The photos couldn’t be read.');
      setStage('pick');
    } else if (answer.status === 'stopped') {
      setStage('pick');
    } else if (answer.status === 'done') {
      if (answer.refused) {
        setErr('Claude declined to read these photos. Try other photos, or enter the cards by tapping them.');
        setStage('pick');
        return;
      }
      try {
        const parsed = parseRecognition(answer.text, photos.length);
        setModel(buildReview(parsed, cubeNames, rctx.pool, rctx.other));
        setStage('review');
      } catch (e) {
        setErr(e instanceof PhotoAnswerError ? e.message : `The answer couldn’t be read: ${e instanceof Error ? e.message : String(e)}`);
        setStage('pick');
      }
    }
    // `run` re-arms this for a second read; the photos and rctx are read once, when the answer lands.
  }, [answer?.status, stage, run]);

  const plan = useMemo(() => (model ? planAdd(model.rows) : null), [model]);
  const confirm = () => {
    if (!plan || plan.open.length || !plan.add.length) return;
    const k = target === 'mine' ? 'cards' : 'opp';
    onChange({ ...pool, [k]: [...pool[k], ...plan.add], updatedAt: Date.now() });
    close();
  };

  const sourceLine =
    source === 'helper'
      ? 'Read by Claude Code on your PC.'
      : source === 'apiKey'
        ? 'Read by Claude with your API key (sent straight to api.anthropic.com).'
        : checking
          ? 'Looking for Claude Code on your PC…'
          : 'Nothing can read photos yet: start ForgeCoach on your PC with Claude Code logged in, or add an API key in Settings.';

  const footer =
    stage === 'review' && model && plan ? (
      <>
        <span className="muted small grow">
          {plan.open.length > 0
            ? `${plan.open.length} question${plan.open.length === 1 ? '' : 's'} to answer first`
            : `${plan.add.length} card${plan.add.length === 1 ? '' : 's'} to add to ${target === 'mine' ? 'your pool' : 'their picks'}`}
        </span>
        <button className="btn btn-quiet" onClick={() => setStage('pick')}>
          Back
        </button>
        <button className="btn btn-primary" disabled={plan.open.length > 0 || plan.add.length === 0} onClick={confirm}>
          Add {plan.add.length}
        </button>
      </>
    ) : stage === 'reading' ? (
      <>
        <span className="muted small grow" />
        <button className="btn btn-quiet" onClick={() => stopAnswer(key)}>
          Stop
        </button>
      </>
    ) : (
      <>
        <span className="muted small grow">
          {photos.length} photo{photos.length === 1 ? '' : 's'}
          {photos.length ? ` · ${kb(photos.reduce((n, p) => n + p.bytes, 0))}` : ''}
        </span>
        <button className="btn btn-primary" disabled={!photos.length || busy > 0 || (!source && !checking)} onClick={read}>
          Read {photos.length > 1 ? `${photos.length} photos` : 'photo'}
        </button>
      </>
    );

  return (
    <>
      <Sheet
        open={open && picking === null}
        onClose={close}
        title="Add from photo"
        subtitle={stage === 'review' ? 'Check what was read. Nothing is added until you confirm.' : 'Photograph the cards you drafted, spread out with their names showing.'}
        width={640}
        className="photo-sheet"
        footer={footer}
      >
        {stage === 'pick' && (
          <div className="ph-pick">
            <div className="paste-opts">
              <div className="seg">
                <button className={cx(target === 'mine' && 'is-on')} onClick={() => setTarget('mine')}>
                  My pool
                </button>
                <button className={cx(target === 'opp' && 'is-on')} onClick={() => setTarget('opp')}>
                  Their picks
                </button>
              </div>
            </div>
            <div className="ph-add">
              <button className="ph-add-btn" onClick={() => camera.current?.click()} disabled={photos.length >= MAX_PHOTOS}>
                <IconCamera size={22} />
                <span>Take photo</span>
              </button>
              <button className="ph-add-btn" onClick={() => chooser.current?.click()} disabled={photos.length >= MAX_PHOTOS}>
                <IconUpload size={22} />
                <span>Choose photos</span>
              </button>
              <input
                ref={camera}
                type="file"
                accept="image/*"
                capture="environment"
                hidden
                onChange={(e) => {
                  void addFiles(e.target.files);
                  e.target.value = '';
                }}
              />
              <input
                ref={chooser}
                type="file"
                accept="image/*"
                multiple
                hidden
                onChange={(e) => {
                  void addFiles(e.target.files);
                  e.target.value = '';
                }}
              />
            </div>
            {(photos.length > 0 || busy > 0) && (
              <div className="ph-thumbs" aria-label="Photos to read">
                {photos.map((p, i) => (
                  <figure key={p.id} className="ph-thumb">
                    <img src={p.previewUrl} alt={`Photo ${i + 1}`} />
                    <figcaption>
                      <b>{i + 1}</b> <span className="muted tiny">{kb(p.bytes)}</span>
                    </figcaption>
                    <button
                      className="icon-btn ph-thumb-x"
                      aria-label={`Remove photo ${i + 1}`}
                      onClick={() => {
                        releasePhoto(p);
                        setPhotos((ps) => ps.filter((x) => x.id !== p.id));
                      }}
                    >
                      <IconX size={14} />
                    </button>
                  </figure>
                ))}
                {Array.from({ length: busy }, (_, i) => (
                  <div key={`b${i}`} className="ph-thumb ph-thumb-busy" aria-label="Shrinking a photo" />
                ))}
              </div>
            )}
            {err && <p className="ph-err small">{err}</p>}
            <ul className="ph-tips tiny muted">
              <li>Up to about 20 cards a photo, names readable; several photos are fine (up to {MAX_PHOTOS}).</li>
              <li>A card in two photos is asked about, never counted twice.</li>
            </ul>
            <p className="ph-privacy tiny">
              <b>Privacy.</b> {sourceLine} Photos are shrunk to 1568 px in this browser first and go nowhere else. They are kept only while this sheet is open; only the
              cards you confirm are saved, with the pool, in this browser.
            </p>
          </div>
        )}

        {stage === 'reading' && (
          <div className="ph-reading" role="status">
            <div className="ph-thumbs ph-thumbs-sm">
              {photos.map((p, i) => (
                <figure key={p.id} className="ph-thumb">
                  <img src={p.previewUrl} alt={`Photo ${i + 1}`} />
                </figure>
              ))}
            </div>
            <p className="ph-reading-line">
              <span className="ph-spin" aria-hidden="true" />
              {answer?.status === 'queued'
                ? `Waiting for Claude Code: ${answer.queuePosition ?? 1} question${(answer.queuePosition ?? 1) === 1 ? '' : 's'} ahead.`
                : answer?.text
                  ? `Reading… ${(answer.text.match(/"name"/g) ?? []).length} cards so far`
                  : answer?.source === 'helper'
                    ? 'Claude Code on your PC is looking at the photos…'
                    : 'Claude is looking at the photos…'}
            </p>
            <p className="tiny muted">{sourceLine}</p>
          </div>
        )}

        {stage === 'review' && model && (
          <Review
            model={model}
            target={target}
            onRow={(id, patch) => setModel((m) => (m ? updateRow(m, id, patch) : m))}
            onFix={(r) => setPicking({ kind: 'row', id: r.id, name: r.name })}
            onPickUnmatched={(id, text) => setPicking({ kind: 'unmatched', id, text })}
            onResolve={(id, name) => setModel((m) => (m ? resolveUnmatched(m, id, name, rctx) : m))}
            onDrop={(id) => setModel((m) => (m ? dropUnmatched(m, id) : m))}
            via={answer?.source ?? null}
          />
        )}
      </Sheet>
      <CardPicker
        open={open && picking !== null}
        title={picking?.kind === 'row' ? `Which card is it? (read as ${picking.name})` : picking ? `Which card is it?${picking.text ? ` (“${picking.text}”)` : ''}` : ''}
        ctx={ctx}
        exclude={new Set()}
        pool={pool.cards}
        onClose={() => setPicking(null)}
        onPick={(name) => {
          if (picking?.kind === 'row') setModel((m) => (m ? renameRow(m, picking.id, name, rctx) : m));
          else if (picking?.kind === 'unmatched') setModel((m) => (m ? resolveUnmatched(m, picking.id, name, rctx) : m));
          setPicking(null);
        }}
      />
    </>
  );
}

function Review({
  model,
  target,
  onRow,
  onFix,
  onPickUnmatched,
  onResolve,
  onDrop,
  via,
}: {
  model: ReviewModel;
  target: 'mine' | 'opp';
  onRow: (id: string, patch: Partial<Pick<ReviewRow, 'include' | 'copies'>>) => void;
  onFix: (r: ReviewRow) => void;
  onPickUnmatched: (id: string, text: string) => void;
  onResolve: (id: string, name: string) => void;
  onDrop: (id: string) => void;
  via: ActiveSource | null;
}) {
  const ticked = model.rows.filter((r) => r.include).length;
  const where = target === 'mine' ? 'your pool' : 'their picks';
  const other = target === 'mine' ? 'their picks' : 'your pool';
  return (
    <div className="ph-review">
      <div className="ph-review-head small">
        <b>{model.rows.length}</b> card{model.rows.length === 1 ? '' : 's'} recognised · {ticked} ticked
        {model.unmatched.length > 0 && (
          <>
            {' '}
            · <b>{model.unmatched.length}</b> to name
          </>
        )}
        {model.basics > 0 && <span className="muted"> · {model.basics} basic lands ignored</span>}
        {via && <span className="muted"> · read {via === 'helper' ? 'by Claude Code on your PC' : 'with your API key'}</span>}
      </div>

      {model.unmatched.length > 0 && (
        <section className="ph-unmatched" aria-label="Cards to name">
          <h3 className="ph-h">Not recognised — name them, or skip</h3>
          {model.unmatched.map((u) => (
            <div key={u.id} className="ph-un">
              <div className="ph-un-text">
                <span>{u.text ? `“${u.text}”` : 'A card'}</span>
                <span className="muted tiny">
                  {u.photo > 0 ? `photo ${u.photo}` : ''}
                  {u.note ? `${u.photo > 0 ? ' · ' : ''}${u.note}` : ''}
                </span>
              </div>
              <div className="ph-un-acts">
                {u.suggestions.map((s) => (
                  <button key={s} className="fchip" onClick={() => onResolve(u.id, s)} title={`It is ${s}`}>
                    <IconPlus size={12} /> {s}
                  </button>
                ))}
                <button className="btn btn-quiet btn-sm" onClick={() => onPickUnmatched(u.id, u.text)}>
                  Pick card…
                </button>
                <button className="icon-btn" onClick={() => onDrop(u.id)} aria-label="Skip it">
                  <IconTrash size={14} />
                </button>
              </div>
            </div>
          ))}
        </section>
      )}

      <section aria-label="Recognised cards">
        {model.rows.length === 0 && <p className="muted small">No cube card was recognised in the photos.</p>}
        <ul className="ph-rows">
          {model.rows.map((r) => {
            const q = rowQuestion(r);
            const conf = rowConfidence(r);
            const ps = rowPhotos(r);
            const readAs = [...new Set(r.sightings.map((s) => s.readAs).filter((x): x is string => !!x))];
            const notes = [...new Set(r.sightings.map((s) => s.note).filter(Boolean))];
            const byHand = r.sightings.some((s) => s.byHand);
            return (
              <li key={r.id} className={cx('ph-row', !r.include && 'is-off', q && r.copies === null && r.include && 'is-asking')}>
                <label className="ph-row-main">
                  <input type="checkbox" checked={r.include} onChange={(e) => onRow(r.id, { include: e.target.checked })} />
                  <span className="ph-row-name">{r.name}</span>
                  <span className={cx('ph-conf', byHand ? 'is-hand' : conf >= 0.85 ? 'is-high' : conf >= SURE ? 'is-mid' : 'is-low')} title="How sure the reader was">
                    {byHand ? 'you' : pct(conf)}
                  </span>
                </label>
                <div className="ph-row-meta tiny muted">
                  {ps.length > 0 && <span>{photoList(ps)}</span>}
                  {readAs.length > 0 && <span className="ph-flag">read as “{readAs.join('”, “')}”</span>}
                  {conf < SURE && !byHand && <span className="ph-flag">unsure</span>}
                  {r.inPool > 0 && <span className="ph-flag">already in {where}</span>}
                  {r.inOther > 0 && <span className="ph-flag">marked as {other}</span>}
                  {notes.length > 0 && <span>{notes.join(' · ')}</span>}
                  <button className="ph-fix" onClick={() => onFix(r)}>
                    Not this card?
                  </button>
                </div>
                {q && (
                  <div className="ph-q">
                    <span className="small">
                      {q === 'photos'
                        ? `Seen in ${photoList(ps)}. The same card, or ${rowSeen(r) === 2 ? 'two copies' : 'more copies'}?`
                        : `${rowSeen(r)} copies counted in ${photoList(ps)}${r.inCube === 1 ? ' (the cube has one)' : ` (the cube has ${r.inCube})`}. How many are there?`}
                    </span>
                    <div className="seg seg-sm" role="radiogroup" aria-label={`Copies of ${r.name}`}>
                      {copyChoices(r).map((n) => (
                        <button key={n} role="radio" aria-checked={r.copies === n} className={cx(r.copies === n && 'is-on')} onClick={() => onRow(r.id, { copies: n, include: true })}>
                          {n === 1 ? (q === 'photos' ? 'Same card' : '1 copy') : `${n} copies`}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </section>
      {model.problems.length > 0 && <p className="tiny muted">Notes on the answer: {model.problems.join(' ')}</p>}
    </div>
  );
}

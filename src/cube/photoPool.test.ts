// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import {
  addSighting,
  buildReview,
  copyChoices,
  editDistance,
  extractJson,
  matchName,
  nameIndex,
  parseRecognition,
  photoPrompt,
  planAdd,
  renameRow,
  resolveUnmatched,
  rowConfidence,
  rowPhotos,
  rowQuestion,
  updateRow,
  PhotoAnswerError,
  type ParsedRecognition,
  type ReviewModel,
} from './photoPool.ts';
import { loadCube } from './testdata/load.ts';

const vintage = loadCube('vintage');
const NAMES = vintage.cards.map((c) => c.name);
const index = nameIndex(NAMES);

const parsed = (cards: ParsedRecognition['cards'], unrecognised: ParsedRecognition['unrecognised'] = []): ParsedRecognition => ({ cards, unrecognised, problems: [] });
const seen = (name: string, photo = 1, confidence = 0.95, count = 1) => ({ name, photo, count, confidence, note: '' });

describe('photoPrompt', () => {
  it('sends every cube name once, asks for strict JSON and names the photos', () => {
    const p = photoPrompt(vintage.title, NAMES, 2);
    expect(vintage.cards).toHaveLength(180);
    for (const n of NAMES) expect(p.user.split('\n')).toContain(n);
    expect(p.user).toContain('The cube\'s cards (180):');
    expect(p.user).toContain('"unrecognised"');
    expect(p.user).toMatch(/numbered 1 to 2/);
    expect(p.user).toMatch(/listed once for each photo; do not merge/);
    expect(p.system).toMatch(/JSON object and nothing else/);
    expect(photoPrompt('X', ['A', 'A', 'B'], 1).user).toMatch(/The photo shows[\s\S]*\(2\):\nA\nB$/);
  });
});

describe('parseRecognition', () => {
  it('reads the asked-for shape', () => {
    const r = parseRecognition(
      JSON.stringify({ cards: [{ name: 'Ponder', photo: 1, count: 1, confidence: 0.9, note: '' }], unrecognised: [{ photo: 2, note: 'face down', guess: '' }] }),
      2,
    );
    expect(r).toEqual({ cards: [seen('Ponder', 1, 0.9)], unrecognised: [{ photo: 2, note: 'face down', guess: '' }], problems: [] });
  });

  it('finds the JSON inside a code fence or prose', () => {
    const text = 'Here you go:\n```json\n{"cards":[{"name":"Brainstorm","photo":1,"count":1,"confidence":1,"note":"a {brace} in a note"}],"unrecognised":[]}\n```\nDone.';
    expect(parseRecognition(text, 1).cards).toEqual([{ ...seen('Brainstorm', 1, 1), note: 'a {brace} in a note' }]);
    expect(extractJson('no json [here or {there')).toBeNull();
    expect(extractJson('first {bad json} then {"ok":1}')).toBe('{"ok":1}');
  });

  it('throws plain words when there is no JSON at all', () => {
    expect(() => parseRecognition('I see some cards.', 1)).toThrow(PhotoAnswerError);
  });

  it('repairs what it can: a bare array, percentages, strings, missing photos and silly counts', () => {
    const r = parseRecognition(JSON.stringify([{ name: 'Ponder', confidence: 85, count: '2' }, 'Preordain', { name: '' }, { name: 'Opt', count: 0 }, { name: 'Balance', count: 12, photo: 9 }]), 1);
    expect(r.cards).toEqual([
      { name: 'Ponder', photo: 1, count: 2, confidence: 0.85, note: '' },
      { name: 'Preordain', photo: 1, count: 1, confidence: 0.5, note: '' },
      { name: 'Balance', photo: 0, count: 4, confidence: 0.5, note: '' },
    ]);
    expect(r.problems.join(' ')).toMatch(/no name/);
    expect(r.problems.join(' ')).toMatch(/Balance.*4 at most/);
    expect(r.problems.join(' ')).toMatch(/no photo/);
  });

  it('takes "unrecognized" spelt the American way, and string entries', () => {
    const r = parseRecognition('{"cards":[],"unrecognized":["a blurry red card",{"photo":1,"description":"sleeved","name":"Fury"}]}', 1);
    expect(r.unrecognised).toEqual([
      { photo: 1, note: 'a blurry red card', guess: '' },
      { photo: 1, note: 'sleeved', guess: 'Fury' },
    ]);
  });
});

describe('matchName (cube-constrained)', () => {
  it('matches the exact name whatever the case, quotes, accents or punctuation', () => {
    expect(matchName('jace, vryn’s prodigy', index)).toMatchObject({ name: "Jace, Vryn's Prodigy", how: 'exact' });
    expect(matchName('Jace Vryns Prodigy', index)).toMatchObject({ name: "Jace, Vryn's Prodigy", how: 'exact' });
    expect(matchName('1x Swords to Plowshares (2XM)', index)).toMatchObject({ name: 'Swords to Plowshares', how: 'exact' });
  });

  it('matches a face of a two-faced card', () => {
    const idx = nameIndex(['Fable of the Mirror-Breaker // Reflection of Kiki-Jiki', 'Opt']);
    expect(matchName('Reflection of Kiki-Jiki', idx)).toMatchObject({ name: 'Fable of the Mirror-Breaker // Reflection of Kiki-Jiki', how: 'exact' });
    expect(matchName('Fable of the Mirror Breaker', idx)).toMatchObject({ name: 'Fable of the Mirror-Breaker // Reflection of Kiki-Jiki', how: 'exact' });
  });

  it('takes a near miss (an OCR slip) as fuzzy, with its score', () => {
    const m = matchName('Swords to Plowshare', index);
    expect(m).toMatchObject({ name: 'Swords to Plowshares', how: 'fuzzy' });
    expect(m.score).toBeGreaterThan(0.9);
    expect(matchName('Thalia, Guardian of Thrabin', index)).toMatchObject({ name: 'Thalia, Guardian of Thraben', how: 'fuzzy' });
    expect(matchName('Brainstrom', index)).toMatchObject({ name: 'Brainstorm', how: 'fuzzy' });
  });

  it('never invents a card outside the cube, and offers the closest instead', () => {
    const m = matchName('Grizzly Bears', index);
    expect(m.name).toBeNull();
    expect(matchName('Black Lotus', nameIndex(['Black Lotus'])).name).toBe('Black Lotus');
    expect(matchName('Jace', index)).toMatchObject({ name: null });
  });

  it('refuses an ambiguous near miss between two cube cards', () => {
    const idx = nameIndex(['Mox Pearl', 'Mox Jet', 'Mox Ruby']);
    expect(matchName('Mox Jat', idx)).toMatchObject({ name: 'Mox Jet', how: 'fuzzy' });
    const amb = nameIndex(['Abcdefgh X', 'Abcdefgh Y']);
    const m = matchName('Abcdefgh Z', amb);
    expect(m.name).toBeNull();
    expect(m.suggestions).toEqual(['Abcdefgh X', 'Abcdefgh Y']);
  });

  it('edit distance counts a swap as one', () => {
    expect(editDistance('brainstorm', 'brainstrom')).toBe(1);
    expect(editDistance('', 'abc')).toBe(3);
    expect(editDistance('kitten', 'sitting')).toBe(3);
  });
});

describe('buildReview and planAdd: dedupe, questions, the pool', () => {
  it('groups by card, ticks the sure ones, and adds them once each', () => {
    const m = buildReview(parsed([seen('Ponder'), seen('Brainstorm', 1, 0.3), seen('Plains'), seen('Forest', 1, 0.9, 2)]), NAMES, []);
    expect(m.rows.map((r) => [r.name, r.include])).toEqual([
      ['Brainstorm', false],
      ['Ponder', true],
    ]);
    expect(m.basics).toBe(3);
    expect(planAdd(m.rows)).toEqual({ add: ['Ponder'], open: [], already: [] });
  });

  it('a card seen in two photos asks, and is never counted twice silently', () => {
    const m = buildReview(parsed([seen('Ponder', 1), seen('Ponder', 2)]), NAMES, []);
    expect(m.rows).toHaveLength(1);
    const row = m.rows[0]!;
    expect(rowPhotos(row)).toEqual([1, 2]);
    expect(rowQuestion(row)).toBe('photos');
    expect(row.copies).toBeNull();
    expect(copyChoices(row)).toEqual([1, 2]);
    const plan = planAdd(m.rows);
    expect(plan.add).toEqual([]);
    expect(plan.open.map((r) => r.name)).toEqual(['Ponder']);
    // The player says: the same card.
    expect(planAdd(updateRow(m, row.id, { copies: 1 }).rows).add).toEqual(['Ponder']);
    // Or two copies.
    expect(planAdd(updateRow(m, row.id, { copies: 2 }).rows).add).toEqual(['Ponder', 'Ponder']);
  });

  it('two copies counted in one photo asks too', () => {
    const m = buildReview(parsed([seen('Counterspell', 1, 0.9, 2)]), NAMES, []);
    expect(rowQuestion(m.rows[0]!)).toBe('copies');
    expect(m.rows[0]!.inCube).toBe(1);
    expect(planAdd(m.rows).open).toHaveLength(1);
  });

  it('a near miss and the exact name in two photos are one card, with a question', () => {
    const m = buildReview(parsed([seen('Swords to Plowshares', 1), seen('Swords to Plowshare', 2, 0.8)]), NAMES, []);
    expect(m.rows).toHaveLength(1);
    expect(m.rows[0]!.sightings[1]!.readAs).toBe('Swords to Plowshare');
    expect(rowQuestion(m.rows[0]!)).toBe('photos');
  });

  it('a card already in the pool starts unticked and is never added again', () => {
    const m = buildReview(parsed([seen('Ponder'), seen('Preordain')]), NAMES, ['Ponder']);
    const ponder = m.rows.find((r) => r.name === 'Ponder')!;
    expect(ponder).toMatchObject({ inPool: 1, include: false });
    const ticked = updateRow(m, ponder.id, { include: true });
    expect(planAdd(ticked.rows)).toMatchObject({ add: ['Preordain'], already: [expect.objectContaining({ name: 'Ponder' })] });
  });

  it('a card marked as the other player\'s starts unticked', () => {
    const m = buildReview(parsed([seen('Ponder')]), NAMES, [], ['Ponder']);
    expect(m.rows[0]).toMatchObject({ inOther: 1, include: false });
  });

  it('names outside the cube and the model\'s unrecognised items wait for the player', () => {
    const m = buildReview(parsed([seen('Grizzly Bears', 1)], [{ photo: 2, note: 'sleeved, glare', guess: 'Brainstrom' }]), NAMES, []);
    expect(m.rows).toEqual([]);
    expect(m.unmatched).toHaveLength(2);
    expect(m.unmatched[0]).toMatchObject({ text: 'Grizzly Bears', photo: 1 });
    expect(m.unmatched[1]).toMatchObject({ photo: 2, note: 'sleeved, glare', suggestions: expect.arrayContaining(['Brainstorm']) });
    expect(m.unmatched[1]!.suggestions[0]).toBe('Brainstorm');
  });

  it('naming an unmatched card by hand adds it ticked, and merges with its row (asking)', () => {
    let m: ReviewModel = buildReview(parsed([seen('Ponder', 1)], [{ photo: 2, note: 'covered', guess: '' }]), NAMES, []);
    const ctx = { pool: [], cubeNames: NAMES };
    m = resolveUnmatched(m, m.unmatched[0]!.id, 'Ponder', ctx);
    expect(m.unmatched).toEqual([]);
    expect(m.rows).toHaveLength(1);
    expect(rowQuestion(m.rows[0]!)).toBe('photos');
    expect(rowConfidence(m.rows[0]!)).toBe(1);
  });

  it('correcting a row moves its sightings to the right card', () => {
    let m = buildReview(parsed([seen('Ponder', 1, 0.4), seen('Preordain', 2)]), NAMES, []);
    const ponder = m.rows.find((r) => r.name === 'Ponder')!;
    m = renameRow(m, ponder.id, 'Preordain', { pool: [], cubeNames: NAMES });
    expect(m.rows.map((r) => r.name)).toEqual(['Preordain']);
    expect(rowQuestion(m.rows[0]!)).toBe('photos');
    m = renameRow(m, m.rows[0]!.id, 'Opt', { pool: [], cubeNames: NAMES });
    expect(m.rows.map((r) => r.name)).toEqual(['Opt']);
  });

  it('a new sighting reopens an answered question', () => {
    const ctx = { pool: [], cubeNames: NAMES };
    let rows = addSighting([], 'Ponder', { photo: 1, count: 1, confidence: 1, note: '' }, ctx);
    rows = addSighting(rows, 'Ponder', { photo: 2, count: 1, confidence: 1, note: '' }, ctx);
    rows = rows.map((r) => ({ ...r, copies: 1 }));
    expect(planAdd(rows).add).toEqual(['Ponder']);
    rows = addSighting(rows, 'Ponder', { photo: 3, count: 1, confidence: 1, note: '' }, ctx);
    expect(rows[0]!.copies).toBeNull();
    expect(copyChoices(rows[0]!)).toEqual([1, 2, 3]);
  });
});

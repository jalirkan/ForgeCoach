import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetCardCacheForTests, cleanCardName, getCachedCard, getCards, mapScryfallCard, type ScryfallCard } from './cards.ts';

type Call = { url: string; init?: RequestInit };
let calls: Call[];

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function simpleCard(name: string): ScryfallCard {
  return {
    object: 'card',
    name,
    mana_cost: '{R}',
    type_line: 'Instant',
    oracle_text: `${name} text`,
    colors: ['R'],
    image_uris: { small: 's', normal: 'n', large: 'l', art_crop: 'a' },
    scryfall_uri: `https://scryfall.com/${encodeURIComponent(name)}`,
  };
}

const delver: ScryfallCard = {
  object: 'card',
  name: 'Delver of Secrets // Insectile Aberration',
  type_line: 'Creature — Human Wizard // Creature — Human Insect',
  scryfall_uri: 'https://scryfall.com/card/isd/51',
  card_faces: [
    {
      name: 'Delver of Secrets',
      mana_cost: '{U}',
      type_line: 'Creature — Human Wizard',
      oracle_text: 'At the beginning of your upkeep, look at the top card of your library.',
      power: '1',
      toughness: '1',
      colors: ['U'],
      image_uris: { small: 'fs', normal: 'fn', large: 'fl', art_crop: 'fa' },
    },
    {
      name: 'Insectile Aberration',
      mana_cost: '',
      type_line: 'Creature — Human Insect',
      oracle_text: 'Flying',
      power: '3',
      toughness: '2',
      colors: ['U'],
      image_uris: { small: 'bs', normal: 'bn', large: 'bl', art_crop: 'ba' },
    },
  ],
};

/** Fake Scryfall: knows `known` by full name and face name; fuzzy also knows `fuzzyOnly`. */
function installFetch(known: ScryfallCard[], fuzzyOnly: Record<string, ScryfallCard> = {}) {
  const byName = new Map<string, ScryfallCard>();
  for (const c of known) {
    byName.set(c.name!.toLowerCase(), c);
    for (const f of c.card_faces ?? []) byName.set(f.name!.toLowerCase(), c);
  }
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    if (url.endsWith('/cards/collection')) {
      const body = JSON.parse(String(init!.body)) as { identifiers: Array<{ name: string }> };
      if (body.identifiers.length > 75) return json({ object: 'error' }, 422);
      const data: ScryfallCard[] = [];
      const not_found: unknown[] = [];
      for (const id of body.identifiers) {
        const c = byName.get(id.name.toLowerCase());
        if (c) data.push(c);
        else not_found.push(id);
      }
      return json({ object: 'list', not_found, data });
    }
    const m = /\/cards\/named\?fuzzy=(.*)$/.exec(url);
    if (m) {
      const q = decodeURIComponent(m[1]);
      const c = fuzzyOnly[q] ?? byName.get(q.toLowerCase());
      return c ? json(c) : json({ object: 'error', code: 'not_found' }, 404);
    }
    return json({}, 500);
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

beforeEach(() => {
  calls = [];
  __resetCardCacheForTests({ spacingMs: 0 });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('cleanCardName', () => {
  it('strips Forge suffixes and normalises split names', () => {
    expect(cleanCardName('Lightning Bolt|M10')).toBe('Lightning Bolt');
    expect(cleanCardName('Fire / Ice')).toBe('Fire // Ice');
    expect(cleanCardName('Fire // Ice')).toBe('Fire // Ice');
    expect(cleanCardName('Opt (XLN)')).toBe('Opt');
    expect(cleanCardName('Jace’s Erasure')).toBe("Jace's Erasure");
  });
});

describe('mapScryfallCard', () => {
  it('maps a double-faced card', () => {
    const info = mapScryfallCard('Delver of Secrets', delver);
    expect(info.found).toBe(true);
    expect(info.name).toBe('Delver of Secrets');
    expect(info.manaCost).toBe('{U}');
    expect(info.typeLine).toBe('Creature — Human Wizard // Creature — Human Insect');
    expect(info.oracleText).toBe('At the beginning of your upkeep, look at the top card of your library.\n//\nFlying');
    expect(info.power).toBe('1');
    expect(info.toughness).toBe('1');
    expect(info.colors).toEqual(['U']);
    expect(info.producedMana).toEqual([]);
    expect(info.image).toEqual({ small: 'fs', normal: 'fn', large: 'fl', artCrop: 'fa' });
    expect(info.faces).toHaveLength(2);
    expect(info.faces![1]).toMatchObject({ name: 'Insectile Aberration', power: '3', toughness: '2', image: { normal: 'bn' } });
    expect(info.scryfallUri).toBe('https://scryfall.com/card/isd/51');
  });

  it('maps a simple card with produced mana', () => {
    const info = mapScryfallCard('Llanowar Elves', { ...simpleCard('Llanowar Elves'), produced_mana: ['G'], power: '1', toughness: '1' });
    expect(info.producedMana).toEqual(['G']);
    expect(info.image?.artCrop).toBe('a');
    expect(info.faces).toBeUndefined();
    expect(info.oracleText).toBe('Llanowar Elves text');
  });
});

describe('getCards', () => {
  it('batches collection requests at 75 identifiers', async () => {
    const names = Array.from({ length: 160 }, (_, i) => `Card ${i}`);
    installFetch(names.map(simpleCard));
    const got = await getCards(names);
    const posts = calls.filter((c) => c.url.endsWith('/cards/collection'));
    expect(posts.map((c) => JSON.parse(String(c.init!.body)).identifiers.length)).toEqual([75, 75, 10]);
    expect(posts[0].init!.method).toBe('POST');
    expect((posts[0].init!.headers as Record<string, string>).Accept).toBe('application/json');
    expect(got.size).toBe(160);
    expect(got.get('Card 159')!.found).toBe(true);
    expect(calls.some((c) => c.url.includes('fuzzy'))).toBe(false);
  });

  it('finds a DFC by its front-face name', async () => {
    installFetch([delver]);
    const got = await getCards(['Delver of Secrets']);
    const d = got.get('Delver of Secrets')!;
    expect(d.found).toBe(true);
    expect(d.oracleText).toContain('\n//\nFlying');
  });

  it('retries not_found with fuzzy, then returns found:false', async () => {
    installFetch([simpleCard('Opt')], { 'Lightnig Bolt': simpleCard('Lightning Bolt') });
    const got = await getCards(['Opt', 'Lightnig Bolt', 'Not A Real Card']);
    expect(got.get('Opt')!.found).toBe(true);
    expect(got.get('Lightnig Bolt')).toMatchObject({ found: true, name: 'Lightnig Bolt', scryfallName: 'Lightning Bolt' });
    expect(got.get('Not A Real Card')).toEqual({
      name: 'Not A Real Card',
      found: false,
      manaCost: '',
      typeLine: '',
      oracleText: '',
      producedMana: [],
      colors: [],
    });
    const fuzzies = calls.filter((c) => c.url.includes('fuzzy=')).map((c) => decodeURIComponent(c.url.split('fuzzy=')[1]));
    expect(fuzzies).toEqual(['Lightnig Bolt', 'Not A Real Card']);
  });

  it('serves repeat lookups from cache without requests', async () => {
    installFetch([simpleCard('Opt')]);
    await getCards(['Opt', 'Nope']);
    const n = calls.length;
    const again = await getCards(['Opt', 'Nope']);
    expect(calls.length).toBe(n);
    expect(again.get('Opt')!.found).toBe(true);
    expect(again.get('Nope')!.found).toBe(false);
    expect(getCachedCard('Opt')!.oracleText).toBe('Opt text');
    expect(getCachedCard('opt')!.name).toBe('opt');
  });

  it('dedupes concurrent requests for the same names', async () => {
    installFetch([simpleCard('Opt'), simpleCard('Shock')]);
    const [a, b] = await Promise.all([getCards(['Opt', 'Shock']), getCards(['Shock', 'Opt'])]);
    expect(calls.length).toBe(1);
    expect(a.get('Shock')!.found && b.get('Opt')!.found).toBe(true);
  });

  it('does not cache network failures', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))));
    const got = await getCards(['Opt']);
    expect(got.get('Opt')!.found).toBe(false);
    expect(getCachedCard('Opt')).toBeUndefined();
    installFetch([simpleCard('Opt')]);
    expect((await getCards(['Opt'])).get('Opt')!.found).toBe(true);
  });

  it('persists to localStorage and rehydrates', async () => {
    const mem = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => void mem.set(k, v),
      removeItem: (k: string) => void mem.delete(k),
    });
    installFetch([simpleCard('Opt')]);
    await getCards(['Opt']);
    expect([...mem.keys()]).toEqual(['forgecoach.cards.v1']);
    __resetCardCacheForTests({ spacingMs: 0 });
    calls = [];
    const got = await getCards(['Opt']);
    expect(calls.length).toBe(0);
    expect(got.get('Opt')!.found).toBe(true);
  });
});

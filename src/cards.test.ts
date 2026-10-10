import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetCardCacheForTests, cleanCardName, isLookupName, getCachedCard, getCards, getCachedToken, getToken, mapScryfallCard, pickToken, tokenBaseName, tokenRef, tokenSearchUrl, type ScryfallCard } from './cards.ts';

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

describe('isLookupName', () => {
  it('rejects names that cannot be real cards', () => {
    for (const n of ['Goblin Token', 'Treasure Token', 'Ajani’s Effect', 'Elspeth\'s Effect', 'Pact Effect', 'Emblem — Elspeth', 'Elspeth Emblem', '???', '', '  ']) {
      expect(isLookupName(n), n).toBe(false);
    }
    expect(isLookupName(null)).toBe(false);
    expect(isLookupName(undefined)).toBe(false);
  });
  it('accepts real names, including Forge suffixes and split cards', () => {
    for (const n of ['Lightning Bolt', 'Lightning Bolt|M10', 'Fire // Ice', 'Emblem of the Warmind', 'Tokens of Fate']) {
      expect(isLookupName(n), n).toBe(true);
    }
  });
  it('getCards never fetches for such names', async () => {
    installFetch([simpleCard('Opt')]);
    const got = await getCards(['Goblin Token', 'Sol Ring Effect', '???']);
    expect(calls).toHaveLength(0);
    expect(got.get('Goblin Token')!.found).toBe(false);
    expect(got.size).toBe(3);
  });
});


// ---------------------------------------------------------------------------
// Tokens

function tokenCard(name: string, type_line: string, power: string | undefined, toughness: string | undefined, released_at: string, img = true): ScryfallCard {
  return {
    object: 'card',
    name,
    type_line,
    power,
    toughness,
    released_at,
    ...(img ? { image_uris: { small: `${name}-${released_at}-s`, normal: `${name}-${released_at}-n`, art_crop: `${name}-${released_at}-a` } } : {}),
  };
}
const bird = { name: 'Bird Token', token: true, types: 'Creature - Bird', power: '1', toughness: '1', counters: {} };

/** A canned /cards/search answer for the Bird search (order=released, newest first, as Scryfall sends it). */
const birdSearch: ScryfallCard[] = [
  tokenCard('Bird', 'Token Creature — Bird', '2', '2', '2025-02-01'),
  tokenCard('Bird', 'Token Creature — Bird', '1', '1', '2024-08-02'),
  tokenCard('Bird', 'Token Creature — Bird', '1', '1', '2022-05-06'),
  tokenCard('Bird Spirit', 'Token Creature — Bird Spirit', '1', '1', '2025-06-01'),
  tokenCard('Bird', 'Token Creature — Bird', '1', '1', '2025-09-09', false), // no image
  tokenCard('Birds of Paradise Token', 'Token Artifact — Bird', undefined, undefined, '2025-10-01'),
];

function installSearch(data: ScryfallCard[] | 404 | 500) {
  const fn = vi.fn(async (url: string) => {
    calls.push({ url });
    if (!url.includes('/cards/search')) return json({}, 500);
    if (data === 404) return json({ object: 'error', code: 'not_found' }, 404);
    if (data === 500) return json({ object: 'error' }, 500);
    return json({ object: 'list', data });
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

describe('token keys and the search query', () => {
  it('knows a token by the flag or the name, and takes the base name off', () => {
    expect(tokenBaseName('Bird Token')).toBe('Bird');
    expect(tokenBaseName('Phyrexian Golem Token')).toBe('Phyrexian Golem');
    expect(tokenRef(bird)?.base).toBe('Bird');
    expect(tokenRef({ name: 'Clue Token' })?.base).toBe('Clue');
    expect(tokenRef({ name: 'Lightning Bolt', token: false })).toBeNull();
    expect(tokenRef({ name: '', token: true })).toBeNull();
    expect(tokenRef({ name: 'Token', token: true })).toBeNull();
    expect(tokenRef(null)).toBeNull();
  });
  it('the key tells a 1/1 Bird from a 2/2 Bird and from a Bird of another type', () => {
    const k = (o: object) => tokenRef({ ...bird, ...o })!.key;
    expect(k({})).not.toBe(k({ power: '2', toughness: '2' }));
    expect(k({})).not.toBe(k({ types: 'Artifact Creature - Bird' }));
    expect(k({})).toBe(k({ name: 'bird token' }));
  });
  it('counters are not part of the key: a 1/1 Bird with a +1/+1 counter is still the 1/1 Bird', () => {
    const pumped = tokenRef({ ...bird, power: '2', toughness: '2', counters: { P1P1: 1 } })!;
    expect(pumped.key).toBe(tokenRef(bird)!.key);
    expect([pumped.power, pumped.toughness]).toEqual(['1', '1']);
  });
  it('the query is one token search on the base name, newest printing first', () => {
    const u = new URL(tokenSearchUrl('Phyrexian Golem'));
    expect(u.origin + u.pathname).toBe('https://api.scryfall.com/cards/search');
    expect(u.searchParams.get('q')).toBe('t:token name:"Phyrexian Golem"');
    expect(u.searchParams.get('unique')).toBe('art');
    expect(u.searchParams.get('order')).toBe('released');
    expect(u.searchParams.get('dir')).toBe('desc');
    expect(new URL(tokenSearchUrl('Bird" OR name:"x')).searchParams.get('q')).toBe('t:token name:"Bird  OR name: x"');
  });
  it('a token is still never looked up as a real card', () => {
    expect(isLookupName('Bird Token')).toBe(false);
  });
});

describe('pickToken: type and P/T filtering', () => {
  it('keeps the newest printing with the right P/T and type, with an image', () => {
    const ref = tokenRef(bird)!;
    const c = pickToken(birdSearch, ref)!;
    expect(c.released_at).toBe('2024-08-02');
    expect(c.power).toBe('1');
  });
  it('a 2/2 Bird picks the 2/2', () => {
    expect(pickToken(birdSearch, tokenRef({ ...bird, power: '2', toughness: '2' })!)!.released_at).toBe('2025-02-01');
  });
  it('a type the wire has that the result lacks rules it out; no types on the wire filters nothing', () => {
    expect(pickToken(birdSearch, tokenRef({ ...bird, types: 'Creature - Bird Warrior' })!)).toBeUndefined();
    expect(pickToken(birdSearch, tokenRef({ ...bird, types: '' })!)!.released_at).toBe('2024-08-02');
  });
  it('without a P/T on the wire (a Clue) the type decides, and an exact name beats a partial one', () => {
    const clue = tokenCard('Clue', 'Token Artifact — Clue', undefined, undefined, '2023-01-01');
    const other = tokenCard('Clue Hound', 'Token Artifact — Clue', undefined, undefined, '2025-01-01');
    expect(pickToken([other, clue], tokenRef({ name: 'Clue Token', token: true, types: 'Artifact - Clue', power: null, toughness: null })!)).toBe(clue);
  });
  it('nothing matches: undefined', () => {
    expect(pickToken(birdSearch, tokenRef({ ...bird, power: '9', toughness: '9' })!)).toBeUndefined();
    expect(pickToken([], tokenRef(bird)!)).toBeUndefined();
  });
});

describe('getToken', () => {
  it('one search, the matching image, cached under the P/T key', async () => {
    const fn = installSearch(birdSearch);
    const ref = tokenRef(bird)!;
    expect(getCachedToken(ref)).toBeUndefined();
    const info = await getToken(ref);
    expect(info.found).toBe(true);
    expect(info.image?.normal).toBe('Bird-2024-08-02-n');
    expect(info.power).toBe('1');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(calls[0].url).toBe(tokenSearchUrl('Bird'));
    expect(getCachedToken(ref)?.image?.normal).toBe('Bird-2024-08-02-n');
    await getToken(ref);
    expect(fn).toHaveBeenCalledTimes(1);
    // The 2/2 Bird is another key: its own search, its own art.
    const big = await getToken(tokenRef({ ...bird, power: '2', toughness: '2' })!);
    expect(big.image?.normal).toBe('Bird-2025-02-01-n');
    expect(fn).toHaveBeenCalledTimes(2);
    expect(getCachedToken(ref)?.image?.normal).toBe('Bird-2024-08-02-n');
  });
  it('concurrent asks for one token share one request', async () => {
    const fn = installSearch(birdSearch);
    const ref = tokenRef(bird)!;
    await Promise.all([getToken(ref), getToken(ref), getToken(ref)]);
    expect(fn).toHaveBeenCalledTimes(1);
  });
  it('a miss (no match, or a 404) is remembered: no repeated requests', async () => {
    const fn = installSearch(birdSearch);
    const odd = tokenRef({ ...bird, power: '9', toughness: '9' })!;
    expect((await getToken(odd)).found).toBe(false);
    expect((await getToken(odd)).found).toBe(false);
    expect(fn).toHaveBeenCalledTimes(1);
    const none = installSearch(404);
    const ref = tokenRef({ name: 'Zzyzx Token', token: true, types: 'Creature - Zzyzx', power: '1', toughness: '1' })!;
    await getToken(ref);
    await getToken(ref);
    expect(none).toHaveBeenCalledTimes(1);
    expect(getCachedToken(ref)?.found).toBe(false);
  });
  it('a server error is not cached, so a later ask tries again', async () => {
    const fn = installSearch(500);
    const ref = tokenRef(bird)!;
    expect((await getToken(ref)).found).toBe(false);
    expect(getCachedToken(ref)).toBeUndefined();
    await getToken(ref);
    expect(fn).toHaveBeenCalledTimes(2);
  });
  it('real cards are untouched: getCards on a real name still uses the collection endpoint, a token name never fetches', async () => {
    const fn = installFetch([simpleCard('Lightning Bolt')]);
    const got = await getCards(['Lightning Bolt', 'Bird Token']);
    expect(got.get('Lightning Bolt')!.found).toBe(true);
    expect(got.get('Bird Token')!.found).toBe(false);
    expect(fn.mock.calls.map((c) => c[0])).toEqual(['https://api.scryfall.com/cards/collection']);
    expect(getCachedCard('Lightning Bolt')?.found).toBe(true);
    expect(getCachedCard('Bird Token')).toBeUndefined();
  });
});

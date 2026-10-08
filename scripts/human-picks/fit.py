# SPDX-License-Identifier: GPL-3.0-or-later
"""ForgeCoach — scripts/human-picks/fit.py

docs/human-picks.md's pre-registered test: fits the human pick models on
17Lands' Powered Cube draft data and scores them, and the baselines, on
held-out drafts.

    python3 -I scripts/human-picks/fit.py describe PICKS.npz FACTS.json
    python3 -I scripts/human-picks/fit.py run PICKS.npz FACTS.json NAMES.json SCRYFALL.json WORKDIR [--ship public/cubes]

PICKS.npz from extract.py, FACTS.json from `npm run human-picks -- facts`,
NAMES.json the npz's card columns as JSON, SCRYFALL.json cardinfo.py's output. `run` writes into WORKDIR the
pickValue item files, calls `npm run human-picks -- pickvalue` for them (so
it must run from the repository root), prints the results and writes
results.json; with --ship it also writes <cube>.picks.json for every cube
that passes the ship rule. Needs numpy and scipy only.
"""
import json
import math
import os
import subprocess
import sys
import time

import numpy as np
from scipy.optimize import minimize

SEED = 20261008
BOOT = 2000
LAMBDAS = [1.0, 10.0, 100.0]
T_SCALE = 44.0          # t = min(1, pool size / 44): 0 at the first pick, 1 from the last pick of the draft on
OFF_SHARE = 0.15        # a colour under 15% of the pool's coloured nonland mass is "off"
OFF_MIN_POOL = 3        # ... once the pool holds at least 3 coloured nonland cards
SHIP_MIN_PICKS = 2000
FEATURES = ['fit', 'fitT', 'off', 'offT', 'goldT', 'colourlessT', 'landT', 'dual', 'dualT', 'curve', 'curveT']
COLOURS = 'WUBRG'
MIN_OVERLAP = 30


def fnv1a32(s):
    h = 0x811c9dc5
    for b in s.encode('utf-8'):
        h ^= b
        h = (h * 0x01000193) & 0xffffffff
    return h


def log(*a):
    print(*a, file=sys.stderr, flush=True)


# --------------------------------------------------------------------------
# Data

class Data:
    def __init__(self, npz, facts_path):
        d = np.load(npz)
        self.names = [str(x) for x in d['names']]
        self.C = len(self.names)
        self.pack_cards = d['pack_cards'].astype(np.int32)
        self.pack_off = d['pack_off']
        self.pool_cards = d['pool_cards'].astype(np.int32)
        self.pool_off = d['pool_off']
        self.pick = d['pick'].astype(np.int32)
        self.packno = d['packno'].astype(np.int32)
        self.pickno = d['pickno'].astype(np.int32)
        self.event = d['event']
        self.draft = d['draft']
        self.winb = d['winb']
        self.rank = d['rank']
        self.draft_ids = [str(x) for x in d['draft_ids']]
        self.P = len(self.pick)
        f = json.load(open(facts_path, encoding='utf-8'))
        self.facts = f
        self.cubes = f['cubes']
        # Per column: colour mass row (1/|C| per colour), land, produces, mv bucket, known.
        self.colmass = np.zeros((self.C, 5))
        self.ncol = np.zeros(self.C)
        self.land = np.zeros(self.C, bool)
        self.known = np.zeros(self.C, bool)
        self.prod = np.zeros((self.C, 5), bool)
        self.mvb = np.zeros(self.C, np.int32)
        for i, n in enumerate(self.names):
            r = f['arena'].get(n)
            if not r:
                continue
            self.known[i] = True
            self.land[i] = r['land']
            cs = [c for c in r['colors'] if c in COLOURS]
            self.ncol[i] = len(cs)
            for c in cs:
                self.colmass[i, COLOURS.index(c)] = 1.0 / len(cs)
            for c in r['produces']:
                if c in COLOURS:
                    self.prod[i, COLOURS.index(c)] = True
            self.mvb[i] = min(max(int(r['mv']), 1), 6) - 1  # buckets <=1,2,3,4,5,6+
        self.packsize = np.diff(self.pack_off).astype(np.int32)
        self.poolsize = np.diff(self.pool_off).astype(np.int32)
        self.item_pick = np.repeat(np.arange(self.P), self.packsize)
        h = np.array([fnv1a32(x) % 5 for x in self.draft_ids])
        self.fold = h[self.draft]   # 0 test, 1 validation, 2-4 train
        self._pool_stats()

    def _pool_stats(self):
        P = self.P
        pick_of_pool = np.repeat(np.arange(P), self.poolsize)
        nonland = ~self.land[self.pool_cards] & self.known[self.pool_cards]
        mass = np.zeros((P, 5))
        for c in range(5):
            mass[:, c] = np.bincount(pick_of_pool, weights=self.colmass[self.pool_cards, c] * nonland, minlength=P)
        coloured = np.bincount(pick_of_pool, weights=(nonland & (self.ncol[self.pool_cards] > 0)).astype(float), minlength=P)
        tot = mass.sum(1)
        self.share = np.divide(mass, tot[:, None], out=np.zeros_like(mass), where=tot[:, None] > 0)
        self.coloured_pool = coloured
        # Top two colours by mass (ties: WUBRG order), only colours with mass > 0.
        order = np.argsort(-mass + 1e-9 * np.arange(5)[None, :], axis=1, kind='stable')
        self.top2 = np.zeros((P, 5), bool)
        for k in range(2):
            c = order[:, k]
            ok = mass[np.arange(P), c] > 0
            self.top2[np.arange(P)[ok], c[ok]] = True
        self.has_pair = self.top2.sum(1) == 2
        self.nonland_pool = np.bincount(pick_of_pool, weights=nonland.astype(float), minlength=P)
        mvc = np.zeros((P, 6))
        for b in range(6):
            mvc[:, b] = np.bincount(pick_of_pool, weights=(nonland & (self.mvb[self.pool_cards] == b)).astype(float), minlength=P)
        self.mv_counts = mvc
        self.t = np.minimum(1.0, self.poolsize / T_SCALE)

    def features(self, items):
        """Feature matrix (len(items) x len(FEATURES)) for flat pack-item indices."""
        card = self.pack_cards[items]
        pk = self.item_pick[items]
        t = self.t[pk]
        known = self.known[card]
        land = self.land[card] & known
        ncol = self.ncol[card]
        coloured = known & ~land & (ncol > 0)
        sh = self.share[pk]
        cm = self.colmass[card] > 0
        fit = np.where(cm, sh, np.inf).min(1)
        fit = np.where(coloured, fit, 0.0)
        offc = (cm & (sh < OFF_SHARE)).sum(1).astype(float)
        off = np.where(coloured & (self.coloured_pool[pk] >= OFF_MIN_POOL), offc, 0.0)
        gold = (coloured & (ncol >= 2)).astype(float)
        cless = (known & ~land & (ncol == 0)).astype(float)
        dual = (land & self.has_pair[pk] & ((self.prod[card] & self.top2[pk]).sum(1) == 2)).astype(float)
        nl = self.nonland_pool[pk]
        same = self.mv_counts[pk, self.mvb[card]]
        curve = np.where(known & ~land & (nl > 0), same / np.maximum(nl, 1), 0.0)
        F = np.stack([fit, fit * t, off, off * t, gold * t, cless * t, land.astype(float) * t, dual, dual * t, curve, curve * t], 1)
        return F.astype(np.float64)


# --------------------------------------------------------------------------
# Choice problems: a set of picks, each with its (possibly restricted) choice set

class Problem:
    def __init__(self, D, pick_mask, col_mask=None, with_features=True):
        items = np.arange(len(D.pack_cards))
        sel = pick_mask[D.item_pick]
        if col_mask is not None:
            sel &= col_mask[D.pack_cards]
        items = items[sel]
        pk = D.item_pick[items]
        is_pick = D.pack_cards[items] == D.pick[pk]
        n = np.bincount(pk, minlength=D.P)
        hit = np.bincount(pk, weights=is_pick, minlength=D.P)
        good = pick_mask & (n >= 2) & (hit >= 1)
        keep = good[pk]
        items, pk, is_pick = items[keep], pk[keep], is_pick[keep]
        # One chosen item per pick (the first copy when a pack holds two).
        self.picks = np.flatnonzero(good)
        counts = np.bincount(pk, minlength=D.P)[self.picks]
        self.starts = np.concatenate([[0], np.cumsum(counts)[:-1]]).astype(np.int64)
        self.seg = np.repeat(np.arange(len(self.picks)), counts)
        first = np.zeros(len(items), bool)
        cand = np.flatnonzero(is_pick)
        _, firsts = np.unique(self.seg[cand], return_index=True)
        first[cand[firsts]] = True
        self.chosen = np.flatnonzero(first)
        self.items = items
        self.card = D.pack_cards[items]
        self.t = D.t[pk]
        self.size = counts
        self.F = D.features(items) if with_features else None
        self.draft = D.draft[self.picks]

    def __len__(self):
        return len(self.picks)


def seg_lse(P, u):
    m = np.maximum.reduceat(u, P.starts)
    e = np.exp(u - m[P.seg])
    z = np.add.reduceat(e, P.starts)
    return m + np.log(z), e, z


# --------------------------------------------------------------------------
# Models

class Model:
    """(a): u = s[card]; (b): u = s[card] * (1 + gamma t) + F beta."""

    def __init__(self, C, context):
        self.C = C
        self.context = context
        self.s = np.zeros(C)
        self.gamma = 0.0
        self.beta = np.zeros(len(FEATURES))

    def pack(self):
        return np.concatenate([self.s, [self.gamma], self.beta]) if self.context else self.s.copy()

    def unpack(self, x):
        self.s = x[:self.C].copy()
        if self.context:
            self.gamma = float(x[self.C])
            self.beta = x[self.C + 1:].copy()

    def utility(self, P):
        u = self.s[P.card]
        if self.context:
            u = u * (1 + self.gamma * P.t) + P.F @ self.beta
        return u

    def fit(self, P, lam, maxiter=500):
        C = self.C

        def f(x):
            self.unpack(x)
            mult = (1 + self.gamma * P.t) if self.context else 1.0
            u = self.utility(P)
            lse, e, z = seg_lse(P, u)
            nll = float(np.sum(lse - u[P.chosen]))
            g = e / z[P.seg]
            g[P.chosen] -= 1
            gs = np.bincount(P.card, weights=g * mult, minlength=C) + lam * self.s
            obj = nll + 0.5 * lam * float(self.s @ self.s)
            if not self.context:
                return obj, gs
            gg = float(np.sum(g * self.s[P.card] * P.t))
            gb = P.F.T @ g
            return obj, np.concatenate([gs, [gg], gb])

        t0 = time.time()
        r = minimize(f, self.pack(), jac=True, method='L-BFGS-B', options={'maxiter': maxiter, 'gtol': 1e-2, 'ftol': 1e-12})
        self.unpack(r.x)
        log(f'  fit {"b" if self.context else "a"} lam={lam}: {r.nit} iterations, {time.time() - t0:.0f}s, {r.message}')
        return self


# --------------------------------------------------------------------------
# Metrics

def per_pick(P, u, prob=True):
    """top-1 and top-3 credit (ties shared at random) and -log p of the pick."""
    uc = u[P.chosen]
    above = np.add.reduceat((u > uc[P.seg]).astype(float), P.starts)
    equal = np.add.reduceat((u == uc[P.seg]).astype(float), P.starts)
    top1 = np.clip((1 - above) / equal, 0, 1)
    top3 = np.clip((3 - above) / equal, 0, 1)
    ll = None
    if prob:
        lse, _, _ = seg_lse(P, u)
        ll = lse - uc
    return top1, top3, ll


def fit_temperature(P, score):
    """beta for softmax(beta * score), maximum likelihood on P (golden-section on log beta)."""
    def nll(lb):
        u = math.exp(lb) * score
        lse, _, _ = seg_lse(P, u)
        return float(np.mean(lse - u[P.chosen]))
    a, b = -8.0, 4.0
    g = (math.sqrt(5) - 1) / 2
    c, d = b - g * (b - a), a + g * (b - a)
    fc, fd = nll(c), nll(d)
    for _ in range(60):
        if fc < fd:
            b, d, fd = d, c, fc
            c = b - g * (b - a)
            fc = nll(c)
        else:
            a, c, fc = c, d, fd
            d = a + g * (b - a)
            fd = nll(d)
    return math.exp((a + b) / 2)


class Boot:
    def __init__(self, drafts):
        self.ud, self.inv = np.unique(drafts, return_inverse=True)
        rng = np.random.default_rng(SEED)
        D = len(self.ud)
        self.W = np.stack([np.bincount(rng.integers(0, D, D), minlength=D) for _ in range(BOOT)]).astype(np.float64)
        self.n = np.bincount(self.inv, minlength=D).astype(np.float64)
        self.nb = self.W @ self.n

    def mean(self, x):
        s = np.bincount(self.inv, weights=x, minlength=len(self.ud))
        return float(x.mean()), self.W @ s / self.nb

    def interval(self, x):
        m, b = self.mean(x)
        return m, float(np.percentile(b, 2.5)), float(np.percentile(b, 97.5))


def fmt(m, lo, hi, pct=True):
    if pct:
        return f'{100 * m:5.1f}% [{100 * lo:.1f}, {100 * hi:.1f}]'
    return f'{m:.3f} [{lo:.3f}, {hi:.3f}]'


def fmtd(m, lo, hi, pct=True):
    if pct:
        return f'{100 * m:+5.1f} pts [{100 * lo:+.1f}, {100 * hi:+.1f}]'
    return f'{m:+.3f} [{lo:+.3f}, {hi:+.3f}]'


# --------------------------------------------------------------------------

def describe(D):
    for name, f in [('test', D.fold == 0), ('validation', D.fold == 1), ('train', D.fold >= 2)]:
        drafts = len(np.unique(D.draft[f]))
        log(f'{name}: {drafts} drafts, {f.sum()} picks, {(f & (D.packsize >= 2)).sum()} with 2+ cards')
    log('picks by pack/pick number (first rows):', np.unique(D.packno * 100 + D.pickno, return_counts=True)[1][:4])
    log('pack size at pack 0 pick 0..2:', [int(np.median(D.packsize[(D.packno == 0) & (D.pickno == k)])) if ((D.packno == 0) & (D.pickno == k)).any() else None for k in range(3)])
    test = D.fold == 0
    for cube in D.cubes:
        cols = np.zeros(D.C, bool)
        for c in cube['cards']:
            cols[D.names.index(c['col'])] = True
        if cols.sum() < MIN_OVERLAP:
            log(f'{cube["id"]}: {int(cols.sum())} overlap cards (under {MIN_OVERLAP}, not tested)')
            continue
        P = Problem(D, test, cols, with_features=False)
        log(f'{cube["id"]}: {int(cols.sum())} overlap cards, {len(P)} test picks in its restricted packs, {len(np.unique(P.draft))} drafts, median choice set {np.median(P.size):.0f}')


def cube_cols(D, cube):
    cols = np.zeros(D.C, bool)
    val = np.full(D.C, np.nan)
    rating = np.full(D.C, np.nan)
    gih = np.full(D.C, np.nan)
    for c in cube['cards']:
        i = D.names.index(c['col'])
        cols[i] = True
        val[i] = c['value']
        rating[i] = c['rating']
        if c['gih'] is not None:
            gih[i] = c['gih']
    if cube['gihAvg'] is not None:
        gih = np.where(cols & np.isnan(gih), cube['gihAvg'], gih)
    else:
        gih[:] = np.nan
    return cols, val, rating, gih


def pickvalue_scores(D, P, cube_id, workdir, tag):
    path = os.path.join(workdir, f'items-{cube_id}-{tag}.jsonl')
    out = os.path.join(workdir, f'pv-{cube_id}-{tag}.jsonl')
    with open(path, 'w') as f:
        for k, p in enumerate(P.picks):
            a, b = D.pool_off[p], D.pool_off[p + 1]
            s, e = P.starts[k], P.starts[k] + P.size[k]
            f.write(json.dumps({'cube': cube_id, 'pool': D.pool_cards[a:b].tolist(), 'pack': P.card[s:e].tolist()}) + '\n')
    t0 = time.time()
    subprocess.run(['npm', 'run', '-s', 'human-picks', '--', 'pickvalue', D.scryfall, D.names_path, path, out], check=True)
    log(f'  pickValue {cube_id} {tag}: {len(P)} items, {time.time() - t0:.0f}s')
    scores = np.concatenate([np.array(json.loads(l), float) for l in open(out) if l.strip()])
    assert len(scores) == len(P.card)
    return scores


def run(D, workdir, ship_dir):
    os.makedirs(workdir, exist_ok=True)
    results = {'seed': SEED, 'boot': BOOT}
    train_m = (D.fold >= 2)
    val_m = (D.fold == 1)
    test_m = (D.fold == 0)
    t0 = time.time()
    Ptr = Problem(D, train_m)
    Pva = Problem(D, val_m)
    log(f'problems: train {len(Ptr)} picks / {len(Ptr.card)} items, validation {len(Pva)}  ({time.time() - t0:.0f}s)')

    # (a): lambda by validation log-loss (warm starts, largest lambda first)
    a = Model(D.C, False)
    best = None
    lam_ll = {}
    for lam in sorted(LAMBDAS, reverse=True):
        a.fit(Ptr, lam)
        _, _, ll = per_pick(Pva, a.utility(Pva))
        lam_ll[lam] = float(ll.mean())
        log(f'  (a) lam={lam}: validation log-loss {ll.mean():.4f}')
        if best is None or ll.mean() < best[1]:
            best = (lam, float(ll.mean()), a.s.copy())
    lam = best[0]
    a.s = best[2]
    results['lambda'] = lam
    results['lambdaValidation'] = lam_ll
    b = Model(D.C, True)
    b.s = a.s.copy()
    b.fit(Ptr, lam)
    results['b'] = {'gamma': b.gamma, 'beta': dict(zip(FEATURES, b.beta.tolist()))}
    log(f'  (b) gamma {b.gamma:.3f} beta ' + ', '.join(f'{k} {v:+.3f}' for k, v in zip(FEATURES, b.beta)))

    # ---- held-out: full packs
    Pte = Problem(D, test_m)
    boot = Boot(Pte.draft)
    rows = {}
    ua, ub = a.utility(Pte), b.utility(Pte)
    unif = np.zeros(len(Pte.card))
    for name, u in [('uniform', unif), ('a', ua), ('b', ub)]:
        t1, t3, ll = per_pick(Pte, u)
        rows[name] = {'top1': boot.interval(t1), 'top3': boot.interval(t3), 'logloss': boot.interval(ll), '_v': (t1, t3, ll)}
    full = {'picks': len(Pte), 'drafts': len(boot.ud), 'models': {k: {m: v[m] for m in ('top1', 'top3', 'logloss')} for k, v in rows.items()}}
    full['b-a'] = {m: boot.interval(rows['b']['_v'][i] - rows['a']['_v'][i]) for i, m in enumerate(('top1', 'top3', 'logloss'))}
    results['full'] = full
    log('\n== Held-out drafts, full 540-card packs ==')
    log(f'{full["picks"]} picks, {full["drafts"]} drafts')
    for k, v in full['models'].items():
        log(f'  {k:8s} top-1 {fmt(*v["top1"])}  top-3 {fmt(*v["top3"])}  log-loss {fmt(*v["logloss"], pct=False)}')
    log(f'  b - a    top-1 {fmtd(*full["b-a"]["top1"])}  top-3 {fmtd(*full["b-a"]["top3"])}  log-loss {fmtd(*full["b-a"]["logloss"], pct=False)}')

    # ---- per cube: restricted packs, baselines, ship rule
    results['cubes'] = {}
    shipped = []
    for cube in D.cubes:
        cols, val, rating, gih = cube_cols(D, cube)
        if cols.sum() < MIN_OVERLAP:
            continue
        cid = cube['id']
        Pt = Problem(D, test_m, cols)
        Pv = Problem(D, val_m, cols)
        if len(Pt) == 0:
            continue
        bt = Boot(Pt.draft)
        scores = {'a': (a.utility(Pt), None), 'b': (b.utility(Pt), None)}
        base = {'cardValue': val, 'aiRating': rating}
        if not np.isnan(gih).all():
            base['gihWR'] = gih
        for k, arr in base.items():
            scores[k] = (arr[Pt.card], arr[Pv.card])
        pv_t = pickvalue_scores(D, Pt, cid, workdir, 'test')
        nv = min(len(Pv), 20000)
        vsub = np.zeros(D.P, bool)
        vsub[Pv.picks[np.random.default_rng(SEED).permutation(len(Pv))[:nv]]] = True
        Pv2 = Problem(D, vsub, cols, with_features=False)
        pv_v = pickvalue_scores(D, Pv2, cid, workdir, 'val')
        scores['pickValue'] = (pv_t, pv_v)
        out = {'overlap': int(cols.sum()), 'picks': len(Pt), 'drafts': len(bt.ud), 'medianChoices': float(np.median(Pt.size)), 'models': {}, 'diff': {}}
        vals = {}
        for k, (ut, uv) in scores.items():
            if uv is None:
                u = ut
                temp = None
            else:
                temp = fit_temperature(Pv2 if k == 'pickValue' else Pv, uv)
                u = temp * ut
            t1, t3, ll = per_pick(Pt, u)
            vals[k] = (t1, t3, ll)
            out['models'][k] = {'top1': bt.interval(t1), 'top3': bt.interval(t3), 'logloss': bt.interval(ll), 'temperature': temp}
        for other in [k for k in scores if k not in ('b',)]:
            out['diff'][f'b-{other}'] = {m: bt.interval(vals['b'][i] - vals[other][i]) for i, m in enumerate(('top1', 'top3', 'logloss'))}
        passes = len(Pt) >= SHIP_MIN_PICKS and all(out['diff'][f'b-{k}']['top1'][1] > 0 for k in ('cardValue', 'pickValue'))
        out['ship'] = passes
        # Reported, not used: by choice-set size and by draft stage.
        by = {}
        for lo, hi in [(2, 3), (4, 6), (7, 9), (10, 15)]:
            m = (Pt.size >= lo) & (Pt.size <= hi)
            if m.sum() < 200:
                continue
            by[f'{lo}-{hi}'] = {'picks': int(m.sum()), **{k: float(vals[k][0][m].mean()) for k in vals}}
        out['bySize'] = by
        st = {}
        tp = D.t[Pt.picks]
        for lo, hi, lab in [(0, 0.34, 'early'), (0.34, 0.67, 'middle'), (0.67, 1.01, 'late')]:
            m = (tp >= lo) & (tp < hi)
            st[lab] = {'picks': int(m.sum()), **{k: float(vals[k][0][m].mean()) for k in vals}}
        out['byStage'] = st
        results['cubes'][cid] = out
        log(f'\n== {cid}: packs cut to its {out["overlap"]} overlap cards ==')
        log(f'{out["picks"]} picks, {out["drafts"]} drafts, median {out["medianChoices"]:.0f} cards to choose from')
        for k, v in out['models'].items():
            log(f'  {k:10s} top-1 {fmt(*v["top1"])}  top-3 {fmt(*v["top3"])}  log-loss {fmt(*v["logloss"], pct=False)}')
        for k, v in out['diff'].items():
            log(f'  {k:14s} top-1 {fmtd(*v["top1"])}  log-loss {fmtd(*v["logloss"], pct=False)}')
        log(f'  ship: {passes}')
        if passes:
            shipped.append((cube, cols))

    # ---- transfer check T1 (Vintage): strengths fit only on overlap-card choice sets
    vint = next(c for c in D.cubes if c['id'] == 'vintage')
    cols, _, _, _ = cube_cols(D, vint)
    Ptr_v = Problem(D, train_m, cols, with_features=False)
    ar = Model(D.C, False).fit(Ptr_v, lam)
    Pt = Problem(D, test_m, cols, with_features=False)
    bt = Boot(Pt.draft)
    t1a, t3a, lla = per_pick(Pt, a.utility(Pt))
    t1r, t3r, llr = per_pick(Pt, ar.utility(Pt))
    idx = np.flatnonzero(cols)
    seen = np.bincount(Ptr_v.card, minlength=D.C)[idx] > 0
    rho = spearman(a.s[idx][seen], ar.s[idx][seen])
    results['transfer'] = {
        'restrictedTrainPicks': len(Ptr_v),
        'aFull': {'top1': bt.interval(t1a), 'logloss': bt.interval(lla)},
        'aRestricted': {'top1': bt.interval(t1r), 'logloss': bt.interval(llr)},
        'full-restricted': {'top1': bt.interval(t1a - t1r), 'logloss': bt.interval(lla - llr)},
        'rhoStrengths': rho, 'cards': int(seen.sum()),
    }
    tr = results['transfer']
    log('\n== Transfer T1 (Vintage overlap): (a) fit on full packs vs (a) fit only on overlap-card choice sets ==')
    log(f'  full-pack fit       top-1 {fmt(*tr["aFull"]["top1"])}  log-loss {fmt(*tr["aFull"]["logloss"], pct=False)}')
    log(f'  overlap-only fit    top-1 {fmt(*tr["aRestricted"]["top1"])}  log-loss {fmt(*tr["aRestricted"]["logloss"], pct=False)}')
    log(f'  full - overlap-only top-1 {fmtd(*tr["full-restricted"]["top1"])}  log-loss {fmtd(*tr["full-restricted"]["logloss"], pct=False)}')
    log(f'  Spearman of the two strength vectors over {tr["cards"]} cards: {rho:.3f}')

    # ---- by drafter skill (reported only), full packs
    wb = D.winb[Pte.picks]
    sk = {}
    for lo, hi, lab in [(0, 0.5, '<50%'), (0.5, 0.6, '50-60%'), (0.6, 1.01, '60%+')]:
        m = (wb >= lo) & (wb < hi)
        if m.sum():
            sk[lab] = {'picks': int(m.sum()), 'a': float(rows['a']['_v'][0][m].mean()), 'b': float(rows['b']['_v'][0][m].mean())}
    results['bySkill'] = sk
    log('\nby drafter win-rate bucket (top-1, full packs):', json.dumps(sk))

    results['model'] = {'s': dict(zip(D.names, a.s.tolist())), 'sb': dict(zip(D.names, b.s.tolist()))}
    with open(os.path.join(workdir, 'results.json'), 'w') as f:
        json.dump(results, f, indent=1, default=float)
    if ship_dir:
        for cube, cols in shipped:
            write_picks(D, cube, cols, b, results, ship_dir)
    log(f'\ndone in {time.time() - t0:.0f}s')


def spearman(x, y):
    def rank(v):
        o = np.argsort(v, kind='stable')
        r = np.empty(len(v))
        r[o] = np.arange(len(v))
        # average ties
        _, inv, cnt = np.unique(v, return_inverse=True, return_counts=True)
        sums = np.bincount(inv, weights=r)
        return (sums / cnt)[inv]
    rx, ry = rank(np.asarray(x)), rank(np.asarray(y))
    return float(np.corrcoef(rx, ry)[0, 1])


def write_picks(D, cube, cols, b, results, ship_dir):
    cnt = np.bincount(D.pack_cards, minlength=D.C)
    taken = np.bincount(D.pick, minlength=D.C)
    cards = {}
    for c in cube['cards']:
        i = D.names.index(c['col'])
        cards[c['name']] = {'s': round(float(b.s[i]), 3), 'seen': int(cnt[i]), 'taken': int(taken[i])}
    r = results['cubes'][cube['id']]
    doc = {
        'schema': 1,
        'source': {
            'name': '17Lands', 'page': 'https://www.17lands.com/public_datasets', 'licence': 'CC BY 4.0',
            'licenceUrl': 'https://creativecommons.org/licenses/by/4.0/', 'dataset': 'Powered Cube',
            'files': ['draft_data_public.Cube_-_Powered.PremierDraft.csv.gz', 'draft_data_public.Cube_-_Powered.TradDraft.csv.gz'],
            'updated': '2025-12-01',
            'changes': 'A pick model fitted to the human picks (docs/human-picks.md): per-card pick strength and pool-context coefficients; matched to this cube by card name.',
        },
        'generated': time.strftime('%Y-%m-%d'),
        'cube': {'file': f'{cube["file"]}.md', 'cards': cube['size'], 'matched': len(cards)},
        'picks': int(len(D.pick)), 'drafts': int(len(D.draft_ids)),
        'model': {'gamma': round(b.gamma, 4), 'beta': {k: round(float(v), 4) for k, v in zip(FEATURES, b.beta)},
                  'tScale': T_SCALE, 'offShare': OFF_SHARE, 'offMinPool': OFF_MIN_POOL},
        'test': {'picks': r['picks'], 'top1': round(r['models']['b']['top1'][0], 4), 'top1CardValue': round(r['models']['cardValue']['top1'][0], 4),
                 'top1PickValue': round(r['models']['pickValue']['top1'][0], 4)},
        'cards': cards,
    }
    path = os.path.join(ship_dir, f'{cube["file"]}.picks.json')
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(doc, f, indent=1, ensure_ascii=False)
        f.write('\n')
    log(f'wrote {path}')


def main(argv):
    if len(argv) >= 3 and argv[0] == 'describe':
        describe(Data(argv[1], argv[2]))
        return 0
    if len(argv) >= 6 and argv[0] == 'run':
        D = Data(argv[1], argv[2])
        D.names_path = os.path.abspath(argv[3])
        D.scryfall = os.path.abspath(argv[4])
        ship = argv[argv.index('--ship') + 1] if '--ship' in argv else None
        run(D, argv[5], ship)
        return 0
    print(__doc__)
    return 2


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))

# SPDX-License-Identifier: GPL-3.0-or-later
"""ForgeCoach — scripts/card-model/synergy.py

docs/card-model.md part D2: which card pairs win more for 17Lands' human
players together than each card does alone.

  python -I synergy.py test DECKS.npz RESULT.json
        the pre-registered run: per half, the main-effects model and every
        candidate pair's score test; discovery (BH 10%) and replication (BH 5%)
        both ways; the halves' agreement. Writes every candidate's numbers.
  python -I synergy.py ship RESULT.json FEATURES.json OUT_DIR YYYY-MM-DD
        the replicated positive pairs into OUT_DIR/<cube>.synergy.json for each
        cube holding both cards (names matched as src/cube/human.ts normName).

DECKS.npz is decks.py's output; FEATURES.json the card-model export (for the
cubes' card names). The model, per half, at cluster level (one draft's games
with one deck: k games, w wins):

  logit p = intercept + win-rate bucket + games bucket + share on the play
            + 5 basic-land counts + Σ_card β_card x_card,   N(0, 1) prior on β_card

fitted by Newton's method. Each candidate pair (a, b) is then tested alone by
the efficient score test against that fit: U = Σ x_a x_b (w − k p̂),
I = Σ x_a x_b k p̂(1 − p̂) − v′M⁻¹v, θ̂ = U / I, z = U / √(φ I), φ the Pearson
dispersion. Effects in win-rate points are θ̂ · p̄(1 − p̄), p̄ the pair's
decks' mean fitted rate. A few seconds per half.
"""
import json
import os
import sys
import unicodedata

for _v in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS"):
    os.environ.setdefault(_v, "1")

import numpy as np  # noqa: E402
from scipy import sparse, stats  # noqa: E402

MIN_TOGETHER = 1000
MIN_ALONE = 1000
FDR_DISCOVERY = 0.10
FDR_REPLICATION = 0.05
CARD_PRIOR_PREC = 1.0


def clusters(d, half):
    """Cluster-level rows of one half: k, w, covariates, deck matrix."""
    m = d["half"] == half
    gi = np.nonzero(m)[0]
    cl = d["cluster"][gi]
    u, first, inv = np.unique(cl, return_index=True, return_inverse=True)
    k = np.bincount(inv).astype(float)
    w = np.bincount(inv, weights=d["won"][gi].astype(float))
    onp = np.bincount(inv, weights=d["onplay"][gi].astype(float)) / k
    g0 = gi[first]
    n_cards = len(d["names"])
    indptr, idx = d["indptr"], d["idx"]
    rows, cols = [], []
    for r, g in enumerate(g0):
        c = idx[indptr[g]:indptr[g + 1]]
        rows.extend([r] * len(c))
        cols.extend(c.tolist())
    X = sparse.csr_matrix((np.ones(len(rows)), (rows, cols)), shape=(len(g0), n_cards))
    wrb = d["wrb"][g0]
    ngb = d["ngb"][g0]
    basics = d["basics"][g0].astype(float)
    cov = [np.ones(len(g0)), onp]
    for lv in range(1, len(d["wrb_labels"])):
        cov.append((wrb == lv).astype(float))
    for lv in range(1, len(d["ngb_labels"])):
        cov.append((ngb == lv).astype(float))
    cov.extend(basics.T)
    C = np.column_stack(cov)
    keep = C.std(axis=0) > 0
    keep[0] = True
    C = C[:, keep]
    Z = sparse.hstack([sparse.csr_matrix(C), X]).tocsr()
    return dict(k=k, w=w, X=X, Z=Z, n_cov=C.shape[1], gamesX=X.multiply(k[:, None]).tocsr())


def fit_main(c):
    Z, k, w, nc = c["Z"], c["k"], c["w"], c["n_cov"]
    P = np.zeros(Z.shape[1])
    P[nc:] = CARD_PRIOR_PREC
    P[:nc] = 1e-6
    beta = np.zeros(Z.shape[1])
    beta[0] = np.log(w.sum() / (k.sum() - w.sum()))
    for it in range(50):
        eta = Z @ beta
        p = 1 / (1 + np.exp(-eta))
        W = k * p * (1 - p)
        g = Z.T @ (w - k * p) - P * beta
        H = (Z.T @ Z.multiply(W[:, None])).toarray() + np.diag(P)
        step = np.linalg.solve(H, g)
        beta += step
        if np.max(np.abs(step)) < 1e-8:
            break
    eta = Z @ beta
    p = 1 / (1 + np.exp(-eta))
    W = k * p * (1 - p)
    H = (Z.T @ Z.multiply(W[:, None])).toarray() + np.diag(P)
    r = w - k * p
    phi = float(np.sum(r * r / W) / (len(k) - Z.shape[1]))
    return dict(beta=beta, p=p, W=W, r=r, H=H, phi=phi, iters=it + 1)


def pair_tests(c, f):
    """Every pair a < b: games together / alone, θ̂, z, p̄."""
    Z, X, k = c["Z"], c["X"], c["k"]
    nc, n = c["n_cov"], X.shape[1]
    Minv = np.linalg.inv(f["H"])
    Xc = X.tocsc()
    G = (X.T @ c["gamesX"]).toarray()  # games together (k-weighted co-occurrence)
    out = {key: np.full((n, n), np.nan) for key in ("U", "I", "pbar")}
    cols = np.arange(nc, nc + n)
    for a in range(n):
        rows = Xc[:, a].nonzero()[0]
        if len(rows) == 0:
            continue
        Za = Z[rows]
        Wa = f["W"][rows]
        Ta = (Za.T @ Za.multiply(Wa[:, None])).toarray()
        Ua = Za.T @ f["r"][rows]
        V = Ta[:, cols]
        Cm = Minv @ V
        out["U"][a] = Ua[cols]
        out["I"][a] = np.diag(Ta)[cols] - np.sum(V * Cm, axis=0)
        kp = (k * f["p"])[rows]
        num = X[rows].T @ kp
        den = X[rows].T @ k[rows]
        with np.errstate(invalid="ignore", divide="ignore"):
            out["pbar"][a] = num / den
    games = np.diag(G)
    iu = np.triu_indices(n, 1)
    U, I = out["U"][iu], out["I"][iu]
    with np.errstate(invalid="ignore", divide="ignore"):
        theta = U / I
        z = U / np.sqrt(f["phi"] * I)
    pbar = out["pbar"][iu]
    tog = G[iu]
    return dict(a=iu[0], b=iu[1], I=I, together=tog, alone_a=games[iu[0]] - tog, alone_b=games[iu[1]] - tog, theta=theta, z=z, pbar=pbar, points=theta * pbar * (1 - pbar))


def bh(p, q):
    """Benjamini–Hochberg: boolean mask of rejections at level q."""
    p = np.asarray(p)
    m = len(p)
    if m == 0:
        return np.zeros(0, dtype=bool)
    order = np.argsort(p)
    thresh = q * np.arange(1, m + 1) / m
    ok = p[order] <= thresh
    kmax = np.max(np.nonzero(ok)[0]) + 1 if ok.any() else 0
    mask = np.zeros(m, dtype=bool)
    mask[order[:kmax]] = True
    return mask


def candidates(t):
    return (t["together"] >= MIN_TOGETHER) & (t["alone_a"] >= MIN_ALONE) & (t["alone_b"] >= MIN_ALONE) & np.isfinite(t["z"]) & (t["I"] > 0)


def cmd_test(path, out_path):
    d = dict(np.load(path, allow_pickle=True))
    names = list(d["names"])
    halves = {}
    for h in (0, 1):
        c = clusters(d, h)
        f = fit_main(c)
        t = pair_tests(c, f)
        t["cand"] = candidates(t)
        halves[h] = t
        print(f"half {h}: {len(c['k'])} decks, {int(c['k'].sum())} games, Newton {f['iters']} steps, dispersion φ {f['phi']:.3f}, candidates {int(t['cand'].sum())}")
    result = {"names": names, "directions": [], "pairs": {}}
    replicated = {}
    for A, B in ((0, 1), (1, 0)):
        ta, tb = halves[A], halves[B]
        ci = np.nonzero(ta["cand"])[0]
        pA = 2 * stats.norm.sf(np.abs(ta["z"][ci]))
        disc = ci[bh(pA, FDR_DISCOVERY)]
        # replication: same sign, one-sided p in that direction, BH 5% over the discovered set
        sgn = np.sign(ta["z"][disc])
        zB = tb["z"][disc]
        ok_b = np.isfinite(zB)
        p1 = np.where(ok_b, stats.norm.sf(sgn * np.nan_to_num(zB)), 1.0)
        rep_mask = bh(p1, FDR_REPLICATION) & (np.sign(np.nan_to_num(zB)) == sgn)
        rep = disc[rep_mask]
        same = float(np.mean(np.sign(np.nan_to_num(zB)) == sgn)) if len(disc) else float("nan")
        both = ta["cand"] & halves[B]["cand"]
        r_all = (stats.pearsonr(ta["theta"][both], tb["theta"][both]).statistic, stats.spearmanr(ta["theta"][both], tb["theta"][both]).statistic) if both.sum() > 2 else (np.nan, np.nan)
        r_disc = (stats.pearsonr(ta["theta"][disc], np.nan_to_num(tb["theta"][disc])).statistic, stats.spearmanr(ta["theta"][disc], np.nan_to_num(tb["theta"][disc])).statistic) if len(disc) > 2 else (np.nan, np.nan)
        dr = dict(A=A, B=B, candidates=int(len(ci)), discovered=int(len(disc)), discovered_pos=int(np.sum(ta["z"][disc] > 0)), replicated=int(len(rep)), replicated_pos=int(np.sum(ta["z"][rep] > 0)), same_sign=same, r_all=list(map(float, r_all)), r_disc=list(map(float, r_disc)), both_candidates=int(both.sum()))
        result["directions"].append(dr)
        print(f"\nhalf {A} → half {B}: {dr['candidates']} candidates, {dr['discovered']} discovered at FDR 10% ({dr['discovered_pos']} positive), {dr['replicated']} replicate ({dr['replicated_pos']} positive); same sign in half {B}: {same:.0%}")
        print(f"  θ̂ across halves, {dr['both_candidates']} pairs candidates in both: Pearson {r_all[0]:+.3f}, Spearman {r_all[1]:+.3f}; over the discoveries: Pearson {r_disc[0]:+.3f}, Spearman {r_disc[1]:+.3f}")
        for j in rep:
            key = (int(ta["a"][j]), int(ta["b"][j]))
            e = replicated.setdefault(key, {"a": names[key[0]], "b": names[key[1]], "replication": []})
            e["replication"].append({"discovery_half": A, "points": float(tb["points"][j]), "theta": float(tb["theta"][j]), "z": float(tb["z"][j]), "games": float(tb["together"][j]), "discovery_points": float(ta["points"][j])})
    for e in replicated.values():
        e["points"] = float(np.mean([r["points"] for r in e["replication"]]))
        e["both_directions"] = len(e["replication"]) == 2
    rows = sorted(replicated.values(), key=lambda e: -e["points"])
    result["replicated"] = rows
    print(f"\nreplicated pairs: {len(rows)} ({sum(e['points'] > 0 for e in rows)} positive)")
    for e in rows:
        print(f"  {e['points']*100:+.1f} pts  {e['a']} + {e['b']}  ({'both ways' if e['both_directions'] else 'one way'}; discovery {np.mean([r['discovery_points'] for r in e['replication']])*100:+.1f}, games together {int(np.mean([r['games'] for r in e['replication']]))})")
    json.dump(result, open(out_path, "w"), indent=1, default=float)
    return 0


def norm_name(name):
    s = name.split(" // ")[0].replace("’", "'").replace("‘", "'")
    s = "".join(ch for ch in unicodedata.normalize("NFKD", s) if not unicodedata.combining(ch))
    return " ".join(s.lower().split())


def cmd_ship(result_path, feats_path, out_dir, generated):
    res = json.load(open(result_path))
    feats = json.load(open(feats_path))
    pos = [e for e in res["replicated"] if e["points"] > 0]
    for cube in feats["cubes"]:
        by = {norm_name(c["name"]): c["name"] for c in cube["cards"]}
        pairs = []
        for e in pos:
            a, b = by.get(norm_name(e["a"])), by.get(norm_name(e["b"]))
            if a and b:
                pairs.append({"a": a, "b": b, "points": round(e["points"] * 100, 1), "games": int(round(np.mean([r["games"] for r in e["replication"]]))), "bothHalves": e["both_directions"]})
        p = os.path.join(out_dir, f"{cube['file']}.synergy.json")
        if not pairs:
            if os.path.exists(p):
                os.remove(p)
            continue
        doc = {
            "schema": 1,
            "source": {
                "name": "17Lands",
                "page": "https://www.17lands.com/public_datasets",
                "licence": "CC BY 4.0",
                "licenceUrl": "https://creativecommons.org/licenses/by/4.0/",
                "dataset": "Cube - Powered",
                "updated": "2025-11-23",
                "changes": "Card-pair interactions estimated from the game data (docs/card-model.md part D2); only pairs found in one half of the drafts and replicated in the other are kept.",
            },
            "generated": generated,
            "cube": cube["file"],
            "sameCube": cube["id"] == "vintage",
            "pairs": pairs,
        }
        with open(p, "w") as fh:
            json.dump(doc, fh, indent=1, ensure_ascii=False)
            fh.write("\n")
        print(p, len(pairs), "pairs")
    return 0


if __name__ == "__main__":
    a = sys.argv[1:]
    if a[:1] == ["test"] and len(a) == 3:
        sys.exit(cmd_test(a[1], a[2]))
    if a[:1] == ["ship"] and len(a) == 5:
        sys.exit(cmd_ship(a[1], a[2], a[3], a[4]))
    print(__doc__)
    sys.exit(2)

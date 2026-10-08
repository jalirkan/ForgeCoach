# SPDX-License-Identifier: GPL-3.0-or-later
"""ForgeCoach — scripts/card-model/fit.py

docs/card-model.md part A2: the hierarchical card-quality model, its
pre-registered held-out test, and (with --ship) the per-cube model files.

  python -I fit.py test FEATURES.json            the test: 2 directions × 5 card folds, the guard, reported extras
  python -I fit.py ship FEATURES.json OUT_DIR    the full-data fit; writes OUT_DIR/<cube>.model.json

FEATURES.json is `npm run card-model -- export FEATURES.json HALVES_DIR`.

The model (see the doc for the plain-words version). For nonland card i of cube c:

  q_i         = α_c + β z_i + g_col[c,col] + g_type[c,type] + g_mv[c,band] + η_i
  human       y_i = p_i − avg = q_i + κ_c + ε,     var p(1−p)/n + σ_t,c²   (κ, σ_t only for Synergy)
  lab         r_i − 0.5 = λ q_i + b_col + b_type + b_mv + b_cell + e,   var 0.375/g + σ_l²

Everything but the eleven hyperparameters is a Gaussian random effect, so given
them the posterior is exact: η is integrated out card by card (Sherman–Morrison
on each card's one or two observations), the 160 level/group/bias effects u
jointly (one 160×160 Cholesky). The hyperparameters maximise the marginal
likelihood (L-BFGS-B, numeric gradients). Numpy and scipy only; a fit takes
seconds.
"""
import json
import os
import sys

# One BLAS thread: the matrices are small, and threads only fight (a fit takes seconds single-threaded).
for _v in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS"):
    os.environ.setdefault(_v, "1")

import numpy as np  # noqa: E402
from scipy import optimize, sparse, stats  # noqa: E402

COLS = ["W", "U", "B", "R", "G", "M", "C"]
BANDS = ["mv2", "mv34", "mv5"]
VALUE_PER_RATE = 250.0
DISCOUNT = 0.8
LAB_VAR = 0.375
SEED = 20261006
N_BOOT = 10000
K_FOLDS = 5
GUARD_MARGIN = -0.03
HYPER = ["lambda", "sigma_lab", "tau", "sigma_transfer", "sg_col", "sg_type", "sg_mv", "sb_col", "sb_type", "sb_mv", "sb_cell"]


def fnv1a32(s):
    h = 0x811C9DC5
    for b in s.encode("utf-8"):
        h ^= b
        h = (h * 0x01000193) & 0xFFFFFFFF
    return h


def colour_of(c):
    s = c["colors"]
    return "C" if not s else (s if len(s) == 1 else "M")


def band_of(c):
    return 0 if c["mv"] <= 2 else (1 if c["mv"] <= 4 else 2)


def usable(row):
    """A human row as score.ts uses it: present, n > 0, 0 < p < 1 (the file already holds only ≥ minGih rows)."""
    if not row:
        return None
    n, k = row
    if n <= 0 or k <= 0 or k >= n:
        return None
    return n, k


class Data:
    """The cards and the fixed parts of the design."""

    def __init__(self, feats):
        self.cubes = [c["id"] for c in feats["cubes"]]
        self.cube_feats = {c["id"]: c for c in feats["cubes"]}
        cards = []
        for ci, cube in enumerate(feats["cubes"]):
            for c in cube["cards"]:
                if c["land"]:
                    continue
                cards.append(dict(c, cube=cube["id"], ci=ci, col=COLS.index(colour_of(c)), typ=0 if c["creature"] else 1, band=band_of(c)))
        self.cards = cards
        n = len(cards)
        nc = len(self.cubes)
        # u layout
        o = {}
        k = 0
        for name, size in [("alpha", nc), ("kappa", 1), ("beta", 1), ("g_col", nc * 7), ("g_type", nc * 2), ("g_mv", nc * 3), ("b_col", 7), ("b_type", 2), ("b_mv", 3), ("b_cell", 42)]:
            o[name] = (k, k + size)
            k += size
        self.off, self.nu = o, k
        Hq = np.zeros((n, k))
        Hb = np.zeros((n, k))
        for i, c in enumerate(cards):
            ci = c["ci"]
            Hq[i, o["alpha"][0] + ci] = 1
            Hq[i, o["beta"][0]] = (c["prior"] - 50) / 10
            Hq[i, o["g_col"][0] + ci * 7 + c["col"]] = 1
            Hq[i, o["g_type"][0] + ci * 2 + c["typ"]] = 1
            Hq[i, o["g_mv"][0] + ci * 3 + c["band"]] = 1
            Hb[i, o["b_col"][0] + c["col"]] = 1
            Hb[i, o["b_type"][0] + c["typ"]] = 1
            Hb[i, o["b_mv"][0] + c["band"]] = 1
            Hb[i, o["b_cell"][0] + c["col"] * 6 + c["typ"] * 3 + c["band"]] = 1
        self.Hq, self.Hb = Hq, Hb
        self.kappa_col = o["kappa"][0]
        self.syn = np.array([c["cube"] == "synergy" for c in cards])
        g = np.array([c["labGames"] for c in cards], dtype=float)
        self.has_lab = g > 0
        self.lab_y = np.where(self.has_lab, np.nan_to_num(np.array([c["labRate"] if c["labRate"] is not None else 0.5 for c in cards])) - 0.5, 0.0)
        self.lab_var0 = np.where(self.has_lab, LAB_VAR / np.maximum(g, 1), np.inf)
        self.index = {(c["cube"], c["name"]): i for i, c in enumerate(cards)}

    def human_obs(self, key, hide=frozenset()):
        """Per card: (y, binomial var) from human file `key` ('full', 'half0', 'half1'), or None; `hide` = card indices left out."""
        out = [None] * len(self.cards)
        for i, c in enumerate(self.cards):
            if i in hide:
                continue
            cube = self.cube_feats[c["cube"]]
            if key not in cube["humanAvg"]:
                continue
            r = usable(c["human"].get(key))
            if not r:
                continue
            n, k = r
            p = k / n
            out[i] = (p - cube["humanAvg"][key], p * (1 - p) / n)
        return out


class Model:
    def __init__(self, data, human, fixed=None):
        self.d = data
        self.human = human
        self.fixed = fixed or {}
        d = data
        hi = [i for i, h in enumerate(human) if h is not None]
        self.hum_idx = np.array(hi, dtype=int)
        self.hum_y = np.array([human[i][0] for i in hi])
        self.hum_var0 = np.array([human[i][1] for i in hi])
        self.hum_syn = d.syn[self.hum_idx]
        self.lab_idx = np.nonzero(d.has_lab)[0]

    def unpack(self, x):
        h = dict(zip(HYPER, [x[0]] + list(np.exp(x[1:]))))
        h.update(self.fixed)
        return h

    def prior_prec(self, h):
        d = self.d
        p = np.zeros(d.nu)
        o = d.off
        p[o["alpha"][0]:o["alpha"][1]] = 1 / 0.1**2
        p[o["kappa"][0]:o["kappa"][1]] = 1 / 0.1**2
        p[o["beta"][0]:o["beta"][1]] = 1 / 0.05**2
        for blk, s in [("g_col", "sg_col"), ("g_type", "sg_type"), ("g_mv", "sg_mv"), ("b_col", "sb_col"), ("b_type", "sb_type"), ("b_mv", "sb_mv"), ("b_cell", "sb_cell")]:
            p[o[blk][0]:o[blk][1]] = 1 / max(h[s], 1e-8) ** 2
        return p

    def system(self, h):
        """Stacked observations: rows H, y, var, η loading, card index."""
        d = self.d
        lam = h["lambda"]
        Hh = d.Hq[self.hum_idx].copy()
        Hh[self.hum_syn, d.kappa_col] = 1
        vh = self.hum_var0 + np.where(self.hum_syn, h["sigma_transfer"] ** 2, 0.0)
        Hl = lam * d.Hq[self.lab_idx] + d.Hb[self.lab_idx]
        vl = d.lab_var0[self.lab_idx] + h["sigma_lab"] ** 2
        H = np.vstack([Hh, Hl])
        y = np.concatenate([self.hum_y, d.lab_y[self.lab_idx]])
        v = np.concatenate([vh, vl])
        load = np.concatenate([np.ones(len(vh)), np.full(len(vl), lam)])
        card = np.concatenate([self.hum_idx, self.lab_idx])
        return H, y, v, load, card

    def solve(self, h):
        d = self.d
        n = len(d.cards)
        H, y, v, load, card = self.system(h)
        tau2 = h["tau"] ** 2
        w = 1 / v
        s = np.bincount(card, weights=load**2 * w, minlength=n)
        t = np.bincount(card, weights=load * y * w, minlength=n)
        inc = sparse.csr_matrix((load * w, (card, np.arange(len(card)))), shape=(n, len(card)))
        V = inc @ H
        c = tau2 / (1 + tau2 * s)
        P0 = self.prior_prec(h)
        Lam = (H * w[:, None]).T @ H - V.T @ (V * c[:, None]) + np.diag(P0)
        b = H.T @ (y * w) - V.T @ (c * t)
        yCy = np.sum(y * y * w) - np.sum(c * t * t)
        L = np.linalg.cholesky(Lam)
        m = np.linalg.solve(L.T, np.linalg.solve(L, b))
        logdetLam = 2 * np.sum(np.log(np.diag(L)))
        ll = -0.5 * (yCy - b @ m + logdetLam - np.sum(np.log(P0)) + np.sum(np.log(v)) + np.sum(np.log1p(tau2 * s)) + len(y) * np.log(2 * np.pi))
        return dict(L=L, m=m, s=s, t=t, V=V, ll=ll, tau2=tau2)

    def nll(self, x):
        try:
            return -self.solve(self.unpack(x))["ll"]
        except np.linalg.LinAlgError:
            return 1e12

    def fit(self):
        best = None
        for lam0 in (1.0, 0.5):
            x0 = np.array([lam0, np.log(0.02), np.log(0.03), np.log(0.01)] + [np.log(0.01)] * 7)
            bounds = [(-3, 5)] + [(np.log(1e-4), np.log(1.0))] * 10
            r = optimize.minimize(self.nll, x0, method="L-BFGS-B", bounds=bounds, options={"ftol": 1e-7})
            if best is None or r.fun < best.fun:
                best = r
        self.x = best.x
        self.h = self.unpack(best.x)
        self.sol = self.solve(self.h)
        self.converged = bool(best.success)
        return self

    def posterior_q(self):
        """Posterior mean and SD of each card's q (and of q + κ for Synergy cards)."""
        d, S = self.d, self.sol
        pi = 1 / S["tau2"] + S["s"]
        A = d.Hq - S["V"] / pi[:, None]
        mean = S["t"] / pi + A @ S["m"]
        Z = np.linalg.solve(S["L"], A.T)
        var = 1 / pi + np.sum(Z * Z, axis=0)
        return mean, np.sqrt(var)

    def kappa(self):
        return self.sol["m"][self.d.kappa_col]

    def effects(self, block):
        """Posterior mean and SD of one block of u."""
        a, b = self.d.off[block]
        L = self.sol["L"]
        E = np.zeros((self.d.nu, b - a))
        E[np.arange(a, b), np.arange(b - a)] = 1
        Z = np.linalg.solve(L, E)
        return self.sol["m"][a:b], np.sqrt(np.sum(Z * Z, axis=0))


def spearman(a, b):
    return stats.spearmanr(a, b).statistic


def rmse(pred, y):
    return float(np.sqrt(np.mean((pred - y) ** 2)))


def boot_diff(fn_model, fn_base, n, rng):
    out = np.empty(N_BOOT)
    for r in range(N_BOOT):
        ix = rng.integers(0, n, n)
        out[r] = fn_model(ix) - fn_base(ix)
    return float(np.percentile(out, 2.5)), float(np.percentile(out, 97.5))


def targets(data, cube, key):
    """Target cards: nonland, a usable row in human file `key`, lab games."""
    out = []
    for i, c in enumerate(data.cards):
        if c["cube"] != cube or not data.has_lab[i]:
            continue
        r = usable(c["human"].get(key))
        if r:
            out.append(i)
    return out


def held_out(data, A, B, fixed=None):
    """One direction: per fold, fit without the fold's human rows; return per-card held-out predictions and today's calibrated rate."""
    fold = np.array([fnv1a32(c["name"]) % K_FOLDS for c in data.cards])
    pred, today_rate, fits = {}, {}, []
    full_A = data.human_obs(A)
    for k in range(K_FOLDS):
        hide = frozenset(int(i) for i in np.nonzero(fold == k)[0])
        human = data.human_obs(A, hide)
        m = Model(data, human, fixed).fit()
        fits.append(m)
        mean, _ = m.posterior_q()
        for cube in ("vintage", "synergy"):
            avg = data.cube_feats[cube]["humanAvg"][A]
            kap = m.kappa() if cube == "synergy" else 0.0
            # today's value → rate: OLS on this cube's training cards (half-A rate on today's value)
            tr = [i for i in range(len(data.cards)) if data.cards[i]["cube"] == cube and human[i] is not None]
            xv = np.array([data.cards[i]["labValue"] for i in tr])
            yv = np.array([full_A[i][0] + avg for i in tr])
            slope, icpt = np.polyfit(xv, yv, 1)
            for i in targets(data, cube, B):
                if fold[i] != k:
                    continue
                pred[i] = avg + mean[i] + kap
                today_rate[i] = icpt + slope * data.cards[i]["labValue"]
    return pred, today_rate, fits


def evaluate(data, cube, A, B, pred, today_rate, rng):
    idx = [i for i in targets(data, cube, B) if i in pred]
    y = np.array([data.cards[i]["human"][B][1] / data.cards[i]["human"][B][0] for i in idx])
    pm = np.array([pred[i] for i in idx])
    tv = np.array([data.cards[i]["labValue"] for i in idx])
    tr = np.array([today_rate[i] for i in idx])
    res = dict(n=len(idx), rho_model=spearman(pm, y), rho_today=spearman(tv, y), rmse_model=rmse(pm, y), rmse_today=rmse(tr, y))
    res["d_rho"] = res["rho_model"] - res["rho_today"]
    res["d_rmse"] = res["rmse_today"] - res["rmse_model"]
    res["d_rho_ci"] = boot_diff(lambda ix: spearman(pm[ix], y[ix]), lambda ix: spearman(tv[ix], y[ix]), len(idx), rng)
    res["d_rmse_ci"] = boot_diff(lambda ix: rmse(tr[ix], y[ix]), lambda ix: rmse(pm[ix], y[ix]), len(idx), rng)
    return res


def guard(data, A, B, rng):
    m = Model(data, data.human_obs(A)).fit()
    mean, _ = m.posterior_q()
    idx = targets(data, "vintage", B)
    y = np.array([data.cards[i]["human"][B][1] / data.cards[i]["human"][B][0] for i in idx])
    pm = mean[idx]
    tv = np.array([data.cards[i]["cardValueHalf" + A[-1]] for i in idx])
    r = dict(n=len(idx), rho_model=spearman(pm, y), rho_today=spearman(tv, y))
    r["d_rho"] = r["rho_model"] - r["rho_today"]
    r["d_rho_ci"] = boot_diff(lambda ix: spearman(pm[ix], y[ix]), lambda ix: spearman(tv[ix], y[ix]), len(idx), rng)
    return r


def f3(x):
    return f"{x:+.3f}"


def ci(c):
    return f"[{f3(c[0])}, {f3(c[1])}]"


def cmd_test(path):
    data = Data(json.load(open(path)))
    rng = np.random.Generator(np.random.PCG64(SEED))
    out = {"directions": []}
    passes = {"vintage": True, "synergy_rho": [], "synergy_rmse": [], "guard": True}
    for A, B in (("half0", "half1"), ("half1", "half0")):
        pred, today_rate, fits = held_out(data, A, B)
        dr = {"A": A, "B": B, "hyper": [f.h for f in fits], "converged": [f.converged for f in fits]}
        for cube in ("vintage", "synergy"):
            dr[cube] = evaluate(data, cube, A, B, pred, today_rate, rng)
        dr["guard"] = guard(data, A, B, rng)
        # reported only: biases switched off
        pred0, _, _ = held_out(data, A, B, fixed={"sb_col": 1e-6, "sb_type": 1e-6, "sb_mv": 1e-6, "sb_cell": 1e-6})
        idx = [i for i in targets(data, "vintage", B) if i in pred0]
        y = np.array([data.cards[i]["human"][B][1] / data.cards[i]["human"][B][0] for i in idx])
        dr["vintage_no_bias_rho"] = spearman(np.array([pred0[i] for i in idx]), y)
        out["directions"].append(dr)
        v, s, g = dr["vintage"], dr["synergy"], dr["guard"]
        passes["vintage"] &= v["d_rho_ci"][0] > 0 and v["d_rmse_ci"][0] > 0
        passes["synergy_rho"].append(s["d_rho"])
        passes["synergy_rmse"].append(s["d_rmse"])
        passes["guard"] &= g["d_rho_ci"][0] > GUARD_MARGIN
        print(f"\n{A} → {B}")
        for cube in ("vintage", "synergy"):
            r = dr[cube]
            print(f"  {cube:8} n {r['n']:3}  rho today {r['rho_today']:.3f} → model {r['rho_model']:.3f}  Δrho {f3(r['d_rho'])} {ci(r['d_rho_ci'])}   RMSE today {r['rmse_today']:.4f} → model {r['rmse_model']:.4f}  ΔRMSE {r['d_rmse']:+.4f} [{r['d_rmse_ci'][0]:+.4f}, {r['d_rmse_ci'][1]:+.4f}]")
        print(f"  guard (human visible, vintage) n {g['n']}  rho today's blend {g['rho_today']:.3f} → model {g['rho_model']:.3f}  Δrho {f3(g['d_rho'])} {ci(g['d_rho_ci'])}")
        print(f"  reported: vintage held-out rho with the biases off {dr['vintage_no_bias_rho']:.3f}; fits converged {dr['converged']}")
    syn_ok = np.mean(passes["synergy_rho"]) >= 0 and np.mean(passes["synergy_rmse"]) >= 0
    decision = passes["vintage"] and syn_ok and passes["guard"]
    out["rule"] = dict(vintage=passes["vintage"], synergy=bool(syn_ok), synergy_mean_d_rho=float(np.mean(passes["synergy_rho"])), synergy_mean_d_rmse=float(np.mean(passes["synergy_rmse"])), guard=passes["guard"], passes=bool(decision))
    print(f"\nRule: vintage {passes['vintage']}, synergy {syn_ok} (mean Δrho {np.mean(passes['synergy_rho']):+.3f}, mean ΔRMSE {np.mean(passes['synergy_rmse']):+.4f}), guard {passes['guard']} → {'PASS' if decision else 'FAIL'}")
    json.dump(out, open(path.replace(".json", "") + ".test-result.json", "w"), indent=1, default=float)
    return 0


def full_fit(data):
    return Model(data, data.human_obs("full")).fit()


def cmd_report(path):
    """Reported extras on the full-data fit: hyperparameters, biases, interval widths."""
    data = Data(json.load(open(path)))
    m = full_fit(data)
    print("hyperparameters:", {k: round(v, 4) for k, v in m.h.items()}, "converged", m.converged)
    print(f"beta (per 10 prior points) {m.effects('beta')[0][0]:+.4f} ± {m.effects('beta')[1][0]:.4f}; kappa_syn {m.kappa():+.4f}")
    for blk, labels in [("b_col", COLS), ("b_type", ["creature", "noncreature"]), ("b_mv", BANDS)]:
        mu, sd = m.effects(blk)
        print(blk, "  ".join(f"{l} {100*a:+.1f} [{100*(a-1.96*s):+.1f}, {100*(a+1.96*s):+.1f}]" for l, a, s in zip(labels, mu, sd)))
    mu, sd = m.effects("b_cell")
    cells = []
    for col in range(7):
        for t in range(2):
            for b in range(3):
                j = col * 6 + t * 3 + b
                n = sum(1 for i, c in enumerate(data.cards) if c["col"] == col and c["typ"] == t and c["band"] == b and data.has_lab[i])
                nh = sum(1 for i, c in enumerate(data.cards) if c["col"] == col and c["typ"] == t and c["band"] == b and m.human[i] is not None)
                cells.append((COLS[col] + "/" + ("cr" if t == 0 else "nc") + "/" + BANDS[b], mu[j], sd[j], n, nh))
    # total bias per cell (main effects + cell)
    tot = []
    um, L = m.sol["m"], m.sol["L"]
    for col in range(7):
        for t in range(2):
            for b in range(3):
                e = np.zeros(data.nu)
                for blk, j in [("b_col", col), ("b_type", t), ("b_mv", b), ("b_cell", col * 6 + t * 3 + b)]:
                    e[data.off[blk][0] + j] = 1
                z = np.linalg.solve(L, e)
                nh = sum(1 for i, c in enumerate(data.cards) if c["col"] == col and c["typ"] == t and c["band"] == b and m.human[i] is not None)
                n = sum(1 for i, c in enumerate(data.cards) if c["col"] == col and c["typ"] == t and c["band"] == b and data.has_lab[i])
                tot.append((COLS[col] + "/" + ("cr" if t == 0 else "nc") + "/" + BANDS[b], e @ um, np.sqrt(z @ z), n, nh))
    tot.sort(key=lambda r: r[1])
    print("total lab bias by cell (lab points; most under-rated first): cell, bias [95%], lab cards, human cards")
    for r in tot:
        print(f"  {r[0]:14} {100*r[1]:+.2f} [{100*(r[1]-1.96*r[2]):+.2f}, {100*(r[1]+1.96*r[2]):+.2f}]  {r[3]:4} {r[4]:3}")
    mean, sd = m.posterior_q()
    for cube in data.cubes:
        ix = [i for i, c in enumerate(data.cards) if c["cube"] == cube]
        w = 2 * 1.96 * sd[ix] * VALUE_PER_RATE * DISCOUNT
        g = [data.cards[i]["labGames"] for i in ix]
        print(f"  {cube:11} cards {len(ix):3}  median lab games {int(np.median(g)):5}  median 95% interval width {np.median(w):.1f} value points; alpha {m.effects('alpha')[0][data.cubes.index(cube)]:+.4f}")
    return 0


def cmd_ship(path, out_dir, generated):
    import os

    feats = json.load(open(path))
    data = Data(feats)
    m = full_fit(data)
    mean, sd = m.posterior_q()
    hyper = {k: round(float(v), 6) for k, v in m.h.items()}
    for cube in data.cubes:
        f = data.cube_feats[cube]
        cards = {}
        for i, c in enumerate(data.cards):
            if c["cube"] != cube:
                continue
            v = 50 + VALUE_PER_RATE * DISCOUNT * mean[i]
            half = 1.96 * VALUE_PER_RATE * DISCOUNT * sd[i]
            cards[c["name"]] = {"value": round(float(np.clip(v, 5, 98)), 1), "lo": round(float(np.clip(v - half, 5, 98)), 1), "hi": round(float(np.clip(v + half, 5, 98)), 1), "human": m.human[i] is not None, "lab": bool(data.has_lab[i])}
        doc = {
            "schema": 1,
            "model": "card-model A2 (docs/card-model.md)",
            "generated": generated,
            "cube": f["file"],
            "scale": "value = 50 + 200·q (q: human GIH win rate above the Powered Cube's average); lo/hi the 95% interval, hyperparameters not propagated",
            "sources": "the cube lab's meta (Forge-vs-Forge) and, for Vintage and Synergy, 17Lands Powered Cube game data (CC BY 4.0)",
            "hyper": hyper,
            "cards": cards,
        }
        p = os.path.join(out_dir, f"{f['file']}.model.json")
        with open(p, "w") as fh:
            json.dump(doc, fh, indent=0, separators=(",", ":"), ensure_ascii=False)
            fh.write("\n")
        print(p, len(cards), "cards")
    return 0


if __name__ == "__main__":
    a = sys.argv[1:]
    if a[:1] == ["test"] and len(a) == 2:
        sys.exit(cmd_test(a[1]))
    if a[:1] == ["report"] and len(a) == 2:
        sys.exit(cmd_report(a[1]))
    if a[:1] == ["ship"] and len(a) == 4:
        sys.exit(cmd_ship(a[1], a[2], a[3]))
    print(__doc__)
    sys.exit(2)

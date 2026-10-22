#!/usr/bin/env python3
"""
Bwenge.AI deterministic analysis engine.

Runs a fixed, whitelisted set of statistical operations described by a JSON request; it never evaluates
code, formulas or expressions from the request. Input arrives on stdin, results leave on stdout as JSON.
The caller (server/services/outputs/pythonRunner.ts) runs this file in a separate process with a clean
environment, a temporary working directory, a time limit and, where the host allows, no network namespace.
This module additionally sets resource limits and disables sockets before importing numpy/pandas.

Request:
  {"dataset": {"columns": [{"name": str, "type": "numeric|categorical|boolean|datetime|text"}], "rows": [[...]]},
   "filters": [{"column", "op", "value"}], "operations": [{"op": "...", ...}]}
"""
import json
import math
import os
import sys

VERSION = "bwenge-analysis-py-1.0.0"


def _harden():
    try:
        import resource
        mem = int(os.environ.get("ANALYSIS_MEM_MB", "1024")) * 1024 * 1024
        cpu = int(os.environ.get("ANALYSIS_CPU_SECONDS", "60"))
        resource.setrlimit(resource.RLIMIT_AS, (mem, mem))
        resource.setrlimit(resource.RLIMIT_CPU, (cpu, cpu + 1))
        resource.setrlimit(resource.RLIMIT_NOFILE, (64, 64))
        resource.setrlimit(resource.RLIMIT_FSIZE, (16 * 1024 * 1024, 16 * 1024 * 1024))
    except Exception:  # pragma: no cover - platform without resource limits
        pass
    import socket

    def _blocked(*_a, **_k):
        raise PermissionError("network access is disabled in the analysis engine")

    socket.socket = _blocked  # type: ignore[assignment]
    socket.create_connection = _blocked  # type: ignore[assignment]
    socket.getaddrinfo = _blocked  # type: ignore[assignment]


class InputError(Exception):
    pass


# ── Distributions (deterministic, no scipy needed) ─────────────────────────────

def _betacf(a, b, x):
    qab, qap, qam = a + b, a + 1.0, a - 1.0
    c, d = 1.0, 1.0 - qab * x / qap
    d = 1.0 / (d if abs(d) > 1e-300 else 1e-300)
    h = d
    for m in range(1, 300):
        m2 = 2 * m
        aa = m * (b - m) * x / ((qam + m2) * (a + m2))
        d = 1.0 + aa * d
        d = 1.0 / (d if abs(d) > 1e-300 else 1e-300)
        c = 1.0 + aa / (c if abs(c) > 1e-300 else 1e-300)
        h *= d * c
        aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2))
        d = 1.0 + aa * d
        d = 1.0 / (d if abs(d) > 1e-300 else 1e-300)
        c = 1.0 + aa / (c if abs(c) > 1e-300 else 1e-300)
        dl = d * c
        h *= dl
        if abs(dl - 1.0) < 3e-14:
            break
    return h


def incomplete_beta(x, a, b):
    """Regularised incomplete beta I_x(a, b)."""
    if x <= 0:
        return 0.0
    if x >= 1:
        return 1.0
    lbt = math.lgamma(a + b) - math.lgamma(a) - math.lgamma(b) + a * math.log(x) + b * math.log(1 - x)
    if x < (a + 1) / (a + b + 2):
        return math.exp(lbt) * _betacf(a, b, x) / a
    return 1.0 - math.exp(lbt) * _betacf(b, a, 1 - x) / b


def t_two_sided_p(t, df):
    if df <= 0 or t is None or not math.isfinite(t):
        return None
    return incomplete_beta(df / (df + t * t), df / 2.0, 0.5)


def t_quantile(p, df):
    """Quantile of Student's t (p in (0,1)) by bisection on the CDF."""
    lo, hi = -1e3, 1e3
    for _ in range(200):
        mid = (lo + hi) / 2
        cdf = 1 - 0.5 * t_two_sided_p(mid, df) if mid >= 0 else 0.5 * t_two_sided_p(mid, df)
        if cdf < p:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2


def f_sf(f, d1, d2):
    if f is None or not math.isfinite(f) or f < 0:
        return None
    return incomplete_beta(d2 / (d2 + d1 * f), d2 / 2.0, d1 / 2.0)


def _gamma_q(a, x):
    if x <= 0:
        return 1.0
    if x < a + 1:
        s, term, n = 1.0 / a, 1.0 / a, a
        for _ in range(500):
            n += 1
            term *= x / n
            s += term
            if abs(term) < abs(s) * 1e-15:
                break
        return 1.0 - s * math.exp(-x + a * math.log(x) - math.lgamma(a))
    b, c, d = x + 1 - a, 1e300, 1.0 / (x + 1 - a)
    h = d
    for i in range(1, 500):
        an = -i * (i - a)
        b += 2
        d = an * d + b
        d = 1.0 / (d if abs(d) > 1e-300 else 1e-300)
        c = b + an / (c if abs(c) > 1e-300 else 1e-300)
        dl = d * c
        h *= dl
        if abs(dl - 1) < 1e-15:
            break
    return math.exp(-x + a * math.log(x) - math.lgamma(a)) * h


def chi2_sf(x, df):
    return _gamma_q(df / 2.0, x / 2.0)


# ── Helpers ───────────────────────────────────────────────────────────────────

def _clean(v):
    """JSON-safe values: NaN/inf become null; numpy scalars become Python numbers."""
    import numpy as np
    if isinstance(v, dict):
        return {str(k): _clean(x) for k, x in v.items()}
    if isinstance(v, (list, tuple)):
        return [_clean(x) for x in v]
    if isinstance(v, (np.integer,)):
        return int(v)
    if isinstance(v, (np.floating, float)):
        f = float(v)
        return f if math.isfinite(f) else None
    if isinstance(v, (np.bool_,)):
        return bool(v)
    if v is None or isinstance(v, (str, int, bool)):
        return v
    if hasattr(v, "isoformat"):
        try:
            return v.isoformat()
        except Exception:
            return str(v)
    try:
        import pandas as pd
        if pd.isna(v):
            return None
    except Exception:
        pass
    return str(v)


def _col(df, name, kinds=None, types=None):
    if name not in df.columns:
        raise InputError(f'Column "{name}" does not exist.')
    if kinds and types.get(name) not in kinds:
        raise InputError(f'Column "{name}" is {types.get(name)}; this operation needs {" or ".join(kinds)}.')
    return df[name]


def build_frame(dataset):
    import pandas as pd
    cols = dataset.get("columns") or []
    rows = dataset.get("rows") or []
    if not cols:
        raise InputError("The dataset has no columns.")
    names = [c["name"] for c in cols]
    if len(set(names)) != len(names):
        raise InputError("Column names must be unique.")
    for r in rows:
        if len(r) != len(names):
            raise InputError("Every row must have one value per column.")
    df = pd.DataFrame(rows, columns=names)
    types = {}
    for c in cols:
        t = c.get("type", "text")
        types[c["name"]] = t
        if t == "numeric":
            df[c["name"]] = pd.to_numeric(df[c["name"]], errors="coerce").astype("float64")
        elif t == "datetime":
            df[c["name"]] = pd.to_datetime(df[c["name"]], errors="coerce", utc=False, format="mixed")
        else:
            df[c["name"]] = df[c["name"]].astype("object")
    return df, types


FILTER_OPS = {"eq", "ne", "gt", "gte", "lt", "lte", "in", "notin", "isnull", "notnull"}


def apply_filters(df, types, filters):
    applied = []
    for f in filters or []:
        op = f.get("op")
        if op not in FILTER_OPS:
            raise InputError(f'Unknown filter operator "{op}".')
        s = _col(df, f.get("column"), types=types)
        v = f.get("value")
        before = len(df)
        if op in ("gt", "gte", "lt", "lte") and types.get(f["column"]) not in ("numeric", "datetime"):
            raise InputError(f'"{op}" needs a numeric or date column; "{f["column"]}" is {types.get(f["column"])}.')
        if types.get(f["column"]) == "datetime" and v is not None and op not in ("isnull", "notnull", "in", "notin"):
            import pandas as pd
            v = pd.to_datetime(v)
        mask = {
            "eq": lambda: s == v, "ne": lambda: s != v, "gt": lambda: s > v, "gte": lambda: s >= v, "lt": lambda: s < v, "lte": lambda: s <= v,
            "in": lambda: s.isin(v if isinstance(v, list) else [v]), "notin": lambda: ~s.isin(v if isinstance(v, list) else [v]),
            "isnull": lambda: s.isna(), "notnull": lambda: s.notna(),
        }[op]()
        df = df[mask.fillna(False)]
        applied.append({"column": f["column"], "op": op, "value": _clean(f.get("value")), "rowsBefore": before, "rowsAfter": len(df)})
    return df, applied


def _quantiles(x):
    import numpy as np
    q = np.quantile(x, [0.25, 0.5, 0.75])  # linear interpolation (R type 7)
    return float(q[0]), float(q[1]), float(q[2])


def _skew_kurt(x):
    import numpy as np
    n = len(x)
    if n < 3:
        return None, None
    m = x.mean()
    s2 = ((x - m) ** 2).mean()
    if s2 == 0:
        return None, None
    g1 = ((x - m) ** 3).mean() / s2 ** 1.5
    g2 = ((x - m) ** 4).mean() / s2 ** 2 - 3
    skew = g1 * math.sqrt(n * (n - 1)) / (n - 2)
    kurt = None
    if n > 3:
        kurt = ((n + 1) * g2 + 6) * (n - 1) / ((n - 2) * (n - 3))
    return float(skew), (float(kurt) if kurt is not None else None)


# ── Operations ─────────────────────────────────────────────────────────────────

def op_describe(df, types, spec):
    import numpy as np
    columns = spec.get("columns") or list(df.columns)
    out = []
    for name in columns:
        s = _col(df, name, types=types)
        t = types[name]
        missing = int(s.isna().sum())
        if t == "numeric":
            x = s.dropna().to_numpy(dtype=float)
            n = len(x)
            row = {"column": name, "type": t, "n": n, "missing": missing}
            if n:
                q1, med, q3 = _quantiles(x)
                sd = float(np.std(x, ddof=1)) if n > 1 else None
                skew, kurt = _skew_kurt(x)
                row.update({"mean": float(x.mean()), "sd": sd, "se": (sd / math.sqrt(n)) if sd is not None else None, "min": float(x.min()), "q1": q1,
                            "median": med, "q3": q3, "max": float(x.max()), "iqr": q3 - q1, "skewness": skew, "excessKurtosis": kurt, "sum": float(x.sum())})
            out.append(row)
        else:
            vc = s.dropna().astype(str).value_counts()
            out.append({"column": name, "type": t, "n": int(s.notna().sum()), "missing": missing, "unique": int(vc.size),
                        "top": (vc.index[0] if vc.size else None), "topCount": (int(vc.iloc[0]) if vc.size else None)})
    return {"op": "describe", "rows": out, "method": "Sample standard deviation (n − 1); quartiles by linear interpolation (R type 7); adjusted Fisher–Pearson skewness.",
            "assumptions": [], "warnings": [f'{r["column"]}: fewer than 2 values, no standard deviation.' for r in out if r.get("type") == "numeric" and r["n"] < 2]}


def op_missing(df, types, spec):
    total = len(df)
    rows = [{"column": c, "missing": int(df[c].isna().sum()), "percent": (100.0 * df[c].isna().sum() / total) if total else None} for c in df.columns]
    complete = int(df.dropna().shape[0])
    return {"op": "missing", "rows": rows, "rowsTotal": total, "completeRows": complete,
            "method": "Counts of empty values after the dataset's missing-value tokens were applied.", "assumptions": [],
            "warnings": [f'{r["column"]}: {r["percent"]:.1f}% missing.' for r in rows if r["percent"] and r["percent"] >= 20]}


def op_distribution(df, types, spec):
    import numpy as np
    name = spec.get("column")
    s = _col(df, name, types=types)
    if types[name] == "numeric":
        x = s.dropna().to_numpy(dtype=float)
        if len(x) < 2:
            raise InputError(f'"{name}" needs at least 2 values for a distribution.')
        bins = spec.get("bins")
        method = "fixed"
        if not bins:
            q1, _, q3 = _quantiles(x)
            method = "Freedman–Diaconis" if q3 > q1 else "Sturges"
            bins = "fd" if q3 > q1 else "sturges"
        counts, edges = np.histogram(x, bins=bins)
        skew, kurt = _skew_kurt(x)
        return {"op": "distribution", "column": name, "kind": "numeric", "n": int(len(x)), "missing": int(s.isna().sum()),
                "bins": [{"from": float(edges[i]), "to": float(edges[i + 1]), "count": int(counts[i])} for i in range(len(counts))],
                "skewness": skew, "excessKurtosis": kurt, "method": f"Histogram with {method} bin width; the last bin includes its upper edge.", "assumptions": [], "warnings": []}
    vc = s.dropna().astype(str).value_counts()
    n = int(vc.sum())
    top = vc.iloc[:50]
    rows = [{"value": k, "count": int(v), "percent": 100.0 * v / n if n else None} for k, v in top.items()]
    if vc.size > 50:
        rest = int(vc.iloc[50:].sum())
        rows.append({"value": "(other values)", "count": rest, "percent": 100.0 * rest / n})
    return {"op": "distribution", "column": name, "kind": "categorical", "n": n, "missing": int(s.isna().sum()), "rows": rows,
            "method": "Frequency table of non-missing values; percentages of non-missing values.", "assumptions": [], "warnings": []}


AGGS = {"count", "mean", "median", "sum", "min", "max", "std"}


def op_groupby(df, types, spec):
    by = spec.get("by") or []
    metrics = spec.get("metrics") or []
    if not by or len(by) > 3:
        raise InputError("Group by 1 to 3 columns.")
    for b in by:
        _col(df, b, ["categorical", "boolean", "text", "datetime", "numeric"], types)
    for m in metrics:
        if m.get("agg") not in AGGS:
            raise InputError(f'Unknown aggregation "{m.get("agg")}".')
        if m.get("agg") != "count":
            _col(df, m.get("column"), ["numeric"], types)
        else:
            _col(df, m.get("column"), types=types)
    g = df.copy()
    for b in by:
        g[b] = g[b].astype(object).where(g[b].notna(), "(missing)")
    grouped = g.groupby(by, dropna=False, sort=True)
    sizes = grouped.size()
    if len(sizes) > 5000:
        raise InputError(f"{len(sizes)} groups; at most 5000 are allowed.")
    rows = []
    for key, part in grouped:
        key = key if isinstance(key, tuple) else (key,)
        row = {b: _clean(k) for b, k in zip(by, key)}
        row["n"] = int(len(part))
        for m in metrics:
            col, agg = m["column"], m["agg"]
            s = part[col]
            label = m.get("as") or f"{agg}_{col}"
            if agg == "count":
                row[label] = int(s.notna().sum())
            else:
                x = s.dropna()
                row[label] = None if x.empty else float({"mean": x.mean, "median": x.median, "sum": x.sum, "min": x.min, "max": x.max, "std": lambda: x.std(ddof=1)}[agg]())
        rows.append(row)
    small = [r for r in rows if r["n"] < 5]
    return {"op": "groupby", "by": by, "rows": rows, "method": "Groups of rows sharing the same values; missing group values shown as \"(missing)\"; aggregations ignore missing values; std uses n − 1.",
            "assumptions": [], "warnings": ([f"{len(small)} group(s) have fewer than 5 rows; their statistics are unstable."] if small else [])}


def op_pivot(df, types, spec):
    index, columns, values, agg = spec.get("index"), spec.get("columns"), spec.get("values"), spec.get("agg", "mean")
    if agg not in AGGS:
        raise InputError(f'Unknown aggregation "{agg}".')
    _col(df, index, types=types)
    _col(df, columns, types=types)
    _col(df, values, ["numeric"] if agg != "count" else None, types)
    g = df[[index, columns, values]].copy()
    for c in (index, columns):
        g[c] = g[c].astype(object).where(g[c].notna(), "(missing)").astype(str)
    func = {"mean": "mean", "median": "median", "sum": "sum", "min": "min", "max": "max", "std": "std", "count": "count"}[agg]
    pt = g.pivot_table(index=index, columns=columns, values=values, aggfunc=func, dropna=False, observed=False)
    if pt.size > 20000:
        raise InputError("The pivot table would have more than 20,000 cells.")
    return {"op": "pivot", "index": index, "columns": [str(c) for c in pt.columns], "rows": [{"key": str(k), "values": [_clean(v) for v in pt.loc[k].tolist()]} for k in pt.index],
            "agg": agg, "valueColumn": values, "method": f"Pivot of {values} by {index} × {columns} using {agg}; empty cells mean no rows.", "assumptions": [], "warnings": []}


def op_correlation(df, types, spec):
    import numpy as np
    cols = spec.get("columns") or [c for c in df.columns if types[c] == "numeric"]
    method = spec.get("method", "pearson")
    if method not in ("pearson", "spearman"):
        raise InputError('Correlation method must be "pearson" or "spearman".')
    if len(cols) < 2:
        raise InputError("Correlation needs at least two numeric columns.")
    for c in cols:
        _col(df, c, ["numeric"], types)
    pairs, warnings = [], []
    for i in range(len(cols)):
        for j in range(i + 1, len(cols)):
            a, b = cols[i], cols[j]
            sub = df[[a, b]].dropna()
            n = len(sub)
            r = p = None
            note = None
            if n >= 3:
                x, y = sub[a].to_numpy(float), sub[b].to_numpy(float)
                if method == "spearman":
                    import pandas as pd
                    x, y = pd.Series(x).rank().to_numpy(), pd.Series(y).rank().to_numpy()
                if np.std(x) == 0 or np.std(y) == 0:
                    note = "one column is constant; correlation undefined"
                else:
                    r = float(np.corrcoef(x, y)[0, 1])
                    if abs(r) < 1:
                        t = r * math.sqrt((n - 2) / (1 - r * r))
                        p = t_two_sided_p(t, n - 2)
                    else:
                        p = 0.0
            else:
                note = "fewer than 3 complete pairs"
            if n and n < 10:
                warnings.append(f"{a} × {b}: only {n} complete pairs; the estimate is very uncertain.")
            pairs.append({"x": a, "y": b, "n": n, "r": r, "p": p, "note": note})
    return {"op": "correlation", "method": method, "pairs": pairs,
            "methodDescription": ("Pearson product-moment correlation" if method == "pearson" else "Spearman rank correlation (average ranks for ties)") + " on pairwise complete observations; two-sided p-value from the t distribution with n − 2 df.",
            "assumptions": (["Pearson measures linear association and is sensitive to outliers; check a scatter plot."] if method == "pearson" else ["Spearman measures monotonic association."]),
            "warnings": warnings, "interpretation": "Correlation shows association only. It does not show that one variable causes the other."}


def op_regression(df, types, spec):
    import numpy as np
    import pandas as pd
    yname = spec.get("y")
    xnames = spec.get("x") or []
    _col(df, yname, ["numeric"], types)
    if not xnames:
        raise InputError("Give at least one predictor in x.")
    if yname in xnames:
        raise InputError("The outcome cannot also be a predictor.")
    for x in xnames:
        _col(df, x, ["numeric", "categorical", "boolean"], types)
    data = df[[yname] + xnames].dropna()
    dropped = len(df) - len(data)
    design, names, refs = [], [], {}
    for x in xnames:
        if types[x] == "numeric":
            design.append(data[x].to_numpy(float))
            names.append(x)
        else:
            levels = sorted(data[x].astype(str).unique().tolist())
            if len(levels) > 20:
                raise InputError(f'"{x}" has {len(levels)} categories; at most 20 can be used as a predictor.')
            if len(levels) < 2:
                raise InputError(f'"{x}" has only one category in the complete rows.')
            refs[x] = levels[0]
            for lv in levels[1:]:
                design.append((data[x].astype(str) == lv).to_numpy(float))
                names.append(f"{x}={lv}")
    n, k = len(data), len(names)
    p_ = k + 1
    if n < p_ + 2:
        raise InputError(f"Only {n} complete rows for {p_} coefficients; regression needs at least {p_ + 2}.")
    X = np.column_stack([np.ones(n)] + design)
    y = data[yname].to_numpy(float)
    rank = np.linalg.matrix_rank(X)
    if rank < p_:
        raise InputError("The predictors are perfectly collinear (one is a combination of others); remove one and try again.")
    beta, *_ = np.linalg.lstsq(X, y, rcond=None)
    fitted = X @ beta
    resid = y - fitted
    rss = float(resid @ resid)
    tss = float(((y - y.mean()) ** 2).sum())
    df_res = n - p_
    sigma2 = rss / df_res
    xtx_inv = np.linalg.inv(X.T @ X)
    se = np.sqrt(np.diag(xtx_inv) * sigma2)
    tcrit = t_quantile(0.975, df_res)
    coefs = []
    for i, nm in enumerate(["(intercept)"] + names):
        t = beta[i] / se[i] if se[i] > 0 else None
        coefs.append({"term": nm, "estimate": float(beta[i]), "se": float(se[i]), "t": (float(t) if t is not None else None), "p": t_two_sided_p(t, df_res) if t is not None else None,
                      "ci95": [float(beta[i] - tcrit * se[i]), float(beta[i] + tcrit * se[i])]})
    r2 = 1 - rss / tss if tss > 0 else None
    adj = 1 - (1 - r2) * (n - 1) / df_res if r2 is not None else None
    fstat = ((tss - rss) / k) / sigma2 if k and sigma2 > 0 else None
    warnings, diagnostics = [], {}
    # Multicollinearity (VIF) for two or more predictors.
    if k >= 2:
        vifs = {}
        for j in range(1, p_):
            others = np.delete(X, j, axis=1)
            b_, *_ = np.linalg.lstsq(others, X[:, j], rcond=None)
            e_ = X[:, j] - others @ b_
            tss_j = float(((X[:, j] - X[:, j].mean()) ** 2).sum())
            r2j = 1 - float(e_ @ e_) / tss_j if tss_j > 0 else 1.0
            vifs[names[j - 1]] = (1 / (1 - r2j)) if r2j < 1 else None
        diagnostics["vif"] = vifs
        high = [nm for nm, v in vifs.items() if v is None or v > 10]
        if high:
            warnings.append(f"Strong multicollinearity (VIF > 10) for {', '.join(high)}; individual coefficients are unreliable.")
    # Residual normality (Jarque–Bera) and constant variance (Breusch–Pagan, studentised).
    skew, kurt = _skew_kurt(resid)
    if skew is not None and kurt is not None:
        jb = n / 6.0 * (skew ** 2 + (kurt ** 2) / 4.0)
        diagnostics["jarqueBera"] = {"statistic": jb, "p": chi2_sf(jb, 2)}
        if diagnostics["jarqueBera"]["p"] < 0.05 and n < 50:
            warnings.append("Residuals do not look normal and the sample is small; p-values and intervals may be inaccurate.")
    e2 = resid ** 2
    b2, *_ = np.linalg.lstsq(X, e2, rcond=None)
    aux_r2 = 1 - float(((e2 - X @ b2) ** 2).sum()) / float(((e2 - e2.mean()) ** 2).sum()) if float(((e2 - e2.mean()) ** 2).sum()) > 0 else 0.0
    bp = n * aux_r2
    diagnostics["breuschPagan"] = {"statistic": bp, "p": chi2_sf(bp, k)}
    if diagnostics["breuschPagan"]["p"] < 0.05:
        warnings.append("The spread of residuals changes with the predictors (Breusch–Pagan p < 0.05); standard errors may be too small.")
    h = np.einsum("ij,jk,ik->i", X, xtx_inv, X)
    cooks = (resid ** 2 / (p_ * sigma2)) * h / (1 - h) ** 2
    influential = int((cooks > 4 / n).sum())
    diagnostics["influentialRows"] = influential
    if influential:
        warnings.append(f"{influential} row(s) have high influence (Cook's distance > 4/n); check them.")
    if n < 10 * k:
        warnings.append(f"{n} rows for {k} predictor(s); fewer than 10 rows per predictor makes estimates unstable.")
    return {"op": "regression", "y": yname, "x": xnames, "n": n, "droppedRows": dropped, "referenceLevels": refs, "coefficients": coefs,
            "r2": r2, "adjustedR2": adj, "f": fstat, "fP": f_sf(fstat, k, df_res) if fstat is not None else None, "dfResidual": df_res, "sigma": math.sqrt(sigma2),
            "diagnostics": diagnostics,
            "method": "Ordinary least squares with an intercept; rows with any missing value in the model were removed (listwise deletion); categorical predictors as indicator variables against the first level; 95% intervals from the t distribution.",
            "assumptions": ["Linear relationship", "Independent observations", "Constant residual variance", "Approximately normal residuals for small samples"],
            "warnings": warnings, "interpretation": "Coefficients describe association in this data. Without a design that rules out confounding (such as a randomised experiment), they do not show causation."}


def op_outliers(df, types, spec):
    import numpy as np
    name = spec.get("column")
    s = _col(df, name, ["numeric"], types).dropna()
    method = spec.get("method", "iqr")
    x = s.to_numpy(float)
    n = len(x)
    if n < 5:
        raise InputError(f'"{name}" needs at least 5 values for outlier diagnostics.')
    warnings = []
    if method == "iqr":
        k = float(spec.get("k", 1.5))
        q1, _, q3 = _quantiles(x)
        lo, hi = q1 - k * (q3 - q1), q3 + k * (q3 - q1)
        mask = (x < lo) | (x > hi)
        desc = f"Tukey fences: below Q1 − {k}·IQR or above Q3 + {k}·IQR."
        bounds = {"lower": lo, "upper": hi}
    elif method == "zscore":
        z = (x - x.mean()) / x.std(ddof=1) if x.std(ddof=1) > 0 else np.zeros(n)
        mask = np.abs(z) > float(spec.get("threshold", 3))
        desc = f"|z| > {spec.get('threshold', 3)} using the sample mean and standard deviation."
        bounds = {"lower": float(x.mean() - spec.get("threshold", 3) * x.std(ddof=1)), "upper": float(x.mean() + spec.get("threshold", 3) * x.std(ddof=1))}
        skew, _ = _skew_kurt(x)
        if n < 30 or (skew is not None and abs(skew) > 1):
            warnings.append("z-scores assume a roughly symmetric distribution and are distorted by the outliers themselves; the IQR or MAD method is safer here.")
    elif method == "mad":
        med = float(np.median(x))
        mad = float(np.median(np.abs(x - med)))
        if mad == 0:
            raise InputError("The median absolute deviation is 0 (most values are equal); use the IQR method.")
        mz = 0.6745 * (x - med) / mad
        mask = np.abs(mz) > float(spec.get("threshold", 3.5))
        desc = f"Modified z-score (Iglewicz–Hoaglin) above {spec.get('threshold', 3.5)}."
        bounds = {"lower": med - float(spec.get("threshold", 3.5)) * mad / 0.6745, "upper": med + float(spec.get("threshold", 3.5)) * mad / 0.6745}
    else:
        raise InputError('Outlier method must be "iqr", "zscore" or "mad".')
    idx = s.index.to_numpy()[mask]
    items = [{"row": int(i) + 2, "value": float(v)} for i, v in zip(idx[:200], x[mask][:200])]
    return {"op": "outliers", "column": name, "method": method, "n": n, "count": int(mask.sum()), "bounds": bounds, "outliers": items,
            "methodDescription": desc + " Row numbers count the header as row 1.", "assumptions": [],
            "warnings": warnings, "interpretation": "Flagged values are unusual, not necessarily wrong. Check them before removing anything."}


def op_moving_average(df, types, spec):
    import pandas as pd
    value, order = spec.get("value"), spec.get("orderBy")
    _col(df, value, ["numeric"], types)
    _col(df, order, ["datetime", "numeric"], types)
    window = int(spec.get("window", 3))
    data = df[[order, value]].dropna(subset=[order]).sort_values(order, kind="mergesort")
    n = len(data)
    if window < 2 or window > n:
        raise InputError(f"The window must be between 2 and the number of rows ({n}).")
    warnings = []
    if data[order].duplicated().any():
        warnings.append(f'"{order}" has repeated values; the moving average follows row order within ties.')
    diffs = data[order].diff().dropna()
    if len(diffs) and diffs.nunique() > 1:
        warnings.append("The time steps are not evenly spaced; the window counts rows, not time.")
    if data[value].isna().any():
        warnings.append(f"{int(data[value].isna().sum())} missing value(s): windows that contain them have no average.")
    ma = data[value].rolling(window=window, min_periods=window, center=bool(spec.get("center", False))).mean()
    rows = [{"order": _clean(o), "value": _clean(v), "movingAverage": _clean(m)} for o, v, m in zip(data[order].tolist()[:5000], data[value].tolist()[:5000], ma.tolist()[:5000])]
    return {"op": "moving_average", "value": value, "orderBy": order, "window": window, "center": bool(spec.get("center", False)), "n": n, "rows": rows,
            "method": f"Simple moving average over {window} consecutive rows ordered by {order}; the first {window - 1} positions have no average.", "assumptions": [], "warnings": warnings}


OPS = {
    "describe": op_describe, "missing": op_missing, "distribution": op_distribution, "groupby": op_groupby, "pivot": op_pivot,
    "correlation": op_correlation, "regression": op_regression, "outliers": op_outliers, "moving_average": op_moving_average,
}


def run(request):
    import numpy as np
    import pandas as pd
    df, types = build_frame(request.get("dataset") or {})
    rows_in = len(df)
    df, filters = apply_filters(df, types, request.get("filters"))
    ops = request.get("operations") or []
    if not ops:
        raise InputError("No operations requested.")
    if len(ops) > 20:
        raise InputError("At most 20 operations per request.")
    results = []
    for spec in ops:
        name = spec.get("op")
        if name not in OPS:
            results.append({"op": name, "error": f'Unknown operation "{name}".'})
            continue
        try:
            results.append(_clean(OPS[name](df, types, spec)))
        except InputError as e:
            results.append({"op": name, "error": str(e)})
    return {"engine": {"name": VERSION, "numpy": np.__version__, "pandas": pd.__version__, "python": sys.version.split()[0]},
            "dataset": {"rowsIn": rows_in, "rowsAnalysed": len(df), "filters": filters}, "results": results}


def main():
    _harden()
    try:
        request = json.loads(sys.stdin.read())
        out = run(request)
    except InputError as e:
        out = {"error": str(e)}
    except MemoryError:
        out = {"error": "The analysis needed more memory than allowed."}
    except Exception as e:  # never leak a traceback
        out = {"error": f"The analysis failed ({type(e).__name__})."}
    sys.stdout.write(json.dumps(out, allow_nan=False))


if __name__ == "__main__":
    main()

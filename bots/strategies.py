"""Entry signals computed on the underlying's one-minute closes.

Each strategy is a pure function: (closes, params) -> "call" | "put" | None.
It only decides direction at this bar; position management (stops, locks,
trailing, the daily brake) lives in the runner so every strategy gets the same
risk rules.
"""
from __future__ import annotations

import math


def sma(xs, n):
    return sum(xs[-n:]) / n


def std(xs, n):
    w = xs[-n:]
    m = sum(w) / n
    return math.sqrt(sum((x - m) ** 2 for x in w) / max(1, n - 1))


def ema_series(xs, n):
    k = 2 / (n + 1)
    out, e = [], xs[0]
    for x in xs:
        e = x * k + e * (1 - k)
        out.append(e)
    return out


def zscore(closes, lookback):
    s = std(closes, lookback)
    if s <= 0:
        return 0.0
    return (closes[-1] - sma(closes, lookback)) / s


def sigma_signal(closes, p):
    """Sigma-band breakout. z = (close - mean) / std over `lookback` bars.
    Fire a call when z crosses up through +k, a put when it crosses down through -k.
    k = 0 makes it a plain mean crossover (the "0σ" worker); larger k waits for a stretch.
    `confirm` extra bars must keep the sign so a single print does not trigger it."""
    lb, k, confirm = int(p.get("lookback", 20)), float(p.get("sigma_k", 0.0)), int(p.get("confirm", 1))
    if len(closes) < lb + confirm + 1:
        return None
    zs = [zscore(closes[: len(closes) - i], lb) for i in range(confirm + 1)][::-1]  # oldest .. newest
    prev, now = zs[0], zs[-1]
    if prev <= k and all(z > k for z in zs[1:]):
        return "call"
    if prev >= -k and all(z < -k for z in zs[1:]):
        return "put"
    return None


def trend_signal(closes, p):
    """EMA crossover with the slow EMA as the trend filter.
    Call when the fast EMA crosses above the slow one and price sits above it;
    put on the mirror image. Default 9 / 50, the EMA50 the reel shows on the chart."""
    fast, slow = int(p.get("ema_fast", 9)), int(p.get("ema_slow", 50))
    if len(closes) < slow + 2:
        return None
    ef, es = ema_series(closes, fast), ema_series(closes, slow)
    if ef[-2] <= es[-2] and ef[-1] > es[-1] and closes[-1] > es[-1]:
        return "call"
    if ef[-2] >= es[-2] and ef[-1] < es[-1] and closes[-1] < es[-1]:
        return "put"
    return None


STRATEGIES = {"sigma": sigma_signal, "trend": trend_signal}


def signal(name, closes, params):
    fn = STRATEGIES.get(name)
    if not fn:
        raise ValueError(f"unknown strategy {name!r}; choose from {sorted(STRATEGIES)}")
    return fn(closes, params)


def indicators(closes, params, strategy):
    """Small readout for the dashboard's thoughts line."""
    out = {}
    if strategy == "sigma" and len(closes) >= int(params.get("lookback", 20)) + 1:
        out["z"] = round(zscore(closes, int(params.get("lookback", 20))), 2)
    if strategy == "trend" and len(closes) >= int(params.get("ema_slow", 50)) + 1:
        out["ema_fast"] = round(ema_series(closes, int(params.get("ema_fast", 9)))[-1], 2)
        out["ema_slow"] = round(ema_series(closes, int(params.get("ema_slow", 50)))[-1], 2)
    return out

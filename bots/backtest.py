#!/usr/bin/env python3
"""Replay recorded one-minute bars through the real runner and compare how each worker
(and optional variants) would have done, under the same risk rules and the same
account budget the live runner uses.

  python bots/backtest.py --source alpaca --days 20          real SPY/QQQ bars (needs ALPACA_KEY_ID / ALPACA_SECRET_KEY, paper keys are fine)
  python bots/backtest.py --source csv --csv data/bars        one CSV per symbol: data/bars/QQQ.csv with columns t,o,h,l,c,v (t = ISO time, Eastern or with offset)
  python bots/backtest.py --source sim --days 10              synthetic random-walk days (plumbing check only; says nothing about markets)

  --variants bots/variants.json   also run alternative worker settings (see bots/variants.json)
  --config PATH                   worker config (default config/bots.json)
  --out PATH                      write the full result JSON here (default data/vault/backtests/<stamp>.json)

Options are priced with Black-Scholes on the replayed underlying with the day's realized
volatility, since one-minute option tapes are not available. Fills are at the modeled
bid/ask. That is a fair model of direction and timing, a rough model of slippage, so
read the comparison as "which rules survive real price paths", not as a profit forecast.
"""
from __future__ import annotations

import argparse
import csv
import json
import math
import os
import shutil
import sys
import tempfile
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from runner import Runner, load_config, DEFAULT_CONFIG, ET, ROOT  # noqa: E402
from sim import SimBroker, bs_price  # noqa: E402


class ReplayBroker(SimBroker):
    """SimBroker fed with recorded bars instead of a random walk."""
    mode = "sim"

    def __init__(self, days: dict[str, dict[str, list[dict]]]):
        # days: {date: {symbol: [bars oldest first]}}
        self.days = days
        self.dates = sorted(days)
        self.cash = 100000.0
        self.orders = {}
        self.vol = 0.18
        self.bars_by_symbol = {}
        self.now = None
        self.cursor = None

    def start_day(self, date):
        self.cursor = 0
        self.today = self.days[date]
        self.symbols = sorted(self.today)
        self.n = min(len(v) for v in self.today.values())
        self.bars_by_symbol = {s: [] for s in self.symbols}
        self.now = self._t(self.today[self.symbols[0]][0]["t"]) - timedelta(minutes=1)

    @staticmethod
    def _t(iso):
        d = datetime.fromisoformat(iso.replace("Z", "+00:00"))
        if d.tzinfo:
            d = d.astimezone(ET).replace(tzinfo=None)
        return d

    def tick(self):
        if self.cursor >= self.n:
            return False
        for s in self.symbols:
            b = self.today[s][self.cursor]
            self.bars_by_symbol[s].append({**b, "t": self._t(b["t"]).isoformat()})
        self.now = self._t(self.today[self.symbols[0]][self.cursor]["t"])
        self.cursor += 1
        closes = [b["c"] for b in self.bars_by_symbol[self.symbols[0]][-60:]]
        if len(closes) > 10:
            rets = [math.log(closes[i] / closes[i - 1]) for i in range(1, len(closes))]
            m = sum(rets) / len(rets)
            sd = math.sqrt(sum((r - m) ** 2 for r in rets) / (len(rets) - 1))
            self.vol = max(0.10, min(0.60, sd * math.sqrt(252 * 390)))
        return True

    def clock(self):
        hm = self.now.hour * 60 + self.now.minute
        return {"timestamp": self.now.isoformat(), "is_open": 570 <= hm < 960}


# ---------- data sources ----------
def days_from_alpaca(symbols, n_days):
    from alpaca import Broker
    b = Broker.from_env("paper")
    end = datetime.now(timezone.utc)
    start = end - timedelta(days=int(n_days * 1.6) + 3)
    out = {}
    for s in symbols:
        bars = b.bars_range(s, start.isoformat().replace("+00:00", "Z"), end.isoformat().replace("+00:00", "Z"))
        for bar in bars:
            t = ReplayBroker._t(bar["t"])
            if not (570 <= t.hour * 60 + t.minute < 960):
                continue
            out.setdefault(t.date().isoformat(), {}).setdefault(s, []).append(bar)
    return _complete(out, symbols, n_days)


def days_from_csv(folder, symbols, n_days):
    out = {}
    for s in symbols:
        path = os.path.join(folder, f"{s}.csv")
        if not os.path.exists(path):
            raise SystemExit(f"missing {path}")
        with open(path, newline="") as f:
            for row in csv.DictReader(f):
                t = ReplayBroker._t(row["t"])
                if not (570 <= t.hour * 60 + t.minute < 960):
                    continue
                out.setdefault(t.date().isoformat(), {}).setdefault(s, []).append({"t": row["t"], "o": float(row["o"]), "h": float(row["h"]), "l": float(row["l"]), "c": float(row["c"]), "v": float(row.get("v") or 0)})
    return _complete(out, symbols, n_days)


def days_from_sim(symbols, n_days, seed):
    out = {}
    day0 = datetime.now(ET).replace(hour=9, minute=30, second=0, microsecond=0, tzinfo=None) - timedelta(days=n_days)
    for i in range(n_days):
        start = day0 + timedelta(days=i)
        if start.weekday() >= 5:
            continue
        sb = SimBroker(seed=seed + i, start=start)
        for _ in range(390):
            sb.tick()
        out[start.date().isoformat()] = {s: sb.bars_by_symbol[s][-390:] for s in symbols}
    return out


def _complete(out, symbols, n_days):
    good = {d: v for d, v in out.items() if all(s in v and len(v[s]) >= 300 for s in symbols)}
    return dict(sorted(good.items())[-n_days:])


# ---------- running ----------
def run_variant(name, cfg, days, keep_dir=None):
    broker = ReplayBroker(days)
    d = keep_dir or tempfile.mkdtemp(prefix="vault-bt-")
    r = None
    per_day = []
    for date in broker.dates:
        broker.start_day(date)
        if r is None:
            r = Runner(broker, cfg, d, fast=True)
        start_total = sum(t["pnl"] for t in r.history)
        while broker.tick():
            r.step()
        per_day.append({"day": date, "pnl": round(sum(t["pnl"] for t in r.history) - start_total, 2)})
    trades = list(r.history) if r else []
    if not keep_dir:
        shutil.rmtree(d, ignore_errors=True)
    return {"name": name, "days": per_day, "trades": trades, "workers": {w.id: w.name for w in (r.workers if r else [])}}


def stats(trades, per_day):
    pnl = [t["pnl"] for t in trades]
    wins = [p for p in pnl if p > 0]
    losses = [p for p in pnl if p < 0]
    eq, peak, dd = 0.0, 0.0, 0.0
    for d in per_day:
        eq += d["pnl"]; peak = max(peak, eq); dd = min(dd, eq - peak)
    premium = sum(t["entry"] * 100 * t["qty"] for t in trades)
    return {"trades": len(pnl), "win_rate": round(100 * len(wins) / len(pnl)) if pnl else 0, "total": round(sum(pnl), 2),
            "avg": round(sum(pnl) / len(pnl), 2) if pnl else 0, "best_day": max((d["pnl"] for d in per_day), default=0), "worst_day": min((d["pnl"] for d in per_day), default=0),
            "max_drawdown": round(dd, 2), "profit_factor": round(sum(wins) / -sum(losses), 2) if losses else (float("inf") if wins else 0),
            "return_on_premium_pct": round(100 * sum(pnl) / premium, 1) if premium else 0,
            "green_days": sum(1 for d in per_day if d["pnl"] > 0), "red_days": sum(1 for d in per_day if d["pnl"] < 0)}


def report(results):
    rows = []
    for res in results:
        by_bot = {}
        for t in res["trades"]:
            by_bot.setdefault(t["bot"], []).append(t)
        for bot, ts in by_bot.items():
            days = [{"day": d, "pnl": round(sum(t["pnl"] for t in ts if t["day"] == d), 2)} for d in sorted({t["day"] for t in ts})]
            rows.append((res["name"], res["workers"].get(bot, bot), stats(ts, days)))
        rows.append((res["name"], "ALL WORKERS", stats(res["trades"], res["days"])))
    hdr = f"{'variant':<14}{'worker':<14}{'trades':>7}{'win%':>6}{'total':>9}{'avg':>8}{'best':>8}{'worst':>8}{'maxDD':>8}{'PF':>6}{'ret%':>7}{'days +/-':>10}"
    print(hdr); print("-" * len(hdr))
    for v, w, s in rows:
        print(f"{v:<14}{w:<14}{s['trades']:>7}{s['win_rate']:>6}{s['total']:>9.0f}{s['avg']:>8.1f}{s['best_day']:>8.0f}{s['worst_day']:>8.0f}{s['max_drawdown']:>8.0f}{s['profit_factor']:>6}{s['return_on_premium_pct']:>7}{str(s['green_days']) + '/' + str(s['red_days']):>10}")
    return rows


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--source", choices=["alpaca", "csv", "sim"], default="alpaca")
    ap.add_argument("--days", type=int, default=20)
    ap.add_argument("--csv", default=os.path.join(ROOT, "data", "bars"))
    ap.add_argument("--config", default=DEFAULT_CONFIG)
    ap.add_argument("--variants", help="JSON list of {name, workers:[...]} or {name, patch:{...}} entries")
    ap.add_argument("--seed", type=int, default=11)
    ap.add_argument("--out")
    a = ap.parse_args(argv)
    cfg = load_config(a.config)
    symbols = sorted({w["symbol"] for w in cfg["workers"]})
    if a.source == "alpaca":
        days = days_from_alpaca(symbols, a.days)
    elif a.source == "csv":
        days = days_from_csv(a.csv, symbols, a.days)
    else:
        days = days_from_sim(symbols, a.days, a.seed)
    if not days:
        raise SystemExit("no complete trading days found")
    print(f"{len(days)} days · {', '.join(symbols)} · {sorted(days)[0]} to {sorted(days)[-1]} · source {a.source} · budget {cfg.get('account')}")
    variants = [{"name": "config", "cfg": cfg}]
    if a.variants:
        for v in json.load(open(a.variants)):
            vc = json.loads(json.dumps(cfg))
            if "workers" in v:
                vc["workers"] = v["workers"]
            if "patch" in v:                      # applied to every worker
                for w in vc["workers"]:
                    for k, val in v["patch"].items():
                        if isinstance(val, dict) and isinstance(w.get(k), dict):
                            w[k].update(val)
                        else:
                            w[k] = val
            if "account" in v:
                vc["account"] = {**vc.get("account", {}), **v["account"]}
            variants.append({"name": v["name"], "cfg": vc})
    results = [run_variant(v["name"], v["cfg"], days) for v in variants]
    rows = report(results)
    out = a.out or os.path.join(ROOT, "data", "vault", "backtests", datetime.now(ET).strftime("%Y%m%d-%H%M%S") + ".json")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, "w") as f:
        json.dump({"source": a.source, "days": sorted(days), "symbols": symbols, "results": results, "summary": [{"variant": v, "worker": w, **s} for v, w, s in rows]}, f, indent=1, default=str)
    print(f"\nfull result -> {out}")


if __name__ == "__main__":
    main()

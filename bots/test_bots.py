#!/usr/bin/env python3
"""Checks for The Vault runner, on the simulator. Run: python bots/test_bots.py"""
from __future__ import annotations

import json
import os
import sys
import tempfile
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from runner import Runner, load_config, DEFAULT_CONFIG  # noqa: E402
from sim import SimBroker, bs_price  # noqa: E402
import strategies  # noqa: E402

results = []


def check(name, fn):
    try:
        fn(); results.append(("PASS", name))
    except Exception as e:  # noqa: BLE001
        results.append(("FAIL", f"{name} — {type(e).__name__}: {e}"))


def fresh(cfg_edit=None, seed=1):
    cfg = load_config(DEFAULT_CONFIG)
    if cfg_edit:
        cfg_edit(cfg)
    d = tempfile.mkdtemp(prefix="vault-test-")
    r = Runner(SimBroker(seed=seed, start=datetime(2026, 10, 5, 9, 30)), cfg, d, fast=True)
    return r, d


def test_strategies():
    up = [100 + i * 0.1 for i in range(30)]
    assert strategies.trend_signal(up, {"ema_fast": 3, "ema_slow": 5}) is None  # no cross inside a steady trend
    flat = [100.0] * 25 + [99.9, 100.5]          # dips under the mean, then crosses back above it
    assert strategies.sigma_signal(flat, {"lookback": 20, "sigma_k": 0, "confirm": 1}) == "call"
    flat_dn = [100.0] * 25 + [100.1, 99.0]
    assert strategies.sigma_signal(flat_dn, {"lookback": 20, "sigma_k": 0, "confirm": 1}) == "put"
    assert strategies.sigma_signal([1.0] * 5, {"lookback": 20}) is None


def test_bs():
    assert abs(bs_price(100, 100, 0, 0.2, "call")) < 1e-9
    assert bs_price(100, 100, 0.01, 0.2, "call") > 0
    assert bs_price(100, 90, 0.01, 0.2, "call") > bs_price(100, 110, 0.01, 0.2, "call")


def test_full_day():
    r, d = fresh()
    r.run(ticks=390)
    st = json.load(open(os.path.join(d, "vault", "state.json")))
    assert st["mode"] == "sim" and st["market_open"] is False
    assert sum(w["trade_count"] for w in st["workers"]) > 0, "no trades in a full simulated day"
    assert all(w["position"] is None for w in st["workers"]), "positions must be flat after the bell"
    assert abs(st["total"] - sum(w["earned"] for w in st["workers"])) < 1e-6
    lines = [json.loads(x) for x in open(os.path.join(d, "vault", "trades.jsonl"))]
    assert len(lines) == sum(w["trade_count"] for w in st["workers"])
    assert all(t["reason"] for t in lines) and all(t["mode"] == "sim" for t in lines)
    assert st["series"]["QQQ"]["c"] and st["series"]["SPY"]["t"]


def test_brake_stops_trading():
    def edit(cfg):
        for w in cfg["workers"]:
            w["daily_brake"] = 1; w["max_trades"] = 50
    r, _ = fresh(edit)
    r.run(ticks=390)
    for w in r.workers:
        wins = [t for t in w.trades if t["pnl"] > 0]
        if wins:
            # after the first winning close the brake holds: no later trade may open
            first_win = w.trades.index(wins[0])
            assert first_win == len(w.trades) - 1, f"{w.name} traded after hitting its brake"
            assert w.status == "brake"


def test_loss_limit_and_max_trades():
    def edit(cfg):
        for w in cfg["workers"]:
            w["daily_loss_limit"] = -1; w["daily_brake"] = 10 ** 9; w["max_trades"] = 2
    r, _ = fresh(edit, seed=3)
    r.run(ticks=390)
    for w in r.workers:
        assert len(w.trades) <= 2, f"{w.name} exceeded max_trades"
        losses = [i for i, t in enumerate(w.trades) if t["pnl"] < 0]
        if losses:
            assert losses[0] == len(w.trades) - 1, f"{w.name} traded after its loss limit"


def test_commands():
    r, d = fresh()
    os.makedirs(os.path.join(d, "vault"), exist_ok=True)
    with open(os.path.join(d, "vault", "commands.json"), "w") as f:
        json.dump([{"bot": "qqq0", "action": "off"}], f)
    r.run(ticks=200)
    w = next(w for w in r.workers if w.id == "qqq0")
    assert w.enabled is False and w.status == "off" and not w.trades, "an off worker must not trade"
    assert not os.path.exists(os.path.join(d, "vault", "commands.json")), "commands are consumed"
    with open(os.path.join(d, "vault", "commands.json"), "w") as f:
        json.dump([{"bot": "qqq0", "action": "on"}], f)
    r.run(ticks=1)
    assert w.enabled is True


def test_restart_restores_positions():
    r, d = fresh()
    n = 0
    while not any(w.position for w in r.workers) and n < 200:
        r.run(ticks=1); n += 1
    assert any(w.position for w in r.workers), "no position opened to test restart"
    open_ids = {w.id for w in r.workers if w.position}
    r2 = Runner(r.b, r.cfg, d, fast=True)      # same simulated clock, new runner process
    assert {w.id for w in r2.workers if w.position} == open_ids
    assert all(w.trades == next(x for x in r.workers if x.id == w.id).trades for w in r2.workers)


def test_live_needs_flag():
    import subprocess
    env = {**os.environ, "ALPACA_KEY_ID": "x", "ALPACA_SECRET_KEY": "y"}
    env.pop("VAULT_LIVE", None)
    p = subprocess.run([sys.executable, os.path.join(os.path.dirname(__file__), "runner.py"), "--mode", "live", "--once"], env=env, capture_output=True, text=True)
    assert p.returncode != 0 and "VAULT_LIVE" in (p.stderr + p.stdout)


for name, fn in list(globals().items()):
    if name.startswith("test_"):
        check(name, fn)
for s, n in results:
    print(f"{s}  {n}")
if any(s == "FAIL" for s, _ in results):
    sys.exit(1)
print(f"{len(results)} checks passed")

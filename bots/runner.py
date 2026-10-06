#!/usr/bin/env python3
"""The Vault runner: runs every worker (bot) in config/bots.json against one broker,
manages positions with shared risk rules, records every closed trade, and writes
data/vault/state.json for the dashboard a few times a minute.

  python bots/runner.py                 paper trading (Alpaca paper keys, real market data)
  python bots/runner.py --mode sim      simulated market, no keys, runs any time
  python bots/runner.py --mode live     real money. Also needs VAULT_LIVE=yes in the environment.

Options: --config PATH  --data-dir PATH  --once  --fast (sim: no sleeping)  --ticks N (sim: stop after N bars)
Env:     MOW_DATA_DIR (same folder the Node server uses), ALPACA_KEY_ID, ALPACA_SECRET_KEY, VAULT_LIVE
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
import uuid
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import strategies  # noqa: E402

try:
    from zoneinfo import ZoneInfo
    ET = ZoneInfo("America/New_York")
except Exception:  # Windows without tzdata: fall back to a fixed offset and say so
    ET = timezone(timedelta(hours=-4), "ET?")
    print("warning: America/New_York zone data not found (pip install tzdata); using UTC-4", file=sys.stderr)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_CONFIG = os.path.join(ROOT, "config", "bots.json")


def hm(s):
    h, m = s.split(":")
    return int(h) * 60 + int(m)


class Worker:
    """One bot: its config, today's tally, and at most one open position."""

    def __init__(self, cfg):
        self.cfg = cfg
        self.id, self.name, self.symbol = cfg["id"], cfg["name"], cfg["symbol"]
        self.strategy, self.params = cfg.get("strategy", "sigma"), cfg.get("params", {})
        self.enabled = bool(cfg.get("enabled", True))
        self.position = None          # dict while a trade is open
        self.trades = []              # today's closed trades (dicts)
        self.last_exit_at = None
        self.thoughts = []            # short log lines for the card
        self.status = "on" if self.enabled else "off"
        self.indicators = {}

    # ---- tallies ----
    @property
    def earned(self):
        return round(sum(t["pnl"] for t in self.trades), 2)

    @property
    def wins(self):
        return sum(1 for t in self.trades if t["pnl"] > 0)

    def think(self, now, msg):
        self.thoughts.append(f"{now.strftime('%H:%M')} {msg}")
        del self.thoughts[:-6]

    def brake(self):
        return float(self.cfg.get("daily_brake", 0) or 0)

    # ---- state for the dashboard ----
    def snapshot(self):
        return {"id": self.id, "name": self.name, "symbol": self.symbol, "strategy": self.strategy, "params": self.params,
                "status": self.status, "status_label": STATUS_LABEL[self.status], "enabled": self.enabled,
                "earned": self.earned, "wins": self.wins, "trade_count": len(self.trades), "trades": self.trades[-12:],
                "position": self.position, "thoughts": self.thoughts, "indicators": self.indicators,
                "risk": {k: self.cfg.get(k) for k in ("qty", "dte", "strike_offset", "stop_loss_pct", "lock_pct", "trail_pct", "take_profit_pct", "max_hold_minutes", "daily_brake", "daily_loss_limit", "max_trades")}}


STATUS_LABEL = {"on": "on shift · watching", "position": "in a trade", "brake": "profit brake hit · off duty", "loss_limit": "loss limit hit · off duty",
                "done": "trade limit reached · off duty", "off": "turned off", "closed": "market closed", "window": "outside trade window",
                "queue": "waiting for a free slot", "pdt": "day-trade limit · off duty", "budget": "nothing affordable · watching"}


class Runner:
    def __init__(self, broker, config, data_dir, fast=False):
        self.b = broker
        self.cfg = config
        self.mode = broker.mode
        self.dir = os.path.join(data_dir, "vault")
        os.makedirs(self.dir, exist_ok=True)
        self.workers = [Worker(w) for w in config["workers"]]
        self.fast = fast
        self.events = []      # recent coin events for the dashboard
        self.errors = []
        self.bars = {}        # symbol -> list of bars
        self.day = None
        self.history = []     # every closed trade in this mode, from trades.jsonl (for the rolling day-trade count)
        self.account = {"size": None, "max_premium_per_trade": None, "max_open_positions": None, "day_trades_per_5_days": None, **(config.get("account") or {})}
        self.cash = None
        self._load_today()

    # ---------- files ----------
    def path(self, name):
        return os.path.join(self.dir, name)

    def now(self):
        if self.mode == "sim":
            return datetime.fromisoformat(self.b.clock()["timestamp"])
        return datetime.now(ET)

    def _load_today(self):
        """Restore today's closed trades and any open positions after a restart."""
        today = self.now().date().isoformat()
        self.day = today
        tp = self.path("trades.jsonl")
        if os.path.exists(tp):
            with open(tp) as f:
                for line in f:
                    try:
                        t = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    if t.get("mode") != self.mode:
                        continue
                    self.history.append(t)
                    if t.get("day") == today:
                        w = next((w for w in self.workers if w.id == t["bot"]), None)
                        if w:
                            w.trades.append(t)
        pp = self.path("positions.json")
        if os.path.exists(pp):
            try:
                saved = json.load(open(pp))
            except json.JSONDecodeError:
                saved = {}
            if saved.get("mode") == self.mode and saved.get("day") == today:
                for w in self.workers:
                    if saved.get("positions", {}).get(w.id):
                        w.position = saved["positions"][w.id]
                        w.status = "position"

    def _save_positions(self):
        self._atomic("positions.json", {"mode": self.mode, "day": self.day, "positions": {w.id: w.position for w in self.workers if w.position}})

    def _atomic(self, name, obj):
        tmp = self.path(name + ".tmp")
        with open(tmp, "w") as f:
            json.dump(obj, f, indent=1, default=str)
        os.replace(tmp, self.path(name))

    def _append_trade(self, t):
        with open(self.path("trades.jsonl"), "a") as f:
            f.write(json.dumps(t) + "\n")

    def _commands(self):
        p = self.path("commands.json")
        if not os.path.exists(p):
            return []
        try:
            cmds = json.load(open(p))
        except (json.JSONDecodeError, OSError):
            cmds = []
        try:
            os.remove(p)
        except OSError:
            pass
        return cmds if isinstance(cmds, list) else []

    # ---------- one pass ----------
    def step(self):
        now = self.now()
        if now.date().isoformat() != self.day:          # new trading day: reset tallies
            for w in self.workers:
                w.trades, w.thoughts = [], []
                if w.status in ("brake", "loss_limit", "done"):
                    w.status = "on"
            self.day = now.date().isoformat()
        for c in self._commands():
            self._apply_command(c, now)
        try:
            clock = self.b.clock()
            is_open = bool(clock.get("is_open"))
        except Exception as e:  # noqa: BLE001
            self._err(now, f"clock: {e}")
            is_open = False
        for sym in {w.symbol for w in self.workers}:
            try:
                self.bars[sym] = self.b.bars(sym, 120)
            except Exception as e:  # noqa: BLE001
                self._err(now, f"bars {sym}: {e}")
        for w in self.workers:
            try:
                self._run_worker(w, now, is_open)
            except Exception as e:  # noqa: BLE001
                self._err(now, f"{w.name}: {e}")
                w.think(now, f"error: {str(e)[:80]}")
        self.write_state(now, is_open)

    def _apply_command(self, c, now):
        w = next((w for w in self.workers if w.id == c.get("bot")), None)
        if not w:
            return
        a = c.get("action")
        if a == "off":
            w.enabled = False
            if w.position:
                self._close(w, now, "turned off")
            w.status = "off"
            w.think(now, "turned off by hand")
        elif a == "on":
            w.enabled = True
            w.status = "on"
            w.think(now, "clocked in by hand")
        elif a == "flatten" and w.position:
            self._close(w, now, "flattened by hand")

    def _err(self, now, msg):
        self.errors.append(f"{now.strftime('%H:%M:%S')} {msg}")
        del self.errors[:-8]
        print(f"[{now.strftime('%H:%M:%S')}] {msg}", file=sys.stderr)

    def day_trades_recent(self, now):
        """Round trips opened and closed on the same day within the last five trading days (the pattern-day-trader window)."""
        days = sorted({t["day"] for t in self.history if t.get("day")} | {self.day})[-5:]
        return sum(1 for t in self.history if t.get("day") in days and str(t.get("entry_time", ""))[:10] == str(t.get("exit_time", ""))[:10])

    def _run_worker(self, w, now, is_open):
        c = w.cfg
        closes = [b["c"] for b in self.bars.get(w.symbol, [])]
        w.indicators = strategies.indicators(closes, w.params, w.strategy) if closes else {}
        minute = now.hour * 60 + now.minute
        window = self.cfg.get("trade_window", ["09:35", "15:30"])
        in_window = hm(window[0]) <= minute < hm(window[1])
        flatten_at = hm(self.cfg.get("flatten_at", "15:50"))

        # 1. manage an open position first; it is handled even when the bot is off duty
        if w.position:
            self._manage(w, now, minute >= flatten_at or not is_open)
            if w.position:
                return

        # 2. decide whether this worker may open a trade
        if not w.enabled:
            w.status = "off"; return
        if w.brake() and w.earned >= w.brake():
            if w.status != "brake":
                w.think(now, f"profit brake hit: {w.earned:+.0f} banked ≥ {w.brake():.0f}. done for today")
            w.status = "brake"; return
        loss_limit = float(c.get("daily_loss_limit", 0) or 0)
        if loss_limit and w.earned <= loss_limit:
            if w.status != "loss_limit":
                w.think(now, f"loss limit hit at {w.earned:+.0f}. done for today")
            w.status = "loss_limit"; return
        if c.get("max_trades") and len(w.trades) >= int(c["max_trades"]):
            w.status = "done"; return
        if not is_open:
            w.status = "closed"; return
        if not in_window:
            w.status = "window"; return
        limit = self.account.get("day_trades_per_5_days")
        if limit and self.day_trades_recent(now) >= int(limit):
            if w.status != "pdt":
                w.think(now, f"{limit} day trades used in the last 5 days; sitting out so the account is not flagged")
            w.status = "pdt"; return
        slots = self.account.get("max_open_positions")
        if slots and sum(1 for x in self.workers if x.position) >= int(slots):
            w.status = "queue"; return
        if w.status != "budget":
            w.status = "on"
        cooldown = int(c.get("cooldown_minutes", 3))
        if w.last_exit_at and (now - w.last_exit_at) < timedelta(minutes=cooldown):
            return
        if len(closes) < 5:
            return

        # 3. ask the strategy
        side = strategies.signal(w.strategy, closes, w.params)
        if side:
            self._open(w, now, side, closes[-1])

    # ---------- orders ----------
    def _open(self, w, now, kind, spot):
        c = w.cfg
        qty = int(c.get("qty", 1))
        cap = self.account.get("max_premium_per_trade")
        if self.cash is not None:
            cap = min(cap, self.cash) if cap else self.cash
        contract = q = None
        base = int(c.get("strike_offset", 0))
        for extra in range(0, 7):                      # walk out of the money until the premium fits the budget
            cand = self.b.pick_contract(w.symbol, spot, kind, int(c.get("dte", 0)), base + extra)
            if not cand:
                break
            cq = self.b.option_quote(cand["symbol"])
            if cq["mid"] <= 0:
                continue
            cost = (cq["ask"] or cq["mid"]) * 100 * qty
            if cap is None or cost <= cap:
                contract, q = cand, cq
                if extra:
                    w.think(now, f"{extra} strike{'s' if extra > 1 else ''} further out to fit ${cap:.0f}: {cand['symbol']} at {cq['ask']:.2f}")
                break
            if cap is not None and cap < 20:
                break
        if not contract:
            if w.status != "budget":
                w.think(now, f"no {kind} contract under ${cap:.0f}" if cap is not None else f"no {kind} contract found near {spot:.2f}")
            w.status = "budget"; return
        sym = contract["symbol"]
        o = self.b.submit(sym, qty, "buy", client_id=f"vault-{w.id}-{uuid.uuid4().hex[:8]}")
        o = self.b.wait_fill(o["id"], float(self.cfg.get("fill_timeout_seconds", 20)))
        px = float(o["filled_avg_price"])
        w.position = {"contract": sym, "kind": kind, "qty": qty, "entry": px, "entry_time": now.isoformat(), "peak": px, "mark": px,
                      "strike": float(contract.get("strike_price", 0)), "expiration": contract.get("expiration_date"), "spot_at_entry": spot}
        w.status = "position"
        w.think(now, f"bought {qty} {w.symbol} {kind} {w.position['strike']:.0f} @ {px:.2f}" + (f" · z {w.indicators['z']:+.2f}" if 'z' in w.indicators else ""))
        self._event(now, w, "open", 0)
        self._save_positions()

    def _manage(self, w, now, force_flat):
        p, c = w.position, w.cfg
        q = self.b.option_quote(p["contract"])
        mark = q["bid"] or q["mid"]
        p["mark"], p["peak"] = mark, max(p["peak"], mark)
        chg = (mark - p["entry"]) / p["entry"] * 100
        peak_chg = (p["peak"] - p["entry"]) / p["entry"] * 100
        held = (now - datetime.fromisoformat(p["entry_time"])).total_seconds() / 60
        reason = None
        if force_flat:
            reason = "clocked out at the bell"
        elif chg <= -float(c.get("stop_loss_pct", 25)):
            reason = "stopped out"
        elif c.get("take_profit_pct") and chg >= float(c["take_profit_pct"]):
            reason = "profit locked"
        elif peak_chg >= float(c.get("lock_pct", 5)) and mark <= p["peak"] * (1 - float(c.get("trail_pct", 8)) / 100):
            reason = "rode the trail"
        elif c.get("max_hold_minutes") and held >= float(c["max_hold_minutes"]):
            reason = "time was up"
        if reason:
            self._close(w, now, reason)
        else:
            self._save_positions()

    def _close(self, w, now, reason):
        p = w.position
        o = self.b.submit(p["contract"], p["qty"], "sell", client_id=f"vault-{w.id}-x-{uuid.uuid4().hex[:8]}")
        o = self.b.wait_fill(o["id"], float(self.cfg.get("fill_timeout_seconds", 20)))
        px = float(o["filled_avg_price"])
        pnl = round((px - p["entry"]) * 100 * p["qty"], 2)
        t = {"id": uuid.uuid4().hex[:10], "bot": w.id, "symbol": w.symbol, "contract": p["contract"], "kind": p["kind"], "qty": p["qty"],
             "entry": p["entry"], "exit": px, "entry_time": p["entry_time"], "exit_time": now.isoformat(), "t": now.strftime("%H:%M"),
             "pnl": pnl, "reason": reason, "day": self.day, "mode": self.mode}
        w.trades.append(t)
        self.history.append(t)
        self._append_trade(t)
        w.position, w.last_exit_at = None, now
        w.status = "on" if w.enabled else "off"
        w.think(now, f"sold {t['qty']} {w.symbol} {t['kind']} @ {px:.2f} · {reason} · {pnl:+.0f}")
        self._event(now, w, "close", pnl)
        self._save_positions()
        print(f"[{now.strftime('%H:%M')}] {w.name}: {reason} {pnl:+.2f} (day {w.earned:+.2f})")

    def _event(self, now, w, kind, pnl):
        self.events.append({"id": uuid.uuid4().hex[:8], "bot": w.id, "kind": kind, "pnl": pnl, "t": now.isoformat()})
        del self.events[:-30]

    # ---------- state ----------
    def write_state(self, now, is_open):
        try:
            acct = self.b.account()
            equity = float(acct.get("equity") or 0)
            size = self.account.get("size")
            real_cash = float(acct.get("cash") or acct.get("buying_power") or 0)
            # never spend more than the budget you said you have, grown or shrunk by what this mode has earned so far
            budget = float(size) + sum(t["pnl"] for t in self.history) if size else None
            self.cash = min(real_cash, budget) if budget is not None else real_cash
        except Exception as e:  # noqa: BLE001
            self._err(now, f"account: {e}"); equity = None
        series = {}
        for sym, bars in self.bars.items():
            pts = bars[-90:]
            series[sym] = {"t": [b["t"][11:16] if "T" in b["t"] else b["t"] for b in pts], "c": [b["c"] for b in pts]}
            if pts:
                series[sym]["last"], series[sym]["open"] = pts[-1]["c"], pts[0]["c"]
        total = round(sum(w.earned for w in self.workers), 2)
        unreal = round(sum((w.position["mark"] - w.position["entry"]) * 100 * w.position["qty"] for w in self.workers if w.position), 2)
        clock = {"weekday": now.strftime("%A"), "date": f"{now.strftime('%a')} {now.month}/{now.day}", "long_date": f"{now.strftime('%A')} {now.month}/{now.day}",
                 "time": f"{now.hour % 12 or 12}:{now.minute:02d} {'AM' if now.hour < 12 else 'PM'}", "tz": "sim" if self.mode == "sim" else "ET",
                 "minutes_since_open": now.hour * 60 + now.minute - 570}
        state = {"version": 1, "mode": self.mode, "as_of": now.isoformat(), "clock": clock, "day": self.day, "market_open": is_open, "equity": equity,
                 "profit_lock_pct": self.cfg.get("workers", [{}])[0].get("lock_pct", 5), "trade_window": self.cfg.get("trade_window"), "flatten_at": self.cfg.get("flatten_at"),
                 "account": {**self.account, "cash": self.cash, "day_trades_recent": self.day_trades_recent(now),
                             "open_positions": sum(1 for w in self.workers if w.position)},
                 "total": total, "unrealized": unreal, "workers": [w.snapshot() for w in self.workers], "series": series, "events": self.events, "errors": self.errors}
        self._atomic("state.json", state)

    # ---------- loop ----------
    def run(self, once=False, ticks=None, poll=None):
        poll = poll or float(self.cfg.get("poll_seconds", 15))
        n = 0
        while True:
            if self.mode == "sim":
                self.b.tick()
            self.step()
            n += 1
            if once or (ticks and n >= ticks):
                return
            if self.mode == "sim":
                if not self.fast:
                    time.sleep(float(self.cfg.get("sim_seconds_per_bar", 1.0)))
            else:
                time.sleep(poll)


def load_config(path):
    with open(path) as f:
        cfg = json.load(f)
    ids = [w["id"] for w in cfg["workers"]]
    if len(ids) != len(set(ids)):
        raise SystemExit("config: worker ids must be unique")
    return cfg


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--mode", choices=["paper", "live", "sim"], default=os.environ.get("VAULT_MODE", "paper"))
    ap.add_argument("--config", default=DEFAULT_CONFIG)
    ap.add_argument("--data-dir", default=os.environ.get("MOW_DATA_DIR") or os.path.join(ROOT, "data"))
    ap.add_argument("--once", action="store_true", help="one pass, then exit")
    ap.add_argument("--fast", action="store_true", help="sim: do not sleep between bars")
    ap.add_argument("--ticks", type=int, help="sim: stop after this many bars")
    ap.add_argument("--seed", type=int, default=1, help="sim: random seed")
    a = ap.parse_args(argv)
    cfg = load_config(a.config)

    if a.mode == "sim":
        from sim import SimBroker
        broker = SimBroker(seed=a.seed, start=datetime.now(ET).replace(hour=9, minute=30, second=0, microsecond=0, tzinfo=None))  # today's Eastern date, 9:30 open
    else:
        from alpaca import Broker
        if a.mode == "live" and os.environ.get("VAULT_LIVE") != "yes":
            raise SystemExit("Refusing to trade live: set VAULT_LIVE=yes in the environment to confirm real-money trading.")
        broker = Broker.from_env(a.mode)
        acct = broker.account()
        print(f"{a.mode} account {acct.get('account_number', '?')} · equity ${float(acct.get('equity', 0)):,.2f} · options level {acct.get('options_approved_level', '?')}")
        if a.mode == "live":
            print("LIVE MODE: orders from here on are real.")
    r = Runner(broker, cfg, a.data_dir, fast=a.fast)
    print(f"The Vault runner · mode {a.mode} · {len(r.workers)} workers · state -> {r.path('state.json')}")
    try:
        r.run(once=a.once, ticks=a.ticks)
    except KeyboardInterrupt:
        print("stopped. Open positions stay open; start the runner again to keep managing them.")


if __name__ == "__main__":
    main()

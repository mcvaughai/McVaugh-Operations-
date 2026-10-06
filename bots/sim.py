"""Simulated broker with the same surface the runner uses from `alpaca.Broker`.

Purpose: exercise the full pipeline (signals -> orders -> fills -> trades -> state file
-> dashboard) with no keys and no market hours. Prices are a random walk; options are
priced with Black-Scholes on a 0DTE clock, so premiums and decay behave plausibly.
Nothing here is real money and the state file is tagged mode = "sim".
"""
from __future__ import annotations

import math
import random
from datetime import datetime, timedelta

START = {"QQQ": 600.0, "SPY": 670.0}


def _ncdf(x):
    return 0.5 * (1 + math.erf(x / math.sqrt(2)))


def bs_price(S, K, t_years, sigma, kind, r=0.0):
    if t_years <= 0:
        return max(0.0, S - K) if kind == "call" else max(0.0, K - S)
    d1 = (math.log(S / K) + (r + sigma * sigma / 2) * t_years) / (sigma * math.sqrt(t_years))
    d2 = d1 - sigma * math.sqrt(t_years)
    if kind == "call":
        return S * _ncdf(d1) - K * math.exp(-r * t_years) * _ncdf(d2)
    return K * math.exp(-r * t_years) * _ncdf(-d2) - S * _ncdf(-d1)


class SimBroker:
    mode = "sim"

    def __init__(self, seed: int = 1, start: datetime | None = None, vol: float = 0.20, drift: float = 0.0):
        self.rng = random.Random(seed)
        self.now = start or datetime.now().replace(hour=9, minute=30, second=0, microsecond=0)
        self.vol, self.drift = vol, drift
        self.bars_by_symbol: dict[str, list[dict]] = {}
        self.cash = 25000.0
        self.orders: dict[str, dict] = {}
        self.regime = 0.0
        for s, p0 in START.items():
            self.bars_by_symbol[s] = []
            self._seed_history(s, p0, 60)

    # ---------- simulated market ----------
    def _seed_history(self, s, p0, n):
        t = self.now - timedelta(minutes=n)
        p = p0
        for _ in range(n):
            p = self._step(p)
            self.bars_by_symbol[s].append({"t": t.isoformat(), "o": p, "h": p, "l": p, "c": round(p, 2), "v": 1000})
            t += timedelta(minutes=1)

    def _step(self, p):
        if self.rng.random() < 0.03:
            self.regime = self.rng.uniform(-0.0004, 0.0004)   # short-lived drifts so trends exist
        per_min = self.vol / math.sqrt(252 * 390)
        return p * (1 + self.regime + self.drift + self.rng.gauss(0, per_min))

    def tick(self):
        """Advance the simulated clock one minute and print one bar per symbol."""
        self.now += timedelta(minutes=1)
        for s, bars in self.bars_by_symbol.items():
            p = self._step(bars[-1]["c"])
            bars.append({"t": self.now.isoformat(), "o": p, "h": p, "l": p, "c": round(p, 2), "v": 1000})
            del bars[:-400]

    def _spot(self, s):
        return self.bars_by_symbol[s][-1]["c"]

    def _t_years(self):
        close = self.now.replace(hour=16, minute=0)
        mins = max(0.0, (close - self.now).total_seconds() / 60)
        return mins / (365 * 24 * 60)

    def _price(self, contract):
        u, K, kind = self._parse(contract)
        return bs_price(self._spot(u), K, self._t_years(), self.vol, kind)

    @staticmethod
    def _parse(contract):
        # OCC: QQQ251006C00600000
        root = contract[:-15]
        kind = "call" if contract[-9] == "C" else "put"
        strike = int(contract[-8:]) / 1000
        return root, strike, kind

    # ---------- broker surface ----------
    def clock(self):
        hm = self.now.hour * 60 + self.now.minute
        return {"timestamp": self.now.isoformat(), "is_open": 570 <= hm < 960}

    def account(self):
        return {"equity": f"{self.cash:.2f}", "cash": f"{self.cash:.2f}"}

    def bars(self, symbol, minutes=120):
        return self.bars_by_symbol[symbol][-minutes:]

    def last_price(self, symbol):
        return self._spot(symbol)

    def option_quote(self, contract):
        mid = max(0.01, self._price(contract))
        half = max(0.01, mid * 0.01)
        return {"bid": round(mid - half, 2), "ask": round(mid + half, 2), "mid": round(mid, 2)}

    def pick_contract(self, underlying, spot, kind, dte=0, strike_offset=0):
        step = 1.0
        atm = round(spot / step) * step
        K = atm + strike_offset * step if kind == "call" else atm - strike_offset * step
        exp = (self.now + timedelta(days=dte)).strftime("%y%m%d")
        sym = f"{underlying}{exp}{'C' if kind == 'call' else 'P'}{int(round(K * 1000)):08d}"
        return {"symbol": sym, "strike_price": f"{K:.2f}", "expiration_date": (self.now + timedelta(days=dte)).date().isoformat(), "type": kind}

    def submit(self, contract, qty, side, limit=None, client_id=None):
        q = self.option_quote(contract)
        px = q["ask"] if side == "buy" else q["bid"]
        oid = f"sim-{len(self.orders) + 1}"
        self.cash += (-1 if side == "buy" else 1) * px * 100 * qty
        self.orders[oid] = {"id": oid, "status": "filled", "filled_avg_price": f"{px:.2f}", "filled_qty": str(qty), "symbol": contract, "side": side}
        return self.orders[oid]

    def order(self, order_id):
        return self.orders[order_id]

    def wait_fill(self, order_id, seconds=20.0):
        return self.orders[order_id]

    def cancel(self, order_id):
        pass

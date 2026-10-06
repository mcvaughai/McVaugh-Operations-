"""Thin Alpaca REST client (trading + market data) using only the standard library.

Paper and live share one API; only the base URL and keys differ.
  paper: https://paper-api.alpaca.markets   keys from the Paper tab of the Alpaca dashboard
  live:  https://api.alpaca.markets          keys from the Live tab (real money)
Market data (both): https://data.alpaca.markets

Env vars read by Broker.from_env():
  ALPACA_KEY_ID, ALPACA_SECRET_KEY            (paper or live keys, depending on mode)
  ALPACA_DATA_FEED   = iex | sip              (stocks; iex is free)
  ALPACA_OPTION_FEED = indicative | opra      (options; indicative is free)
"""
from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

TRADING_URL = {"paper": "https://paper-api.alpaca.markets", "live": "https://api.alpaca.markets"}
DATA_URL = "https://data.alpaca.markets"


class BrokerError(Exception):
    pass


class Broker:
    def __init__(self, key_id: str, secret: str, mode: str = "paper", stock_feed: str = "iex", option_feed: str = "indicative", timeout: float = 15.0):
        if mode not in TRADING_URL:
            raise ValueError("mode must be paper or live")
        if not key_id or not secret:
            raise BrokerError("ALPACA_KEY_ID and ALPACA_SECRET_KEY are not set")
        self.mode = mode
        self.base = TRADING_URL[mode]
        self.headers = {"APCA-API-KEY-ID": key_id, "APCA-API-SECRET-KEY": secret, "Accept": "application/json", "Content-Type": "application/json"}
        self.stock_feed = stock_feed
        self.option_feed = option_feed
        self.timeout = timeout

    @classmethod
    def from_env(cls, mode: str) -> "Broker":
        return cls(os.environ.get("ALPACA_KEY_ID", ""), os.environ.get("ALPACA_SECRET_KEY", ""), mode,
                   os.environ.get("ALPACA_DATA_FEED", "iex"), os.environ.get("ALPACA_OPTION_FEED", "indicative"))

    # ---------- http ----------
    def _req(self, method: str, url: str, params: dict | None = None, body: dict | None = None, retries: int = 3):
        if params:
            url += ("&" if "?" in url else "?") + urllib.parse.urlencode({k: v for k, v in params.items() if v is not None})
        data = json.dumps(body).encode() if body is not None else None
        last = None
        for attempt in range(retries):
            req = urllib.request.Request(url, data=data, method=method, headers=self.headers)
            try:
                with urllib.request.urlopen(req, timeout=self.timeout) as r:
                    txt = r.read().decode()
                    return json.loads(txt) if txt else None
            except urllib.error.HTTPError as e:
                txt = e.read().decode(errors="replace")
                if e.code in (429, 500, 502, 503, 504) and attempt < retries - 1:
                    time.sleep(1.5 * (attempt + 1)); last = e; continue
                raise BrokerError(f"{method} {url} -> {e.code}: {txt[:300]}") from None
            except (urllib.error.URLError, TimeoutError) as e:
                last = e
                if attempt < retries - 1:
                    time.sleep(1.5 * (attempt + 1)); continue
                raise BrokerError(f"{method} {url} failed: {e}") from None
        raise BrokerError(f"{method} {url} failed: {last}")

    def _t(self, method, path, params=None, body=None):
        return self._req(method, self.base + path, params, body)

    def _d(self, method, path, params=None):
        return self._req(method, DATA_URL + path, params)

    # ---------- account / clock ----------
    def account(self) -> dict:
        return self._t("GET", "/v2/account")

    def clock(self) -> dict:
        return self._t("GET", "/v2/clock")

    def positions(self) -> list:
        return self._t("GET", "/v2/positions") or []

    # ---------- market data: stocks ----------
    def bars(self, symbol: str, minutes: int = 120) -> list[dict]:
        """Last `minutes` one-minute bars: [{t, o, h, l, c, v}] oldest first."""
        start = (datetime.now(timezone.utc) - timedelta(minutes=minutes + 30)).isoformat().replace("+00:00", "Z")
        out, token = [], None
        while True:
            r = self._d("GET", "/v2/stocks/bars", {"symbols": symbol, "timeframe": "1Min", "start": start, "limit": 1000, "feed": self.stock_feed, "page_token": token, "adjustment": "raw"})
            out += (r.get("bars") or {}).get(symbol, [])
            token = r.get("next_page_token")
            if not token:
                break
        return out[-minutes:]

    def last_price(self, symbol: str) -> float:
        r = self._d("GET", "/v2/stocks/trades/latest", {"symbols": symbol, "feed": self.stock_feed})
        return float(r["trades"][symbol]["p"])

    # ---------- market data: options ----------
    def option_quote(self, contract: str) -> dict:
        """{bid, ask, mid} for one OCC contract symbol."""
        r = self._d("GET", "/v1beta1/options/quotes/latest", {"symbols": contract, "feed": self.option_feed})
        q = (r.get("quotes") or {}).get(contract)
        if not q:
            raise BrokerError(f"no quote for {contract}")
        bid, ask = float(q.get("bp") or 0), float(q.get("ap") or 0)
        mid = (bid + ask) / 2 if bid and ask else (ask or bid)
        return {"bid": bid, "ask": ask, "mid": mid}

    def contracts(self, underlying: str, expiration: str, kind: str, strike_lo: float, strike_hi: float) -> list[dict]:
        r = self._t("GET", "/v2/options/contracts", {"underlying_symbols": underlying, "expiration_date": expiration, "type": kind,
                                                      "strike_price_gte": f"{strike_lo:.2f}", "strike_price_lte": f"{strike_hi:.2f}", "status": "active", "limit": 200})
        return r.get("option_contracts") or []

    def expirations(self, underlying: str, days: int = 7) -> list[str]:
        today = datetime.now(timezone.utc).date()
        r = self._t("GET", "/v2/options/contracts", {"underlying_symbols": underlying, "expiration_date_gte": today.isoformat(),
                                                      "expiration_date_lte": (today + timedelta(days=days)).isoformat(), "status": "active", "limit": 500, "type": "call"})
        return sorted({c["expiration_date"] for c in (r.get("option_contracts") or [])})

    def pick_contract(self, underlying: str, spot: float, kind: str, dte: int = 0, strike_offset: int = 0) -> dict | None:
        """Nearest expiration at or after `dte` days out; strike at-the-money shifted `strike_offset` strikes out of the money."""
        exps = self.expirations(underlying)
        if not exps:
            return None
        want = (datetime.now(timezone.utc).date() + timedelta(days=dte)).isoformat()
        exp = next((e for e in exps if e >= want), exps[-1])
        cs = self.contracts(underlying, exp, kind, spot * 0.97, spot * 1.03)
        if not cs:
            return None
        cs.sort(key=lambda c: float(c["strike_price"]))
        atm = min(range(len(cs)), key=lambda i: abs(float(cs[i]["strike_price"]) - spot))
        idx = atm + strike_offset if kind == "call" else atm - strike_offset
        idx = max(0, min(len(cs) - 1, idx))
        return cs[idx]

    # ---------- orders ----------
    def submit(self, contract: str, qty: int, side: str, limit: float | None = None, client_id: str | None = None) -> dict:
        body = {"symbol": contract, "qty": str(qty), "side": side, "type": "limit" if limit else "market", "time_in_force": "day"}
        if limit:
            body["limit_price"] = f"{limit:.2f}"
        if client_id:
            body["client_order_id"] = client_id
        return self._t("POST", "/v2/orders", body=body)

    def order(self, order_id: str) -> dict:
        return self._t("GET", f"/v2/orders/{order_id}")

    def cancel(self, order_id: str) -> None:
        try:
            self._t("DELETE", f"/v2/orders/{order_id}")
        except BrokerError:
            pass

    def wait_fill(self, order_id: str, seconds: float = 20.0) -> dict:
        """Poll until filled; cancel and raise if it is not filled in time."""
        t0 = time.time()
        while True:
            o = self.order(order_id)
            if o.get("status") == "filled":
                return o
            if o.get("status") in ("canceled", "expired", "rejected"):
                raise BrokerError(f"order {order_id} {o.get('status')}")
            if time.time() - t0 > seconds:
                self.cancel(order_id)
                o = self.order(order_id)
                if o.get("status") == "filled":
                    return o
                raise BrokerError(f"order {order_id} not filled in {seconds:.0f}s; canceled")
            time.sleep(1.0)

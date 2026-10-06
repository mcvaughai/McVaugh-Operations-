# The Vault — Python options bots

Workers (bots) that trade same-day (0DTE) SPY and QQQ options through Alpaca, pay every closed trade into one vault, and stop on their own when the day's profit clears a brake. The dashboard at `/vault.html` reads what the runner writes.

Nothing here predicts profit. The sim mode proves the plumbing works; paper mode proves the strategy against real prices without money; live mode is real money and is gated behind an explicit flag.

## Pieces

| File | Role |
|---|---|
| `bots/runner.py` | The loop. Pulls bars, asks each worker's strategy for a signal, places and manages orders, records trades, writes `data/vault/state.json`. |
| `bots/strategies.py` | Entry signals on the underlying's 1-minute closes: `sigma` (z-score band breakout; `sigma_k` 0 = mean crossover) and `trend` (EMA 9/50 crossover). |
| `bots/alpaca.py` | Alpaca REST client, standard library only. Paper and live use the same calls. |
| `bots/sim.py` | Simulated broker: random-walk prices, Black-Scholes option marks, instant fills. For testing only. |
| `config/bots.json` | The workers and their risk rules. |
| `bots/test_bots.py` | Checks the risk rules and the state file on the simulator. `python bots/test_bots.py` |

## Setup (paper first)

1. Python 3.10+ (`python --version`). No packages to install. On Windows run `pip install tzdata` once so the runner knows Eastern time.
2. Open an Alpaca account at alpaca.markets, enable options trading on the **paper** account (Level 2 is enough for buying calls and puts), and copy the paper API key and secret.
3. Set the keys in the shell that will run the bots:
   * Windows: `set ALPACA_KEY_ID=...` and `set ALPACA_SECRET_KEY=...`
   * Mac/Linux: `export ALPACA_KEY_ID=...` and `export ALPACA_SECRET_KEY=...`
4. Start the dashboard server in one window: `node server/server.js`
5. Start the runner in another: `python bots/runner.py` (paper is the default). It prints the account it connected to and every closed trade.
6. Open http://localhost:8787/vault.html and sign in with any role passphrase from `data/credentials.json`.

If the server and runner use a custom data folder, give both the same `MOW_DATA_DIR`.

### Try it right now, no keys, market closed

```
python bots/runner.py --mode sim
```
One simulated minute per second, from a 9:30 open. The dashboard shows a SIM banner; sim trades are tagged and never mix with paper or live records. `--fast --ticks 390` runs a whole simulated day in a few seconds.

### Going live

Only after paper trading has run for long enough to trust the rules. Then, with the **live** keys in the environment:

```
set VAULT_LIVE=yes        (export on Mac/Linux)
python bots/runner.py --mode live
```
Without `VAULT_LIVE=yes` the runner refuses live mode.

## How a worker trades

Every `poll_seconds` (15 by default) the runner:

1. Reads the clock and the last 120 one-minute bars for each symbol.
2. For a worker with an open position: marks it at the bid and exits on the first rule that fires.
   * `stop_loss_pct` down from entry: **stopped out**
   * `take_profit_pct` up from entry: **profit locked**
   * once the trade has been up `lock_pct`, a trailing stop `trail_pct` below the peak: **rode the trail**
   * `max_hold_minutes` elapsed: **time was up**
   * `flatten_at` (15:50 by default) or market closed: **clocked out at the bell**
3. For a worker with no position, checks whether it may trade: enabled, under `daily_brake` profit, above `daily_loss_limit`, under `max_trades`, market open, inside `trade_window`, past `cooldown_minutes` since its last exit.
4. Asks the strategy for a direction. On a signal it buys `qty` contracts of the nearest expiration at least `dte` days out, at the money shifted `strike_offset` strikes, as a market order, and waits up to `fill_timeout_seconds` for the fill.

When a worker's realized profit for the day reaches `daily_brake` it clocks out ("profit brake hit · off duty") and does not trade again until the next day. `daily_loss_limit` does the same on the downside.

## Turning a worker on or off

Open the worker's card on the dashboard and press **Clock out** (turns it off; any open trade is flattened first), **Clock in**, or **Flatten now**. The button queues a command that the runner picks up on its next pass, usually within `poll_seconds`, so the card updates a few seconds later. Only roles that can write (anything but `viewer`) get the buttons, and every command is written to the audit log.

For a permanent change set `"enabled": false` for that worker in `config/bots.json` and restart the runner.

## Files the runner writes (`data/vault/`, git-ignored)

* `state.json` — the dashboard's feed: mode, clock, equity, each worker's status, trades, open position, thoughts, the last 90 closes per symbol, recent events.
* `trades.jsonl` — one line per closed trade, forever. Tagged with `mode` and `day`.
* `positions.json` — open positions, so a restarted runner picks them back up.
* `commands.json` — a queue the runner drains each pass (`[{"bot": "qqq0", "action": "off"}]`, actions `on`, `off`, `flatten`).

## Market data plans

Alpaca's free plan gives IEX stock bars and indicative option quotes, which is enough to run. Fills in paper mode are simulated by Alpaca against real quotes. For live trading consider the paid OPRA option feed (`ALPACA_OPTION_FEED=opra`) so the marks the stops are judged on are the real market.

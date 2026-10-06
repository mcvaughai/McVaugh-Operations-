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

## The account budget (what $100 actually buys)

`config/bots.json` has an `account` block that describes the real money behind the bots. The runner enforces it in every mode, so paper trading on Alpaca's $100,000 paper account still behaves like your $100:

| Setting | Default | What it does |
|---|---|---|
| `size` | 100 | Starting budget. The runner never spends more than this plus what the bots have earned so far, even if the broker account holds more. |
| `max_premium_per_trade` | 60 | A contract whose ask × 100 × qty is above this is skipped. The runner walks the strike out of the money, up to six strikes, to find one that fits; if none fits the worker shows "too pricey" and waits. |
| `max_open_positions` | 1 | Workers share the slot; the others show "queued". |
| `day_trades_per_5_days` | 3 | Pattern-day-trader protection. A margin account under $25,000 that makes four day trades in five business days gets frozen by the broker, so the runner stops at three and the workers show "day-trade cap". |

With $100 that means: one contract at a time, usually one to three strikes out of the money, about three trades a week. An at-the-money same-day QQQ contract costs $150 to $300, which is why the bots have to go out of the money; those contracts move faster both ways and expire worthless more often. If you open the Alpaca account as a **cash** account there is no day-trade cap, but options cash settles the next day, so one trade a day is the practical limit. Raise `size` and `max_premium_per_trade` when you add money; raise `day_trades_per_5_days` only once the account is over $25,000.

## Testing which strategy to use

Two tools, in this order.

**1. Backtest on real bars.** `bots/backtest.py` replays recorded one-minute SPY and QQQ bars through the exact runner, risk rules and budget, and prints one row per worker and variant:

```
python bots/backtest.py --source alpaca --days 20 --variants bots/variants.json
```
It needs the Alpaca keys in the environment (paper keys work; the data API is the same). `bots/variants.json` lists alternative settings to compare: tighter and wider stops, faster and slower trailing, sigma 1 and 2 instead of 0, and a longer cooldown. Edit it freely; a `patch` applies to every worker, an `account` block overrides the budget. Columns: trades, win rate, total and average P&L, best and worst day, max drawdown, profit factor (gross wins ÷ gross losses), return on premium, and green/red days. Favor the row with the highest profit factor and the shallowest drawdown, not the biggest total; with three trades a week, one lucky day can dominate the total.

Options in the backtest are priced with Black-Scholes on the replayed underlying using the day's realized volatility, because minute-by-minute option tapes are not available. Direction and timing are real; slippage and the bid/ask are modeled. `--source sim` runs the same harness on synthetic days and only proves the plumbing.

**2. Paper trade the winner.** Start the runner in paper mode during market hours (9:35 to 15:50 ET) and leave it running for at least five sessions:

```
python bots/runner.py
```
Then read `data/vault/trades.jsonl`: every line is a closed trade with entry, exit, reason and P&L. Compare the paper fills with what the backtest predicted for the same days. If the paper results are much worse than the backtest, the bid/ask on out-of-the-money contracts is eating the edge, and the fix is a bigger budget (closer to the money), fewer trades, or a longer hold, not a different signal.

The sigma and trend strategies are starting points. Turn a worker off in the dashboard once it has shown a few red sessions, and keep the one that survives.

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

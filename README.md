# Deep-Dip BTC Bot (cbBTC, 1-minute bars)

A trading bot for the make.fun bounty
"Race a BTC trading bot live for 24 hours" (btc-race-24h-20261113-2314).
It trades cbBTC vs USDC on 1-minute bars through the `agent-fun/bars-replay/v1`
protocol, long only, starting from $1,000 paper USDC.

## Strategy

Deep-dip mean reversion, one trade at a time:

- **Entry:** flat and the latest close is at least **115 bps below EMA(60)**
  (seeded with the mean of the first 60 closes). Only a stretched
  dislocation triggers a trade; shallow dips are ignored because backtests
  show they catch the waterfall mid-fall and lose.
- **Size:** all cash (one position; the weight cap is 10000 bps).
- **Exit:** take profit at **+80 bps** above the average fill price, or stop
  out at **-200 bps** below it. No time exit. The replay flattens any open
  position at the end. The entry price is tracked from the fills the
  harness reports, not from the position cost (the reported cost is the
  notional, fee included, 4 bps above the fill price).
- **Costs:** every order names `max_slippage_bps` 100; no order during warm-up.
- **Deterministic:** a pure function of the bars — no clock, no randomness,
  no I/O. The same data always produces the same orders.

## Local grade (official kit harness, dev window)

- **Net PnL +$6.86** (return +0.69%), 1 round-trip trade, win rate 100%,
  max drawdown 2.15%, exposure 42.5%, 0 rejected orders.
- Determinism verified: the L1 regrade reproduced the run byte for byte.
- Cost sensitivity: at 2x fees the net PnL is still +$6.05.
- Neighbouring parameters are also positive (take profit 60/80/100 bps,
  dip 115 bps, stop 200 bps, size $250-$1,000), so the result is a
  plateau, not a tuned spike.

House baselines on the same window: momentum -$49.23, ema-cross -$109.38,
rsi-bollinger -$65.83, adx-momentum -$50.31, buy-and-hold -$52.59,
hold-cash $0.00. This bot beats every house baseline.

## Why this shape

The dev window falls ~5% over 24 hours while 1-minute returns are
essentially uncorrelated, so momentum chasing and buying every small dip
both lose to the ~26 bps round-trip cost (4 bps fee + 2 bps slippage +
price impact each way). The only trade with a positive edge in backtests
across eight strategy families (momentum, EMA cross, RSI/Bollinger,
dip-buying at 15-100 bps, ladders, trailing exits, scale-ins) is the rare
deep dislocation: price stretched far below its 60-minute average, bought
once in full size, held until the reversion pays. A faithful replay
simulator (integer fill model, validated against the official grader to
the cent on the ema-cross baseline) was used to compare the families.

## Files

- `main.ts` — the bot (TypeScript, Node 22, type stripping; stdlib only
  plus the vendored shim).
- `vendor/makefun-bars.ts` — byte-identical copy of the kit's
  `sdk/makefun-bars.ts` (excluded from authorship counts per the kit rules).
- `LICENSE` — MIT.
- `.makefun/owner.json` — account wallet claim file.

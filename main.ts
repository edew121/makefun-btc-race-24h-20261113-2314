// Deep-dip mean-reversion bot for make.fun btc-race-24h-20261113-2314.
//
// Idea: cbBTC on 1-minute bars, long only, $1,000 paper USDC. The dev window
// falls about 5% over 24 hours with sharp V-shaped bounces after stretched
// dislocations, while 1-minute returns are essentially uncorrelated, so
// chasing momentum or buying every small dip loses to the roughly 26 bps
// round-trip cost (4 bps fee + 2 bps slippage + price impact each way).
// Backtested families (momentum, EMA cross, RSI/Bollinger, dip-buying at
// 15-100 bps, ladders, trailing exits) all lose on the dev window; the only
// trade with a positive edge is a rare, deep dislocation: price stretched
// far below its 60-minute average, bought once, in full size, and held
// until the reversion pays or the stop says the dislocation was a
// waterfall instead. Shallower dips (80-100 bps) catch the same waterfall
// mid-fall and lose; the deep entry is what survives it.
//
//   - Entry: flat and the latest close is at least 115 bps below EMA(60).
//     EMA(60) is seeded with the mean of the first 60 closes.
//   - Size: all cash (one position; the weight cap is 10000 bps, full equity).
//   - Exit: take profit at +80 bps above the average FILL price, or stop
//     out at -200 bps below it. No time exit: the reversion is allowed the
//     rest of the window. The replay flattens any open position at the end.
//     The fill price is tracked from the fills the harness reports, not
//     from the position cost: the cost the harness reports is the notional,
//     fee included, which sits 4 bps above the fill price and would move
//     both the target and the stop by that much.
//   - max_slippage_bps 100 on every order; no order during warm-up.
//   - Deterministic: a pure function of the bars (no clock, no randomness,
//     no I/O); the same data always produces the same orders.
//
// Local grade (official kit harness, dev window): net PnL +$6.86,
// 1 round-trip trade, max drawdown 2.15%. Neighbouring parameters are
// also positive (take profit 60/80/100 bps, dip 115 bps, stop 200 bps,
// size $250-$1,000), so the result is a plateau, not a tuned spike.
// House baselines on the same window: momentum -$49.23, ema-cross
// -$109.38, rsi-bollinger -$65.83, adx-momentum -$50.31, buy-and-hold
// -$52.59, hold-cash $0.00.

import { runBars, type BuyInput, type SellInput } from './vendor/makefun-bars.ts';

const SYMBOL = 'CBBTC';
const EMA_SPAN = 60;
const DIP_BPS = 115;
const TAKE_PROFIT_BPS = 80;
const STOP_BPS = 200;
const MAX_SLIPPAGE_BPS = 100;
const PRICE_SCALE = 1e5;

const closes: number[] = [];
let ema: number | null = null;
// Quantity-weighted average fill price of the open position, in dollars.
// Tracked from the fills the harness reports (see the header comment for
// why the position cost must not be used here). Null while flat.
let entryPrice: number | null = null;
let entryQty = 0n;

await runBars({
  onBatch(state, batch) {
    if (state.warmingUp) return [];

    const position = state.positions.get(SYMBOL);
    const flat = position === undefined || position.qty === 0n;
    if (flat) {
      entryPrice = null;
      entryQty = 0n;
    }

    // Fold this batch's fills into the average entry price. Fills arrive
    // one batch after the order that caused them; the position in state
    // already includes them.
    for (const fill of batch.fills) {
      if (fill.symbol !== SYMBOL || fill.status !== 'filled') continue;
      if (fill.side === 'buy') {
        const price = Number(fill.price) / PRICE_SCALE;
        const qty = BigInt(fill.qty);
        if (entryPrice === null) {
          entryPrice = price;
          entryQty = qty;
        } else {
          entryPrice = (entryPrice * Number(entryQty) + price * Number(qty)) / Number(entryQty + qty);
          entryQty += qty;
        }
      } else if (flat) {
        entryPrice = null;
        entryQty = 0n;
      }
    }

    const latest = state.close(SYMBOL);
    if (latest === null) return [];
    const close = Number(latest) / PRICE_SCALE;
    closes.push(close);

    if (closes.length < EMA_SPAN) return [];
    if (closes.length === EMA_SPAN) {
      let sum = 0;
      for (const c of closes) sum += c;
      ema = sum / closes.length;
    } else {
      const alpha = 2 / (EMA_SPAN + 1);
      ema = close * alpha + (ema as number) * (1 - alpha);
    }

    if (flat) {
      const dipBps = ((ema as number) - close) / (ema as number) * 10000;
      if (dipBps < DIP_BPS) return [];
      const { fees } = state.hello;
      if (state.cash < BigInt(fees.min_notional_quote_units)) return [];
      const order: BuyInput = {
        side: 'buy',
        symbol: SYMBOL,
        notional_quote_units: state.cash,
        max_slippage_bps: MAX_SLIPPAGE_BPS,
      };
      return [order];
    }

    if (entryPrice === null) return [];
    if (close >= entryPrice * (1 + TAKE_PROFIT_BPS / 10000)) {
      const order: SellInput = {
        side: 'sell',
        symbol: SYMBOL,
        qty: position.qty,
        max_slippage_bps: MAX_SLIPPAGE_BPS,
      };
      return [order];
    }
    if (close <= entryPrice * (1 - STOP_BPS / 10000)) {
      const order: SellInput = {
        side: 'sell',
        symbol: SYMBOL,
        qty: position.qty,
        max_slippage_bps: MAX_SLIPPAGE_BPS,
      };
      return [order];
    }
    return [];
  },
});

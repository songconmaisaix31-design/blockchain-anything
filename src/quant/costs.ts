import type { CostModel } from './types.js';

/**
 * 默认成本口径（保守，宁可高估成本）。
 * - feeBps：OKX 公开费率实测 taker 0.0015 = 15 bps/边；
 * - slippageBps：主流币日频调仓，点差 + 冲击的保守估计；
 * - apiCostUsdPerCall：BCA credits 估算（Pro $79 / 90,000 credits，1 credit/次）。
 * 这三个数字都可以用 `quant calibrate` 用真实订单簿重新标定，见 estimateImpactBps。
 */
export const DEFAULT_COST_MODEL: CostModel = {
  feeBps: 15,
  slippageBps: 3,
  apiCostUsdPerCall: 0.000878,
  note: 'fee 取交易所公开 taker；slippage 为保守估计；两者都可用真实订单簿标定',
};

export function tradeCost(notionalUsd: number, model: CostModel) {
  const notional = Math.abs(notionalUsd);
  const fee = (notional * model.feeBps) / 1e4;
  const slippage = (notional * model.slippageBps) / 1e4;
  return { fee, slippage, total: fee + slippage };
}

export function roundTripBps(model: CostModel) {
  return (model.feeBps + model.slippageBps) * 2;
}

export type ImpactEstimate = { bps: number; vwap: number; filledUsd: number; complete: boolean };

/**
 * 用真实订单簿估算一笔市价单的冲击成本（bps，相对 mid）。
 * side='buy' 吃 asks，side='sell' 吃 bids。深度不足时 complete=false，bps 只是下界。
 */
export function estimateImpactBps(
  notionalUsd: number,
  book: { bids: number[][]; asks: number[][] },
  side: 'buy' | 'sell' = 'buy',
): ImpactEstimate {
  const levels = (side === 'buy' ? book.asks : book.bids)
    .map(([price, qty]) => [Number(price), Number(qty)] as [number, number])
    .filter(([price, qty]) => Number.isFinite(price) && Number.isFinite(qty) && price > 0 && qty > 0)
    .sort((a, b) => (side === 'buy' ? a[0] - b[0] : b[0] - a[0]));
  const bestBid = Number(book.bids[0]?.[0]);
  const bestAsk = Number(book.asks[0]?.[0]);
  const mid = Number.isFinite(bestBid) && Number.isFinite(bestAsk) ? (bestBid + bestAsk) / 2 : levels[0]?.[0] ?? 0;
  if (!mid || !levels.length) return { bps: 0, vwap: mid, filledUsd: 0, complete: false };
  let remaining = Math.abs(notionalUsd);
  let cost = 0;
  let qtyFilled = 0;
  for (const [price, qty] of levels) {
    const take = Math.min(remaining, price * qty);
    cost += take;
    qtyFilled += take / price;
    remaining -= take;
    if (remaining <= 1e-9) break;
  }
  const vwap = qtyFilled > 0 ? cost / qtyFilled : mid;
  const bps = Math.abs(vwap / mid - 1) * 1e4 * (side === 'buy' ? 1 : 1);
  return { bps, vwap, filledUsd: Math.abs(notionalUsd) - remaining, complete: remaining <= 1e-6 };
}

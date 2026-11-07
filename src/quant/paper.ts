import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { tradeCost } from './costs.js';
import { decide, type PositionState } from './strategies.js';
import type { Aligned } from './engine.js';
import type { CostModel, CostLedger, EquityPoint, PaperState, StrategyId, StrategyParams, Trade } from './types.js';

export function initialState(options: {
  strategy: StrategyId; params: StrategyParams; symbols: string[]; capital: number;
}): PaperState {
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    strategy: options.strategy,
    params: options.params,
    capital: options.capital,
    cash: options.capital,
    positions: options.symbols.map((symbol) => ({ symbol, qty: 0, avgPrice: 0, weight: 0 })),
    lastBar: {},
    pending: [],
    fills: [],
    equity: [],
    ledger: { feesUsd: 0, slippageUsd: 0, apiUsd: 0, totalUsd: 0, turnoverUsd: 0, tradeCount: 0, dragPct: 0 },
  };
}

export function loadState(path: string): PaperState | null {
  try {
    if (!existsSync(path)) return null;
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as PaperState;
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.positions)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveState(path: string, state: PaperState) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(state, null, 2));
}

export type PaperCycleOptions = {
  state: PaperState;
  aligned: Aligned;
  symbols: string[];
  costs: CostModel;
  maxDrawdownStop?: number;
  apiCalls?: number;
};

export type PaperCycleResult = {
  state: PaperState;
  filled: Trade[];
  halted: boolean;
  note: string;
  latest: { t: number; close: number; equity: number };
};

function markToMarket(state: PaperState, aligned: Aligned, index: number) {
  let gross = 0;
  for (const position of state.positions) {
    const bar = aligned.bars.get(position.symbol)?.[index];
    const price = bar?.c ?? position.avgPrice;
    gross += position.qty * price;
    position.weight = 0;
  }
  return { cash: state.cash, gross, total: state.cash + gross };
}

/**
 * 一个 paper 周期：
 * 1) 若上一轮留下了 pending，且已经出现新的 K 线，则在新 K 线开盘价成交（不偷看收盘）；
 * 2) 用最新收盘计算下一轮目标，写入 pending，等下一次运行成交；
 * 3) 触发最大回撤熔断时清仓并停止开新仓。
 */
export function runPaperCycle(options: PaperCycleOptions): PaperCycleResult {
  const { state, aligned, symbols, costs } = options;
  const maxDD = options.maxDrawdownStop ?? 0.25;
  const index = aligned.timestamps.length - 1;
  if (index < 1) throw new Error('数据不足');
  const filled: Trade[] = [];
  let halted = false;

  const latestT = aligned.timestamps[index]!;
  const hasNewBar = state.pending.length > 0
    && symbols.some((symbol) => (state.lastBar[symbol] ?? 0) < (aligned.bars.get(symbol)?.[index]?.t ?? 0));

  if (hasNewBar) {
    const mark = markToMarket(state, aligned, index);
    for (const order of state.pending) {
      const bar = aligned.bars.get(order.symbol)?.[index];
      if (!bar) continue;
      const price = bar.o;
      if (!Number.isFinite(price) || price <= 0) continue;
      const position = state.positions.find((p) => p.symbol === order.symbol);
      if (!position) continue;
      const currentNotional = position.qty * price;
      const targetNotional = mark.total * order.weight;
      const delta = targetNotional - currentNotional;
      const band = Math.max(mark.total * 0.01, Math.abs(targetNotional) * 0.2);
      if (Math.abs(delta) < band) continue;
      const { fee, slippage } = tradeCost(Math.abs(delta), costs);
      if (delta > 0) {
        const qty = delta / price;
        const oldQty = position.qty;
        position.qty = oldQty + qty;
        position.avgPrice = position.qty > 0 ? (position.avgPrice * oldQty + delta) / position.qty : price;
        state.cash -= delta + fee + slippage;
        filled.push({ t: bar.t, symbol: order.symbol, side: 'buy', price, qty, notional: delta, feeUsd: fee, slippageUsd: slippage, reason: 'paper-rebalance' });
      } else {
        const qty = Math.min(position.qty, -delta / price);
        if (qty <= 0) continue;
        const proceeds = qty * price;
        position.qty -= qty;
        if (position.qty <= 1e-12) { position.qty = 0; position.avgPrice = 0; }
        state.cash += proceeds - fee - slippage;
        filled.push({ t: bar.t, symbol: order.symbol, side: 'sell', price, qty, notional: proceeds, feeUsd: fee, slippageUsd: slippage, reason: 'paper-rebalance' });
      }
      state.ledger.feesUsd += fee;
      state.ledger.slippageUsd += slippage;
      state.ledger.turnoverUsd += Math.abs(delta);
      state.ledger.tradeCount += 1;
    }
    state.pending = [];
  }

  for (const symbol of symbols) {
    const bar = aligned.bars.get(symbol)?.[index];
    if (bar) state.lastBar[symbol] = bar.t;
  }

  const mark = markToMarket(state, aligned, index);
  const peak = Math.max(state.capital, ...state.equity.map((p) => p.equity), mark.total);
  const drawdown = peak > 0 ? mark.total / peak - 1 : 0;
  state.equity.push({ t: latestT, equity: mark.total, gross: mark.gross, cash: state.cash, drawdown });

  if (drawdown <= -maxDD) {
    // 熔断：按最新收盘清仓，记录成本，之后不再开新仓。
    for (const position of state.positions) {
      if (position.qty <= 0) continue;
      const bar = aligned.bars.get(position.symbol)?.[index];
      const price = bar?.c ?? position.avgPrice;
      const notional = position.qty * price;
      const { fee, slippage } = tradeCost(notional, costs);
      state.cash += notional - fee - slippage;
      state.ledger.feesUsd += fee;
      state.ledger.slippageUsd += slippage;
      state.ledger.turnoverUsd += notional;
      state.ledger.tradeCount += 1;
      filled.push({ t: latestT, symbol: position.symbol, side: 'sell', price, qty: position.qty, notional, feeUsd: fee, slippageUsd: slippage, reason: 'kill-switch' });
      position.qty = 0; position.avgPrice = 0;
    }
    state.pending = [];
    halted = true;
  } else {
    const states = new Map<string, PositionState>(symbols.map((s) => [s, { inPosition: false, entryIndex: 0 }]));
    let gross = 0;
    const next = new Map<string, number>();
    for (const symbol of symbols) {
      const bars = aligned.bars.get(symbol);
      if (!bars) continue;
      const closes = bars.map((b) => b.c);
      const decision = decide(state.strategy, bars, closes, index, state.params, states.get(symbol)!);
      const weight = Math.max(0, decision.weight);
      next.set(symbol, weight);
      gross += weight;
    }
    const scale = gross > state.params.maxGross && gross > 0 ? state.params.maxGross / gross : 1;
    state.pending = [...next.entries()].map(([symbol, weight]) => ({
      symbol, side: 'buy' as const, weight: Math.round(weight * scale * 20) / 20,
      targetNotional: Math.round(mark.total * weight * scale),
    })).filter((order) => order.weight > 0 || (state.positions.find((p) => p.symbol === order.symbol)?.qty ?? 0) > 0);
  }

  state.fills.push(...filled);
  state.ledger.apiUsd = (options.apiCalls ?? 0) * costs.apiCostUsdPerCall;
  state.ledger.totalUsd = state.ledger.feesUsd + state.ledger.slippageUsd + state.ledger.apiUsd;
  state.ledger.dragPct = state.capital > 0 ? state.ledger.totalUsd / state.capital : 0;
  state.updatedAt = new Date().toISOString();

  return {
    state, filled, halted,
    note: halted
      ? `触发 ${(maxDD * 100).toFixed(0)}% 最大回撤熔断，已清仓并停止开新仓。`
      : state.pending.length
        ? `已生成 ${state.pending.length} 条下一期目标，等下一根 K 线开盘成交。`
        : '本期无目标仓位。',
    latest: { t: latestT, close: aligned.bars.get(symbols[0]!)?.[index]?.c ?? 0, equity: mark.total },
  };
}

import { tradeCost } from './costs.js';
import { decide, type PositionState } from './strategies.js';
import type {
  BacktestResult, Bar, CostModel, CostLedger, EquityPoint, Metrics, StrategyId, StrategyParams, Trade,
} from './types.js';

export type Aligned = { timestamps: number[]; bars: Map<string, Bar[]> };

export type BacktestOptions = {
  strategy: StrategyId;
  params: StrategyParams;
  symbols: string[];
  aligned: Aligned;
  capital: number;
  costs: CostModel;
  apiCalls?: number;
  dataSource?: string;
};

type Holding = { qty: number; avgPrice: number; realized: number; closes: number; wins: number; pnl: number[]; fees: number };

const emptyHolding = (): Holding => ({ qty: 0, avgPrice: 0, realized: 0, closes: 0, wins: 0, pnl: [], fees: 0 });

export function warmupBars(params: StrategyParams, strategy: StrategyId) {
  const regime = strategy === 'meanrev' ? Math.max(params.regimeSma, 200) : params.regimeSma;
  return Math.max(params.lookback, params.exitLookback, params.volWindow, regime) + 2;
}

export function sliceAligned(aligned: Aligned, from: number, to: number): Aligned {
  const bars = new Map<string, Bar[]>();
  for (const [symbol, series] of aligned.bars) bars.set(symbol, series.slice(from, to));
  return { timestamps: aligned.timestamps.slice(from, to), bars };
}

function dailyStats(values: number[]) {
  if (values.length < 2) return { mean: 0, std: 0 };
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / (values.length - 1);
  return { mean, std: Math.sqrt(variance) };
}

function computeMetrics(
  equity: EquityPoint[],
  ledger: CostLedger,
  initialCapital: number,
  holdings: Map<string, Holding>,
  tradeCount: number,
): Metrics {
  const values = equity.map((p) => p.equity);
  const first = values[0] ?? initialCapital;
  const last = values[values.length - 1] ?? initialCapital;
  const days = Math.max(1, (equity[equity.length - 1]!.t - equity[0]!.t) / 86_400_000);
  const years = days / 365;
  const rets: number[] = [];
  for (let i = 1; i < values.length; i += 1) {
    const prev = values[i - 1]!;
    if (prev > 0) rets.push(values[i]! / prev - 1);
  }
  const { mean, std } = dailyStats(rets);
  const downside = rets.filter((r) => r < 0);
  const downStd = downside.length > 1
    ? Math.sqrt(downside.reduce((a, b) => a + b * b, 0) / (downside.length - 1))
    : 0;
  const annVol = std * Math.sqrt(365);
  const totalReturn = first > 0 ? last / first - 1 : 0;
  const cagr = first > 0 && years > 0 ? (last / first) ** (1 / years) - 1 : 0;
  let peak = values[0] ?? initialCapital;
  let worst = 0;
  for (const value of values) {
    peak = Math.max(peak, value);
    if (peak > 0) worst = Math.min(worst, value / peak - 1);
  }
  let closes = 0; let wins = 0; let gains = 0; let losses = 0;
  for (const holding of holdings.values()) {
    closes += holding.closes; wins += holding.wins;
    for (const pnl of holding.pnl) { if (pnl >= 0) gains += pnl; else losses += Math.abs(pnl); }
  }
  const exposure = equity.length
    ? equity.reduce((sum, p) => sum + (p.equity > 0 ? p.gross / p.equity : 0), 0) / equity.length : 0;
  return {
    start: new Date(equity[0]!.t).toISOString().slice(0, 10),
    end: new Date(equity[equity.length - 1]!.t).toISOString().slice(0, 10),
    days: Math.round(days),
    totalReturn, cagr, vol: annVol,
    sharpe: std > 0 ? (mean / std) * Math.sqrt(365) : 0,
    sortino: downStd > 0 ? (mean / downStd) * Math.sqrt(365) : 0,
    maxDrawdown: worst,
    calmar: worst < 0 ? cagr / Math.abs(worst) : 0,
    winRate: closes > 0 ? wins / closes : 0,
    profitFactor: losses > 0 ? gains / losses : gains > 0 ? Infinity : 0,
    avgExposure: exposure,
    turnoverPerYear: years > 0 ? ledger.turnoverUsd / years / initialCapital : 0,
    tradeCount,
  };
}

export function backtest(options: BacktestOptions): BacktestResult {
  const { strategy, params, symbols, aligned, capital, costs } = options;
  const { timestamps, bars } = aligned;
  const n = timestamps.length;
  const warmup = warmupBars(params, strategy);
  if (n <= warmup + 10) throw new Error(`数据不足以回测：${n} 根，至少需要 ${warmup + 11} 根`);

  const holdings = new Map<string, Holding>(symbols.map((s) => [s, emptyHolding()]));
  const states = new Map<string, PositionState>(symbols.map((s) => [s, { inPosition: false, entryIndex: 0 }]));
  const closes = new Map<string, number[]>(symbols.map((s) => [s, (bars.get(s) ?? []).map((b) => b.c)]));
  const targets = new Map<string, number>();
  const ledger: CostLedger = { feesUsd: 0, slippageUsd: 0, apiUsd: 0, totalUsd: 0, turnoverUsd: 0, tradeCount: 0, dragPct: 0 };
  const trades: Trade[] = [];
  const equity: EquityPoint[] = [];
  let cash = capital;
  let lastClose = new Map<string, number>();
  // 只有在收盘算出新目标后的下一根开盘才执行，避免每天重复调仓、放大换手与成本。
  let pendingExecution = false;

  const equityAt = (i: number) => {
    let gross = 0;
    for (const symbol of symbols) {
      const price = bars.get(symbol)?.[i]?.c ?? lastClose.get(symbol) ?? 0;
      gross += (holdings.get(symbol)?.qty ?? 0) * price;
    }
    return { cash, gross, total: cash + gross };
  };

  for (let i = 0; i < n; i += 1) {
    // 1) 用上一根收盘产生的目标，在本根开盘成交（不偷看未来）
    if (i > 0 && pendingExecution) {
      pendingExecution = false;
      const mark = equityAt(i - 1);
      for (const symbol of symbols) {
        const bar = bars.get(symbol)?.[i];
        if (!bar) continue;
        const price = bar.o;
        if (!Number.isFinite(price) || price <= 0) continue;
        const targetWeight = targets.get(symbol) ?? 0;
        const holding = holdings.get(symbol)!;
        const targetNotional = mark.total * targetWeight;
        const currentNotional = holding.qty * price;
        const delta = targetNotional - currentNotional;
        // 免交易带：相对偏离不足 20%、且绝对额不足资金 1% 时不动，避免为微小偏离付手续费。
        const band = Math.max(mark.total * 0.01, Math.abs(targetNotional) * 0.2);
        if (Math.abs(delta) < band) continue;
        const { fee, slippage } = tradeCost(Math.abs(delta), costs);
        if (delta > 0) {
          const qty = delta / price;
          const oldQty = holding.qty;
          holding.qty = oldQty + qty;
          holding.avgPrice = holding.qty > 0 ? (holding.avgPrice * oldQty + delta) / holding.qty : price;
          cash -= delta + fee + slippage;
          trades.push({ t: bar.t, symbol, side: 'buy', price, qty, notional: delta, feeUsd: fee, slippageUsd: slippage, reason: 'rebalance' });
        } else {
          const qty = Math.min(holding.qty, -delta / price);
          if (qty <= 0) continue;
          const proceeds = qty * price;
          if (holding.qty > 0) {
            const pnl = (price - holding.avgPrice) * qty - fee - slippage;
            holding.realized += pnl;
            holding.pnl.push(pnl);
            holding.closes += 1;
            if (pnl > 0) holding.wins += 1;
          }
          holding.qty -= qty;
          if (holding.qty <= 1e-12) { holding.qty = 0; holding.avgPrice = 0; }
          cash += proceeds - fee - slippage;
          trades.push({ t: bar.t, symbol, side: 'sell', price, qty, notional: proceeds, feeUsd: fee, slippageUsd: slippage, reason: 'rebalance' });
        }
        holding.fees += fee + slippage;
        ledger.feesUsd += fee;
        ledger.slippageUsd += slippage;
        ledger.turnoverUsd += Math.abs(delta);
        ledger.tradeCount += 1;
      }
    }

    // 2) 收盘盯市
    for (const symbol of symbols) {
      const bar = bars.get(symbol)?.[i];
      if (bar) lastClose.set(symbol, bar.c);
    }
    const mark = equityAt(i);
    equity.push({ t: timestamps[i]!, equity: mark.total, gross: mark.gross, cash: mark.cash, drawdown: 0 });

    // 3) 收盘后用已知数据算下一期的目标
    if (i >= warmup && (i - warmup) % Math.max(1, params.rebalanceDays) === 0) {
      let gross = 0;
      const next = new Map<string, number>();
      for (const symbol of symbols) {
        const series = bars.get(symbol);
        const closesForSymbol = closes.get(symbol);
        if (!series || !closesForSymbol) continue;
        const decision = decide(strategy, series, closesForSymbol, i, params, states.get(symbol)!);
        states.set(symbol, decision.state);
        next.set(symbol, Math.max(0, decision.weight));
        gross += Math.max(0, decision.weight);
      }
      const scale = gross > params.maxGross && gross > 0 ? params.maxGross / gross : 1;
      for (const [symbol, weight] of next) next.set(symbol, Math.round(weight * scale * 20) / 20);
      targets.clear();
      for (const [symbol, weight] of next) targets.set(symbol, weight);
      pendingExecution = targets.size > 0;
    }
  }

  // 期末按最后收盘价平掉，保证 PnL 已实现、成本入账
  const lastIndex = n - 1;
  for (const symbol of symbols) {
    const holding = holdings.get(symbol)!;
    if (holding.qty <= 0) continue;
    const bar = bars.get(symbol)?.[lastIndex];
    const price = bar?.c ?? lastClose.get(symbol) ?? holding.avgPrice;
    const notional = holding.qty * price;
    const { fee, slippage } = tradeCost(notional, costs);
    const pnl = (price - holding.avgPrice) * holding.qty - fee - slippage;
    holding.realized += pnl;
    holding.pnl.push(pnl);
    holding.closes += 1;
    if (pnl > 0) holding.wins += 1;
    holding.fees += fee + slippage;
    ledger.feesUsd += fee;
    ledger.slippageUsd += slippage;
    ledger.turnoverUsd += notional;
    ledger.tradeCount += 1;
    cash += notional - fee - slippage;
    trades.push({ t: timestamps[lastIndex]!, symbol, side: 'sell', price, qty: holding.qty, notional, feeUsd: fee, slippageUsd: slippage, reason: 'final-close' });
    holding.qty = 0;
  }

  ledger.apiUsd = (options.apiCalls ?? 0) * costs.apiCostUsdPerCall;
  ledger.totalUsd = ledger.feesUsd + ledger.slippageUsd + ledger.apiUsd;
  ledger.dragPct = capital > 0 ? ledger.totalUsd / capital : 0;

  const finalEquity = equity.length ? equity[equity.length - 1]! : null;
  if (finalEquity) {
    const totalAfterCosts = cash;
    finalEquity.equity = totalAfterCosts;
    finalEquity.cash = cash;
    finalEquity.gross = 0;
  }
  let peak = equity[0]?.equity ?? capital;
  for (const point of equity) { peak = Math.max(peak, point.equity); point.drawdown = peak > 0 ? point.equity / peak - 1 : 0; }

  const monthly = new Map<string, { first: number; last: number }>();
  for (const point of equity) {
    const key = new Date(point.t).toISOString().slice(0, 7);
    const entry = monthly.get(key);
    if (!entry) monthly.set(key, { first: point.equity, last: point.equity });
    else entry.last = point.equity;
  }
  const monthlyReturns = [...monthly.entries()].map(([month, v]) => ({ month, ret: v.first > 0 ? v.last / v.first - 1 : 0 }));

  return {
    strategy, params, symbols, initialCapital: capital,
    equity, trades, ledger,
    metrics: computeMetrics(equity, ledger, capital, holdings, ledger.tradeCount),
    monthlyReturns,
    perSymbol: symbols.map((symbol) => {
      const holding = holdings.get(symbol)!;
      return { symbol, trades: holding.closes, pnlUsd: holding.realized, feesUsd: holding.fees };
    }),
  };
}

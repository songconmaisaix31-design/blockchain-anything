import { backtest, sliceAligned, warmupBars, type Aligned } from './engine.js';
import type { CostModel, GridCell, StrategyId, StrategyParams, WalkforwardResult } from './types.js';

export type WalkforwardOptions = {
  strategy: StrategyId;
  base: StrategyParams;
  aligned: Aligned;
  symbols: string[];
  capital: number;
  costs: CostModel;
  splitRatio?: number;
  apiCalls?: number;
};

type Candidate = Partial<StrategyParams>;

function runOne(
  strategy: StrategyId, params: StrategyParams, aligned: Aligned, symbols: string[], capital: number, costs: CostModel, apiCalls: number,
) {
  const result = backtest({ strategy, params, aligned, symbols, capital, costs, apiCalls });
  return { sharpe: result.metrics.sharpe, cagr: result.metrics.cagr, maxDD: result.metrics.maxDrawdown, trades: result.metrics.tradeCount };
}

/**
 * 样本内选参 → 样本外验证。样本外切片额外包含 warmup 根前置数据（只用历史，不引入未来信息），
 * 因此样本外开头会有若干天空仓期，指标按整段计算，属于保守处理。
 */
export function walkforward(options: WalkforwardOptions): WalkforwardResult {
  const { strategy, base, aligned, symbols, capital, costs } = options;
  const apiCalls = options.apiCalls ?? 0;
  const splitRatio = options.splitRatio ?? 0.7;
  const n = aligned.timestamps.length;
  const split = Math.max(1, Math.min(n - 1, Math.floor(n * splitRatio)));
  const warmup = warmupBars(base, strategy);

  const candidates: Candidate[] = [];
  for (const lookback of [30, 60, 90, 120]) {
    for (const targetVol of [0.15, 0.2, 0.25]) {
      candidates.push({ lookback, targetVol });
    }
  }

  const isAligned = sliceAligned(aligned, 0, split);
  const oosStart = Math.max(0, split - warmup);
  const oosAligned = sliceAligned(aligned, oosStart, n);

  const cells: GridCell[] = [];
  for (const candidate of candidates) {
    const params: StrategyParams = { ...base, ...candidate };
    try {
      const is = runOne(strategy, params, isAligned, symbols, capital, costs, apiCalls);
      const oos = runOne(strategy, params, oosAligned, symbols, capital, costs, apiCalls);
      cells.push({
        params: candidate,
        isSharpe: is.sharpe, isCagr: is.cagr, isMaxDD: is.maxDD,
        oosSharpe: oos.sharpe, oosCagr: oos.cagr, oosMaxDD: oos.maxDD,
      });
    } catch {
      // 数据不足的组合直接跳过，不伪造结果
    }
  }

  const eligible = cells.filter((c) => c.isSharpe > 0);
  const pool = eligible.length ? eligible : cells;
  const chosen = pool.length
    ? pool.reduce((best, cur) => (cur.isSharpe > best.isSharpe ? cur : best))
    : null;

  const splitDate = new Date(aligned.timestamps[split - 1]!).toISOString().slice(0, 10);
  return {
    strategy,
    splitDate,
    inSampleDays: split,
    outOfSampleDays: n - split,
    cells,
    chosen,
    note: chosen
      ? `按样本内 Sharpe 选参（${JSON.stringify(chosen.params)}）。样本外 Sharpe ${chosen.oosSharpe.toFixed(2)}，样本内 ${chosen.isSharpe.toFixed(2)}。样本内强、样本外弱是过拟合的典型信号，请以样本外为准。`
      : '没有可用参数组合，数据可能不足。',
  };
}

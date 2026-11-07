import { annualizedVol, atr, donchianHigh, donchianLow, rsi, sma } from './indicators.js';
import type { Bar, StrategyId, StrategyParams } from './types.js';

export type PositionState = { inPosition: boolean; entryIndex: number };

export const STRATEGY_LABELS: Record<StrategyId, string> = {
  tsmom: '时序动量 + 波动率目标（长/空仓）',
  donchian: '唐奇安通道突破（趋势跟随）',
  meanrev: '均值回归（牛市回调买入）',
};

/**
 * 时序动量：过去 N 日收益为正才持有，仓位按 targetVol / 实现波动缩放。
 * 决策只用 index 及之前的数据，执行在下一根开盘，避免前视。
 */
export function tsmomWeight(closes: number[], index: number, params: StrategyParams): number {
  if (params.regimeSma > 0) {
    const regime = sma(closes, params.regimeSma, index);
    if (regime === null || closes[index]! < regime) return 0;
  }
  const past = closes[index - params.lookback];
  if (past === undefined || past <= 0) return 0;
  const momentum = closes[index]! / past - 1;
  if (momentum <= 0) return 0;
  if (params.targetVol <= 0) return params.maxWeight;
  const vol = annualizedVol(closes, params.volWindow, index);
  if (vol === null || vol <= 0) return 0;
  return Math.min(params.maxWeight, params.targetVol / vol);
}

/** 唐奇安突破：突破前 N 日高点入场，跌破前 M 日低点离场。 */
export function donchianStep(
  bars: Bar[],
  index: number,
  params: StrategyParams,
  state: PositionState,
): { weight: number; state: PositionState } {
  const close = bars[index]!.c;
  if (!state.inPosition) {
    const high = donchianHigh(bars, params.lookback, index - 1);
    if (high !== null && close > high) {
      const atrValue = atr(bars, 14, index);
      const stopDistance = atrValue && atrValue > 0 ? atrValue / close : 0.03;
      const riskWeight = Math.min(params.maxWeight, 0.005 / stopDistance);
      const vol = annualizedVol(bars.map((b) => b.c), params.volWindow, index);
      const volCap = params.targetVol > 0 && vol && vol > 0 ? params.targetVol / vol : params.maxWeight;
      return { weight: Math.max(0, Math.min(params.maxWeight, riskWeight, volCap)), state: { inPosition: true, entryIndex: index } };
    }
    return { weight: 0, state };
  }
  const low = donchianLow(bars, params.exitLookback, index - 1);
  if (low !== null && close < low) return { weight: 0, state: { inPosition: false, entryIndex: state.entryIndex } };
  return { weight: params.maxWeight, state };
}

/** 均值回归：长期均线之上、RSI 超卖时买入，RSI 回升或持有超时离场。 */
export function meanrevStep(
  closes: number[],
  index: number,
  params: StrategyParams,
  state: PositionState,
): { weight: number; state: PositionState } {
  const regimeWindow = params.regimeSma > 0 ? params.regimeSma : 200;
  const regime = sma(closes, regimeWindow, index);
  const value = rsi(closes, 3, index);
  if (regime === null || value === null) return { weight: 0, state };
  const aboveRegime = closes[index]! > regime;
  if (!state.inPosition) {
    if (aboveRegime && value < 30) {
      return { weight: params.maxWeight, state: { inPosition: true, entryIndex: index } };
    }
    return { weight: 0, state };
  }
  const held = index - state.entryIndex;
  if (value > 55 || held > 10 || !aboveRegime) {
    return { weight: 0, state: { inPosition: false, entryIndex: state.entryIndex } };
  }
  return { weight: params.maxWeight, state };
}

export function decide(
  strategy: StrategyId,
  bars: Bar[],
  closes: number[],
  index: number,
  params: StrategyParams,
  state: PositionState,
): { weight: number; state: PositionState } {
  if (strategy === 'tsmom') return { weight: tsmomWeight(closes, index, params), state };
  if (strategy === 'donchian') return donchianStep(bars, index, params, state);
  return meanrevStep(closes, index, params, state);
}

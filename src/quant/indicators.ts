import type { Bar } from './types.js';

export function sma(values: number[], window: number, end: number): number | null {
  if (window <= 0 || end + 1 < window) return null;
  let sum = 0;
  for (let i = end - window + 1; i <= end; i += 1) sum += values[i]!;
  return sum / window;
}

export function stdev(values: number[], window: number, end: number): number | null {
  if (window <= 1 || end + 1 < window) return null;
  const mean = sma(values, window, end);
  if (mean === null) return null;
  let acc = 0;
  for (let i = end - window + 1; i <= end; i += 1) {
    const d = values[i]! - mean;
    acc += d * d;
  }
  return Math.sqrt(acc / (window - 1));
}

/** 简单日收益率序列，index 0 为 null。 */
export function dailyReturns(closes: number[]): (number | null)[] {
  return closes.map((value, i) => (i === 0 || closes[i - 1] === 0 ? null : value / closes[i - 1]! - 1));
}

/** 年化波动率：日收益标准差 × sqrt(365)。 */
export function annualizedVol(closes: number[], window: number, end: number): number | null {
  if (end + 1 < window + 1) return null;
  const rets: number[] = [];
  for (let i = end - window + 1; i <= end; i += 1) {
    const prev = closes[i - 1];
    if (prev === undefined || prev === 0) continue;
    rets.push(closes[i]! / prev - 1);
  }
  if (rets.length < Math.min(8, window)) return null;
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const variance = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length - 1);
  return Math.sqrt(variance) * Math.sqrt(365);
}

export function atr(bars: Bar[], window: number, end: number): number | null {
  if (end < window) return null;
  let sum = 0;
  for (let i = end - window + 1; i <= end; i += 1) {
    const bar = bars[i]!;
    const prevClose = bars[i - 1]?.c ?? bar.o;
    sum += Math.max(bar.h - bar.l, Math.abs(bar.h - prevClose), Math.abs(bar.l - prevClose));
  }
  return sum / window;
}

export function donchianHigh(bars: Bar[], window: number, end: number): number | null {
  if (end + 1 < window) return null;
  let high = -Infinity;
  for (let i = end - window + 1; i <= end; i += 1) high = Math.max(high, bars[i]!.h);
  return high;
}

export function donchianLow(bars: Bar[], window: number, end: number): number | null {
  if (end + 1 < window) return null;
  let low = Infinity;
  for (let i = end - window + 1; i <= end; i += 1) low = Math.min(low, bars[i]!.l);
  return low;
}

/** Wilder RSI。 */
export function rsi(closes: number[], window: number, end: number): number | null {
  if (end < window) return null;
  let gain = 0;
  let loss = 0;
  for (let i = end - window + 1; i <= end; i += 1) {
    const diff = closes[i]! - closes[i - 1]!;
    if (diff >= 0) gain += diff;
    else loss -= diff;
  }
  if (gain + loss === 0) return 50;
  const rs = gain / Math.max(loss, 1e-12);
  return 100 - 100 / (1 + rs);
}

export function maxDrawdown(equity: number[]): number {
  let peak = equity[0] ?? 0;
  let worst = 0;
  for (const value of equity) {
    if (value > peak) peak = value;
    if (peak > 0) worst = Math.min(worst, value / peak - 1);
  }
  return worst;
}

export function pctChange(from: number, to: number): number {
  return from === 0 ? 0 : to / from - 1;
}

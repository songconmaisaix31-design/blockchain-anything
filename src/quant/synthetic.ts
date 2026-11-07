import type { Bar, Series } from './types.js';

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rnd: () => number) {
  const u = Math.max(rnd(), 1e-9);
  const v = rnd();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export type SyntheticOptions = {
  symbols: string[];
  days?: number;
  seed?: number;
  startPrices?: Record<string, number>;
  annualVol?: number;
};

/**
 * 合成行情：牛熊 regime 切换 + 波动率聚集 + 偶发跳空。
 * 仅用于验证回测引擎的正确性（成交时序、成本、风控），**不能**作为策略盈利能力的证据。
 * 数据源标记为 `synthetic`，报告与 CLI 都会显式标注。
 */
export function syntheticSeries(options: SyntheticOptions): Series[] {
  const days = options.days ?? 1200;
  const seed = options.seed ?? 20261107;
  const annualVol = options.annualVol ?? 0.55;
  const rnd = mulberry32(seed);
  const symbols = options.symbols;
  const startPrices = options.startPrices ?? Object.fromEntries(symbols.map((s, i) => [s, 30_000 / (i + 1)]));

  const end = Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate());
  const timestamps: number[] = Array.from({ length: days }, (_, i) => end - (days - 1 - i) * 86_400_000);

  // 共同因子：regime 漂移 + 波动率聚集
  const factorReturns: number[] = [];
  let regime = 1;
  let regimeLeft = 90 + Math.floor(rnd() * 120);
  let logVol = Math.log(annualVol);
  for (let i = 0; i < days; i += 1) {
    regimeLeft -= 1;
    if (regimeLeft <= 0) {
      regime = rnd() < 0.45 ? -1 : 1;
      regimeLeft = 70 + Math.floor(rnd() * 180);
    }
    logVol = 0.97 * logVol + 0.03 * Math.log(annualVol) + 0.04 * gaussian(rnd);
    const dailyVol = (Math.exp(logVol) / Math.sqrt(365)) * (regime > 0 ? 1 : 1.25);
    const dailyDrift = (regime > 0 ? 0.45 : -0.35) / 365;
    const jump = rnd() < 0.004 ? gaussian(rnd) * dailyVol * 6 : 0;
    factorReturns.push(dailyDrift + dailyVol * gaussian(rnd) + jump);
  }

  return symbols.map((symbol, index) => {
    const beta = 1 + 0.25 * (index % 3);
    const idioVol = 0.35 / Math.sqrt(365);
    let price = startPrices[symbol] ?? 1000;
    const bars: Bar[] = [];
    for (let i = 0; i < days; i += 1) {
      const ret = beta * factorReturns[i]! + idioVol * gaussian(rnd);
      const prev = price;
      price = Math.max(0.01, price * (1 + ret));
      const gap = 1 + gaussian(rnd) * 0.002;
      const open = Math.max(0.01, prev * gap);
      const close = price;
      const wick = Math.abs(gaussian(rnd)) * 0.006 + 0.001;
      const high = Math.max(open, close) * (1 + wick);
      const low = Math.min(open, close) * (1 - wick);
      const volume = 1000 * (1 + Math.abs(gaussian(rnd))) * (1 + Math.abs(ret) * 40);
      bars.push({ t: timestamps[i]!, o: open, h: high, l: low, c: close, v: volume });
    }
    return { symbol, exchange: 'synthetic', timeframe: '1d', bars };
  });
}

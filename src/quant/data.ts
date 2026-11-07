import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Bar, Series } from './types.js';

const FALLBACK_EXCHANGES = ['okx', 'kraken', 'coinbase'];
const TF_MS: Record<string, number> = { '1h': 3_600_000, '4h': 14_400_000, '1d': 86_400_000 };

type CcxtLike = {
  fetchOHLCV(symbol: string, timeframe?: string, since?: number, limit?: number): Promise<unknown[][]>;
  close(): Promise<void>;
};

async function makeClient(name: string, timeoutMs: number): Promise<CcxtLike> {
  const { default: ccxt } = await import('ccxt');
  if (!ccxt.exchanges.includes(name)) throw new Error(`未知 CCXT 交易所：${name}`);
  const Ctor = ccxt[name as keyof typeof ccxt] as unknown as new (options: object) => CcxtLike;
  return new Ctor({
    enableRateLimit: true,
    timeout: timeoutMs,
    ...(process.env.BCA_CCXT_PROXY ? { httpsProxy: process.env.BCA_CCXT_PROXY } : {}),
  });
}

function cachePath(dir: string, exchange: string, symbol: string, timeframe: string) {
  return join(dir, `${exchange}-${symbol.replace(/[^a-zA-Z0-9]+/g, '_')}-${timeframe}.json`);
}

function readCache(file: string, maxAgeMs: number): Bar[] | null {
  try {
    if (!existsSync(file)) return null;
    const stat = JSON.parse(readFileSync(file, 'utf8')) as { savedAt?: number; bars?: Bar[] };
    if (!stat.savedAt || !stat.bars?.length) return null;
    if (Date.now() - stat.savedAt > maxAgeMs) return null;
    return stat.bars;
  } catch {
    return null;
  }
}

export type FetchOptions = {
  symbol: string;
  timeframe?: string;
  limit?: number;
  exchange?: string;
  cacheDir?: string;
  cacheMaxAgeMs?: number;
  refresh?: boolean;
  timeoutMs?: number;
};

/** 拉取日线（或多周期）K 线，带多交易所兜底与磁盘缓存；不使用任何交易凭据。 */
export async function fetchSeries(options: FetchOptions): Promise<Series> {
  const timeframe = options.timeframe ?? '1d';
  const limit = options.limit ?? 1200;
  const cacheDir = options.cacheDir ?? join(process.cwd(), '.quant', 'cache');
  const cacheMaxAgeMs = options.cacheMaxAgeMs ?? 6 * 3_600_000;
  const timeoutMs = options.timeoutMs ?? 25_000;
  const tfMs = TF_MS[timeframe];
  if (!tfMs) throw new Error(`不支持的 timeframe：${timeframe}`);
  const candidates = options.exchange ? [options.exchange, ...FALLBACK_EXCHANGES.filter((e) => e !== options.exchange)] : FALLBACK_EXCHANGES;
  const errors: string[] = [];

  for (const exchange of candidates) {
    const file = cachePath(cacheDir, exchange, options.symbol, timeframe);
    if (!options.refresh) {
      const cached = readCache(file, cacheMaxAgeMs);
      if (cached && cached.length >= Math.min(limit, 50)) {
        return { symbol: options.symbol, exchange, timeframe, bars: cached.slice(-limit) };
      }
    }
    let client: CcxtLike | null = null;
    try {
      client = await makeClient(exchange, timeoutMs);
      let since = Date.now() - limit * tfMs;
      const collected = new Map<number, Bar>();
      let emptyRounds = 0;
      while (collected.size < limit && emptyRounds < 2) {
        const remaining = limit - collected.size;
        const batch = await client.fetchOHLCV(options.symbol, timeframe, since, Math.min(300, remaining));
        if (!batch.length) {
          emptyRounds += 1;
          since += tfMs * Math.min(300, remaining);
          continue;
        }
        for (const row of batch) {
          const [t, o, h, l, c, v] = row as [number, number, number, number, number, number];
          if (![t, o, h, l, c].every((n) => Number.isFinite(n))) continue;
          collected.set(t, { t, o, h, l, c, v: Number.isFinite(v) ? v : 0 });
        }
        const lastT = batch[batch.length - 1]![0] as number;
        if (lastT + tfMs <= since) break;
        since = lastT + tfMs;
        if (collected.size >= limit) break;
      }
      const bars = [...collected.values()].sort((a, b) => a.t - b.t).slice(-limit);
      if (bars.length < 30) throw new Error(`仅返回 ${bars.length} 根 K 线，数据不足`);
      mkdirSync(cacheDir, { recursive: true });
      writeFileSync(file, JSON.stringify({ savedAt: Date.now(), exchange, symbol: options.symbol, timeframe, bars }));
      return { symbol: options.symbol, exchange, timeframe, bars };
    } catch (error) {
      errors.push(`${exchange}: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      await client?.close().catch(() => undefined);
    }
  }
  throw new Error(`全部交易所均失败：${errors.join(' | ')}`);
}

/** 按时间戳对齐多品种，取交集，保证组合回测不偷看未来。 */
export function alignSeries(series: Series[]) {
  if (!series.length) throw new Error('没有可对齐的序列');
  const maps = series.map((s) => new Map(s.bars.map((bar) => [bar.t, bar])));
  const common = [...maps[0]!.keys()].filter((t) => maps.every((m) => m.has(t))).sort((a, b) => a - b);
  if (common.length < 30) throw new Error('对齐后数据不足 30 根');
  return {
    timestamps: common,
    bars: new Map(series.map((s, i) => [s.symbol, common.map((t) => maps[i]!.get(t)!)])) as Map<string, Bar[]>,
  };
}

export function seriesHealth(series: Series) {
  const bars = series.bars;
  let gaps = 0;
  let duplicates = 0;
  const seen = new Set<number>();
  for (let i = 0; i < bars.length; i += 1) {
    const bar = bars[i]!;
    if (seen.has(bar.t)) duplicates += 1;
    seen.add(bar.t);
    if (i > 0 && bar.t - bars[i - 1]!.t > TF_MS[series.timeframe]! * 1.5) gaps += 1;
  }
  return {
    symbol: series.symbol,
    exchange: series.exchange,
    bars: bars.length,
    from: new Date(bars[0]!.t).toISOString().slice(0, 10),
    to: new Date(bars[bars.length - 1]!.t).toISOString().slice(0, 10),
    gaps,
    duplicates,
  };
}

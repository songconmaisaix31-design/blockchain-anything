import { readConfig } from '../config.js';
import { tradingTools } from '../trading/index.js';
import type { Bar, Series } from './types.js';

const TF_MS: Record<string, number> = { '1h': 3_600_000, '4h': 14_400_000, '1d': 86_400_000 };

type OhlcvRow = [number, number, number, number, number, number];

/**
 * 直接复用仓库里的 `ccxt_ohlcv` 工具（PR #19 新增）作为数据源，
 * 因此 EA 与 MCP 工具走同一套路由、兜底与结构化错误，不另造一套行情客户端。
 */
export async function fetchSeriesViaBca(options: {
  symbol: string; timeframe?: string; limit?: number; exchange?: string;
}): Promise<Series> {
  const timeframe = options.timeframe ?? '1d';
  const limit = options.limit ?? 1200;
  const tfMs = TF_MS[timeframe];
  if (!tfMs) throw new Error(`不支持的 timeframe：${timeframe}`);
  const config = readConfig();
  const tool = tradingTools(config).find((item) => item.name === 'ccxt_ohlcv');
  if (!tool) throw new Error('当前版本没有 ccxt_ohlcv 工具，请先合并 PR #19 或升级 runtime');

  const collected = new Map<number, Bar>();
  let since = Date.now() - limit * tfMs;
  for (let round = 0; round < 24 && collected.size < limit; round += 1) {
    const raw = await tool.execute({
      exchange: options.exchange ?? 'okx',
      symbol: options.symbol,
      timeframe,
      since,
      limit: Math.min(500, limit - collected.size),
    }) as { taskStatus?: string; code?: string; message?: string; exchange?: string; ohlcv?: OhlcvRow[] };
    if (raw?.taskStatus === 'business_failed') {
      throw new Error(`${raw.code ?? 'UPSTREAM_ERROR'}: ${raw.message ?? '上游失败'}`);
    }
    const rows = raw?.ohlcv ?? [];
    if (!rows.length) break;
    for (const row of rows) {
      const [t, o, h, l, c, v] = row;
      if (![t, o, h, l, c].every((n) => Number.isFinite(n))) continue;
      collected.set(t, { t, o, h, l, c, v: Number.isFinite(v) ? v : 0 });
    }
    const lastT = rows[rows.length - 1]![0];
    if (lastT + tfMs <= since) break;
    since = lastT + tfMs;
  }
  const bars = [...collected.values()].sort((a, b) => a.t - b.t).slice(-limit);
  if (bars.length < 30) throw new Error(`ccxt_ohlcv 仅返回 ${bars.length} 根，数据不足`);
  return { symbol: options.symbol, exchange: options.exchange ?? 'okx', timeframe, bars };
}

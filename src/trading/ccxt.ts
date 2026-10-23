import { z } from 'zod';
import { defineTool } from '../types.js';
import type { WalletConfig } from '../wallets/config.js';

async function exchangeFor(config: WalletConfig, requested?: string) {
  const id = requested ?? config.ccxtExchange;
  const ccxt = await import('ccxt');
  if (!Object.hasOwn(ccxt.exchanges, id)) throw new Error(`未知 CCXT exchange：${id}`);
  const Constructor = (ccxt as unknown as Record<string, new (options: Record<string, unknown>) => {
    id: string;
    fetchMarkets(): Promise<unknown[]>;
    fetchTicker(symbol: string): Promise<Record<string, unknown>>;
    fetchOHLCV(symbol: string, timeframe: string, since?: number, limit?: number): Promise<unknown[]>;
  }>)[id];
  if (!Constructor) throw new Error(`CCXT 未导出 exchange：${id}`);
  return new Constructor({ enableRateLimit: true, timeout: config.base.timeoutMs });
}

export function ccxtTools(config: WalletConfig) {
  return [
    defineTool(
      'trading_ccxt_status',
      '读取 CCXT 公开数据适配器的进程配置；不使用 API key，不执行交易。',
      z.strictObject({}),
      true,
      async () => ({ sdk: 'ccxt', exchange: config.ccxtExchange, credentialsUsed: false, scope: 'public-only' }),
    ),
    defineTool(
      'trading_ccxt_markets',
      '通过 CCXT 公共 API 读取指定交易所的市场列表；只读公开数据。',
      z.strictObject({ exchange: z.string().min(1).optional() }),
      true,
      async ({ exchange }) => {
        const client = await exchangeFor(config, exchange);
        const markets = await client.fetchMarkets() as Array<Record<string, unknown>>;
        return {
          sdk: 'ccxt',
          exchange: client.id,
          count: markets.length,
          symbols: markets.map((market) => market.symbol).filter((symbol): symbol is string => typeof symbol === 'string'),
        };
      },
    ),
    defineTool(
      'trading_ccxt_ticker',
      '通过 CCXT 公共 API 读取交易对 ticker；只读公开数据，不涉及账户或下单。',
      z.strictObject({
        symbol: z.string().min(3),
        exchange: z.string().min(1).optional(),
      }),
      true,
      async ({ symbol, exchange }) => {
        const client = await exchangeFor(config, exchange);
        const ticker = await client.fetchTicker(symbol);
        return {
          sdk: 'ccxt',
          exchange: client.id,
          symbol,
          ticker: {
            last: ticker.last ?? null,
            bid: ticker.bid ?? null,
            ask: ticker.ask ?? null,
            high: ticker.high ?? null,
            low: ticker.low ?? null,
            baseVolume: ticker.baseVolume ?? null,
            quoteVolume: ticker.quoteVolume ?? null,
            timestamp: ticker.timestamp ?? null,
            datetime: ticker.datetime ?? null,
          },
        };
      },
    ),
    defineTool(
      'trading_ccxt_ohlcv',
      '通过 CCXT 公共 API 读取 OHLCV；只读公开数据，不涉及账户或下单。',
      z.strictObject({
        symbol: z.string().min(3),
        timeframe: z.string().regex(/^[1-9][0-9]*[mhdw]$/).default('1h'),
        limit: z.number().int().positive().max(500).default(100),
        exchange: z.string().min(1).optional(),
      }),
      true,
      async ({ symbol, timeframe, limit, exchange }) => {
        const client = await exchangeFor(config, exchange);
        const candles = await client.fetchOHLCV(symbol, timeframe, undefined, limit);
        return { sdk: 'ccxt', exchange: client.id, symbol, timeframe, count: candles.length, candles };
      },
    ),
  ];
}

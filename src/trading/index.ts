import { z } from 'zod';
import type { Config } from '../config.js';
import { defineTool } from '../types.js';
import { endpointEnv, envHeaders, requestJson } from '../providers/http.js';

async function exchange(config: Config, name: string) {
  const { default: ccxt } = await import('ccxt');
  if (!ccxt.exchanges.includes(name)) throw new Error('未知 CCXT 交易所');
  const Constructor = ccxt[name as keyof typeof ccxt] as unknown as new (options: object) => import('ccxt').Exchange;
  return new Constructor({ enableRateLimit: true, timeout: config.timeoutMs,
    ...(process.env.BCA_CCXT_PROXY ? { httpsProxy: endpointEnv('BCA_CCXT_PROXY') } : {}),
  });
}

export function tradingTools(config: Config) {
  const market = z.strictObject({ exchange: z.string().regex(/^[a-z0-9]+$/), symbol: z.string().min(1).max(80) });
  return [
    defineTool('ccxt_exchanges', '列出已安装官方 CCXT 支持的交易所。', z.strictObject({}), true,
      async () => ({ exchanges: (await import('ccxt')).default.exchanges })),
    defineTool('ccxt_ticker', '通过官方 CCXT 查询公开行情，不加载交易凭据。', market, true,
      async ({ exchange: name, symbol }) => {
        const client = await exchange(config, name);
        try { return await client.fetchTicker(symbol); } finally { await client.close(); }
      }),
    defineTool('ccxt_orderbook', '通过官方 CCXT 查询公开订单簿。', market.extend({ limit: z.number().int().min(1).max(100).default(20) }), true,
      async ({ exchange: name, symbol, limit }) => {
        const client = await exchange(config, name);
        try { return await client.fetchOrderBook(symbol, limit); } finally { await client.close(); }
      }),
    defineTool('hummingbot_status', '读取已部署 Hummingbot API 的运行中机器人状态；不启动策略、不下单。', z.strictObject({}), true,
      async () => requestJson(config, `${endpointEnv('BCA_HUMMINGBOT_URL')}/bot-orchestration/status`, { headers: envHeaders('BCA_HUMMINGBOT_AUTH', 'Authorization', '') })),
  ];
}

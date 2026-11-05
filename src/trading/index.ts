// +4 个只读量化输入工具、451/429 结构化错误信封、可达性兜底链与瞬态重试、订单簿同快照 microstructure。
// 注：提交前在仓库内执行 `npm run typecheck && npm run build` 做类型验证。
import { z } from 'zod';
import type { Config } from '../config.js';
import { defineTool } from '../types.js';
import { endpointEnv, envHeaders, requestJson } from '../providers/http.js';

type CcxtExchange = import('ccxt').Exchange;
type Attempt = Record<string, unknown>;
type Failure = {
  taskStatus: 'business_failed';
  code: string;
  upstream: string;
  message: string;
  retryable: boolean;
  alternatives: string[];
  hint: string;
  nextCall: Record<string, unknown> | null;
  attempts: Attempt[];
  upstreamMessage: string | null;
  upstreamCostUsd: null;
  note: string;
};
type FailureArgs = {
  code: string;
  upstream: string;
  message: string;
  retryable: boolean;
  alternatives: string[];
  hint: string;
  nextCall: Record<string, unknown> | null;
  attempts?: Attempt[];
  upstreamMessage?: string | null;
};
type RoutedInput = {
  tool: string;
  exchange: string;
  symbol?: string | null;
  allowFallback?: boolean;
  resolve?: boolean;
  fallbacks?: string[];
};
type Classified = { code: string; raw: string; continuable: boolean; transient: boolean; envelope: Failure };

const FALLBACK_EXCHANGES = ['okx', 'kraken', 'coinbase'];
const REACHABILITY_TTL_MS = 60_000;
const reachability = new Map<string, { ok: boolean; at: number; code?: string }>();

async function exchange(config: Config, name: string): Promise<CcxtExchange> {
  const { default: ccxt } = await import('ccxt');
  if (!ccxt.exchanges.includes(name)) throw new Error('未知 CCXT 交易所');
  const Constructor = ccxt[name as keyof typeof ccxt] as unknown as new (options: object) => CcxtExchange;
  return new Constructor({ enableRateLimit: true, timeout: config.timeoutMs,
    ...(process.env.BCA_CCXT_PROXY ? { httpsProxy: endpointEnv('BCA_CCXT_PROXY') } : {}),
  });
}

async function withClient<T>(config: Config, name: string, invoke: (client: CcxtExchange) => Promise<T>): Promise<T> {
  const client = await exchange(config, name);
  try { return await invoke(client); } finally { await client.close(); }
}

/** 结构化失败信封：以返回值而非异常给出，避免 toolkit.safeError 把可执行信息脱敏成纯文本。 */
function failure(args: FailureArgs): Failure {
  return { taskStatus: 'business_failed', attempts: [], upstreamMessage: null, upstreamCostUsd: null,
    note: '结构化上游失败：Agent 可直接按 nextCall 降级，无需解析异常文本。', ...args };
}

function classify(error: unknown, upstream: string, symbol: string | null, tool: string, candidateList: string[] = FALLBACK_EXCHANGES): Classified {
  const raw = error instanceof Error ? error.message : String(error);
  const geo = /\b451\b|Unavailable For Legal Reasons|restricted location|Service unavailable from a restricted|\b403\b/i.test(raw);
  const rate = /\b429\b|rate.?limit|too many requests/i.test(raw);
  const network = /ETIMEDOUT|ECONNRESET|ENOTFOUND|EAI_AGAIN|fetch failed|timeout|timed out|NetworkError/i.test(raw);
  const badSymbol = /BadSymbol|does not have market symbol|not supported|does not support|not implemented|not found/i.test(raw);
  const code = geo ? 'UPSTREAM_GEO_BLOCKED' : rate ? 'UPSTREAM_RATE_LIMITED' : network ? 'UPSTREAM_UNREACHABLE' : badSymbol ? 'UPSTREAM_BAD_SYMBOL' : 'UPSTREAM_ERROR';
  const alternatives = candidateList.filter((item) => item !== upstream);
  const retryable = geo || network || rate;
  const envelope = failure({ code, upstream,
    message: geo ? `${upstream} 在当前地区不可达（HTTP 451 地域限制）`
      : rate ? `${upstream} 触发上游限流（HTTP 429）`
        : network ? `${upstream} 网络不可达或超时`
          : badSymbol ? `${upstream} 不支持该交易对或该方法` : `${upstream} 上游调用失败`,
    retryable, alternatives, upstreamMessage: raw.slice(0, 500),
    hint: geo ? '设置 BCA_CCXT_PROXY，或改用可达交易所（alternatives / nextCall）'
      : rate ? '降低调用频率；本工具已对瞬态限流自动重试一次'
        : network ? '检查网络或 BCA_CCXT_PROXY；可改用 alternatives'
          : badSymbol ? '改用该交易所支持的交易对，或换一家交易所' : '查看 upstreamMessage 并按 nextCall 重试',
    nextCall: { tool, input: { exchange: alternatives[0] ?? upstream, ...(symbol ? { symbol } : {}) } } });
  return { code, raw, continuable: retryable || badSymbol, transient: network || rate, envelope };
}

/** ccxt 统一符号在不同交易所存在差异，按市场表解析，解析结果写回返回值以便对账。 */
async function resolveSymbol(client: CcxtExchange, symbol: string | null, enabled: boolean): Promise<string | null> {
  if (!symbol || !enabled) return symbol;
  const markets = (client.markets ?? await client.loadMarkets()) as unknown as Record<string, unknown>;
  if (markets[symbol]) return symbol;
  const base = symbol.split('/')[0];
  for (const quote of ['USDT', 'USD', 'USDC', 'EUR']) {
    const alt = `${base}/${quote}`;
    if (markets[alt]) return alt;
  }
  return symbol;
}

async function routedCall(
  config: Config,
  { tool, exchange: primary, symbol = null, allowFallback = true, resolve = true, fallbacks = FALLBACK_EXCHANGES }: RoutedInput,
  invoke: (client: CcxtExchange, symbol: string | null) => Promise<Record<string, unknown>>,
): Promise<Record<string, unknown>> {
  const chain = allowFallback ? [primary, ...fallbacks.filter((item) => item !== primary)] : [primary];
  const attempts: Attempt[] = [];
  let last: Classified | null = null;
  for (const candidate of chain) {
    const cached = reachability.get(candidate);
    // 主选交易所始终真实探测，保证 451 等结构化错误可复现；仅对候选交易所使用短期缓存。
    if (candidate !== primary && cached && !cached.ok && Date.now() - cached.at < REACHABILITY_TTL_MS) {
      attempts.push({ exchange: candidate, skipped: 'cached_unreachable', code: cached.code ?? null });
      continue;
    }
    // 网络抖动 / 限流是真实交易链路的常态：同一交易所瞬时重试一次，再决定是否降级。
    const maxAttempts = allowFallback ? 2 : 1;
    for (let round = 1; round <= maxAttempts; round++) {
      try {
        const value = await withClient(config, candidate, async (client) => {
          const resolved = await resolveSymbol(client, symbol, resolve);
          return { value: await invoke(client, resolved), resolved };
        });
        reachability.set(candidate, { ok: true, at: Date.now() });
        if (round > 1) attempts.push({ exchange: candidate, recovered: `第 ${round} 次尝试成功` });
        const routing = candidate === primary ? { exchange: candidate }
          : { exchange: candidate, routing: { requested: primary, used: candidate, attempts, reason: '可达性兜底' } };
        return { ...routing, ...(symbol ? { symbol, resolvedSymbol: value.resolved } : {}), ...value.value };
      } catch (error) {
        const c = classify(error, candidate, symbol, tool, fallbacks);
        last = c;
        if (c.transient && round < maxAttempts) {
          attempts.push({ exchange: candidate, code: c.code, transientRetry: round });
          await new Promise((done) => setTimeout(done, 400 * round));
          continue;
        }
        reachability.set(candidate, { ok: false, at: Date.now(), code: c.code });
        attempts.push({ exchange: candidate, code: c.code, message: c.raw.slice(0, 200) });
        if (!allowFallback || !c.continuable) return { ...c.envelope, attempts };
        break;
      }
    }
  }
  const base = last?.envelope ?? failure({ code: 'ALL_UPSTREAMS_UNREACHABLE', upstream: primary,
    message: '所有候选交易所均不可达', retryable: true, alternatives: fallbacks,
    hint: '设置 BCA_CCXT_PROXY 或检查网络', nextCall: null });
  return { ...base, code: 'ALL_UPSTREAMS_UNREACHABLE', attempts,
    message: `${primary} 及全部候选交易所均不可用（${attempts.length} 次尝试）` };
}

export function tradingTools(config: Config) {
  const exchangeName = z.string().regex(/^[a-z0-9]+$/);
  const market = z.strictObject({ exchange: exchangeName, symbol: z.string().min(1).max(80),
    allowFallback: z.boolean().default(true).describe('上游不可达时自动切换到可达交易所；关闭后返回结构化错误信封') });
  return [
    defineTool('ccxt_exchanges', '列出已安装官方 CCXT 支持的交易所。', z.strictObject({}), true,
      async () => ({ exchanges: (await import('ccxt')).default.exchanges })),
    defineTool('ccxt_ticker', '通过官方 CCXT 查询公开行情 ticker（bid / ask / last），用于价差与成本估算。', market, true,
      (input) => routedCall(config, { tool: 'ccxt_ticker', ...input },
        async (client, symbol) => ({ ticker: await client.fetchTicker(symbol as string) }))),
    defineTool('ccxt_orderbook', '通过官方 CCXT 查询公开订单簿 orderbook 及同一快照的买一/卖一/中间价/价差，用于深度与冲击成本估算。',
      market.extend({ limit: z.number().int().min(1).max(100).default(20) }), true,
      (input) => routedCall(config, { tool: 'ccxt_orderbook', ...input }, async (client, symbol) => {
        const ob = await client.fetchOrderBook(symbol as string, input.limit);
        const bestBid = ob.bids?.[0]?.[0] ?? null;
        const bestAsk = ob.asks?.[0]?.[0] ?? null;
        const mid = bestBid !== null && bestAsk !== null ? (bestBid + bestAsk) / 2 : null;
        const spread = bestBid !== null && bestAsk !== null ? bestAsk - bestBid : null;
        const spreadBps = spread !== null && mid !== null && mid > 0 ? Math.round(spread / mid * 1e6) / 100 : null;
        return { orderbook: ob, microstructure: { bestBid, bestAsk, mid, spread, spreadBps,
          note: '买卖一与中间价取自同一份订单簿快照；滑点与成本计算必须以本快照 mid 为基准，跨请求价格漂移会污染估计。' } };
      })),
    // 含成本回测的四类输入，全部只读、不加载交易凭据、不下单。
    defineTool('ccxt_ohlcv', '通过官方 CCXT 获取历史 K 线（OHLCV / candle），策略研究与净值序列的输入数据。',
      market.extend({ timeframe: z.string().min(1).max(12).default('1d'), since: z.number().int().min(0).optional(),
        limit: z.number().int().min(1).max(500).default(30) }), true,
      (input) => routedCall(config, { tool: 'ccxt_ohlcv', ...input }, async (client, symbol) => ({
        timeframe: input.timeframe, since: input.since ?? null, limit: input.limit,
        ohlcv: await client.fetchOHLCV(symbol as string, input.timeframe, input.since, input.limit),
      }))),
    defineTool('ccxt_funding_rate', '通过官方 CCXT 获取永续合约资金费率（funding rate / funding），用于持仓成本计算；仅支持永续合约的交易所可用。', market, true,
      (input) => routedCall(config, { tool: 'ccxt_funding_rate', ...input, resolve: false, fallbacks: ['okx'] },
        async (client, symbol) => ({ fundingRate: await client.fetchFundingRate(symbol as string) }))),
    defineTool('ccxt_trades', '通过官方 CCXT 获取公开逐笔成交（trades / 成交回报），用于滑点与冲击估计。',
      market.extend({ limit: z.number().int().min(1).max(100).default(20) }), true,
      (input) => routedCall(config, { tool: 'ccxt_trades', ...input }, async (client, symbol) => ({
        limit: input.limit, trades: await client.fetchTrades(symbol as string, undefined, input.limit),
      }))),
    defineTool('ccxt_fees', '读取交易所公开交易费率表（trading_fee / fee_rate / maker / taker），用于成本归因；优先公开接口，需凭据时回退 CCXT 静态费率。',
      z.strictObject({ exchange: exchangeName, allowFallback: z.boolean().default(true) }), true,
      (input) => routedCall(config, { tool: 'ccxt_fees', ...input, resolve: false }, async (client) => {
        let trading: unknown = null;
        let source = 'ccxt-static-fees';
        try {
          const dynamic = client as unknown as Record<string, unknown>;
          const fetchFees = dynamic.fetchTradingFees as (() => Promise<Record<string, unknown>>) | undefined;
          if (typeof fetchFees === 'function' && (dynamic.has as Record<string, unknown> | undefined)?.fetchTradingFees) {
            const live = await fetchFees.call(client);
            if (live && Object.keys(live).length) { trading = live; source = 'fetchTradingFees'; }
          }
        } catch {
          // 公开端点常见：需要账户凭据。退回 CCXT 随包发布的公开费率元数据，不编造数字。
        }
        if (!trading) trading = client.fees?.trading ?? null;
        return { fees: { trading }, feeSource: source,
          note: '费率为交易所公开费率元数据；实际成交费率随 VIP 等级、活动与币种变化，回测需按账户实际费率复核。' };
      })),
    defineTool('hummingbot_status', '读取已部署 Hummingbot API 的运行中机器人状态；不启动策略、不下单。', z.strictObject({}), true,
      async () => {
        if (!process.env.BCA_HUMMINGBOT_URL)
          return failure({ code: 'MISSING_CONFIG', upstream: 'hummingbot', message: '需要 BCA_HUMMINGBOT_URL',
            retryable: false, alternatives: [], hint: '设置 BCA_HUMMINGBOT_URL 指向已部署的 Hummingbot API；本工具只读状态、不启动策略、不下单',
            nextCall: { tool: 'capability_search', input: { query: 'Hummingbot 状态配置', limit: 3 } } });
        try {
          return await requestJson(config, `${endpointEnv('BCA_HUMMINGBOT_URL')}/bot-orchestration/status`,
            { headers: envHeaders('BCA_HUMMINGBOT_AUTH', 'Authorization', '') });
        } catch (error) {
          return failure({ code: 'UPSTREAM_UNREACHABLE', upstream: 'hummingbot', message: 'Hummingbot API 不可达',
            retryable: true, alternatives: [], upstreamMessage: (error instanceof Error ? error.message : String(error)).slice(0, 500),
            hint: '检查 BCA_HUMMINGBOT_URL 与 BCA_HUMMINGBOT_AUTH',
            nextCall: { tool: 'capability_search', input: { query: 'Hummingbot 配置', limit: 3 } } });
        }
      }),
  ];
}

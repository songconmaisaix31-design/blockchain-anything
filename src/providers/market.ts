import { z } from 'zod';
import type { Config } from '../config.js';
import { defineTool } from '../types.js';
import { requestJson } from './http.js';
import { uint256Schema } from './common.js';

const LLAMA = 'https://api.llama.fi';

// DefiLlama 的字段会随上游增删，这里只取稳定字段，其余原样保留在 raw 中。
const protocolSchema = z.looseObject({
  name: z.string().optional(),
  symbol: z.string().optional(),
  category: z.string().optional(),
  chains: z.array(z.string()).optional(),
  url: z.string().optional(),
  description: z.string().optional(),
  audits: z.string().optional(),
  tvl: z.array(z.looseObject({ date: z.number(), totalLiquidityUSD: z.number() })).optional(),
});

const chainsSchema = z.array(z.looseObject({ name: z.string(), tvl: z.number(), tokenSymbol: z.string().nullable().optional() }));

const jupiterQuoteSchema = z.looseObject({
  inputMint: z.string(),
  inAmount: z.string(),
  outputMint: z.string(),
  outAmount: z.string(),
  otherAmountThreshold: z.string().optional(),
  slippageBps: z.number().optional(),
  priceImpactPct: z.string().optional(),
  routePlan: z.array(z.looseObject({ swapInfo: z.looseObject({ label: z.string().optional() }).optional() })).optional(),
});

// 常用 Solana 代币，避免调用方每次自己查 mint。
const SOLANA_MINTS: Record<string, string> = {
  SOL: 'So11111111111111111111111111111111111111112',
  USDC: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  USDT: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
  JUP: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN',
  BONK: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
};

// 仅用于把最小单位换算成人类可读比例；未知代币不猜精度。
const MINT_DECIMALS: Record<string, number> = {
  So11111111111111111111111111111111111111112: 9,
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: 6,
  Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: 6,
  JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN: 6,
  DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263: 5,
};

function mintOf(value: string): string {
  const upper = value.toUpperCase();
  return SOLANA_MINTS[upper] ?? value;
}

export function marketTools(config: Config) {
  return [
    defineTool(
      'defillama_protocol',
      '查询 DefiLlama 上单个协议的最新 TVL、所属类别、覆盖链与审计情况。只读，公开接口，无需密钥。',
      z.strictObject({
        slug: z.string().min(1).regex(/^[a-z0-9-]+$/i, 'slug 只能包含字母、数字与连字符').describe('DefiLlama 协议标识，例如 uniswap、aave、lido'),
      }),
      true,
      async ({ slug }) => {
        const detailUrl = `${LLAMA}/protocol/${slug.toLowerCase()}`;
        // 详情接口包含完整 TVL 历史，长历史协议会超过默认读取上限；这里单独放宽到 8MB，仍有界。
        const detailConfig = { ...config, maxReadBytes: Math.max(config.maxReadBytes, 8 * 1024 * 1024) };
        let body: z.output<typeof protocolSchema> | null = null;
        let degraded: string | null = null;
        try {
          body = protocolSchema.parse(await requestJson(detailConfig, detailUrl, { headers: { Accept: 'application/json' } }));
        } catch (error) {
          // 详情接口会返回完整 TVL 序列，长历史协议可能超过读取上限；此时降级为当前 TVL。
          const message = error instanceof Error ? error.message : String(error);
          if (!/读取字节上限|BCA_MAX_READ_BYTES/.test(message)) throw error;
          degraded = '详情响应超过 BCA_MAX_READ_BYTES，已降级为只返回当前 TVL';
        }

        if (!body) {
          const tvlUrl = `${LLAMA}/tvl/${slug.toLowerCase()}`;
          const raw = await requestJson(config, tvlUrl, { headers: { Accept: 'application/json' } });
          const tvl = typeof raw === 'number' ? raw : Number(raw);
          if (!Number.isFinite(tvl)) throw new Error(`DefiLlama 没有返回 ${slug} 的 TVL 数值（协议可能不存在或已更名）`);
          return {
            provider: 'defillama',
            access: 'public',
            slug,
            name: slug,
            tvlUsd: tvl,
            category: null,
            chains: [],
            change7dPct: null,
            degraded,
            source: tvlUrl,
          };
        }

        const series = body.tvl ?? [];
        const latest = series.at(-1);
        if (!latest) throw new Error(`DefiLlama 没有返回 ${slug} 的 TVL 数据（协议可能不存在或已更名）`);
        const previous = series.at(-8);
        const change7d = previous && previous.totalLiquidityUSD > 0
          ? ((latest.totalLiquidityUSD - previous.totalLiquidityUSD) / previous.totalLiquidityUSD) * 100
          : null;
        return {
          provider: 'defillama',
          access: 'public',
          slug,
          name: body.name ?? slug,
          symbol: body.symbol ?? null,
          category: body.category ?? null,
          chains: body.chains ?? [],
          url: body.url ?? null,
          audits: body.audits ?? null,
          tvlUsd: latest.totalLiquidityUSD,
          tvlAt: new Date(latest.date * 1000).toISOString(),
          change7dPct: change7d === null ? null : Number(change7d.toFixed(2)),
          description: body.description ? body.description.slice(0, 400) : null,
          degraded: null,
          source: detailUrl,
        };
      },
    ),
    defineTool(
      'defillama_chains',
      '查询各条链在 DefiLlama 上的最新 TVL 排名。只读，公开接口，无需密钥。',
      z.strictObject({
        limit: z.number().int().min(1).max(50).default(10).describe('返回前 N 条链，默认 10'),
      }),
      true,
      async ({ limit }) => {
        const url = `${LLAMA}/v2/chains`;
        const chains = chainsSchema.parse(await requestJson(config, url, { headers: { Accept: 'application/json' } }));
        const ranked = chains.filter((item) => item.tvl > 0).sort((a, b) => b.tvl - a.tvl).slice(0, limit);
        return {
          provider: 'defillama',
          access: 'public',
          totalChains: chains.length,
          returned: ranked.length,
          chains: ranked.map((item, index) => ({ rank: index + 1, name: item.name, tvlUsd: Math.round(item.tvl), symbol: item.tokenSymbol ?? null })),
          source: url,
        };
      },
    ),
    defineTool(
      'jupiter_quote',
      '通过 Jupiter 公开报价接口获取 Solana 上两个代币之间的兑换报价（只读报价，不构造也不提交交易）。',
      z.strictObject({
        inputMint: z.string().min(2).describe('输入代币 mint 地址，可用简写 SOL / USDC / USDT / JUP / BONK'),
        outputMint: z.string().min(2).describe('输出代币 mint 地址，可用简写 SOL / USDC / USDT / JUP / BONK'),
        amount: uint256Schema.describe('输入数量，按最小单位计（例如 1 SOL = 1000000000）'),
        slippageBps: z.number().int().min(0).max(5000).default(50).describe('滑点容差，单位 bps，默认 50 即 0.5%'),
      }),
      true,
      async ({ inputMint, outputMint, amount, slippageBps }) => {
        const input = mintOf(inputMint);
        const output = mintOf(outputMint);
        const mintPattern = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
        if (!mintPattern.test(input)) throw new Error(`无法识别的输入代币：${inputMint}；请用简写或 32–44 位 base58 mint 地址`);
        if (!mintPattern.test(output)) throw new Error(`无法识别的输出代币：${outputMint}；请用简写或 32–44 位 base58 mint 地址`);
        const url = new URL('https://lite-api.jup.ag/swap/v1/quote');
        url.searchParams.set('inputMint', input);
        url.searchParams.set('outputMint', output);
        url.searchParams.set('amount', amount);
        url.searchParams.set('slippageBps', String(slippageBps));
        const quote = jupiterQuoteSchema.parse(await requestJson(config, url.href, { headers: { Accept: 'application/json' } }));
        const inAmount = BigInt(quote.inAmount);
        const outAmount = BigInt(quote.outAmount);
        // 人类可读兑换比需要两个代币的精度；未知代币返回 null，不猜。
        const inDecimals = MINT_DECIMALS[quote.inputMint];
        const outDecimals = MINT_DECIMALS[quote.outputMint];
        const humanRate = inAmount > 0n && inDecimals !== undefined && outDecimals !== undefined
          ? (Number(outAmount) / 10 ** outDecimals) / (Number(inAmount) / 10 ** inDecimals)
          : null;
        const rawRatio = inAmount > 0n ? Number(outAmount * 10n ** 9n / inAmount) / 1e9 : null;
        return {
          provider: 'jupiter',
          access: 'public',
          inputMint: quote.inputMint,
          outputMint: quote.outputMint,
          inAmount: quote.inAmount,
          outAmount: quote.outAmount,
          minOutAmount: quote.otherAmountThreshold ?? null,
          humanRate,
          rawRatio,
          priceImpactPct: quote.priceImpactPct ?? null,
          slippageBps: quote.slippageBps ?? slippageBps,
          routeLabels: [...new Set((quote.routePlan ?? []).map((step) => step.swapInfo?.label).filter(Boolean))],
          note: '这是只读报价，不含交易构造与签名；实际成交以链上为准。',
          source: 'https://lite-api.jup.ag/swap/v1/quote',
        };
      },
    ),
  ];
}

import { z } from 'zod';
import type { Config } from '../config.js';
import { defineTool } from '../types.js';
import { addressSchema } from './common.js';
import { withProvider } from './evm.js';

// AggregatorV3Interface 的函数选择器
const LATEST_ROUND_DATA = '0xfeaf968c';
const DECIMALS = '0x313ce567';
const DESCRIPTION = '0x7284e416';

// 仅列出 Ethereum 主网（chainId 1）的常用 USD 喂价。其他链必须显式传 feed 地址。
const MAINNET_FEEDS: Record<string, string> = {
  'ETH/USD': '0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419',
  'BTC/USD': '0xF4030086522a5bEEa4988F8cA5B36dbC97BeE88c',
  'LINK/USD': '0x2c1d072e956AFFC0D435Cb7AC38EF18d24d9127c',
  'USDC/USD': '0x8fFfFfd4AfB6115b954Bd326cbe7B4BA576818f6',
  'USDT/USD': '0x3E7d1eAB13ad0104d2750B8863b489D65364e32D',
  'DAI/USD': '0xAed0c38402a5d19df6E4c03F4E2DceD6e29c1ee9',
  'UNI/USD': '0x553303d460EE0afB37EdFf9bE42922D8FF63220e',
  'AAVE/USD': '0x547a514d5e3769680Ce22B2361c10Ea13619e8a9',
};

const STALE_AFTER_SECONDS = 3600;

function word(data: string, index: number): string {
  const start = 2 + index * 64;
  const slice = data.slice(start, start + 64);
  if (slice.length !== 64) throw new Error('返回值长度不足，可能不是 AggregatorV3 喂价合约');
  return slice;
}

function toInt256(hex: string): bigint {
  const value = BigInt(`0x${hex}`);
  const limit = 1n << 255n;
  return value >= limit ? value - (1n << 256n) : value;
}

// ABI 编码的动态 string：offset -> length -> data
function decodeString(data: string): string {
  const offset = Number(BigInt(`0x${word(data, 0)}`));
  const lengthWordIndex = offset / 32;
  const length = Number(BigInt(`0x${word(data, lengthWordIndex)}`));
  if (length === 0) return '';
  const bytes = Buffer.from(data.slice(2), 'hex').subarray(offset + 32, offset + 32 + length);
  return bytes.toString('utf8');
}

function formatUnits(value: bigint, decimals: number): string {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  const fraction = (abs % base).toString().padStart(decimals, '0').replace(/0+$/, '');
  return `${negative ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''}`;
}

export function chainlinkTools(config: Config) {
  return [
    defineTool(
      'chainlink_price',
      '读取 Chainlink 价格喂价合约的最新报价（AggregatorV3 latestRoundData），返回价格、精度、更新时间与陈旧判定。只读，走已配置的 RPC。',
      z.strictObject({
        pair: z.string().min(3).describe(`交易对简写，仅 Ethereum 主网支持：${Object.keys(MAINNET_FEEDS).join('、')}；其他链请改用 feed`),
        feed: addressSchema.optional().describe('喂价合约地址；提供后忽略 pair，可用于任意 EVM 链'),
      }),
      true,
      async ({ pair, feed }) => {
        const isMainnet = config.chainId === 1n;
        const resolved = feed ?? (isMainnet ? MAINNET_FEEDS[pair.toUpperCase()] : undefined);
        if (!resolved) {
          throw new Error(
            isMainnet
              ? `未知交易对 ${pair}；当前支持 ${Object.keys(MAINNET_FEEDS).join('、')}，或直接传 feed 地址`
              : `链 ${config.chainId} 没有内置喂价表，请用 feed 参数直接传喂价合约地址`,
          );
        }
        return withProvider(config, async (provider) => {
          const [roundData, decimalsHex, descriptionHex] = await Promise.all([
            provider.call({ to: resolved, data: LATEST_ROUND_DATA }),
            provider.call({ to: resolved, data: DECIMALS }),
            provider.call({ to: resolved, data: DESCRIPTION }).catch(() => '0x'),
          ]);
          if (roundData === '0x') throw new Error(`地址 ${resolved} 没有返回喂价数据，可能不是 AggregatorV3 合约`);

          const roundId = BigInt(`0x${word(roundData, 0)}`);
          const answer = toInt256(word(roundData, 1));
          const updatedAt = Number(BigInt(`0x${word(roundData, 3)}`));
          const decimals = Number(BigInt(`0x${word(decimalsHex, 0)}`)) & 0xff;
          let description = '';
          try { description = decodeString(descriptionHex); } catch { /* 老合约可能没有 description */ }

          const now = Math.floor(Date.now() / 1000);
          const ageSeconds = updatedAt > 0 ? now - updatedAt : null;
          return {
            provider: 'chainlink',
            access: 'public',
            chainId: config.chainId?.toString() ?? null,
            pair: pair.toUpperCase(),
            feed: resolved,
            description: description || null,
            answer: answer.toString(),
            decimals,
            price: formatUnits(answer, decimals),
            roundId: roundId.toString(),
            updatedAt: updatedAt > 0 ? new Date(updatedAt * 1000).toISOString() : null,
            ageSeconds,
            stale: ageSeconds === null ? null : ageSeconds > STALE_AFTER_SECONDS,
            note: 'stale=true 表示超过 1 小时未更新；喂价按偏离阈值与心跳更新，不代表一定异常。',
          };
        });
      },
    ),
  ];
}

import { z } from 'zod';
import type { Config } from '../config.js';
import { defineTool } from '../types.js';
import { requestJson } from './http.js';

const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN_2022_PROGRAM = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';

const rpcEnvelope = z.looseObject({
  result: z.looseObject({
    value: z.array(z.looseObject({
      pubkey: z.string(),
      account: z.looseObject({
        data: z.looseObject({
          parsed: z.looseObject({
            info: z.looseObject({
              mint: z.string().optional(),
              owner: z.string().optional(),
              tokenAmount: z.looseObject({ amount: z.string(), decimals: z.number(), uiAmountString: z.string().optional() }).optional(),
            }).optional(),
          }).optional(),
        }).optional(),
      }),
    })).optional(),
  }).optional(),
  error: z.looseObject({ code: z.number(), message: z.string() }).optional(),
});

async function rpc(config: Config, url: string, method: string, params: unknown[]): Promise<unknown> {
  const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method, params });
  const envelope = rpcEnvelope.parse(
    await requestJson(config, url, { method: 'POST', headers: { 'content-type': 'application/json', Accept: 'application/json' }, body }),
  );
  if (envelope.error) throw new Error(`Solana RPC 返回错误（${envelope.error.code}）：${envelope.error.message}`);
  return envelope.result ?? null;
}

export function solanaTools2(config: Config) {
  const rpcUrl = process.env.BCA_SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
  return [
    defineTool(
      'solana_tokens',
      '列出某个 Solana 地址持有的 SPL 代币（mint、数量、精度），按数量排序并过滤零余额。只读，使用 BCA_SOLANA_RPC_URL 或公共 RPC。',
      z.strictObject({
        owner: z.string().min(32).max(44).describe('Solana 钱包地址（base58）'),
        mint: z.string().min(32).max(44).optional().describe('只看某个代币的持仓（推荐）；不传则列出全部非零持仓，大钱包响应可能很大'),
        limit: z.number().int().min(1).max(50).default(20).describe('最多返回多少个非零持仓，默认 20'),
        includeToken2022: z.boolean().default(true).describe('是否同时查询 Token-2022 程序下的持仓（指定 mint 时忽略）'),
      }),
      true,
      async ({ owner, mint, limit, includeToken2022 }) => {
        // 指定 mint 时只返回该代币账户，响应很小；否则按程序查询，可能遇到空投刷量的大钱包。
        const filters = mint ? [{ mint }] : includeToken2022 ? [TOKEN_PROGRAM, TOKEN_2022_PROGRAM].map((programId) => ({ programId })) : [{ programId: TOKEN_PROGRAM }];
        // 全量列表可能包含上万个小额账户，单独放宽读取上限，但仍是有界的 16MB。
        const callConfig = { ...config, maxReadBytes: Math.max(config.maxReadBytes, 16 * 1024 * 1024) };
        const collected: { mint: string; amount: string; decimals: number; uiAmount: string; program: string }[] = [];
        for (const filter of filters) {
          let result: { value?: unknown[] } | null;
          try {
            result = (await rpc(callConfig, rpcUrl, 'getTokenAccountsByOwner', [
              owner,
              filter,
              { encoding: 'jsonParsed' },
            ])) as { value?: unknown[] } | null;
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (/读取字节上限/.test(message)) {
              throw new Error('该地址的 SPL 账户过多，响应超出读取上限；请用 mint 参数指定单个代币再查询');
            }
            throw error;
          }
          const program = 'programId' in filter ? filter.programId : null;
          const accounts = (result?.value ?? []) as Array<{ pubkey: string; account: { data: { parsed?: { info?: { mint?: string; tokenAmount?: { amount: string; decimals: number; uiAmountString?: string } } } } } }>;
          for (const item of accounts) {
            const info = item.account?.data?.parsed?.info;
            const amount = info?.tokenAmount?.amount;
            if (!info?.mint || !amount || amount === '0') continue;
            collected.push({
              mint: info.mint,
              amount,
              decimals: info.tokenAmount!.decimals,
              uiAmount: info.tokenAmount!.uiAmountString ?? amount,
              program: program === TOKEN_PROGRAM ? 'spl-token' : program === TOKEN_2022_PROGRAM ? 'token-2022' : 'spl-token',
            });
          }
        }
        // 按数量降序（转成 number 仅用于排序，展示仍用原始字符串）
        collected.sort((a, b) => Number(b.amount) - Number(a.amount));
        return {
          provider: 'solana-rpc',
          access: 'public',
          owner,
          rpc: rpcUrl,
          totalNonZeroAccounts: collected.length,
          returned: Math.min(collected.length, limit),
          tokens: collected.slice(0, limit),
          note: '只统计 SPL 代币账户；原生 SOL 余额请用 solana_balance。',
        };
      },
    ),
  ];
}

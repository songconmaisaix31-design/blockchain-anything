import { z } from 'zod';
import { createRequire } from 'node:module';
import type { Config } from '../config.js';
import { defineTool } from '../types.js';
import { addressSchema, bytesSchema, uint256Schema } from '../providers/common.js';
import { endpointEnv } from '../providers/http.js';

async function safeClient(config: Config, safeAddress: string) {
  const { createPublicClient, http } = await import('viem');
  const provider = endpointEnv('BCA_RPC_URL');
  const chainId = await createPublicClient({ transport: http(provider, { timeout: config.timeoutMs, retryCount: 0 }) }).getChainId();
  if (!config.chainId || BigInt(chainId) !== config.chainId) throw new Error('Safe RPC 与 BCA_CHAIN_ID 不匹配');
  const { default: Safe } = createRequire(import.meta.url)('@safe-global/protocol-kit') as typeof import('@safe-global/protocol-kit');
  return Safe.init({ provider, safeAddress });
}

export function walletTools(config: Config) {
  return [
    defineTool('safe_info', '官方 Safe Protocol Kit 查询钱包所有者、阈值和 nonce。', z.strictObject({ address: addressSchema }), true,
      async ({ address }) => {
        const safe = await safeClient(config, address);
        return { address, owners: await safe.getOwners(), threshold: await safe.getThreshold(), nonce: await safe.getNonce(), chainId: config.chainId };
      }),
    defineTool('safe_prepare', '官方 Safe SDK 构建待签名交易并计算 Safe transaction hash；不签署、不发送。', z.strictObject({ address: addressSchema, transactions: z.array(z.strictObject({ to: addressSchema, value: uint256Schema.default('0'), data: bytesSchema.default('0x') })).min(1).max(32), nonce: z.number().int().nonnegative().optional() }), true,
      async ({ address, transactions, nonce }) => {
        const safe = await safeClient(config, address);
        const transaction = await safe.createTransaction({ transactions, onlyCalls: true, options: nonce === undefined ? undefined : { nonce } });
        return { address, chainId: config.chainId, data: transaction.data, safeTxHash: await safe.getTransactionHash(transaction), signed: false, submitted: false };
      }),
    defineTool('x402_decode', '使用官方 x402 SDK 解码 PAYMENT-REQUIRED、PAYMENT-SIGNATURE 或 PAYMENT-RESPONSE；解码不代表已付款。', z.strictObject({ kind: z.enum(['required', 'signature', 'response']), header: z.string().min(1).max(65536) }), true,
      async ({ kind, header }) => {
        const sdk = await import('@x402/core/http');
        const decode = { required: sdk.decodePaymentRequiredHeader, signature: sdk.decodePaymentSignatureHeader, response: sdk.decodePaymentResponseHeader }[kind];
        return { kind, value: decode(header), verified: false };
      }),
    defineTool('x402_supported', '官方 x402 facilitator client 查询支持的网络与支付方案。', z.strictObject({}), true,
      async () => {
        const { HTTPFacilitatorClient } = await import('@x402/core/server');
        return new HTTPFacilitatorClient({ url: endpointEnv('BCA_X402_FACILITATOR'), timeoutMs: config.timeoutMs }).getSupported();
      }),
    defineTool('x402_verify', '官方 x402 facilitator 校验支付授权；不结算、不转账。', z.strictObject({ payload: z.record(z.string(), z.json()), requirements: z.record(z.string(), z.json()) }), true,
      async ({ payload, requirements }) => {
        const { HTTPFacilitatorClient } = await import('@x402/core/server');
        const { PaymentPayloadV2Schema, PaymentRequirementsV2Schema } = await import('@x402/core/schemas');
        const client = new HTTPFacilitatorClient({ url: endpointEnv('BCA_X402_FACILITATOR'), timeoutMs: config.timeoutMs });
        // SDK schema validates CAIP network syntax but exposes it as string.
        return client.verify(PaymentPayloadV2Schema.parse(payload) as Parameters<typeof client.verify>[0], PaymentRequirementsV2Schema.parse(requirements) as Parameters<typeof client.verify>[1]);
      }),
  ];
}

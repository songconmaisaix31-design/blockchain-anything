import { z } from 'zod';
import { defineTool } from '../types.js';
import { addressSchema, submitSchema } from '../providers/common.js';
import type { WalletConfig } from './config.js';
import { requestJson } from './http.js';

const networkSchema = z.string().regex(/^eip155:[1-9][0-9]*$/, '必须为 eip155:<chainId> CAIP-2 网络');
const amountSchema = z.string().regex(/^(0|[1-9][0-9]*)$/, '必须为原子单位的十进制字符串');

const requirementsSchema = z.strictObject({
  scheme: z.literal('exact'),
  network: networkSchema,
  asset: addressSchema,
  amount: amountSchema,
  payTo: addressSchema,
  maxTimeoutSeconds: z.number().int().positive(),
  extra: z.record(z.string(), z.unknown()),
});

const payloadSchema = z.strictObject({
  x402Version: z.literal(2),
  resource: z.record(z.string(), z.unknown()).optional(),
  accepted: requirementsSchema,
  payload: z.record(z.string(), z.unknown()),
  extensions: z.record(z.string(), z.unknown()).optional(),
});

export function x402Tools(config: WalletConfig) {
  return [
    defineTool(
      'wallet_x402_supported',
      '读取配置的 x402 facilitator 的 /supported 能力清单；不支付、不结算。',
      z.strictObject({}),
      true,
      async () => {
        const body = await requestJson<Record<string, unknown>>(
          `${config.x402FacilitatorUrl}/supported`,
          { method: 'GET' },
          config,
          'x402 facilitator /supported',
        );
        return { facilitator: config.x402FacilitatorUrl, ...body };
      },
    ),
    defineTool(
      'wallet_x402_create_payment',
      '按 x402 exact scheme 生成并本地签名 EIP-3009 支付载荷；只签名，不提交、不结算、不转移资产。',
      z.strictObject({
        network: networkSchema.default('eip155:84532'),
        amount: amountSchema,
        payTo: addressSchema,
        resourceUrl: z.string().url(),
        description: z.string().optional(),
        asset: addressSchema.optional(),
        assetName: z.string().min(1).optional(),
        assetVersion: z.string().min(1).optional(),
        maxTimeoutSeconds: z.number().int().positive().max(3600).default(60),
        submit: submitSchema,
      }),
      false,
      async ({ network, amount, payTo, resourceUrl, description, asset, assetName, assetVersion, maxTimeoutSeconds }) => {
        if (!config.x402PrivateKey) throw new Error('x402 支付签名需要 BCA_X402_PRIVATE_KEY 或 BCA_PRIVATE_KEY');
        const { x402Client, x402HTTPClient } = await import('@x402/core/client');
        const { registerExactEvmScheme } = await import('@x402/evm/exact/client');
        const { getDefaultAsset } = await import('@x402/evm');
        const { privateKeyToAccount } = await import('viem/accounts');
        const account = privateKeyToAccount(config.x402PrivateKey as `0x${string}`);
        let selectedAsset = asset;
        let selectedName = assetName;
        let selectedVersion = assetVersion;
        const caip2Network = network as `${string}:${string}`;
        if (!selectedAsset) {
          const fallback = getDefaultAsset(caip2Network);
          selectedAsset = fallback.asset;
          selectedName = fallback.name;
          selectedVersion = fallback.version;
        }
        if (!selectedName || !selectedVersion) {
          throw new Error('提供 asset 时必须同时提供 assetName 和 assetVersion（EIP-712 域）');
        }
        const accepted = {
          scheme: 'exact' as const,
          network: caip2Network,
          asset: selectedAsset,
          amount,
          payTo,
          maxTimeoutSeconds,
          extra: { name: selectedName, version: selectedVersion },
        };
        const paymentRequired = {
          x402Version: 2,
          resource: { url: resourceUrl, ...(description ? { description } : {}) },
          accepts: [accepted],
        };
        const client = new x402Client();
        registerExactEvmScheme(client, { signer: account });
        const httpClient = new x402HTTPClient(client);
        const paymentPayload = await httpClient.createPaymentPayload(
          paymentRequired as unknown as Parameters<typeof httpClient.createPaymentPayload>[0],
        );
        return {
          protocol: 'x402',
          x402Version: 2,
          signer: account.address,
          paymentRequirements: accepted,
          paymentPayload,
          headers: httpClient.encodePaymentSignatureHeader(paymentPayload),
          settled: false,
          note: '仅生成支付授权签名；未向 facilitator 提交或结算',
        };
      },
    ),
    defineTool(
      'wallet_x402_verify',
      '调用 x402 facilitator 的 /verify 验证支付载荷；不调用 /settle，不转移资产。',
      z.strictObject({
        paymentPayload: payloadSchema,
        paymentRequirements: requirementsSchema,
      }),
      true,
      async ({ paymentPayload, paymentRequirements }) => {
        const result = await requestJson<Record<string, unknown>>(
          `${config.x402FacilitatorUrl}/verify`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ x402Version: 2, paymentPayload, paymentRequirements }),
          },
          config,
          'x402 facilitator /verify',
        );
        return { facilitator: config.x402FacilitatorUrl, ...result };
      },
    ),
  ];
}

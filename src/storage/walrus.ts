import { SuiGrpcClient } from '@mysten/sui/grpc';
import { walrus, WalrusClient } from '@mysten/walrus';
import { z } from 'zod';
import { defineTool } from '../types.js';
import { httpUrl, maxReadBytes, oneOf, timeoutMs } from '../chains/env.js';

type SuiNetwork = 'mainnet' | 'testnet' | 'devnet' | 'localnet';
const networks = ['mainnet', 'testnet', 'devnet', 'localnet'] as const;

type WalrusSuiClient = SuiGrpcClient & { walrus: WalrusClient };

let cached: { key: string; client: WalrusSuiClient } | undefined;

function walrusClient(): WalrusSuiClient {
  const network = oneOf<SuiNetwork>('BCA_SUI_NETWORK', networks);
  const baseUrl = httpUrl('BCA_SUI_RPC_URL', true);
  const key = `${network}|${baseUrl}`;
  if (cached?.key === key) return cached.client;
  const base = new SuiGrpcClient({ network, baseUrl });
  const client = base.$extend(walrus({
    storageNodeClientOptions: { timeout: timeoutMs() },
  })) as unknown as WalrusSuiClient;
  cached = { key, client };
  return client;
}

const blobId = z.string().min(1).describe('Walrus blob ID（base64url）');

function metadataSummary(value: Awaited<ReturnType<WalrusClient['getBlobMetadata']>>) {
  const v1 = (value.metadata as { V1?: Record<string, unknown> }).V1;
  if (!v1) throw new Error('Walrus 元数据缺少 V1 字段');
  const encoding = v1.encoding_type as Record<string, unknown> | undefined;
  const hashes = v1.hashes as Record<string, unknown> | undefined;
  const primary = hashes?.primary_hash as Record<string, unknown> | undefined;
  const secondary = hashes?.secondary_hash as Record<string, unknown> | undefined;
  return {
    encodingType: encoding ? Object.keys(encoding)[0] ?? null : null,
    unencodedLength: String(v1.unencoded_length),
    primaryHash: primary?.Digest ? Buffer.from(primary.Digest as Uint8Array).toString('base64') : null,
    secondaryHash: secondary?.Digest ? Buffer.from(secondary.Digest as Uint8Array).toString('base64') : null,
  };
}

/** Walrus 官方 TypeScript SDK 只读工具。写入需要 WAL/SUI 费用，本适配不执行。 */
export function walrusTools() {
  return [
    defineTool('walrus_status', '通过官方 Walrus SDK 读取 Sui 链标识和当前存储费用；不执行写入。', z.strictObject({}), true,
      async () => {
        const client = walrusClient();
        const identifier = await client.getChainIdentifier();
        const cost = await client.walrus.storageCost(1024 * 1024, 1);
        return {
          network: process.env.BCA_SUI_NETWORK,
          connectionVerified: true,
          chainIdentifier: (identifier as { chainIdentifier?: string }).chainIdentifier ?? identifier,
          storageCostFor1MiB1Epoch: {
            storageCost: cost.storageCost.toString(),
            writeCost: cost.writeCost.toString(),
            totalCost: cost.totalCost.toString(),
          },
        };
      }),

    defineTool('walrus_blob_metadata', '通过官方 Walrus SDK 从存储节点读取 blob 元数据；不下载完整内容。',
      z.strictObject({ blobId }), true,
      async ({ blobId: id }) => {
        const metadata = await walrusClient().walrus.getBlobMetadata({ blobId: id });
        return { blobId: metadata.blobId, metadata: metadataSummary(metadata) };
      }),

    defineTool('walrus_blob_read', '通过官方 Walrus SDK 读取 blob 内容，返回 base64；先按元数据长度检查上限，不返回截断内容。',
      z.strictObject({ blobId, maxBytes: z.number().int().positive().optional() }), true,
      async ({ blobId: id, maxBytes }) => {
        const client = walrusClient();
        const limit = Math.min(maxBytes ?? maxReadBytes(), maxReadBytes());
        const metadata = await client.walrus.getBlobMetadata({ blobId: id });
        const summary = metadataSummary(metadata);
        const declared = Number(summary.unencodedLength);
        if (!Number.isSafeInteger(declared) || declared < 0) throw new Error('Walrus unencoded_length 无效');
        if (declared > limit) throw new Error('Walrus blob 超过读取字节上限');
        const bytes = await client.walrus.readBlob({ blobId: id });
        if (bytes.byteLength !== declared) throw new Error('Walrus 读取长度与元数据不一致');
        return {
          blobId: id,
          bytes: bytes.byteLength,
          encoding: 'base64',
          data: Buffer.from(bytes).toString('base64'),
          metadata: summary,
        };
      }),

    defineTool('walrus_blob_object', '通过官方 Walrus SDK 读取链上 Blob 对象；参数为 Sui 对象 ID。',
      z.strictObject({ blobObjectId: z.string().regex(/^0x[0-9a-fA-F]{1,64}$/, '必须为 Sui 对象 ID') }), true,
      async ({ blobObjectId }) => ({
        blobObjectId,
        object: await walrusClient().walrus.getBlobObject(blobObjectId),
      })),
  ];
}

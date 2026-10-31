import { z } from 'zod';
import type { Config } from '../config.js';
import { defineTool } from '../types.js';
import { addressSchema, uint256Schema } from './common.js';
import { withProvider } from './evm.js';
import { requestJson } from './http.js';

// ERC-721 函数选择器
const BALANCE_OF = '0x70a08231';
const OWNER_OF = '0x6352211e';
const TOKEN_URI = '0xc87b56dd';

function padAddress(address: string): string {
  return address.toLowerCase().replace(/^0x/, '').padStart(64, '0');
}

function padUint(value: string): string {
  const big = BigInt(value);
  return big.toString(16).padStart(64, '0');
}

// ABI 动态 string：offset -> length -> data
function decodeString(data: string): string {
  if (data === '0x' || data.length < 130) throw new Error('合约没有返回字符串数据');
  const offset = Number(BigInt(`0x${data.slice(2, 66)}`));
  const length = Number(BigInt(`0x${data.slice(2 + offset * 2, 2 + offset * 2 + 64)}`));
  if (length === 0) return '';
  const start = 2 + offset * 2 + 64;
  return Buffer.from(data.slice(start, start + length * 2), 'hex').toString('utf8');
}

// 只允许把 ipfs:// 与 ar:// 换成公共网关，避免任意 URL 被当成内网探测入口。
// 公共 IPFS 网关经常对共享出口 IP 限流（429），所以给出候选列表，逐个尝试。
function ipfsCandidates(cid: string): string[] {
  const custom = process.env.BCA_IPFS_GATEWAY?.replace(/\/+$/, '');
  const gateways = [
    ...(custom ? [custom] : []),
    'https://ipfs.io/ipfs',
    'https://dweb.link/ipfs',
    'https://gateway.pinata.cloud/ipfs',
  ];
  return gateways.map((gateway) => `${gateway}/${cid}`);
}

function resolveUri(uri: string): { primary: string; candidates: string[] } | null {
  if (uri.startsWith('ipfs://')) {
    const cid = uri.slice('ipfs://'.length).replace(/^ipfs\//, '');
    const candidates = ipfsCandidates(cid);
    return { primary: candidates[0]!, candidates };
  }
  if (uri.startsWith('ar://')) {
    const url = `https://arweave.net/${uri.slice('ar://'.length)}`;
    return { primary: url, candidates: [url] };
  }
  if (/^https?:\/\//.test(uri)) return { primary: uri, candidates: [uri] };
  return null;
}

export function nftTools(config: Config) {
  return [
    defineTool(
      'nft_balance',
      '查询某地址在某个 ERC-721 合约下持有的数量（balanceOf）。只读，走已配置 RPC；不返回具体 tokenId 列表。',
      z.strictObject({
        collection: addressSchema.describe('ERC-721 合约地址'),
        owner: addressSchema.describe('持有者地址'),
      }),
      true,
      async ({ collection, owner }) => withProvider(config, async (provider) => {
        const raw = await provider.call({ to: collection, data: `${BALANCE_OF}${padAddress(owner)}` });
        if (raw === '0x') throw new Error(`${collection} 没有返回 balanceOf，可能不是 ERC-721 合约`);
        const balance = BigInt(raw);
        return {
          provider: 'rpc/erc721',
          access: 'public',
          chainId: config.chainId?.toString() ?? null,
          collection,
          owner,
          balance: balance.toString(),
          note: balance === 0n ? '余额为 0；也可能合约不支持 ERC-721 的 balanceOf 签名' : null,
        };
      })),
    defineTool(
      'nft_owner',
      '查询某个 ERC-721 tokenId 当前的所有者（ownerOf）。只读，走已配置 RPC。',
      z.strictObject({
        collection: addressSchema.describe('ERC-721 合约地址'),
        tokenId: uint256Schema.describe('tokenId，十进制字符串'),
      }),
      true,
      async ({ collection, tokenId }) => withProvider(config, async (provider) => {
        const raw = await provider.call({ to: collection, data: `${OWNER_OF}${padUint(tokenId)}` });
        if (raw === '0x') throw new Error(`tokenId ${tokenId} 不存在或合约未实现 ownerOf；已销毁的 token 也会返回空`);
        return {
          provider: 'rpc/erc721',
          access: 'public',
          chainId: config.chainId?.toString() ?? null,
          collection,
          tokenId,
          owner: `0x${raw.slice(-40)}`.toLowerCase(),
        };
      })),
    defineTool(
      'nft_metadata',
      '读取 ERC-721 的 tokenURI 并解析元数据 JSON（name、description、image）。只读；ipfs:// 与 ar:// 会换成公共网关。',
      z.strictObject({
        collection: addressSchema.describe('ERC-721 合约地址'),
        tokenId: uint256Schema.describe('tokenId，十进制字符串'),
        resolve: z.boolean().default(true).describe('是否继续抓取 tokenURI 指向的 JSON；设为 false 只返回 URI'),
      }),
      true,
      async ({ collection, tokenId, resolve }) => withProvider(config, async (provider) => {
        const raw = await provider.call({ to: collection, data: `${TOKEN_URI}${padUint(tokenId)}` });
        if (raw === '0x') throw new Error(`tokenId ${tokenId} 没有 tokenURI，合约可能不是 ERC-721 或不支持元数据扩展`);
        const tokenUri = decodeString(raw);
        const target = resolveUri(tokenUri);
        const base = {
          provider: 'rpc/erc721',
          access: 'public',
          chainId: config.chainId?.toString() ?? null,
          collection,
          tokenId,
          tokenUri,
          gatewayUrl: target?.primary ?? null,
        };
        if (!resolve || !target) return { ...base, metadata: null, note: target ? null : 'tokenURI 既不是 http(s) 也不是 ipfs/ar，未自动抓取' };

        // 逐个网关尝试：公共 IPFS 网关对共享出口 IP 限流很常见。
        let body: unknown = null;
        let usedGateway: string | null = null;
        const failures: string[] = [];
        for (const candidate of target.candidates) {
          try {
            body = await requestJson(config, candidate, { headers: { Accept: 'application/json' } });
            usedGateway = candidate;
            break;
          } catch (error) {
            failures.push(`${new URL(candidate).host}：${error instanceof Error ? error.message : String(error)}`);
          }
        }
        if (body === null) {
          return {
            ...base,
            metadata: null,
            gatewayFailures: failures,
            note: '所有候选网关都没有取到元数据；URI 本身有效，可以稍后重试或设置 BCA_IPFS_GATEWAY 指定自建网关。',
          };
        }

        const meta = z.looseObject({
          name: z.string().optional(),
          description: z.string().optional(),
          image: z.string().optional(),
          attributes: z.array(z.looseObject({ trait_type: z.string().optional(), value: z.unknown() })).optional(),
        }).parse(body);
        const image = meta.image ? resolveUri(meta.image)?.primary ?? meta.image : null;
        return {
          ...base,
          gatewayUrl: usedGateway,
          metadata: {
            name: meta.name ?? null,
            description: meta.description ? meta.description.slice(0, 300) : null,
            image,
            attributeCount: meta.attributes?.length ?? 0,
          },
          note: '元数据由合约指定地址返回，内容不受本工具校验。',
        };
      })),
  ];
}

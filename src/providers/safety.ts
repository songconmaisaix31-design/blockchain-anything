import { getAddress, id as topicId, Interface } from 'ethers';
import { z } from 'zod';
import type { Config } from '../config.js';
import { defineTool } from '../types.js';
import { addressSchema, uint256Schema } from './common.js';
import { withProvider } from './evm.js';
import { requestJson } from './http.js';

const ERC20 = new Interface([
  'function allowance(address owner, address spender) view returns (uint256)',
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'function name() view returns (string)',
  'function totalSupply() view returns (uint256)',
  'function owner() view returns (address)',
  'function paused() view returns (bool)',
  'function isApprovedForAll(address owner, address operator) view returns (bool)',
  'function getApproved(uint256 tokenId) view returns (address)',
]);
const ALLOWANCE_SELECTOR = '0xdd62ed3e';
const OWNER_SELECTOR = '0x8da5cb5b';
const PAUSED_SELECTOR = '0x5c975abb';
const APPROVAL_TOPIC = topicId('Approval(address,address,uint256)');
const UNLIMITED_THRESHOLD = 2n ** 255n;

// ERC-1967 / ERC-1822 的标准存储槽
const SLOT_IMPLEMENTATION = '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc';
const SLOT_ADMIN = '0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103';
const SLOT_BEACON = '0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50';
const SLOT_PROXIABLE = '0x7050c9e0f4ca769c69bd3a8ef740bc37934f8e2c036e5a723fd8ee048ed3f8c3';

// 主网常见 ERC-20：仅用于"没指定代币"时的默认扫描范围，不表示只存在这些风险。
const MAINNET_TOKENS: Record<string, string> = {
  USDC: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  USDT: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
  DAI: '0x6B175474E89094C44Da98b954EedeAC495271d0F',
  WETH: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
  WBTC: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599',
  LINK: '0x514910771AF9Ca656af840dff83E8264EcF986CA',
  UNI: '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984',
  AAVE: '0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9',
};

// 常被滥用/钓鱼的授权对象清单（去重后按地址轮询），标签仅作提示，不代表该合约有恶意。
const KNOWN_SPENDERS: Array<{ address: string; label: string }> = [
  { address: '0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD', label: 'Uniswap Universal Router' },
  { address: '0xE592427A0AEce92De3Edee1F18E0157C05861564', label: 'Uniswap V3 SwapRouter' },
  { address: '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D', label: 'Uniswap V2 Router' },
  { address: '0x000000000022D473030F116dDEE9F6B43aC78BA3', label: 'Uniswap Permit2' },
  { address: '0x1111111254EEB25477B68fb85Ed929f73A960582', label: '1inch Aggregation Router v5' },
  { address: '0x111111125421cA6dc452d289314280a0f8842A65', label: '1inch Aggregation Router v6' },
  { address: '0xDef1C0ded9bec7F1a1670819833240f027b25EfF', label: '0x Exchange Proxy' },
  { address: '0x00000000000000ADc04C56Bf30aC9d3c0aAF14dC', label: 'Seaport 1.5' },
  { address: '0x0000000000000068F116a894984e2DB1123eB395', label: 'Seaport 1.6' },
  { address: '0x000000000000Ad05Ccc4F10045630fb830B95127', label: 'Blur Marketplace' },
  { address: '0x0000000000E655fAe4d56241588680F86E3b2377', label: 'LooksRare v2 Aggregator' },
  { address: '0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F', label: 'SushiSwap Router' },
  { address: '0xBA12222222228d8Ba445958a75a0704d566BF2C8', label: 'Balancer V2 Vault' },
  { address: '0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2', label: 'Aave V3 Pool' },
  { address: '0x3ee18B2214AFF97000D974cf647E7C347E8fa585', label: 'Wormhole Token Bridge' },
  { address: '0x881D40237659C251811CEC9c364ef91dC08D300C', label: 'Metamask Swap Router' },
];

const KNOWN_NFT_OPERATORS: Array<{ address: string; label: string }> = [
  { address: '0x00000000000000ADc04C56Bf30aC9d3c0aAF14dC', label: 'Seaport 1.5' },
  { address: '0x0000000000000068F116a894984e2DB1123eB395', label: 'Seaport 1.6' },
  { address: '0x000000000000Ad05Ccc4F10045630fb830B95127', label: 'Blur Marketplace' },
  { address: '0x0000000000E655fAe4d56241588680F86E3b2377', label: 'LooksRare v2 Aggregator' },
  { address: '0x1E0049783F008A0085193E00003D00cd54003c71', label: 'OpenSea Conduit Controller' },
];

function padAddress(address: string): string {
  return address.toLowerCase().replace(/^0x/, '').padStart(64, '0');
}

function hexQuantity(value: number | bigint): string {
  return `0x${BigInt(value).toString(16)}`;
}

async function callOrNull(call: (data: string) => Promise<string>, data: string): Promise<string | null> {
  try {
    const raw = await call(data);
    return raw && raw !== '0x' ? raw : null;
  } catch {
    return null;
  }
}

function spenderLabel(spender: string): string | null {
  return KNOWN_SPENDERS.find((item) => item.address.toLowerCase() === spender.toLowerCase())?.label ?? null;
}

// 公共 RPC 对 eth_getLogs 的区块跨度限制差别很大（有的 1 万，有的不限），
// 因此先用大窗口，失败就收缩重试，实在不行才放弃这一段并给出原因。
async function scanApprovalLogs(
  provider: { send: (method: string, params: unknown[]) => Promise<any> },
  token: string,
  ownerTopic: string,
  fromBlock: number,
  toBlock: number,
): Promise<{ logs: any[]; warnings: string[] }> {
  const logs: any[] = [];
  const warnings: string[] = [];
  let start = fromBlock;
  let chunk = 200_000;
  while (start <= toBlock) {
    const end = Math.min(start + chunk - 1, toBlock);
    try {
      const batch = await provider.send('eth_getLogs', [{ address: token, topics: [APPROVAL_TOPIC, ownerTopic], fromBlock: hexQuantity(start), toBlock: hexQuantity(end) }]) as any[];
      logs.push(...batch);
      start = end + 1;
    } catch (error) {
      if (chunk <= 2000) {
        warnings.push(`${token} 区块 ${start}-${end} 未取到：${error instanceof Error ? error.message : String(error)}`);
        break;
      }
      chunk = Math.max(2000, Math.floor(chunk / 4));
    }
  }
  return { logs, warnings };
}

// ---------------------------------------------------------------- 工具实现

export function safetyTools(config: Config) {
  return [
    defineTool(
      'allowance_check',
      '查询某个 ERC-20 的授权额度（allowance）：owner 授权给 spender 还能动多少。只读；用于确认一次授权是否仍然有效、是否为无限授权。',
      z.strictObject({
        token: addressSchema.describe('ERC-20 合约地址'),
        owner: addressSchema.describe('资产持有者地址'),
        spender: addressSchema.describe('被授权方地址（合约或 EOA）'),
      }),
      true,
      async ({ token, owner, spender }) => withProvider(config, async (provider) => {
        const data = `${ALLOWANCE_SELECTOR}${padAddress(owner)}${padAddress(spender)}`;
        const raw = await provider.call({ to: token, data });
        if (raw === '0x') throw new Error(`${token} 没有返回 allowance，可能不是 ERC-20 合约`);
        const allowance = BigInt(raw);
        const decimals = await callOrNull((d) => provider.call({ to: token, data: d }), ERC20.encodeFunctionData('decimals'))
          .then((value) => (value ? Number(ERC20.decodeFunctionResult('decimals', value)[0]) : null));
        const symbol = await callOrNull((d) => provider.call({ to: token, data: d }), ERC20.encodeFunctionData('symbol'))
          .then((value) => (value ? ERC20.decodeFunctionResult('symbol', value)[0] as string : null));
        return {
          provider: 'rpc/erc20',
          access: 'public',
          chainId: config.chainId?.toString() ?? null,
          token,
          symbol,
          decimals,
          owner,
          spender,
          spenderLabel: spenderLabel(spender),
          allowance: allowance.toString(),
          unlimited: allowance >= UNLIMITED_THRESHOLD,
          active: allowance > 0n,
          note: allowance === 0n
            ? '额度为 0：该授权已用完或已被撤销。'
            : allowance >= UNLIMITED_THRESHOLD
              ? '这是无限授权（额度接近 uint256 上限）：被授权方可随时转走该代币的全部余额，建议按实际用量重设或撤销。'
              : '有限额度：被授权方最多只能动用该数量。',
        };
      }),
    ),

    defineTool(
      'approval_scan',
      '扫描一个地址对外授予的 ERC-20 授权：先从 Approval 事件找出授权对象，再逐个读回当前 allowance，标出无限授权。有 BCA_ETHERSCAN_API_KEY 时走全历史日志；否则按最近区块窗口扫描，并明确说明覆盖范围。',
      z.strictObject({
        owner: addressSchema.describe('要体检的地址'),
        tokens: z.array(addressSchema).max(20).optional().describe('要扫描的 ERC-20 合约地址；缺省为主网常见代币表'),
        spenders: z.array(addressSchema).max(50).optional().describe('直接轮询这些被授权方的当前额度，跳过日志扫描'),
        windowBlocks: z.number().int().min(1000).max(5_000_000).default(500_000).describe('无 Etherscan key 时向前扫描的区块窗口'),
        includeZero: z.boolean().default(false).describe('是否把额度已归零的历史授权也列出来'),
      }),
      true,
      async ({ owner, tokens, spenders, windowBlocks, includeZero }) => withProvider(config, async (provider) => {
        const chainId = config.chainId;
        const tokenList = tokens ?? (chainId === 1n ? Object.values(MAINNET_TOKENS) : undefined);
        if (!tokenList?.length) throw new Error('非主网没有内置代币表，请用 tokens 显式传入要扫描的 ERC-20 地址');
        const holder = getAddress(owner);
        const ownerTopic = `0x${padAddress(holder)}`;
        const warnings: string[] = [];
        const pairs = new Map<string, { token: string; spender: string; block: number | null }>();

        if (spenders?.length) {
          for (const token of tokenList) for (const spender of spenders) {
            pairs.set(`${token.toLowerCase()}:${spender.toLowerCase()}`, { token, spender, block: null });
          }
        } else if (config.etherscanApiKey) {
          for (const token of tokenList) {
            const url = new URL('https://api.etherscan.io/v2/api');
            url.searchParams.set('chainid', chainId?.toString() ?? '1');
            url.searchParams.set('module', 'logs');
            url.searchParams.set('action', 'getLogs');
            url.searchParams.set('fromBlock', '0');
            url.searchParams.set('toBlock', 'latest');
            url.searchParams.set('address', token);
            url.searchParams.set('topic0', APPROVAL_TOPIC);
            url.searchParams.set('topic1', ownerTopic);
            url.searchParams.set('topic0_1_opr', 'and');
            url.searchParams.set('page', '1');
            url.searchParams.set('offset', '1000');
            url.searchParams.set('apikey', config.etherscanApiKey);
            try {
              const body = z.looseObject({ status: z.string(), message: z.string(), result: z.unknown() }).parse(await requestJson(config, url.href, { headers: { Accept: 'application/json' } }));
              const rows = Array.isArray(body.result) ? body.result as any[] : [];
              for (const row of rows) {
                const spender = getAddress(`0x${String(row.topics?.[2] ?? '').slice(26)}`);
                if (!spender) continue;
                pairs.set(`${token.toLowerCase()}:${spender.toLowerCase()}`, { token, spender, block: Number(BigInt(row.blockNumber ?? 0)) });
              }
            } catch (error) {
              warnings.push(`${token} 日志查询失败：${error instanceof Error ? error.message : String(error)}`);
            }
          }
        } else {
          const latest = await provider.getBlockNumber();
          const from = Math.max(0, latest - windowBlocks);
          for (const token of tokenList) {
            const scan = await scanApprovalLogs(provider, token, ownerTopic, from, latest);
            warnings.push(...scan.warnings);
            for (const log of scan.logs) {
              const spender = getAddress(`0x${String(log.topics[2]).slice(26)}`);
              const key = `${token.toLowerCase()}:${spender.toLowerCase()}`;
              const existing = pairs.get(key);
              const block = Number(BigInt(log.blockNumber));
              if (!existing || (block > (existing.block ?? 0))) pairs.set(key, { token, spender, block });
            }
          }
          warnings.push(`未配置 BCA_ETHERSCAN_API_KEY，只扫描最近 ${windowBlocks} 个区块；更早的授权不会出现在结果里。`);
        }

        const results = [];
        for (const { token, spender, block } of pairs.values()) {
          const raw = await callOrNull((data) => provider.call({ to: token, data }), `${ALLOWANCE_SELECTOR}${padAddress(holder)}${padAddress(spender)}`);
          if (!raw) continue;
          const allowance = BigInt(raw);
          if (!includeZero && allowance === 0n) continue;
          const symbol = await callOrNull((data) => provider.call({ to: token, data }), ERC20.encodeFunctionData('symbol'))
            .then((value) => (value ? ERC20.decodeFunctionResult('symbol', value)[0] as string : null));
          results.push({
            token,
            symbol,
            spender,
            spenderLabel: spenderLabel(spender),
            allowance: allowance.toString(),
            unlimited: allowance >= UNLIMITED_THRESHOLD,
            grantedAtBlock: block,
          });
        }
        results.sort((a, b) => Number(b.unlimited) - Number(a.unlimited));

        return {
          provider: config.etherscanApiKey ? 'etherscan-logs+rpc' : 'rpc-logs',
          access: config.etherscanApiKey ? 'api-key' : 'public',
          chainId: chainId?.toString() ?? null,
          owner: holder,
          strategy: spenders?.length ? 'explicit-spenders' : config.etherscanApiKey ? 'etherscan-logs' : 'rpc-logs-window',
          scannedTokens: tokenList.length,
          scannedFromBlock: spenders?.length || config.etherscanApiKey ? null : Math.max(0, (await provider.getBlockNumber()) - windowBlocks),
          approvals: results,
          approvalCount: results.length,
          unlimitedCount: results.filter((item) => item.unlimited).length,
          warnings,
          note: '额度以链上当前 allowance 为准；日志只用来发现授权对象，不用来推断额度。未列出的代币与更早的授权不在覆盖范围内。',
        };
      }),
    ),

    defineTool(
      'nft_approval_check',
      '检查某个 ERC-721 集合上的授权：对常见市场合约的 setApprovalForAll（可转走整个集合）以及指定 tokenId 的单枚授权 getApproved。只读。',
      z.strictObject({
        collection: addressSchema.describe('ERC-721 合约地址'),
        owner: addressSchema.describe('持有者地址'),
        tokenId: uint256Schema.optional().describe('要检查单枚授权的 tokenId'),
        operators: z.array(addressSchema).max(20).optional().describe('额外要检查的 operator 地址'),
      }),
      true,
      async ({ collection, owner, tokenId, operators }) => withProvider(config, async (provider) => {
        const holder = getAddress(owner);
        const targets = [...KNOWN_NFT_OPERATORS, ...(operators ?? []).map((address) => ({ address: getAddress(address.toLowerCase()), label: null }))];
        const approvals = [];
        for (const target of targets) {
          const operator = getAddress(target.address.toLowerCase());
          const raw = await callOrNull((data) => provider.call({ to: collection, data }), ERC20.encodeFunctionData('isApprovedForAll', [holder, operator]));
          if (!raw) continue;
          const approved = ERC20.decodeFunctionResult('isApprovedForAll', raw)[0] as boolean;
          if (!approved) continue;
          approvals.push({ operator, label: target.label, scope: 'all', approved: true });
        }
        let single: string | null = null;
        if (tokenId) {
          const raw = await callOrNull((data) => provider.call({ to: collection, data }), ERC20.encodeFunctionData('getApproved', [BigInt(tokenId)]));
          if (raw) {
            const approvedFor = getAddress(ERC20.decodeFunctionResult('getApproved', raw)[0] as string);
            single = approvedFor === '0x0000000000000000000000000000000000000000' ? null : approvedFor;
          }
        }
        return {
          provider: 'rpc/erc721',
          access: 'public',
          chainId: config.chainId?.toString() ?? null,
          collection,
          owner: holder,
          collectionWideApprovals: approvals,
          collectionWideCount: approvals.length,
          tokenId: tokenId ?? null,
          approvedForTokenId: single,
          note: approvals.length
            ? '存在集合级授权：被授权的 operator 可以转走该地址在此集合下的全部 NFT（不只是某几枚）。'
            : '在已检查的 operator 清单里没有集合级授权；未列出的 operator 仍需自行确认。',
        };
      }),
    ),

    defineTool(
      'contract_posture',
      '给一个合约地址做静态体检：是否合约、字节码大小、是否代理/可升级（ERC-1967 / ERC-1822 / ERC-1167 / Beacon）、owner、是否 paused、代币基本信息。只读；不做源码审计，也不调用任何会改变状态的函数。',
      z.strictObject({
        address: addressSchema.describe('要体检的合约地址'),
      }),
      true,
      async ({ address }) => withProvider(config, async (provider) => {
        const target = getAddress(address);
        const code = await provider.getCode(target);
        const isContract = Boolean(code && code !== '0x');
        const call = (data: string) => provider.call({ to: target, data });
        const flags: string[] = [];

        if (!isContract) {
          return {
            provider: 'rpc/evm',
            access: 'public',
            chainId: config.chainId?.toString() ?? null,
            address: target,
            isContract: false,
            flags: ['该地址没有合约代码：它是 EOA 或尚未部署的合约地址'],
            note: 'EOA 没有代理、owner 或可升级性可言；检查授权请改用 allowance_check / approval_scan。',
          };
        }

        const codeSize = (code.length - 2) / 2;
        const minimalProxy = /^0x363d3d373d3d3d363d73[0-9a-fA-F]{40}5af43d82803e903d91602b57fd5bf3$/.test(code);
        // EIP-7702：EOA 把执行委托给某段代码，字节码以 0xef0100 + 20 字节地址开头。
        const delegated = /^0xef0100[0-9a-fA-F]{40}$/.test(code);
        if (delegated) flags.push(`EIP-7702 委托：该地址是 EOA，但执行已委托给 ${getAddress(`0x${code.slice(8, 48)}`)} 的代码`);
        const implementationSlot = await provider.getStorage(target, SLOT_IMPLEMENTATION).catch(() => null);
        const adminSlot = await provider.getStorage(target, SLOT_ADMIN).catch(() => null);
        const beaconSlot = await provider.getStorage(target, SLOT_BEACON).catch(() => null);
        const proxiableSlot = await provider.getStorage(target, SLOT_PROXIABLE).catch(() => null);
        const slotAddress = (value: string | null) => {
          if (!value) return null;
          const parsed = BigInt(value);
          if (parsed === 0n) return null;
          return getAddress(`0x${parsed.toString(16).padStart(40, '0').slice(-40)}`);
        };
        const implementation = slotAddress(implementationSlot);
        const admin = slotAddress(adminSlot);
        const beacon = slotAddress(beaconSlot);
        // 槽全零等于没有写入，不能当作"存在 proxiableUUID"。
        const proxiable = proxiableSlot && BigInt(proxiableSlot) !== 0n ? `0x${BigInt(proxiableSlot).toString(16).padStart(64, '0')}` : null;

        const ownerRaw = await callOrNull(call, OWNER_SELECTOR);
        const owner = ownerRaw ? getAddress(`0x${ownerRaw.slice(-40)}`) : null;
        const pausedRaw = await callOrNull(call, PAUSED_SELECTOR);
        const paused = pausedRaw ? pausedRaw.slice(-1) === '1' : null;

        const symbol = await callOrNull(call, ERC20.encodeFunctionData('symbol')).then((raw) => (raw ? ERC20.decodeFunctionResult('symbol', raw)[0] as string : null));
        const name = await callOrNull(call, ERC20.encodeFunctionData('name')).then((raw) => (raw ? ERC20.decodeFunctionResult('name', raw)[0] as string : null));
        const decimals = await callOrNull(call, ERC20.encodeFunctionData('decimals')).then((raw) => (raw ? Number(ERC20.decodeFunctionResult('decimals', raw)[0]) : null));
        const totalSupply = await callOrNull(call, ERC20.encodeFunctionData('totalSupply')).then((raw) => (raw ? BigInt(ERC20.decodeFunctionResult('totalSupply', raw)[0]).toString() : null));
        const isErc20 = decimals !== null || symbol !== null;

        if (implementation) flags.push(`ERC-1967 代理：实现合约 ${implementation}`);
        if (admin) flags.push(`ERC-1967 管理槽有值 ${admin}：存在可升级权限`);
        if (beacon) flags.push(`Beacon 代理：${beacon}`);
        if (proxiable) flags.push('存在 ERC-1822 proxiableUUID 槽：可能是 UUPS 可升级合约');
        if (minimalProxy) flags.push('ERC-1167 最小代理（克隆）');
        if (owner) flags.push(`存在 owner()=${owner}`);
        if (paused === true) flags.push('合约当前处于 paused 状态');

        // 字节级扫描必然有假阳性（同一个字节也可能只是常量数据），因此单列说明，不并入 flags。
        const opcodeHints = ([['SELFDESTRUCT', 'ff', '可自毁'], ['DELEGATECALL', 'f4', '把外部代码在当前存储上下文执行'], ['CREATE2', 'f5', '可确定性部署新合约']] as const)
          .filter(([, hex]) => code.slice(2).toLowerCase().includes(hex))
          .map(([opcode, , meaning]) => `${opcode}（${meaning}）`);

        return {
          provider: 'rpc/evm',
          access: 'public',
          chainId: config.chainId?.toString() ?? null,
          address: target,
          isContract: true,
          isDelegatedEoa: delegated,
          codeSizeBytes: codeSize,
          proxy: { erc1967Implementation: implementation, erc1967Admin: admin, beacon, erc1822ProxiableUuid: proxiable, erc1167MinimalProxy: minimalProxy },
          upgradeable: Boolean(implementation || admin || beacon),
          opcodeHints,
          owner,
          paused,
          token: isErc20 ? { isErc20Like: true, name, symbol, decimals, totalSupply } : { isErc20Like: false },
          flags,
          note: '这是链上静态信息的体检，不是安全审计：逻辑漏洞、后门与权限滥用必须靠源码审计与模拟才能判定。',
        };
      }),
    ),

    defineTool(
      'wallet_posture',
      '给一个地址做钱包体检：原生币余额、nonce、是否为合约、当前仍生效的 ERC-20 授权（含无限授权）与指定 NFT 集合的集合级授权。只读；不读取私钥，不做任何转账。',
      z.strictObject({
        address: addressSchema.describe('要体检的地址'),
        tokens: z.array(addressSchema).max(20).optional().describe('要扫描授权的 ERC-20；缺省为主网常见代币表'),
        collections: z.array(addressSchema).max(10).optional().describe('要检查集合级授权的 ERC-721 合约'),
        windowBlocks: z.number().int().min(1000).max(5_000_000).default(500_000).describe('无 Etherscan key 时授权扫描的区块窗口'),
      }),
      true,
      async ({ address, tokens, collections, windowBlocks }) => withProvider(config, async (provider) => {
        const holder = getAddress(address);
        const code = await provider.getCode(holder);
        const isContract = Boolean(code && code !== '0x');
        const [balance, transactionCount] = await Promise.all([provider.getBalance(holder), provider.getTransactionCount(holder)]);

        const tokenList = tokens ?? (config.chainId === 1n ? Object.values(MAINNET_TOKENS) : []);
        const ownerTopic = `0x${padAddress(holder)}`;
        const pairs = new Map<string, { token: string; spender: string }>();
        const warnings: string[] = [];
        if (tokenList.length) {
          const latest = await provider.getBlockNumber();
          const from = Math.max(0, latest - windowBlocks);
          for (const token of tokenList) {
            const scan = await scanApprovalLogs(provider, token, ownerTopic, from, latest);
            warnings.push(...scan.warnings);
            for (const log of scan.logs) pairs.set(`${token.toLowerCase()}:${String(log.topics[2]).toLowerCase()}`, { token, spender: getAddress(`0x${String(log.topics[2]).slice(26)}`) });
          }
          if (!config.etherscanApiKey) warnings.push(`未配置 BCA_ETHERSCAN_API_KEY，授权只扫描最近 ${windowBlocks} 个区块。`);
        }

        const approvals = [];
        for (const { token, spender } of pairs.values()) {
          const raw = await callOrNull((data) => provider.call({ to: token, data }), `${ALLOWANCE_SELECTOR}${padAddress(holder)}${padAddress(spender)}`);
          if (!raw) continue;
          const allowance = BigInt(raw);
          if (allowance === 0n) continue;
          const symbol = await callOrNull((data) => provider.call({ to: token, data }), ERC20.encodeFunctionData('symbol'))
            .then((value) => (value ? ERC20.decodeFunctionResult('symbol', value)[0] as string : null));
          approvals.push({ token, symbol, spender, spenderLabel: spenderLabel(spender), allowance: allowance.toString(), unlimited: allowance >= UNLIMITED_THRESHOLD });
        }
        approvals.sort((a, b) => Number(b.unlimited) - Number(a.unlimited));

        const nftApprovals = [];
        for (const collection of collections ?? []) {
          for (const target of KNOWN_NFT_OPERATORS) {
            const operator = getAddress(target.address.toLowerCase());
            const raw = await callOrNull((data) => provider.call({ to: collection, data }), ERC20.encodeFunctionData('isApprovedForAll', [holder, operator]));
            if (!raw) continue;
            if (ERC20.decodeFunctionResult('isApprovedForAll', raw)[0] === true) nftApprovals.push({ collection, operator, label: target.label });
          }
        }

        const unlimited = approvals.filter((item) => item.unlimited);
        return {
          provider: 'rpc/evm',
          access: 'public',
          chainId: config.chainId?.toString() ?? null,
          address: holder,
          isContract,
          balanceWei: balance.toString(),
          nonce: transactionCount,
          approvals: approvals.slice(0, 40),
          approvalCount: approvals.length,
          unlimitedApprovals: unlimited.slice(0, 20),
          unlimitedCount: unlimited.length,
          nftCollectionApprovals: nftApprovals,
          warnings,
          note: isContract
            ? '这是合约地址，不是 EOA：合约的"授权"由代码逻辑决定，检查可升级性与权限请改用工 contract_posture。'
            : '授权清单以链上 allowance 为准；未列出的代币、未列出的 operator 与更早区块里的授权不在覆盖范围内。',
        };
      }),
    ),
  ];
}

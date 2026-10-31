import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { getAddress, id as topicId, Interface } from 'ethers';
import { z } from 'zod';
import type { Config } from '../config.js';
import { defineTool } from '../types.js';
import { addressSchema, uidSchema, uint256Schema } from './common.js';
import { withProvider } from './evm.js';
import { requireBinary, terminateWindowsProcessTree } from '../development/exec.js';

// ---------------------------------------------------------------- 公共常量

// SEAL Safe Harbor Registry V3：由 CreateX 部署，所有 EVM 链同一地址。
const SAFE_HARBOR_REGISTRY = '0x326733493E143b8904716E7A64A9f4fb6A185a2c';
const SAFE_HARBOR_URL = 'https://frameworks.securityalliance.org/safe-harbor/';

const REGISTRY_ABI = new Interface([
  'function version() view returns (string)',
  'function getAgreement(address adopter) view returns (address)',
]);

// V3 与 V2 的 AgreementDetails 结构相同（V3 多了 ChildContractScope），V1 用 address + uint256 id。
const AGREEMENT_V3 = new Interface([
  'function version() view returns (string)',
  'function owner() view returns (address)',
  'function getDetails() view returns (tuple(string protocolName, tuple(string name, string contact)[] contactDetails, tuple(string assetRecoveryAddress, tuple(string accountAddress, uint8 childContractScope)[] accounts, string caip2ChainId)[] chains, tuple(uint256 bountyPercentage, uint256 bountyCapUSD, bool retainable, uint8 identity, string diligenceRequirements, uint256 aggregateBountyCapUSD) bountyTerms, string agreementURI))',
]);
const AGREEMENT_V2 = new Interface([
  'function owner() view returns (address)',
  'function getDetails() view returns (tuple(string protocolName, tuple(string name, string contact)[] contactDetails, tuple(string assetRecoveryAddress, tuple(string accountAddress)[] accounts, string caip2ChainId)[] chains, tuple(uint256 bountyPercentage, uint256 bountyCapUSD, bool retainable, uint8 identity, string diligenceRequirements, uint256 aggregateBountyCapUSD) bountyTerms, string agreementURI))',
]);
const AGREEMENT_V1 = new Interface([
  'function owner() view returns (address)',
  'function getDetails() view returns (tuple(string protocolName, tuple(string name, string contact)[] contactDetails, tuple(address assetRecoveryAddress, tuple(address accountAddress)[] accounts, uint256 id)[] chains, tuple(uint256 bountyPercentage, uint256 bountyCapUSD, bool retainable, string diligenceRequirements) bountyTerms, string agreementURI))',
]);

const EVENTS = new Interface([
  'event SafeHarborAdoption(address indexed adopter, address agreementAddress)',
  'event Transfer(address indexed from, address indexed to, uint256 value)',
  'event Approval(address indexed owner, address indexed spender, uint256 value)',
  'event ApprovalForAll(address indexed owner, address indexed operator, bool approved)',
  'event Swap(address indexed sender, address indexed recipient, int256 amount0, int256 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick)',
  'event Sync(uint112 reserve0, uint112 reserve1)',
  'event Deposit(address indexed dst, uint256 wad)',
  'event Withdrawal(address indexed src, uint256 wad)',
]);
const TRANSFER_TOPIC = topicId('Transfer(address,address,uint256)');
const APPROVAL_TOPIC = topicId('Approval(address,address,uint256)');
const APPROVAL_FOR_ALL_TOPIC = topicId('ApprovalForAll(address,address,bool)');
const ADOPTION_TOPIC = topicId('SafeHarborAdoption(address,address)');

const POOL_ABI = new Interface([
  'function token0() view returns (address)',
  'function token1() view returns (address)',
  'function fee() view returns (uint24)',
  'function liquidity() view returns (uint128)',
  'function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)',
]);
const ERC20_ABI = new Interface([
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'function balanceOf(address) view returns (uint256)',
]);
const FEED_ABI = new Interface([
  'function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)',
  'function decimals() view returns (uint8)',
]);

// WETH/USDC 主网池：0.05% 与 0.3% 两档费率，用来做同交易对的跨池比较。
const MAINNET_POOL_A = '0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640';
const MAINNET_POOL_B = '0x8ad599c3A0ff1De082011EFDDc58f1908eb6e6D8';
const MAINNET_ETH_USD_FEED = '0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419';

const IDENTITY_LABELS = ['Anonymous', 'Pseudonymous', 'Named'] as const;

function padAddress(address: string): string {
  return address.toLowerCase().replace(/^0x/, '').padStart(64, '0');
}

// 公共只读节点普遍拒绝历史 eth_getLogs（403 或 "archive requests require a token"），
// 所以凡是扫日志的路径，优先走 BCA_ARCHIVE_RPC_URL；没配就退回主 RPC。
function logConfig(config: Config): Config {
  return config.archiveRpcUrl ? { ...config, rpcUrl: config.archiveRpcUrl } : config;
}

function hexQuantity(value: number | bigint): string {
  return `0x${BigInt(value).toString(16)}`;
}

async function callData(provider: { call: (tx: { to: string; data: string }) => Promise<string> }, to: string, data: string): Promise<string | null> {
  try {
    const raw = await provider.call({ to, data });
    return raw && raw !== '0x' ? raw : null;
  } catch {
    return null;
  }
}

// 分块扫描日志：公共 RPC 普遍限制区块跨度，单块失败时保留已收集部分并给出原因。
async function scanLogs(
  provider: { send: (method: string, params: unknown[]) => Promise<any> },
  address: string,
  topics: (string | null)[],
  fromBlock: number,
  toBlock: number,
  chunk: number,
  maxChunks: number,
): Promise<{ logs: any[]; scannedTo: number; warnings: string[]; complete: boolean }> {
  const logs: any[] = [];
  const warnings: string[] = [];
  let scannedTo = fromBlock;
  let start = fromBlock;
  let span = chunk;
  let chunks = 0;
  while (start <= toBlock && chunks < maxChunks) {
    const end = Math.min(start + span - 1, toBlock);
    try {
      const batch = await provider.send('eth_getLogs', [{ address, topics, fromBlock: hexQuantity(start), toBlock: hexQuantity(end) }]);
      logs.push(...(Array.isArray(batch) ? batch : []));
      scannedTo = end;
      start = end + 1;
      chunks += 1;
    } catch (error) {
      // 节点对区块跨度限制不一：先收缩窗口重试，实在不行才放弃这一段。
      if (span <= 2000) {
        warnings.push(`区块 ${start}-${end} 未取到：${error instanceof Error ? error.message : String(error)}`);
        return { logs, scannedTo, warnings, complete: false };
      }
      span = Math.max(2000, Math.floor(span / 4));
    }
  }
  return { logs, scannedTo, warnings, complete: scannedTo >= toBlock };
}

// ---------------------------------------------------------------- 工具实现

export function defenseTools(config: Config) {
  return [
    defineTool(
      'safeharbor_registry',
      '查询 SEAL Whitehat Safe Harbor 链上登记：某协议是否已公开授权白帽救援、赏金比例与上限、资产归还地址、覆盖链与联系人。只读；未登记的协议只应做只读复盘，不要动其资金。',
      z.strictObject({
        protocol: addressSchema.optional().describe('协议治理/登记地址；传入后查询该协议的登记条款'),
        registry: addressSchema.optional().describe(`注册表地址，缺省使用 SEAL V3 全链同址 ${SAFE_HARBOR_REGISTRY}`),
        list: z.boolean().default(false).describe('改为列举注册表上的全部登记记录；需要节点支持历史日志'),
        fromBlock: uint256Schema.optional().describe('列举时的起始区块；缺省为最新区块往前 200 万'),
        resolveLimit: z.number().int().min(0).max(25).default(8).describe('列举时最多解析多少个协议名称'),
      }),
      true,
      async ({ protocol, registry, list, fromBlock, resolveLimit }) => withProvider(list ? logConfig(config) : config, async (provider) => {
        const target = registry ?? SAFE_HARBOR_REGISTRY;
        const code = await provider.getCode(target);
        if (!code || code === '0x') throw new Error(`地址 ${target} 在当前链没有合约代码；SEAL Safe Harbor Registry 未部署在这条链上`);
        const version = await callData(provider, target, REGISTRY_ABI.encodeFunctionData('version'))
          .then((raw) => (raw ? REGISTRY_ABI.decodeFunctionResult('version', raw)[0] as string : null));

        const base = {
          provider: 'rpc/safe-harbor-registry',
          access: 'public',
          chainId: config.chainId?.toString() ?? null,
          registry: target,
          registryVersion: version,
          reference: SAFE_HARBOR_URL,
        };

        if (list) {
          const latest = await provider.getBlockNumber();
          const from = fromBlock ? Number(fromBlock) : Math.max(0, latest - 2_000_000);
          const scan = await scanLogs(provider, target, [ADOPTION_TOPIC], from, latest, 200_000, 20);
          const records = scan.logs.map((log) => ({
            adopter: getAddress(`0x${log.topics[1]!.slice(26)}`),
            agreement: getAddress(`0x${(log.data ?? '0x').slice(0, 66).slice(-40)}`),
            blockNumber: Number(BigInt(log.blockNumber)),
            transactionHash: log.transactionHash ?? null,
          }));
          const resolved = [];
          for (const record of records.slice(0, resolveLimit)) {
            const raw = await callData(provider, record.agreement, AGREEMENT_V3.encodeFunctionData('getDetails'));
            let protocolName: string | null = null;
            let bounty: string | null = null;
            if (raw) {
              try {
                const details = AGREEMENT_V3.decodeFunctionResult('getDetails', raw)[0];
                protocolName = details[0] as string;
                bounty = `${details[3][0]}% / $${details[3][1]}`;
              } catch { /* 旧版本结构不同，保留未解析 */ }
            }
            resolved.push({ ...record, protocolName, bounty });
          }
          return {
            ...base,
            mode: 'list',
            scannedFromBlock: from,
            scannedToBlock: scan.scannedTo,
            scanComplete: scan.complete,
            warnings: scan.warnings,
            count: records.length,
            records: resolved.length ? resolved : records,
            unresolved: Math.max(0, records.length - resolved.length),
            note: '登记记录来自链上事件；历史事件需要归档节点，扫描不完整时会给出 scannedToBlock 与 warnings。',
          };
        }

        if (!protocol) throw new Error('需要 protocol（协议登记地址），或设置 list=true 列举全部登记记录');
        const owner = getAddress(protocol);
        let agreement: string | null = null;
        let lookupError: string | null = null;
        try {
          const raw = await provider.call({ to: target, data: REGISTRY_ABI.encodeFunctionData('getAgreement', [owner]) });
          const decoded = getAddress(REGISTRY_ABI.decodeFunctionResult('getAgreement', raw)[0] as string);
          agreement = decoded === '0x0000000000000000000000000000000000000000' ? null : decoded;
        } catch (error) {
          // getAgreement 在无登记时会 revert，这是正常的"未登记"信号，不是故障。
          lookupError = error instanceof Error ? error.message : String(error);
        }

        if (!agreement) {
          return {
            ...base,
            mode: 'lookup',
            protocol: owner,
            registered: false,
            agreement: null,
            lookupError,
            guidance: '该地址没有在 Safe Harbor 注册表登记。没有公开授权就不要动协议里的资金：只做只读复盘与披露，并通过协议自己的漏洞赏金渠道联系。',
            boundaries: [
              'Safe Harbor 只覆盖"正在发生或迫在眉睫"的攻击，不适用于有时间走披露流程的情况',
              '自己发起攻击再"救援"仍属黑帽，无赏金且全额担责',
              '框架不为白帽行为的合法性背书，框架外的责任由个人承担',
            ],
          };
        }

        const detailsRaw = await callData(provider, agreement, AGREEMENT_V3.encodeFunctionData('getDetails'));
        let decoded: any = null;
        let schema: string | null = null;
        for (const [label, iface] of [['V3', AGREEMENT_V3], ['V2', AGREEMENT_V2], ['V1', AGREEMENT_V1]] as const) {
          if (!detailsRaw) break;
          try {
            decoded = iface.decodeFunctionResult('getDetails', detailsRaw)[0];
            schema = label;
            break;
          } catch { /* 换下一个版本结构 */ }
        }
        const agreementVersion = await callData(provider, agreement, AGREEMENT_V3.encodeFunctionData('version'))
          .then((raw) => (raw ? AGREEMENT_V3.decodeFunctionResult('version', raw)[0] as string : null));
        const agreementOwner = await callData(provider, agreement, AGREEMENT_V3.encodeFunctionData('owner'))
          .then((raw) => (raw ? getAddress(AGREEMENT_V3.decodeFunctionResult('owner', raw)[0] as string) : null));

        const bounty = decoded ? {
          percentage: Number(decoded[3][0]),
          capUsd: Number(decoded[3][1]),
          retainable: Boolean(decoded[3][2]),
          identity: decoded[3].length > 4 ? IDENTITY_LABELS[Number(decoded[3][3])] ?? String(decoded[3][3]) : null,
          // 尽调要求常常是一整段法律条文，截断到可读长度并提示完整内容在 agreementURI 里。
          diligenceRequirements: String(decoded[3].length > 4 ? decoded[3][4] : decoded[3][3]).slice(0, 300),
          aggregateCapUsd: decoded[3].length > 5 ? Number(decoded[3][5]) : null,
        } : null;

        return {
          ...base,
          mode: 'lookup',
          protocol: owner,
          registered: true,
          agreement,
          agreementVersion,
          agreementOwner,
          detailsSchema: schema,
          protocolName: decoded ? (decoded[0] as string) : null,
          agreementUri: decoded ? (decoded[4] as string) : null,
          bounty,
          contacts: decoded ? (decoded[1] as any[]).map((contact) => ({ name: contact[0] as string, contact: contact[1] as string })) : [],
          // 显式给出条数与一句话条款，避免模型自己数链条数时数错。
          chainCount: decoded ? (decoded[2] as any[]).length : 0,
          bountySummary: bounty
            ? `${bounty.percentage}% 追回金额，每人每事件上限 $${bounty.capUsd}${bounty.identity ? `，身份要求 ${bounty.identity}` : ''}${bounty.retainable ? '，可自留赏金' : ''}`
            : null,
          chains: decoded ? (decoded[2] as any[]).map((chain) => ({
            caip2ChainId: typeof chain[2] === 'string' ? chain[2] as string : String(chain[2]),
            assetRecoveryAddress: chain[0] as string,
            accountCount: (chain[1] as any[]).length,
            accounts: (chain[1] as any[]).slice(0, 10).map((account) => ({ accountAddress: account[0] as string, childContractScope: account.length > 1 ? Number(account[1]) : null })),
          })) : [],
          guidance: decoded
            ? `已登记：救援赏金为追回金额的 ${bounty!.percentage}%${bounty!.capUsd ? `，每人每事件上限 $${bounty!.capUsd}` : ''}${bounty!.identity ? `，身份要求 ${bounty!.identity}` : ''}。资金必须在 72 小时内归还到链上登记的 assetRecoveryAddress，赏金条款按登记内容自动生效、不可谈判。`
            : '已登记，但本工具未能解析条款结构体；请以链上 agreement 合约与协议公告为准。',
          boundaries: [
            '仅限正在发生或迫在眉睫的攻击；有时间走披露流程时不受保护',
            '72 小时内归还到登记的 assetRecoveryAddress',
            '本工具只读：不构造、不提交任何救援交易',
          ],
        };
      }),
    ),

    defineTool(
      'mempool_watch',
      '读取节点 mempool 中的待处理交易并按条件过滤（最小金额、目标合约、函数选择器）。只读；用于观察是否有异常大额交易正在排队，不提交任何交易。',
      z.strictObject({
        minValueWei: uint256Schema.default('0').describe('只看原生币转账额大于等于该值的交易'),
        to: addressSchema.optional().describe('只看发往该地址/合约的交易'),
        selector: z.string().regex(/^0x[0-9a-fA-F]{8}$/).optional().describe('只看以该 4 字节函数选择器开头的调用'),
        limit: z.number().int().min(1).max(100).default(20).describe('最多返回多少条'),
      }),
      true,
      async ({ minValueWei, to, selector, limit }) => withProvider(config, async (provider) => {
        const warnings: string[] = [];
        let txpoolStatus: Record<string, string> | null = null;
        try {
          txpoolStatus = await provider.send('txpool_status', []);
        } catch (error) {
          warnings.push(`txpool_status 不可用：${error instanceof Error ? error.message : String(error)}`);
        }
        let pending: any[] = [];
        try {
          const raw = await provider.send('eth_pendingTransactions', []);
          pending = Array.isArray(raw) ? raw : [];
        } catch (error) {
          warnings.push(`eth_pendingTransactions 不可用：${error instanceof Error ? error.message : String(error)}`);
        }
        const minValue = BigInt(minValueWei);
        const toFilter = to?.toLowerCase();
        const selectorFilter = selector?.toLowerCase();
        const matched = pending.filter((tx) => {
          if (minValue > 0n && BigInt(tx.value ?? 0) < minValue) return false;
          if (toFilter && String(tx.to ?? '').toLowerCase() !== toFilter) return false;
          if (selectorFilter && !String(tx.input ?? '0x').toLowerCase().startsWith(selectorFilter)) return false;
          return true;
        });
        return {
          provider: 'rpc/mempool',
          access: 'public',
          chainId: config.chainId?.toString() ?? null,
          txpoolStatus,
          pendingSeen: pending.length,
          matched: matched.length,
          transactions: matched.slice(0, limit).map((tx) => ({
            hash: tx.hash ?? null,
            from: tx.from ?? null,
            to: tx.to ?? null,
            valueWei: BigInt(tx.value ?? 0).toString(),
            gasPriceWei: BigInt(tx.gasPrice ?? tx.maxFeePerGas ?? 0).toString(),
            nonce: tx.nonce ?? null,
            selector: String(tx.input ?? '0x').slice(0, 10),
            inputBytes: Math.max(0, (String(tx.input ?? '0x').length - 2) / 2),
          })),
          warnings,
          note: '结果只是单个节点视角：私有 mempool、relay bundle 与其他节点的交易看不到，因此"没看到"不等于"没有"。',
        };
      }),
    ),

    defineTool(
      'tx_call_tree',
      '还原一笔交易做了什么：优先用 debug_traceTransaction 得到调用树，节点不支持时降级为回执日志解码，输出可读的资产流向（ERC-20/ERC-721 转移、授权、swap）。只读复盘工具，不提交交易。',
      z.strictObject({
        transactionHash: uidSchema.describe('交易哈希'),
        maxDepth: z.number().int().min(1).max(10).default(4).describe('调用树最大展开层级'),
      }),
      true,
      async ({ transactionHash, maxDepth }) => withProvider(config, async (provider) => {
        const tx = await provider.getTransaction(transactionHash);
        if (!tx) throw new Error(`节点没有返回交易 ${transactionHash}；可能尚未广播或不在当前链上`);
        const receipt = await provider.getTransactionReceipt(transactionHash);
        if (!receipt) throw new Error(`交易 ${transactionHash} 还没有回执；请确认已上链`);

        let trace: any = null;
        let traceSource = 'receipt-logs';
        try {
          trace = await provider.send('debug_traceTransaction', [transactionHash, { tracer: 'callTracer' }]);
          traceSource = 'debug_traceTransaction';
        } catch (error) {
          trace = { unavailable: error instanceof Error ? error.message : String(error) };
        }

        const events: Array<{ contract: string; name: string; args: Record<string, string> }> = [];
        const balances = new Map<string, Map<string, bigint>>();
        const move = (token: string, who: string, delta: bigint) => {
          const byAddress = balances.get(token) ?? new Map<string, bigint>();
          byAddress.set(who, (byAddress.get(who) ?? 0n) + delta);
          balances.set(token, byAddress);
        };

        for (const log of receipt.logs) {
          const contract = String(log.address).toLowerCase();
          const topic0 = log.topics[0];
          if (topic0 === TRANSFER_TOPIC || topic0 === APPROVAL_TOPIC || topic0 === APPROVAL_FOR_ALL_TOPIC) {
            // ERC-721 的 Transfer 把 tokenId 放在 topics[3]，ERC-20 把金额放在 data。
            if (topic0 === TRANSFER_TOPIC && log.topics.length >= 4) {
              const from = getAddress(`0x${log.topics[1]!.slice(26)}`);
              const to = getAddress(`0x${log.topics[2]!.slice(26)}`);
              const tokenId = BigInt(log.topics[3]!).toString();
              events.push({ contract, name: 'ERC721 Transfer', args: { from, to, tokenId } });
              continue;
            }
            if (topic0 === APPROVAL_FOR_ALL_TOPIC) {
              const owner = getAddress(`0x${log.topics[1]!.slice(26)}`);
              const operator = getAddress(`0x${log.topics[2]!.slice(26)}`);
              const approved = BigInt(log.data) === 1n;
              events.push({ contract, name: 'ApprovalForAll', args: { owner, operator, approved: String(approved) } });
              continue;
            }
            try {
              const parsed = EVENTS.parseLog({ topics: log.topics, data: log.data });
              const args = parsed!.args;
              if (parsed!.name === 'Transfer') {
                move(contract, getAddress(args[0]), -BigInt(args[2]));
                move(contract, getAddress(args[1]), BigInt(args[2]));
                events.push({ contract, name: 'Transfer', args: { from: getAddress(args[0]), to: getAddress(args[1]), value: BigInt(args[2]).toString() } });
              } else if (parsed!.name === 'Approval') {
                events.push({ contract, name: 'Approval', args: { owner: getAddress(args[0]), spender: getAddress(args[1]), value: BigInt(args[2]).toString() } });
              }
              continue;
            } catch { /* 非标准事件，跳过解码 */ }
          }
          try {
            const parsed = EVENTS.parseLog({ topics: log.topics, data: log.data });
            if (!parsed) continue;
            const args = parsed.args;
            if (parsed.name === 'Swap' && args.length === 7) {
              events.push({ contract, name: 'UniswapV3 Swap', args: { recipient: getAddress(args[1]), amount0: BigInt(args[2]).toString(), amount1: BigInt(args[3]).toString(), tick: String(args[6]) } });
            } else if (parsed.name === 'Swap' && args.length === 6) {
              events.push({ contract, name: 'UniswapV2 Swap', args: { to: getAddress(args[5]), amount0In: BigInt(args[1]).toString(), amount1Out: BigInt(args[3]).toString() } });
            } else if (parsed.name === 'Sync') {
              events.push({ contract, name: 'Sync', args: { reserve0: BigInt(args[0]).toString(), reserve1: BigInt(args[1]).toString() } });
            } else if (parsed.name === 'Deposit' || parsed.name === 'Withdrawal') {
              events.push({ contract, name: parsed.name, args: { address: getAddress(args[0]), amount: BigInt(args[1]).toString() } });
            }
          } catch { /* 未识别的事件保留在 rawLogCount 里 */ }
        }

        // 调用树：只在 trace 可用时展开，层级与条数都做限制，避免一次返回过大。
        const flatten = (node: any, depth: number): any[] => {
          if (!node || depth > maxDepth) return [];
          const row = {
            depth,
            type: node.type ?? null,
            from: node.from ? String(node.from).toLowerCase() : null,
            to: node.to ? String(node.to).toLowerCase() : null,
            valueWei: node.value ? BigInt(node.value).toString() : '0',
            selector: node.input ? String(node.input).slice(0, 10) : null,
            error: node.error ?? null,
          };
          const children = Array.isArray(node.calls) ? node.calls : [];
          return [row, ...children.flatMap((child: any) => flatten(child, depth + 1))];
        };
        const callTree = trace && !trace.unavailable ? flatten(trace, 0) : [];

        const assetFlows = [...balances.entries()].flatMap(([token, byAddress]) =>
          [...byAddress.entries()]
            .filter(([, delta]) => delta !== 0n)
            .map(([holder, delta]) => ({ token, holder, deltaWei: delta.toString() })),
        ).sort((a, b) => (BigInt(b.deltaWei) > 0n ? 1 : -1) - (BigInt(a.deltaWei) > 0n ? 1 : -1));

        // 一句话结论放在最前面：模型读长 JSON 时最容易把 from/to 弄反。
        const short = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`;
        const statusText = receipt.status === 1 ? '成功' : receipt.status === 0 ? '回滚' : '未知';
        const headline = `${short(tx.from)} ${tx.to ? `→ ${short(tx.to)}` : '（合约创建）'} · ${statusText} · gas ${receipt.gasUsed.toString()} · ${events.length} 个可读事件 · ${assetFlows.length} 条资产净流向`;

        return {
          provider: 'rpc/trace',
          access: 'public',
          chainId: config.chainId?.toString() ?? null,
          headline,
          transactionHash,
          blockNumber: receipt.blockNumber,
          from: tx.from,
          to: tx.to ?? null,
          valueWei: tx.value.toString(),
          status: receipt.status === 1 ? 'success' : receipt.status === 0 ? 'reverted' : 'unknown',
          gasUsed: receipt.gasUsed.toString(),
          effectiveGasPriceWei: receipt.gasPrice?.toString() ?? null,
          // 手续费单独算好给出来，模型自己乘容易出错（例如把 gas 数当 ETH）。
          gasCostWei: receipt.gasPrice ? (receipt.gasUsed * receipt.gasPrice).toString() : null,
          gasCostEth: receipt.gasPrice ? Number(receipt.gasUsed * receipt.gasPrice) / 1e18 : null,
          traceSource,
          traceUnavailableReason: trace?.unavailable ?? null,
          callTree,
          callCount: callTree.length,
          rawLogCount: receipt.logs.length,
          decodedEvents: events.slice(0, 60),
          decodedEventCount: events.length,
          assetFlows: assetFlows.slice(0, 40),
          note: traceSource === 'debug_traceTransaction'
            ? '调用树来自节点 trace；资产流向由回执日志解码得出，未含内部转账的手续费拆分。'
            : '当前节点不支持 debug_traceTransaction，已降级为回执日志解码：能看到资产流向和事件，看不到内部调用层级。',
        };
      }),
    ),

    defineTool(
      'arb_scan',
      '扫描同一交易对在两个 Uniswap V3 池之间的价差，并**扣除两条腿的池费与 gas 后给出净额**，同时给出不同本金下的敏感度。只读；不会提交任何交易。',
      z.strictObject({
        poolA: addressSchema.optional().describe(`第一个 Uniswap V3 池；缺省为主网 WETH/USDC 0.05% 池 ${MAINNET_POOL_A}`),
        poolB: addressSchema.optional().describe(`第二个 Uniswap V3 池；缺省为主网 WETH/USDC 0.3% 池 ${MAINNET_POOL_B}`),
        feed: addressSchema.optional().describe(`可选：Chainlink 喂价地址（缺省主网 ETH/USD ${MAINNET_ETH_USD_FEED}），用于换算 gas 成本与给出预言机价差参考`),
        notionalUsd: uint256Schema.default('50000').describe('本金规模（美元），用于计算净额'),
        gasUnits: uint256Schema.default('250000').describe('两腿合计的 gas 估算'),
      }),
      true,
      async ({ poolA, poolB, feed, notionalUsd, gasUnits }) => withProvider(config, async (provider) => {
        const isMainnet = config.chainId === 1n;
        const a = poolA ?? (isMainnet ? MAINNET_POOL_A : undefined);
        const b = poolB ?? (isMainnet ? MAINNET_POOL_B : undefined);
        if (!a || !b) throw new Error('非主网没有内置池地址，请用 poolA / poolB 显式传入两个 Uniswap V3 池');
        const feedAddress = feed ?? (isMainnet ? MAINNET_ETH_USD_FEED : undefined);

        async function readPool(pool: string) {
          const [token0Raw, token1Raw, feeRaw, slot0Raw, liquidityRaw] = await Promise.all([
            callData(provider, pool, POOL_ABI.encodeFunctionData('token0')),
            callData(provider, pool, POOL_ABI.encodeFunctionData('token1')),
            callData(provider, pool, POOL_ABI.encodeFunctionData('fee')),
            callData(provider, pool, POOL_ABI.encodeFunctionData('slot0')),
            callData(provider, pool, POOL_ABI.encodeFunctionData('liquidity')),
          ]);
          if (!token0Raw || !token1Raw || !feeRaw || !slot0Raw) throw new Error(`地址 ${pool} 读不出 Uniswap V3 池状态（token0/token1/fee/slot0）`);
          const token0 = getAddress(POOL_ABI.decodeFunctionResult('token0', token0Raw)[0] as string);
          const token1 = getAddress(POOL_ABI.decodeFunctionResult('token1', token1Raw)[0] as string);
          const fee = Number(POOL_ABI.decodeFunctionResult('fee', feeRaw)[0]);
          const slot0 = POOL_ABI.decodeFunctionResult('slot0', slot0Raw);
          const sqrtPriceX96 = BigInt(slot0[0]);
          // 精度必须拿到：拿不到就报错，不能悄悄按 18 处理，否则价格会差好几个数量级。
          const decimals0Raw = await callData(provider, token0, ERC20_ABI.encodeFunctionData('decimals'));
          const decimals1Raw = await callData(provider, token1, ERC20_ABI.encodeFunctionData('decimals'));
          if (!decimals0Raw || !decimals1Raw) throw new Error(`读不出 ${token0} / ${token1} 的 decimals`);
          const decimals0 = Number(ERC20_ABI.decodeFunctionResult('decimals', decimals0Raw)[0]);
          const decimals1 = Number(ERC20_ABI.decodeFunctionResult('decimals', decimals1Raw)[0]);
          const symbol0 = await callData(provider, token0, ERC20_ABI.encodeFunctionData('symbol')).then((raw) => (raw ? ERC20_ABI.decodeFunctionResult('symbol', raw)[0] as string : null));
          const symbol1 = await callData(provider, token1, ERC20_ABI.encodeFunctionData('symbol')).then((raw) => (raw ? ERC20_ABI.decodeFunctionResult('symbol', raw)[0] as string : null));
          // price = (sqrtPriceX96 / 2^96)^2，再按两个代币的精度差换算；整数运算先放大 10^18 保留小数。
          const numerator = sqrtPriceX96 * sqrtPriceX96 * 10n ** BigInt(decimals0) * 10n ** 18n;
          const denominator = 2n ** 192n * 10n ** BigInt(decimals1);
          const price = denominator === 0n ? 0 : Number(numerator / denominator) / 1e18;
          return {
            pool, token0, token1, symbol0, symbol1, decimals0, decimals1,
            feeBps: fee / 100, feeRaw: fee,
            sqrtPriceX96: sqrtPriceX96.toString(),
            priceToken1PerToken0: price,
            priceToken0PerToken1: price > 0 ? 1 / price : null,
            liquidity: liquidityRaw ? BigInt(POOL_ABI.decodeFunctionResult('liquidity', liquidityRaw)[0]).toString() : null,
          };
        }

        const [first, second] = await Promise.all([readPool(a), readPool(b)]);
        if (first.token0.toLowerCase() !== second.token0.toLowerCase() || first.token1.toLowerCase() !== second.token1.toLowerCase()) {
          throw new Error(`两个池的交易对不同：${first.symbol0 ?? first.token0}/${first.symbol1 ?? first.token1} 与 ${second.symbol0 ?? second.token0}/${second.symbol1 ?? second.token1}；跨池比较要求同一交易对`);
        }

        const high = Math.max(first.priceToken1PerToken0, second.priceToken1PerToken0);
        const low = Math.min(first.priceToken1PerToken0, second.priceToken1PerToken0);
        const grossBps = low > 0 ? ((high - low) / low) * 10_000 : 0;
        const feeBps = first.feeBps + second.feeBps;
        const notional = Number(notionalUsd);
        const grossUsd = notional * grossBps / 10_000;
        const feeUsd = notional * feeBps / 10_000;

        const gasPriceWei = await provider.send('eth_gasPrice', []).then((raw: string) => BigInt(raw)).catch(() => null);
        let ethUsd: number | null = null;
        let oracle: { address: string; price: number; ageSeconds: number | null } | null = null;
        if (feedAddress) {
          const [roundRaw, feedDecimalsRaw] = await Promise.all([
            callData(provider, feedAddress, FEED_ABI.encodeFunctionData('latestRoundData')),
            callData(provider, feedAddress, FEED_ABI.encodeFunctionData('decimals')),
          ]);
          if (roundRaw) {
            const round = FEED_ABI.decodeFunctionResult('latestRoundData', roundRaw);
            const decimals = Number(feedDecimalsRaw ? FEED_ABI.decodeFunctionResult('decimals', feedDecimalsRaw)[0] : 8n);
            const answer = Number(BigInt(round[1])) / 10 ** decimals;
            const updatedAt = Number(BigInt(round[3]));
            ethUsd = answer;
            oracle = { address: feedAddress, price: answer, ageSeconds: updatedAt > 0 ? Math.floor(Date.now() / 1000) - updatedAt : null };
          }
        }
        const gasUsd = gasPriceWei !== null && ethUsd !== null ? Number(gasPriceWei * BigInt(gasUnits)) / 1e18 * ethUsd : null;
        const netUsd = grossUsd - feeUsd - (gasUsd ?? 0);
        const sensitivity = [10_000, 50_000, 200_000, 1_000_000].map((size) => ({
          notionalUsd: size,
          grossUsd: Number((size * grossBps / 10_000).toFixed(2)),
          feeUsd: Number((size * feeBps / 10_000).toFixed(2)),
          netUsd: Number((size * grossBps / 10_000 - size * feeBps / 10_000 - (gasUsd ?? 0)).toFixed(2)),
        }));
        // 池子报价可能是"每 token0 多少 token1"，也可能是反的；取与喂价方向一致的那一边作参考。
        let oracleGapBps: number | null = null;
        if (oracle && oracle.price > 0) {
          const direct = (first.priceToken1PerToken0 - oracle.price) / oracle.price;
          const inverted = first.priceToken1PerToken0 > 0 ? (1 / first.priceToken1PerToken0 - oracle.price) / oracle.price : Number.POSITIVE_INFINITY;
          oracleGapBps = Number((Math.abs(inverted) < Math.abs(direct) ? inverted : direct) * 10_000);
        }

        return {
          provider: 'rpc/uniswap-v3+chainlink',
          access: 'public',
          chainId: config.chainId?.toString() ?? null,
          pair: `${first.symbol0 ?? first.token0}/${first.symbol1 ?? first.token1}`,
          pools: [first, second],
          spread: {
            // 两个方向都给出：token1/token0 是链上原始方向，取倒数往往更贴近人的读法（例如 USDC/WETH）。
            priceToken1PerToken0A: Number(first.priceToken1PerToken0.toPrecision(10)),
            priceToken1PerToken0B: Number(second.priceToken1PerToken0.toPrecision(10)),
            priceToken0PerToken1A: first.priceToken1PerToken0 > 0 ? Number((1 / first.priceToken1PerToken0).toPrecision(10)) : null,
            priceToken0PerToken1B: second.priceToken1PerToken0 > 0 ? Number((1 / second.priceToken1PerToken0).toPrecision(10)) : null,
            grossBps: Number(grossBps.toFixed(3)),
            feeBps: Number(feeBps.toFixed(3)),
          },
          costs: { notionalUsd: notional, grossUsd: Number(grossUsd.toFixed(2)), feeUsd: Number(feeUsd.toFixed(2)), gasUsd: gasUsd === null ? null : Number(gasUsd.toFixed(2)), gasUnits, gasPriceWei: gasPriceWei?.toString() ?? null, ethUsd },
          netUsd: Number(netUsd.toFixed(2)),
          verdict: netUsd > 0 ? '按当前静态假设净额为正' : '不成立：扣除两腿手续费与 gas 后净额为负',
          sensitivity,
          oracle,
          oracleGapBps,
          note: oracleGapBps !== null
            ? '预言机价差只作参考：预言机本身不可交易，能否变现取决于是否有协议按该价格清算或定价。静态快照不等于可执行机会。'
            : '静态快照：不含滑点、竞争者抢跑与打包延迟，实际执行会更低。',
        };
      }),
    ),

    defineTool(
      'fork_replay',
      '在本机 anvil 上 fork 指定区块并重放一笔已发生的交易，返回重放回执与各地址原生币/代币余额变化。用于攻击复盘与救援推演：不改主网、不广播、不签名。需要 BCA_ARCHIVE_RPC_URL（能读历史状态的归档节点）与本机 anvil。',
      z.strictObject({
        transactionHash: uidSchema.describe('要重放的交易哈希'),
        blockNumber: uint256Schema.optional().describe('fork 到的区块高度；缺省为该交易所在区块的前一块'),
        watch: z.array(addressSchema).max(10).optional().describe('额外要报告余额变化的地址；默认含交易的 from 与 to'),
        token: addressSchema.optional().describe('可选：一并报告该 ERC-20 的 balanceOf 变化'),
      }),
      true,
      async ({ transactionHash, blockNumber, watch, token }) => {
        const archive = config.archiveRpcUrl ?? config.rpcUrl;
        if (!archive) throw new Error('需要 BCA_ARCHIVE_RPC_URL：fork 重放要读历史区块状态，普通公共 RPC 只保留最近状态');
        requireBinary('anvil', '安装 Foundry：curl -L https://foundry.paradigm.xyz | bash && foundryup');
        const budget = Math.max(config.timeoutMs, 120_000);

        async function jsonRpc(url: string, method: string, params: unknown[]): Promise<any> {
          const response = await fetch(url, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
            signal: AbortSignal.timeout(Math.min(budget, 60_000)),
          });
          const body = await response.json() as { result?: unknown; error?: { message?: string } };
          if (body.error) throw new Error(`${method} 失败：${body.error.message ?? '上游错误'}`);
          return body.result;
        }

        const tx = await jsonRpc(archive, 'eth_getTransactionByHash', [transactionHash]) as any;
        if (!tx) throw new Error(`归档节点没有交易 ${transactionHash}`);
        const txBlock = Number(BigInt(tx.blockNumber));
        const forkBlock = blockNumber ? Number(blockNumber) : Math.max(0, txBlock - 1);
        const watchers = [...new Set([String(tx.from).toLowerCase(), ...(tx.to ? [String(tx.to).toLowerCase()] : []), ...(watch ?? []).map((item) => item.toLowerCase())])];

        const port = await new Promise<number>((resolvePort, rejectPort) => {
          const server = createServer();
          server.on('error', rejectPort);
          server.listen(0, '127.0.0.1', () => {
            const address = server.address();
            const value = typeof address === 'object' && address ? address.port : 0;
            server.close(() => (value ? resolvePort(value) : rejectPort(new Error('无法分配本地端口'))));
          });
        });
        const endpoint = `http://127.0.0.1:${port}`;
        // 不加 --silent：anvil 的就绪信息只在正常输出里，同时这里也主动轮询端口，双保险。
        const child = spawn('anvil', ['--fork-url', archive, '--fork-block-number', String(forkBlock), '--port', String(port)], { stdio: ['ignore', 'pipe', 'pipe'] });
        let stderr = '';
        child.stdout?.resume();
        child.stderr?.on('data', (chunk) => { stderr += String(chunk); });
        const cleanup = async () => {
          if (child.exitCode !== null || child.signalCode !== null) return;
          child.kill('SIGTERM');
          if (process.platform === 'win32' && child.pid) await terminateWindowsProcessTree(child.pid).catch(() => undefined);
          else child.kill('SIGKILL');
        };
        try {
          await new Promise<void>((resolveReady, rejectReady) => {
            const deadline = Date.now() + budget;
            let settled = false;
            const finish = (error?: Error) => {
              if (settled) return;
              settled = true;
              clearInterval(timer);
              if (error) rejectReady(error); else resolveReady();
            };
            const timer = setInterval(async () => {
              if (child.exitCode !== null || child.signalCode !== null) {
                finish(new Error(`anvil 启动失败（退出码 ${child.exitCode ?? child.signalCode}）：${stderr.slice(0, 200) || '无输出'}`));
                return;
              }
              if (Date.now() > deadline) {
                finish(new Error(`anvil 在 ${budget / 1000}s 内没就绪；归档节点可能不支持历史状态`));
                return;
              }
              try { await jsonRpc(endpoint, 'eth_chainId', []); finish(); } catch { /* 继续轮询 */ }
            }, 500);
            child.on('exit', (code) => finish(new Error(`anvil 启动失败（退出码 ${code}）：${stderr.slice(0, 200) || '无输出'}`)));
          });

          const before = new Map<string, bigint>();
          const tokenBefore = new Map<string, bigint>();
          for (const holder of watchers) {
            before.set(holder, BigInt(await jsonRpc(endpoint, 'eth_getBalance', [holder, hexQuantity(forkBlock)])));
            if (token) tokenBefore.set(holder, BigInt(await jsonRpc(endpoint, 'eth_call', [{ to: token, data: `${ERC20_ABI.encodeFunctionData('balanceOf', [holder])}` }, hexQuantity(forkBlock)])));
          }

          await jsonRpc(endpoint, 'anvil_impersonateAccount', [tx.from]);
          const sent = await jsonRpc(endpoint, 'eth_sendTransaction', [{ from: tx.from, to: tx.to, value: tx.value ?? '0x0', data: tx.input ?? '0x', gas: tx.gas ?? '0x7a120' }]) as string;
          // 重放一笔复杂交易时，anvil 需要向归档节点补齐大量历史状态，可能需要几十秒。
          let receipt: any = null;
          for (let attempt = 0; attempt < 120 && !receipt; attempt += 1) {
            receipt = await jsonRpc(endpoint, 'eth_getTransactionReceipt', [sent]);
            if (!receipt) await new Promise((r) => setTimeout(r, 1000));
          }
          if (!receipt) throw new Error(`重放交易在预期时间内没有拿到回执；anvil 输出：${stderr.slice(0, 200) || '无'}`);

          const deltas = [];
          for (const holder of watchers) {
            const after = BigInt(await jsonRpc(endpoint, 'eth_getBalance', [holder, 'latest']));
            const delta = after - (before.get(holder) ?? 0n);
            const entry: Record<string, unknown> = { address: holder, balanceBeforeWei: (before.get(holder) ?? 0n).toString(), balanceAfterWei: after.toString(), deltaWei: delta.toString() };
            if (token) {
              const tokenAfter = BigInt(await jsonRpc(endpoint, 'eth_call', [{ to: token, data: ERC20_ABI.encodeFunctionData('balanceOf', [holder]) }, 'latest']));
              entry.tokenDeltaWei = (tokenAfter - (tokenBefore.get(holder) ?? 0n)).toString();
            }
            deltas.push(entry);
          }

          return {
            provider: 'anvil-fork',
            access: 'local',
            transactionHash,
            sourceBlockNumber: txBlock,
            forkBlockNumber: forkBlock,
            replayedTransactionHash: sent,
            status: receipt.status === '0x1' ? 'success' : 'reverted',
            gasUsed: receipt.gasUsed ? BigInt(receipt.gasUsed).toString() : null,
            logCount: Array.isArray(receipt.logs) ? receipt.logs.length : 0,
            watchers: deltas,
            token: token ?? null,
            note: '重放发生在本机 fork 出的临时链上：改动不进主网，结果仅用于复盘与推演。余额差包含该交易自身的转账与 gas 消耗。',
          };
        } finally {
          await cleanup();
        }
      },
    ),
  ];
}

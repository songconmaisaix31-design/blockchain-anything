import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { z } from 'zod';
import type { Config } from '../config.js';
import { defineTool, type ToolDefinition } from '../types.js';
import { resolveExecutable } from '../development/exec.js';
import { inspectProject } from '../development/workspace.js';
import { resolveWorkingDir } from '../development/exec.js';
import { identifyChains, includesAlias, inspectProviders, type ProviderMatch } from '../bridge/config.js';

const packageRoot = fileURLToPath(new URL('../../', import.meta.url));
const pkg = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'));
const dependencies: Record<string, string> = { ...pkg.dependencies, ...pkg.devDependencies };
const sources: Record<string, string> = {
  viem: 'viem', evm: 'ethers', eas: '@ethereum-attestation-service/eas-sdk', content: 'multiformats', ipfs: 'kubo-rpc-client',
  sui: '@mysten/sui', aptos: '@aptos-labs/ts-sdk', solana: '@solana/kit', sas: 'sas-lib', sign: '@ethsign/sp-sdk',
  seal: '@mysten/seal', arweave: 'arweave', safe: '@safe-global/protocol-kit', x402: '@x402/core', ccxt: 'ccxt',
  brian: '@brian-ai/sdk', vc: 'did-jwt-vc', did: 'key-did-resolver', bridge: '@modelcontextprotocol/client',
};
const conditions: Record<string, string[]> = {
  sui: ['BCA_SUI_RPC_URL'], aptos: ['BCA_APTOS_RPC_URL'], solana: ['BCA_SOLANA_RPC_URL'], sas: ['BCA_SOLANA_RPC_URL'],
  bankr: ['BCA_BANKR_API_KEY'], brian: ['BCA_BRIAN_API_KEY'], hummingbot: ['BCA_HUMMINGBOT_URL'],
  openlineage: ['BCA_OPENLINEAGE_URL'],
  explorer: ['BCA_ETHERSCAN_API_KEY'], aa: ['BCA_BUNDLER_URL'], tx: ['BCA_TENDERLY_ACCESS_KEY'],
  graph: ['BCA_GRAPH_API_KEY'],
};

export const workstations = [
  { id: 'evm-diagnose', name: 'EVM 交易诊断', target: 'evm',
    description: '解释交易为何失败、revert、回执、gas 与合约调用错误',
    aliases: ['交易失败', '交易报错', '交易诊断', '为什么失败', '为什么回滚', '交易回滚', '执行回滚', 'revert', 'failed transaction', 'transaction failed', 'debug transaction', 'tx failed', 'transaction diagnosis'],
    required: ['viem_transaction', 'workstation_diagnose'], optional: ['evm_trace', 'evm_contract_source', 'evm_proxy', 'bridge_call'],
    facts: ['chainId', 'hash'], officialSkills: ['https://getfoundry.sh/cast/reference/run/', 'https://docs.sourcify.dev/docs/api/'],
  },
  { id: 'evm-develop', name: 'EVM 合约开发与验证', target: 'evm',
    description: '生成 ERC20 或编译、测试、部署、验证 Solidity 合约',
    aliases: ['开发合约', '合约开发', '智能合约', '编译合约', '测试合约', '合约测试', '部署合约', '验证源码', '发行代币', '发一个币', 'erc20', 'solidity', 'smart contract', 'deploy contract', 'compile contract', 'test contract', 'foundry', 'hardhat'],
    required: ['dev_project'], optional: ['bridge_call', 'dev_skill_read', 'dev_solidity_compile', 'dev_forge_build', 'dev_forge_test', 'dev_forge_deploy_local', 'dev_hardhat_compile', 'dev_hardhat_test', 'viem_read', 'dev_forge_verify'],
    facts: ['dir'], officialSkills: ['https://github.com/OpenZeppelin/openzeppelin-skills', 'https://getfoundry.sh/forge/overview/'],
  },
  { id: 'nft-create', name: 'NFT 创建', target: 'chain-specific',
    description: '选择链后创建 NFT；EVM 使用 OpenZeppelin ERC721，本地编译、测试、铸造并读取 tokenURI',
    aliases: ['nft', 'erc721', '非同质化代币'],
    required: ['project_init'], optional: ['project_run', 'dev_forge_deploy_local', 'dev_erc721_mint_local', 'dev_cast_call', 'ipfs_add', 'bridge_call'],
    facts: ['chainFamily'], officialSkills: ['https://github.com/OpenZeppelin/contracts-wizard/blob/master/packages/mcp/README.md', 'https://github.com/sendaifun/solana-agent-kit'],
  },
  { id: 'onchain-data', name: '链上数据查询', target: 'provider-specific',
    description: '按链、协议、指标和时间区间发现数据表、执行查询并读取结果',
    aliases: ['交易量', '链上数据', '数据分析', '链上分析', '活跃地址', 'volume', 'analytics', 'onchain data', 'on-chain data'],
    required: ['bridge_refresh'], optional: ['capability_search', 'bridge_call'],
    facts: ['chain', 'metric', 'timeRange'], officialSkills: ['https://docs.dune.com/docs/agents/mcp'],
  },
  { id: 'security-check', name: '安全检查', target: 'input-specific',
    description: '按代币、地址、源码或待执行交易选择 GoPlus 风险查询、Slither 分析或 Tenderly 模拟',
    aliases: ['安全', '风险', '漏洞', '审计', '模拟交易', '交易模拟', 'security', 'risk', 'audit', 'simulate'],
    required: [], optional: ['goplus_token_security', 'dev_slither_analyze', 'bridge_refresh', 'capability_search', 'bridge_call'],
    facts: ['securityInput'], officialSkills: ['https://github.com/GoPlusSecurity/goplus-mcp', 'https://github.com/crytic/slither', 'https://tenderly.co/blog/validating-agentic-workflows-with-tenderly-mcp-server/'],
  },
];

export const goplusPublicProvider = 'goplus-public';

export function isTokenSecurityQuery(query: string) {
  return ['erc20', 'token', '代币', 'goplus_token_security'].some((word) => includesAlias(query, word))
    && !/nft|erc721|erc1155|非同质化|钱包|wallet|approval|授权|源码|source|模拟|simulat/i.test(query);
}

export function usesPublicGoPlus(match: ProviderMatch | undefined, provider?: string, query = '') {
  return match?.preset.id === 'goplus' && !match.servers.some((server) => provider
    ? server.name.toLowerCase() === provider.toLowerCase() : includesAlias(query, server.name));
}

function binaryFor(name: string) {
  if (name.startsWith('dev_forge')) return 'forge';
  if (name.startsWith('dev_cast')) return 'cast';
  if (name.startsWith('dev_slither')) return 'slither';
  return undefined;
}

export function metadataFor(tool: ToolDefinition) {
  const name = tool.name; const family = name.split('_')[0]!;
  const binary = binaryFor(name);
  const dependency = name === 'dev_solidity_compile' ? 'solc' : binary && ['forge', 'cast', 'anvil'].includes(binary) ? `@foundry-rs/${binary}` : sources[family];
  const source = dependency ? { type: binary ? 'CLI' : family === 'bridge' ? 'MCP' : 'SDK', name: dependency, version: dependencies[dependency] ?? null,
    official: true, url: `https://www.npmjs.com/package/${dependency}` } : { type: 'adapter', name: family, version: pkg.version, official: false, url: null };
  if (binary === 'slither') Object.assign(source, { type: 'CLI', name: 'slither-analyzer', version: null, official: true, url: 'https://github.com/crytic/slither' });
  if (name === 'goplus_token_security') Object.assign(source, { type: 'HTTP API', name: 'GoPlus Token Security API', version: 'v1', official: true, url: 'https://docs.gopluslabs.io/reference/tokensecurityusingget_1' });
  if (name.startsWith('dev_hardhat')) Object.assign(source, { type: 'CLI', name: 'project-installed hardhat', version: null, official: true, url: 'https://hardhat.org/docs' });
  if (['evm_proxy', 'evm_contract_source'].includes(name)) Object.assign(source, { type: 'SDK/API', name: name === 'evm_proxy' ? 'viem / ERC-1967 / ERC-1167' : 'Sourcify v2 / local compiler artifact / viem', version: dependencies.viem, official: true, url: name === 'evm_proxy' ? 'https://viem.sh' : 'https://docs.sourcify.dev/docs/api/' });
  if (name === 'chainlink_price') Object.assign(source, { type: 'SDK/API', name: 'Chainlink AggregatorV3 / ethers', version: dependencies.ethers, official: true, url: 'https://docs.chain.link/data-feeds' });
  if (/^defillama_/.test(name)) Object.assign(source, { type: 'HTTP API', name: 'DefiLlama API', version: null, official: true, url: 'https://defillama.com/docs/api' });
  if (name === 'jupiter_quote') Object.assign(source, { type: 'HTTP API', name: 'Jupiter Quote API', version: null, official: true, url: 'https://station.jup.ag/docs/apis/swap-api' });
  if (name === 'explorer_abi') Object.assign(source, { type: 'HTTP API', name: 'Etherscan v2 API', version: null, official: true, url: 'https://docs.etherscan.io/etherscan-v2' });
  if (name.startsWith('aa_')) Object.assign(source, { type: 'HTTP API', name: 'ERC-4337 bundler JSON-RPC', version: null, official: true, url: 'https://eips.ethereum.org/EIPS/eip-4337' });
  if (name === 'tx_simulate') Object.assign(source, { type: 'HTTP API', name: 'Tenderly Simulation API', version: null, official: true, url: 'https://docs.tenderly.co/simulations' });
  if (/^nft_/.test(name)) Object.assign(source, { type: 'SDK/API', name: 'ERC-721 / ethers', version: dependencies.ethers, official: true, url: 'https://eips.ethereum.org/EIPS/eip-721' });
  if (name === 'across_quote') Object.assign(source, { type: 'HTTP API', name: 'Across Suggested Fees API', version: null, official: true, url: 'https://docs.across.to' });
  if (name === 'wormhole_tx_status') Object.assign(source, { type: 'HTTP API', name: 'Wormholescan API', version: null, official: true, url: 'https://wormholescan.io' });
  if (name === 'solana_tokens') Object.assign(source, { type: 'JSON-RPC', name: 'Solana getTokenAccountsByOwner', version: null, official: true, url: 'https://solana.com/docs/rpc/http/gettokenaccountsbyowner' });
  if (name === 'subgraph_query') Object.assign(source, { type: 'HTTP API', name: 'The Graph Gateway', version: null, official: true, url: 'https://thegraph.com/docs' });
  return { source, workstations: workstations.filter((station) => [...station.required, ...station.optional].includes(name)).map((station) => station.id),
    targets: /^(goplus_token_security|evm_|viem_|eas_|safe_|project_|chainlink_|explorer_|aa_|tx_simulate|nft_|across_|wormhole_|dev_(forge|cast|solidity|hardhat|slither|erc721)|workstation_diagnose)/.test(name) ? ['evm']
      : family === 'jupiter' ? ['solana'] : ['solana', 'sas'].includes(family) ? ['solana'] : ['sui', 'seal'].includes(family) ? ['sui'] : family === 'aptos' ? ['aptos'] : ['any'],
    impact: name === 'dev_erc721_mint_local' ? ['onchain-submit'] : name === 'dev_forge_deploy_local' ? ['local-files', 'onchain-submit'] : name === 'dev_forge_verify' ? ['source-upload'] :
      /^(dev_(forge|hardhat)|project_|system_setup|bridge_configure)/.test(name) ? ['local-files'] : tool.readOnly ? ['read'] : ['provider-defined-write-or-sign'],
    requirements: { executable: binary ?? null, projectDirectory: /^dev_/.test(name), authorization: tool.readOnly ? 'read' : 'host/operator authorization according to tool schema' } };
}

export async function capabilityStatus(tool: ToolDefinition, config: Config, dir = '.') {
  const name = tool.name; const family = name.split('_')[0]!;
  let status = 'unverified'; let reason = '尚未在当前环境连接或执行该业务';
  const requirements: string[] = [];
  const easLocal = /^eas_(schema_encode|schema_decode|private_data_)/.test(name);
  const group = !easLocal && /^viem_|^evm_(?!status|verify_message)|^eas_|^chainlink_|^workstation_diagnose$/.test(name) ? 'evm' : family === 'ipfs' ? 'ipfs' : undefined;
  if (group && config.issues?.[group]?.length) { status = 'configuration_error'; reason = config.issues[group]!.join('；'); }
  else if (group === 'evm' && (!config.rpcUrl || !config.chainId)) { status = 'configuration_error'; reason = '需要 BCA_RPC_URL / BCA_CHAIN_ID'; requirements.push('BCA_RPC_URL', 'BCA_CHAIN_ID'); }
  else if (group === 'ipfs' && !config.ipfsUrl) { status = 'configuration_error'; reason = '需要 BCA_IPFS_URL'; requirements.push('BCA_IPFS_URL'); }
  else if (/^content_|^capability_|^workstation_(list|search|guide)$|^system_doctor$|^project_init$|^dev_(project|solidity_compile)$|^evm_(status|verify_message)$/.test(name)) { status = 'available'; reason = '本地内置能力；不要求外部账户'; }
  if (easLocal) { status = 'available'; reason = '本地 EAS 编码/PrivateData 功能'; }
  if (name === 'goplus_token_security') { status = 'available'; reason = 'GoPlus 官方公开 EVM 代币风险 API；无需账户，实际覆盖与限流由上游返回'; }
  if (/^defillama_|^jupiter_|^across_|^wormhole_|^solana_tokens$/.test(name)) { status = 'available'; reason = '公开 HTTP API，无需账户；实际覆盖与限流由上游返回'; }
  if (/^nft_/.test(name)) { status = config.rpcUrl && config.chainId ? 'available' : 'configuration_error'; reason = config.rpcUrl && config.chainId ? '走已配置 RPC 直读合约，无需密钥' : '需要 BCA_RPC_URL / BCA_CHAIN_ID'; if (!(config.rpcUrl && config.chainId)) requirements.push('BCA_RPC_URL', 'BCA_CHAIN_ID'); }
  if (family === 'eas' && !tool.readOnly) {
    if (config.issues?.signer?.length) { status = 'configuration_error'; reason = config.issues.signer.join('；'); }
    else if (!config.privateKey || !config.allowWrites) { status = 'missing_authorization'; reason = '需要签署配置与写入许可；全局开关不代表逐笔用户授权'; }
  }
  const binary = binaryFor(name);
  if (binary) {
    const executable = resolveExecutable(binary);
    const found = existsSync(executable) || (process.env.PATH ?? '').split(process.platform === 'win32' ? ';' : ':').some((dir) => existsSync(join(dir, `${binary}${process.platform === 'win32' ? '.exe' : ''}`)));
    status = found ? 'available' : 'not_installed'; reason = found ? '发现程序文件；doctor 另行检测版本，业务仍需验证' : `未安装 ${binary}；执行 setup --install 或安装官方程序`;
    if (!found) requirements.push(binary);
  }
  for (const variable of conditions[family] ?? []) {
    if (!process.env[variable]) { status = /KEY|TOKEN/.test(variable) ? 'missing_authorization' : 'configuration_error'; reason = `需要 ${variable}；未连接`; requirements.push(variable); }
  }
  if (/^dev_hardhat/.test(name)) {
    const cwd = await resolveWorkingDir(config, dir);
    const found = existsSync(join(cwd, 'node_modules/hardhat/package.json'));
    status = found ? 'available' : 'not_installed';
    reason = found ? '项目已安装 Hardhat；业务仍需实际运行' : '目标项目未安装 Hardhat';
    if (!found) requirements.push('hardhat');
  }
  if (['dev_forge_deploy_local', 'dev_erc721_mint_local'].includes(name) && (!config.allowWrites || !config.rpcUrl || !config.chainId)) {
    status = config.allowWrites ? 'configuration_error' : 'missing_authorization'; reason = '需要本机 Anvil RPC/chainId、显式 from、宿主授权及 BCA_ALLOW_WRITES=true';
    if (!config.rpcUrl) requirements.push('BCA_RPC_URL');
    if (!config.chainId) requirements.push('BCA_CHAIN_ID');
    if (!config.allowWrites) requirements.push('BCA_ALLOW_WRITES');
  }
  if (name === 'dev_forge_verify' && !config.allowWrites) { status = 'missing_authorization'; reason = '源码上传需要 BCA_ALLOW_WRITES=true 与 submit=true'; }
  return { name, status, reason, missing: requirements, check: 'configuration-and-local-files' };
}

export const workstationContextSchema = z.strictObject({
  chainFamily: z.string().optional(), chainId: z.string().optional(), hash: z.string().optional(),
  address: z.string().optional(), dir: z.string().optional(), provider: z.string().optional(), contract: z.string().optional(),
  chain: z.string().optional(), protocol: z.string().optional(), metric: z.string().optional(), timeRange: z.string().optional(),
  target: z.string().optional().describe('本地源码文件或项目目录'),
  securityInput: z.enum(['token', 'address', 'source', 'transaction']).optional().describe('token 指 ERC20 合约；address 指钱包或其他地址检查'),
  transaction: z.strictObject({ from: z.string().optional(), to: z.string().optional(), data: z.string().optional(), value: z.string().optional() }).optional(),
  from: z.string().optional(), recipient: z.string().optional(), tokenId: z.string().optional(), tokenUri: z.string().optional(),
  task: z.enum(['compile', 'test', 'deploy', 'develop', 'create', 'mint', 'query', 'security']).optional(),
});
type Context = z.output<typeof workstationContextSchema>;
type Step = { tool: string; input: Record<string, unknown>; purpose: string };
type Plan = { task: string; provider?: string; facts: string[]; mismatches: string[]; steps: Step[]; services?: ProviderMatch[]; missingRequirements?: string[]; request?: Record<string, unknown> };

function taskFor(query: string): Context['task'] {
  if (/部署|deploy/.test(query)) return /编译|测试|compile|build|test/.test(query) ? 'develop' : 'deploy';
  if (/开发|生成|创建|develop|create|generate/.test(query)) return 'develop';
  if (/测试|test/.test(query)) return 'test';
  if (/编译|compile|build/.test(query)) return 'compile';
  return 'develop';
}

export function catalogTools(config: Config, getTools: () => ToolDefinition[]) {
  const statuses = async (names: string[], dir?: string) => Promise.all(names.map(async (name) => {
    const tool = getTools().find((item) => item.name === name);
    return tool ? capabilityStatus(tool, config, dir) : { name, status: 'unsupported', reason: '没有此实现', missing: [name] };
  }));
  function evmMismatches(context: Context, needsRpc: boolean) {
    const mismatches: string[] = [];
    if (context.chainFamily && context.chainFamily.toLowerCase() !== 'evm') mismatches.push(`不支持 ${context.chainFamily} 目标`);
    if (needsRpc && context.chainId && config.chainId && context.chainId !== String(config.chainId)) mismatches.push(`请求链 ${context.chainId} 与配置链 ${config.chainId} 不同；需要明确修改配置`);
    return mismatches;
  }
  async function servicePlan(context: Context, defaultProvider: string, stationId: string, query: string): Promise<Plan> {
    const found = await inspectProviders('', config.workingRoot, context.provider ?? defaultProvider);
    const facts: string[] = []; const mismatches: string[] = [];
    if (found.matches.length !== 1) return { task: stationId, facts: ['provider'], mismatches: [found.ambiguity ?? `无法确定供应商 ${context.provider ?? defaultProvider}`], steps: [] };
    const service = found.matches[0]!;
    if (!service.preset.workstations.includes(stationId)) mismatches.push(`${service.preset.label} 未登记此工作站能力`);
    if (context.chainFamily && !service.preset.chains.length) facts.push('provider chain support');
    else if (context.chainFamily && !service.preset.chains.includes('any') && !service.preset.chains.includes(context.chainFamily.toLowerCase())) mismatches.push(`${service.preset.label} 未登记支持 ${context.chainFamily}`);
    const exactServer = service.servers.find((entry) => entry.name.toLowerCase() === context.provider?.toLowerCase());
    const server = exactServer?.name ?? (service.servers.length === 1 ? service.servers[0]!.name : service.servers.length === 0 ? service.preset.id : undefined);
    if (!server) facts.push('provider 配置名称');
    const steps: Step[] = [];
    if (service.status === 'not_configured' && service.nextCall) steps.push({ ...service.nextCall, purpose: `保存 ${service.preset.label} 连接配置，凭据由操作者设置` });
    if (server && service.status !== 'unavailable') {
      steps.push({ tool: 'bridge_refresh', input: { server }, purpose: '读取实际工具目录；连接错误原样返回' });
      steps.push({ tool: 'capability_search', input: { server, query, details: true }, purpose: '读取本次任务相关工具的真实 Schema，补全参数与调用许可' });
    }
    return { task: stationId, provider: service.preset.id, facts, mismatches, steps, services: [service],
      missingRequirements: [...service.missingEnvironment, ...service.errors, ...(service.status === 'unavailable' ? service.requirements : [])] };
  }
  async function developGuide(context: Context): Promise<Plan> {
    const task = context.task ?? 'develop'; const facts = context.dir ? [] : ['dir'];
    const project = context.dir ? await inspectProject(config, context.dir) : undefined;
    const provider = context.provider?.toLowerCase() ?? project?.selected ?? undefined;
    const mismatches = evmMismatches(context, task === 'deploy' || task === 'develop');
    const steps: Step[] = [];
    if (!['compile', 'test', 'deploy', 'develop'].includes(task)) mismatches.push(`合约开发不支持任务 ${task}`);
    if (!provider) {
      facts.push('provider');
      steps.push({ tool: 'dev_project', input: { dir: context.dir ?? '<dir>' }, purpose: '读取项目，选择已有 Foundry 或 Hardhat' });
    } else if (!['foundry', 'hardhat'].includes(provider)) mismatches.push(`合约开发未支持供应商 ${provider}`);
    else {
      const hardhat = provider === 'hardhat'; const input = { dir: context.dir ?? '<dir>' };
      if (task === 'compile' || task === 'develop') steps.push({ tool: hardhat ? 'dev_hardhat_compile' : 'dev_forge_build', input, purpose: '按项目配置编译' });
      if (task === 'test' || task === 'develop') steps.push({ tool: hardhat ? 'dev_hardhat_test' : 'dev_forge_test', input, purpose: '运行项目测试' });
      if (task === 'deploy' || task === 'develop') {
        if (!context.contract) facts.push('contract'); if (!context.from) facts.push('from');
        if (hardhat) facts.push('existing deployment script / host wallet authorization');
        else steps.push({ tool: 'dev_forge_deploy_local', input: { ...input, contract: context.contract ?? '<path:Contract>', from: context.from ?? '<authorized local address>', submit: true }, purpose: '授权后部署到本机 Anvil，保留回执' });
        steps.push({ tool: 'viem_read', input: { address: '<deployed-address>', abi: ['<actual ABI>'], functionName: '<read-function>' }, purpose: '按实际编译产物 ABI 读取部署结果' });
      }
    }
    return { task, provider, facts, mismatches, steps };
  }
  async function diagnoseGuide(context: Context): Promise<Plan> {
    const facts = [...(!context.hash ? ['hash'] : []), ...(!context.chainId && !config.chainId ? ['chainId'] : [])];
    if (context.provider && !['rpc', 'viem'].includes(context.provider.toLowerCase())) {
      const plan = await servicePlan(context, 'tenderly', 'evm-diagnose', 'debug transaction trace');
      return { ...plan, task: 'diagnose', facts: [...facts, ...plan.facts], request: { hash: context.hash, chainId: context.chainId ?? config.chainId?.toString() } };
    }
    return { task: 'diagnose', provider: context.provider ?? 'rpc', facts, mismatches: evmMismatches(context, true),
      steps: [{ tool: 'workstation_diagnose', input: { hash: context.hash ?? '<hash>' }, purpose: '读取交易、回执、源码与 trace，解释失败原因' }] };
  }
  async function nftGuide(context: Context): Promise<Plan> {
    if (context.task && ['compile', 'test', 'deploy'].includes(context.task)) return developGuide(context);
    if (!context.chainFamily) return { task: 'create', facts: ['chainFamily'], mismatches: [], steps: [] };
    if (context.chainFamily.toLowerCase() === 'solana') return { task: 'create', provider: 'solana-agent-kit', facts: [...(!context.recipient ? ['recipient'] : []), 'metadata', 'NFT action'], mismatches: [],
      steps: [{ tool: 'agent_actions', input: { provider: 'solana-agent-kit' }, purpose: '读取已配置框架的实际 actions，确认 NFTPlugin 和输入 Schema' }],
      missingRequirements: [...(!process.env.BCA_SOLANA_AGENT_MODULE ? ['BCA_SOLANA_AGENT_MODULE', '@solana-agent-kit/plugin-nft 未在默认示例加载；需与 solana-agent-kit 采用兼容版本'] : []), ...(!process.env.BCA_SOLANA_RPC_URL ? ['BCA_SOLANA_RPC_URL'] : [])],
      request: { framework: 'solana-agent-kit', plugin: '@solana-agent-kit/plugin-nft', example: 'examples/agents/solana-agent-kit.mjs', next: '配置兼容 NFTPlugin 后使用 agent_actions 读取实际动作目录' } };
    if (context.chainFamily.toLowerCase() !== 'evm') return { task: context.task ?? 'create', facts: [], mismatches: [`NFT 创建尚未支持 ${context.chainFamily}`], steps: [] };
    if (context.task && !['create', 'develop', 'mint'].includes(context.task)) return { task: context.task, facts: [], mismatches: [`NFT 创建不支持任务 ${context.task}`], steps: [] };
    const task = context.task ?? 'create'; const facts = task === 'mint' || context.dir ? [] : ['dir'];
    const mismatches = evmMismatches(context, true);
    if (context.provider && context.provider.toLowerCase() !== 'foundry') {
      const selected = await inspectProviders('', config.workingRoot, context.provider);
      if (selected.matches.length !== 1 || selected.matches[0]!.preset.id !== 'openzeppelin') mismatches.push(`NFT 模板未支持供应商 ${context.provider}`);
    }
    const dir = context.dir ?? '<new-directory>'; const steps: Step[] = [];
    if (task !== 'mint') {
      steps.push({ tool: 'project_init', input: { dir, template: 'erc721', submit: true }, purpose: '在新目录创建 OpenZeppelin ERC721URIStorage/Ownable 项目' });
      steps.push({ tool: 'project_run', input: { dir, action: 'compile' }, purpose: '编译真实 NFT 合约' });
      steps.push({ tool: 'project_run', input: { dir, action: 'test' }, purpose: '验证铸造、元数据、重复 tokenId 和所有者权限' });
      steps.push({ tool: 'dev_forge_deploy_local', input: { dir, contract: 'src/MyNFT.sol:MyNFT', from: context.from ?? '<local-owner>', submit: true }, purpose: '由已授权本机账户部署到 Anvil，使用返回的 deployedTo' });
    } else if (!context.address) facts.push('address');
    for (const key of ['from', 'recipient', 'tokenId', 'tokenUri'] as const) if (!context[key]) facts.push(key);
    steps.push({ tool: 'dev_erc721_mint_local', input: { address: context.address ?? '<deployedTo>', from: context.from ?? '<local-owner>', recipient: context.recipient ?? '<recipient>', tokenId: context.tokenId ?? '<tokenId>', tokenUri: context.tokenUri ?? '<metadata-uri>', submit: true }, purpose: '铸造并读取该回执区块的 ownerOf/tokenURI；IPFS 元数据可先通过 ipfs_add 上传' });
    steps.push({ tool: 'dev_cast_call', input: { to: context.address ?? '<deployedTo>', signature: 'tokenURI(uint256)(string)', args: [context.tokenId ?? '<tokenId>'] }, purpose: '再次读取真实链上 tokenURI' });
    return { task, provider: 'foundry', facts, mismatches, steps };
  }
  async function dataGuide(context: Context): Promise<Plan> {
    const plan = await servicePlan(context, 'dune', 'onchain-data', 'tables query execute results usage');
    const facts = [...plan.facts];
    if (!context.chain && !context.chainFamily && !context.chainId) facts.push('chain');
    if (!context.metric) facts.push('metric'); if (!context.timeRange) facts.push('timeRange');
    return { ...plan, task: 'query', facts, request: { chain: context.chain ?? context.chainFamily, chainId: context.chainId, protocol: context.protocol, metric: context.metric, timeRange: context.timeRange,
      sequence: ['发现实际数据表及字段', '按链、协议、指标和时间范围准备查询', '核对账户查询权限与 credits 后执行', '按返回的执行标识读取结果，保留服务错误及数据范围'],
      execution: '宿主按真实 Schema 调用 bridge_call；不自动重复提交查询' } };
  }
  async function securityGuide(context: Context): Promise<Plan> {
    const kind = context.securityInput ?? (context.target ? 'source' : context.transaction ? 'transaction' : context.address ? 'address' : undefined);
    if (!kind) return { task: 'security', facts: ['securityInput'], mismatches: [], steps: [] };
    const publicRequested = context.provider?.toLowerCase() === goplusPublicProvider && !(await inspectProviders('', config.workingRoot, context.provider)).matches.length;
    if (publicRequested && kind !== 'token') return { task: 'security', provider: 'goplus', facts: [],
      mismatches: ['GoPlus 公开入口仅支持 ERC20 代币检查，请明确 securityInput 为 token 并提供代币合约地址'], steps: [] };
    if (kind === 'source') {
      const target = context.target ?? context.dir;
      if (context.provider && context.provider.toLowerCase() !== 'slither') {
        const plan = await servicePlan(context, 'slither', 'security-check', 'run detectors solidity project');
        if (plan.provider !== 'slither') plan.mismatches.push('源码分析需要 Slither 或其已配置服务名称');
        return { ...plan, task: 'security', facts: [...plan.facts, ...(!target ? ['target'] : [])], request: { securityInput: kind, target } };
      }
      return { task: 'security', provider: 'slither', facts: target ? [] : ['target'], mismatches: evmMismatches(context, false),
        steps: [{ tool: 'dev_slither_analyze', input: { target: target ?? '<source-path>' }, purpose: '运行真实 Slither，保留官方发现、位置与分析错误' }] };
    }
    if (kind === 'token') {
      const selected = await inspectProviders('', config.workingRoot, publicRequested ? 'goplus' : context.provider ?? 'goplus');
      if (selected.matches.length === 1 && usesPublicGoPlus(selected.matches[0], context.provider)) {
        return { task: 'security', provider: 'goplus', facts: [...(!context.chainId ? ['chainId'] : []), ...(!context.address ? ['address'] : [])],
          mismatches: identifyChains(context.chain ?? '', context.chainFamily).families.filter((family) => family !== 'evm').map((family) => `GoPlus 公开代币查询不支持 ${family} 目标`),
          steps: [{ tool: 'goplus_token_security', input: { chainId: context.chainId ?? '<EVM chainId>', address: context.address ?? '<ERC20 contract address>' }, purpose: '读取官方公开代币风险字段；空数据与上游失败均返回错误' }],
          request: { securityInput: kind, access: 'public', chainId: context.chainId, address: context.address,
            scope: '仅检查 EVM ERC20 代币合约；不检查钱包、授权或待执行交易，缺失字段保留为未提供' } };
      }
    }
    const addressInput = kind === 'address' || kind === 'token';
    const plan = await servicePlan(context, addressInput ? 'goplus' : 'tenderly', 'security-check', kind === 'token' ? 'token security risk' : addressInput ? 'address approval security risk' : 'simulate transaction');
    if (plan.provider !== (addressInput ? 'goplus' : 'tenderly')) plan.mismatches.push(`${addressInput ? '代币或地址风险检查需要 GoPlus' : '待执行交易模拟需要 Tenderly'} 或其已配置服务名称`);
    const facts = [...plan.facts];
    if (!context.chainId && !context.chain) facts.push('chainId');
    if (addressInput && !context.address) facts.push('address');
    if (kind === 'transaction') for (const key of ['from', 'to', 'data', 'value'] as const) if (context.transaction?.[key] === undefined) facts.push(`transaction.${key}`);
    return { ...plan, task: 'security', facts, request: { securityInput: kind, chainId: context.chainId, chain: context.chain, address: context.address, transaction: context.transaction,
      execution: '宿主按工具 Schema 调用 bridge_call，保留各服务原始检查结果及未检查字段；模拟不提交链上交易' } };
  }
  async function guide(id: string, context: Context) {
    const station = workstations.find((item) => item.id === id);
    if (!station) throw new Error('未知工作站');
    const normalizedFamily = identifyChains('', context.chainFamily).families[0];
    context = { ...context, chainFamily: normalizedFamily };
    const plan = await ({ 'evm-develop': developGuide, 'evm-diagnose': diagnoseGuide, 'nft-create': nftGuide, 'onchain-data': dataGuide, 'security-check': securityGuide }[id]!(context));
    const { steps } = plan; const required = [...new Set(steps.map((step) => step.tool))];
    const requiredCapabilities = await statuses(required, context.dir);
    const missing = requiredCapabilities.filter((item) => !['available', 'unverified'].includes(item.status));
    return { id: station.id, name: station.name, task: plan.task, provider: plan.provider ?? null,
      requiredCapabilities, missingCapabilities: missing, factsNeeded: [...new Set(plan.facts)], mismatches: plan.mismatches,
      ...(plan.services ? { services: plan.services } : {}), ...(plan.request ? { request: plan.request } : {}), missingRequirements: plan.missingRequirements ?? [],
      executable: missing.length === 0 && plan.mismatches.length === 0 && plan.facts.length === 0 && !plan.missingRequirements?.length && !(plan.services?.some((service) => service.status !== 'configured')),
      steps, optionalTools: station.optional.filter((name) => !required.includes(name)), officialSkills: station.officialSkills,
      limitation: '只检查本次任务的配置条件；步骤中的占位参数需由宿主补全，写入仍需授权。' };
  }
  return [
    defineTool('capability_list', '列出能力摘要和配置状态；指定 name 或 details=true 才返回完整 Schema 与来源。',
      z.strictObject({ name: z.string().optional(), details: z.boolean().default(false), dir: z.string().default('.') }), true, async ({ name, details, dir }) => {
        const tools = getTools().filter((tool) => !name || tool.name === name);
        if (name && !tools.length) throw new Error(`未知工具：${name}`);
        return Promise.all(tools.map(async (tool) => ({ name: tool.name, description: tool.description, readOnly: tool.readOnly,
          ...(name || details ? { inputSchema: z.toJSONSchema(tool.inputSchema, { io: 'input' }), ...tool.metadata } : {}),
          availability: await capabilityStatus(tool, config, dir) })));
      }),
    defineTool('workstation_list', '列出工作站与可选工具。', z.strictObject({}), true, async () => workstations),
    defineTool('workstation_guide', '按开发、NFT、数据查询或安全检查任务返回对应步骤、实际连接条件与待补参数。',
      z.strictObject({ id: z.string(), context: workstationContextSchema.default({}) }), true, ({ id, context }) => guide(id, context)),
    defineTool('workstation_search', '中英文问题检索；编译和测试不要求部署权限。返回步骤，由宿主执行。',
      z.strictObject({ query: z.string().min(1), context: workstationContextSchema.default({}) }), true, async ({ query, context }) => {
        const normalized = query.toLowerCase();
        const localProvider = context.provider && ['foundry', 'hardhat', 'rpc', 'viem', 'solana-agent-kit'].includes(context.provider.toLowerCase());
        let providers = await inspectProviders(query, config.workingRoot, localProvider ? undefined : context.provider);
        if (context.provider?.toLowerCase() === goplusPublicProvider && !providers.matches.length) providers = await inspectProviders(query, config.workingRoot, 'goplus');
        const identified = identifyChains(`${query} ${context.chain ?? ''}`, context.chainFamily);
        const chains = identified.chains.filter((chain) => chain !== 'evm' || identified.chains.length === 1);
        const chain = chains.length === 1 ? chains[0] : undefined;
        const family = identified.families.length === 1 ? identified.families[0] : undefined;
        const isSecurity = /安全|风险|漏洞|审计|模拟|security|risk|audit|simulat/.test(normalized);
        const isDiagnosis = /失败|报错|回滚|诊断|revert|failed|debug|trace/.test(normalized);
        const isData = /交易量|数据|分析|活跃地址|volume|analytics|on.?chain data/.test(normalized);
        const isNft = /nft|erc721|非同质化/.test(normalized) && !isSecurity && !isData;
        const selected = providers.explicit ? providers.matches.flatMap((match) => match.preset.workstations) : [];
        const selectedProvider = providers.explicit && providers.matches.length === 1 ? providers.matches[0] : undefined;
        const providerName = selectedProvider?.servers.find((server) => selectedProvider.matchedAliases.some((alias) => alias.toLowerCase() === server.name.toLowerCase()))?.name ?? selectedProvider?.preset.id;
        const candidates = [];
        for (const station of workstations) {
          const matches = station.aliases.filter((alias) => normalized.includes(alias.toLowerCase()));
          if (providers.explicit && !selected.includes(station.id)) continue;
          if (!matches.length && !selected.includes(station.id)) continue;
          if (station.id === 'nft-create' && !isNft) continue;
          if (station.id === 'evm-diagnose' && isSecurity && !isDiagnosis) continue;
          if (station.id === 'security-check' && isDiagnosis && !isSecurity) continue;
          if (station.id === 'evm-develop' && (isSecurity || isData || isNft)) continue;
          if (station.id === 'onchain-data' && !isData && !selected.includes(station.id)) continue;
          if (family && family !== 'evm' && station.target === 'evm') continue;
          const inferred = station.id === 'security-check' ? /源码|source|slither/.test(normalized) ? 'source' : /模拟|simulat/.test(normalized) ? 'transaction' : isTokenSecurityQuery(normalized) ? 'token' : /地址|钱包|address|wallet|approval|授权/.test(normalized) ? 'address' : undefined : undefined;
          const details = await guide(station.id, { ...context, chain: context.chain ?? chain ?? (station.id === 'security-check' && chains.length > 1 ? chains.join(' ') : undefined), chainFamily: family,
            provider: context.provider ?? providerName,
            securityInput: context.securityInput ?? inferred,
            task: context.task ?? (station.id === 'evm-develop' || (station.id === 'nft-create' && ['compile', 'test', 'deploy'].includes(taskFor(normalized)!)) ? taskFor(normalized) : station.id === 'nft-create' && /铸造|mint/.test(normalized) ? 'mint' : undefined) });
          candidates.push({ ...details, score: matches.length, reasons: matches, selectable: details.mismatches.length === 0 && details.missingCapabilities.length === 0 });
        }
        candidates.sort((a, b) => Number(b.selectable) - Number(a.selectable) || Number(b.executable) - Number(a.executable) || b.score - a.score);
        const providerAmbiguity = providers.matches.length === 1 && candidates.some((candidate) => candidate.request?.access === 'public') ? null : providers.ambiguity;
        return { candidates, ambiguity: providerAmbiguity ?? (chains.length > 1 && !context.chain ? '检测到多个链，请明确本次范围' : candidates.length > 1 && candidates[0]!.score === candidates[1]!.score ? '请明确本次工作站任务' : null),
          reason: candidates.length ? '按任务及当前配置匹配' : '未匹配已支持任务，请补充目标' };
      }),
  ];
}

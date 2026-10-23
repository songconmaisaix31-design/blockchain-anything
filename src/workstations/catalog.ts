import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { z } from 'zod';
import type { Config } from '../config.js';
import { defineTool, type ToolDefinition } from '../types.js';
import { resolveExecutable } from '../development/exec.js';
import { inspectProject } from '../development/workspace.js';
import { loadMcpServers } from '../bridge/config.js';

const packageRoot = fileURLToPath(new URL('../../', import.meta.url));
const pkg = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'));
const require = createRequire(import.meta.url);
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
};

export type Verification = { scope: string; at: string | null; succeeded: boolean | null };
export const workstations = [
  { id: 'evm-diagnose', name: 'EVM 交易诊断', target: 'evm',
    description: '解释交易为何失败、revert、回执、gas 与合约调用错误',
    aliases: ['交易失败', '交易报错', '交易诊断', '为什么失败', '为什么回滚', '交易回滚', '执行回滚', 'revert', 'failed transaction', 'transaction failed', 'debug transaction', 'tx failed', 'transaction diagnosis'],
    required: ['viem_transaction', 'workstation_diagnose'], optional: ['evm_trace', 'evm_contract_source', 'evm_proxy', 'bridge_call'],
    facts: ['chainId', 'hash'], officialSkills: ['https://getfoundry.sh/cast/reference/run/', 'https://docs.sourcify.dev/docs/api/'],
  },
  { id: 'evm-develop', name: 'EVM 合约开发与验证', target: 'evm',
    description: '生成 ERC20/NFT 或编译、测试、部署、验证 Solidity 合约',
    aliases: ['开发合约', '合约开发', '智能合约', '编译合约', '部署合约', '验证源码', '发行代币', '发一个币', 'erc20', 'erc721', 'nft', 'solidity', 'smart contract', 'deploy contract', 'compile contract', 'test contract', 'foundry', 'hardhat'],
    required: ['dev_project'], optional: ['bridge_call', 'dev_skill_read', 'dev_solidity_compile', 'dev_forge_build', 'dev_forge_test', 'dev_forge_deploy_local', 'dev_hardhat_compile', 'dev_hardhat_test', 'viem_read', 'dev_forge_verify'],
    facts: ['dir'], officialSkills: ['https://github.com/OpenZeppelin/openzeppelin-skills', 'https://getfoundry.sh/forge/overview/'],
  },
];

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
  if (name.startsWith('dev_hardhat')) Object.assign(source, { type: 'CLI', name: 'project-installed hardhat', version: null, official: true, url: 'https://hardhat.org/docs' });
  if (['evm_proxy', 'evm_contract_source'].includes(name)) Object.assign(source, { type: 'SDK/API', name: name === 'evm_proxy' ? 'viem / ERC-1967 / ERC-1167' : 'Sourcify v2 / local compiler artifact / viem', version: dependencies.viem, official: true, url: name === 'evm_proxy' ? 'https://viem.sh' : 'https://docs.sourcify.dev/docs/api/' });
  return { source, workstations: workstations.filter((station) => [...station.required, ...station.optional].includes(name)).map((station) => station.id),
    targets: /^(evm_|viem_|eas_|dev_(forge|cast|solidity|hardhat)|workstation_diagnose)/.test(name) ? ['evm'] : ['provider-specific'],
    impact: name === 'dev_forge_deploy_local' ? ['local-files', 'onchain-submit'] : name === 'dev_forge_verify' ? ['source-upload'] :
      /^(dev_(forge|hardhat)|system_setup)/.test(name) ? ['local-files'] : tool.readOnly ? ['read'] : ['provider-defined-write-or-sign'],
    requirements: { executable: binary ?? null, projectDirectory: /^dev_/.test(name), authorization: tool.readOnly ? 'read' : 'host/operator authorization according to tool schema' } };
}

export async function capabilityStatus(tool: ToolDefinition, config: Config, verified?: Verification) {
  const name = tool.name; const family = name.split('_')[0]!;
  let status = 'unverified'; let reason = '尚未在当前环境连接或执行该业务';
  const requirements: string[] = [];
  const easLocal = /^eas_(schema_encode|schema_decode|private_data_)/.test(name);
  const group = !easLocal && /^viem_|^evm_(?!status|verify_message)|^eas_/.test(name) ? 'evm' : family === 'ipfs' ? 'ipfs' : undefined;
  if (group && config.issues?.[group]?.length) { status = 'configuration_error'; reason = config.issues[group]!.join('；'); }
  else if (group === 'evm' && (!config.rpcUrl || !config.chainId)) { status = 'configuration_error'; reason = '需要 BCA_RPC_URL / BCA_CHAIN_ID'; requirements.push('BCA_RPC_URL', 'BCA_CHAIN_ID'); }
  else if (group === 'ipfs' && !config.ipfsUrl) { status = 'configuration_error'; reason = '需要 BCA_IPFS_URL'; requirements.push('BCA_IPFS_URL'); }
  else if (/^content_|^capability_|^workstation_(list|search|guide)$|^system_doctor$|^dev_(project|solidity_compile)$|^evm_(status|verify_message)$/.test(name)) { status = 'available'; reason = '本地内置能力；不要求外部账户'; }
  if (easLocal) { status = 'available'; reason = '本地 EAS 编码/PrivateData 功能'; }
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
    try { require.resolve('hardhat', { paths: [config.workingRoot] }); status = 'available'; reason = '在当前工作目录发现 Hardhat；子项目请传 dir 后检查'; }
    catch { status = 'not_installed'; reason = '当前根目录未发现 Hardhat；子项目可用 dev_project 明确路径'; }
  }
  if (name === 'dev_forge_deploy_local' && (!config.allowWrites || !config.rpcUrl || !config.chainId)) { status = config.allowWrites ? 'configuration_error' : 'missing_authorization'; reason = '需要本机 Anvil RPC/chainId、显式 from、宿主授权及 BCA_ALLOW_WRITES=true'; }
  if (name === 'dev_forge_verify' && !config.allowWrites) { status = 'missing_authorization'; reason = '源码上传需要 BCA_ALLOW_WRITES=true 与 submit=true'; }
  return { name, status, reason, missing: requirements, checkedAt: new Date().toISOString(), check: 'configuration-and-local-files', connectionVerified: false,
    verification: verified ?? { scope: '当前进程尚未执行；历史验收见 docs/acceptance', at: null, succeeded: null } };
}

const contextSchema = z.strictObject({ chainFamily: z.string().optional(), chainId: z.string().optional(), hash: z.string().optional(), address: z.string().optional(), dir: z.string().optional(), provider: z.string().optional() });

export function catalogTools(config: Config, getTools: () => ToolDefinition[], verified: Map<string, Verification>) {
  const statuses = async (names: string[]) => Promise.all(names.map(async (name) => {
    const tool = getTools().find((item) => item.name === name);
    return tool ? capabilityStatus(tool, config, verified.get(name)) : { name, status: 'unsupported', reason: '没有此实现', missing: [name] };
  }));
  async function guide(id: string, context: z.output<typeof contextSchema>) {
    const station = workstations.find((item) => item.id === id);
    if (!station) throw new Error('未知工作站');
    const facts = station.facts.filter((key) => !context[key as keyof typeof contextSchema.shape] && !(key === 'chainId' && config.chainId));
    const mismatches: string[] = [];
    if (context.chainFamily && context.chainFamily.toLowerCase() !== 'evm') mismatches.push(`不支持 ${context.chainFamily} 目标`);
    if (context.chainId && config.chainId && context.chainId !== String(config.chainId)) mismatches.push(`请求链 ${context.chainId} 与配置链 ${config.chainId} 不同；不自动换链`);
    let provider = context.provider;
    let project: Awaited<ReturnType<typeof inspectProject>> | undefined;
    if (station.id === 'evm-develop' && context.dir) {
      project = await inspectProject(config, context.dir);
      provider ??= project.selected ?? undefined;
      if (project.ambiguity && !provider) facts.push('provider');
    }
    if (station.id === 'evm-develop' && provider && !['foundry', 'hardhat'].includes(provider.toLowerCase())) mismatches.push(`开发工作站未支持供应商 ${provider}`);
    if (station.id === 'evm-diagnose' && provider && !['rpc', 'viem', 'tenderly'].includes(provider.toLowerCase())) mismatches.push(`诊断工作站未映射供应商 ${provider}`);
    const isHardhat = provider?.toLowerCase() === 'hardhat';
    const required = station.id === 'evm-develop' ? [...station.required, ...(isHardhat ? ['dev_hardhat_compile', 'dev_hardhat_test'] : ['dev_forge_build', 'dev_forge_test', 'dev_forge_deploy_local']), 'viem_read'] : [...station.required];
    if (isHardhat) facts.push('existing deployment script / host wallet authorization');
    const requiredCapabilities = await statuses(required);
    const optionalCapabilities = await statuses(station.optional.filter((name) => !required.includes(name)));
    const missing = requiredCapabilities.filter((item) => !['available', 'unverified'].includes(item.status));
    let servers: string[] = [];
    try { servers = Object.keys(await loadMcpServers()); } catch { /* doctor reports config errors */ }
    if (provider?.toLowerCase() === 'tenderly' && !servers.includes('tenderly')) mismatches.push('用户指定 Tenderly，尚未配置该服务；不静默换供应商');
    const steps = station.id === 'evm-diagnose' ? [
      { tool: 'viem_transaction', input: { hash: context.hash ?? '<hash>' }, purpose: '确认交易与回执状态' },
      ...(provider?.toLowerCase() === 'tenderly' ? [{ tool: 'bridge_refresh', input: { server: 'tenderly' }, purpose: '发现授权服务 Schema，由宿主选取实际 trace 工具' }] :
        [{ tool: 'workstation_diagnose', input: { hash: context.hash ?? '<hash>' }, purpose: '汇总匹配源码、代理、trace 证据和缺口' }]),
    ] : [
      { tool: 'dev_project', input: { dir: context.dir ?? '<dir>' }, purpose: '识别已有配置和版本' },
      { tool: 'dev_skill_read', input: { name: '<installed-official-skill>' }, purpose: '需要生成合约时读取已安装官方技能；也可经 bridge_call 调用 OpenZeppelin' },
      { tool: isHardhat ? 'dev_hardhat_compile' : 'dev_forge_build', input: { dir: context.dir ?? '<dir>' }, purpose: '按项目原配置编译' },
      { tool: isHardhat ? 'dev_hardhat_test' : 'dev_forge_test', input: { dir: context.dir ?? '<dir>' }, purpose: '运行相关测试；失败后局部修改复测' },
      ...(!isHardhat ? [{ tool: 'dev_forge_deploy_local', input: { dir: context.dir ?? '<dir>', contract: '<path:Contract>', from: '<authorized local address>', submit: true }, purpose: '宿主确认本地部署意图后执行' }] : []),
      { tool: 'viem_read', input: { address: '<deployed-address>', abi: ['<actual ABI>'], functionName: '<read-function>' }, purpose: '链上读取确认行为' },
    ];
    return { ...station, provider: provider ?? (station.id === 'evm-diagnose' ? 'configured RPC' : 'foundry path proposed; confirm against dev_project'), project, requiredCapabilities, optionalCapabilities, missingCapabilities: missing,
      factsNeeded: facts, mismatches, executable: missing.length === 0 && mismatches.length === 0 && facts.length === 0 && !isHardhat,
      steps, officialSkills: station.officialSkills, configuredMcpServers: servers,
      alternatives: station.id === 'evm-diagnose' ? ['可用本地编译产物替代源码服务', 'RPC trace 不可用时可显式选择已授权 Tenderly；缺历史状态保持部分结果'] : ['保留现有 Hardhat 工程与部署脚本；BCA 可编译/测试，宿主调用原部署脚本', '无链授权时先完成本地编译/测试'],
      lifecycle: { matched: true, planned: mismatches.length === 0, executed: false },
      limitation: isHardhat ? 'Hardhat 部署需宿主执行已有脚本，BCA 未提供统一部署适配器。' : '步骤需要宿主填写真实参数并授权；计划不表示执行完成。' };
  }
  return [
    defineTool('capability_list', '完整工具目录及独立运行状态；默认不连接外部服务。', z.strictObject({ name: z.string().optional() }), true, async ({ name }) => {
      const tools = getTools().filter((tool) => !name || tool.name === name);
      return Promise.all(tools.map(async (tool) => ({ name: tool.name, description: tool.description, inputSchema: z.toJSONSchema(tool.inputSchema, { io: 'input' }), ...metadataFor(tool),
        availability: await capabilityStatus(tool, config, verified.get(tool.name)) })));
    }),
    defineTool('workstation_list', '列出已实现的工作站说明及必要能力，不宣称已执行。', z.strictObject({}), true, async () => workstations),
    defineTool('workstation_guide', '查看工作站真实工具步骤、能力缺口、事实和授权条件。', z.strictObject({ id: z.string(), context: contextSchema.default({}) }), true, ({ id, context }) => guide(id, context)),
    defineTool('workstation_search', '中英文问题检索：返回匹配原因、条件、歧义及下一步；不绑定模型，不自动运行。',
      z.strictObject({ query: z.string().min(1), context: contextSchema.default({}) }), true, async ({ query, context }) => {
        const normalized = query.toLowerCase();
        if (/\b(solana|bitcoin|sui|aptos)\b|索拉纳|比特币/.test(normalized) && !context.chainFamily) return { candidates: [], reason: '当前两个工作站仅支持 EVM；保留其他链工具目录供宿主独立调用', executed: false };
        const candidates = [];
        for (const station of workstations) {
          const matches = station.aliases.filter((alias) => normalized.includes(alias.toLowerCase()));
          if (!matches.length) continue;
          const details = await guide(station.id, context);
          candidates.push({ ...details, score: matches.length, reasons: matches, selectable: details.mismatches.length === 0 && details.missingCapabilities.length === 0 });
        }
        candidates.sort((a, b) => Number(b.selectable) - Number(a.selectable) || Number(b.executable) - Number(a.executable) || b.score - a.score);
        return { candidates, ambiguity: candidates.length > 1 && candidates[0]!.score === candidates[1]!.score ? '多个工作站匹配，请明确诊断现有交易或开发合约' : null,
          reason: candidates.length ? '根据明确任务描述与实际条件匹配；不更改链/钱包/指定供应商' : '未匹配已支持任务，请补充目标；不会强行生成工作站', executed: false };
      }),
  ];
}

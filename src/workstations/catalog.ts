import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { z } from 'zod';
import type { Config } from '../config.js';
import { defineTool, type ToolDefinition } from '../types.js';
import { resolveExecutable } from '../development/exec.js';
import { inspectProject } from '../development/workspace.js';
import { resolveWorkingDir } from '../development/exec.js';
import { loadMcpServers } from '../bridge/config.js';

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
};

export const workstations = [
  { id: 'evm-diagnose', name: 'EVM 交易诊断', target: 'evm',
    description: '解释交易为何失败、revert、回执、gas 与合约调用错误',
    aliases: ['交易失败', '交易报错', '交易诊断', '为什么失败', '为什么回滚', '交易回滚', '执行回滚', 'revert', 'failed transaction', 'transaction failed', 'debug transaction', 'tx failed', 'transaction diagnosis'],
    required: ['viem_transaction', 'workstation_diagnose'], optional: ['evm_trace', 'evm_contract_source', 'evm_proxy', 'bridge_call'],
    facts: ['chainId', 'hash'], officialSkills: ['https://getfoundry.sh/cast/reference/run/', 'https://docs.sourcify.dev/docs/api/'],
  },
  { id: 'evm-develop', name: 'EVM 合约开发与验证', target: 'evm',
    description: '生成 ERC20/NFT 或编译、测试、部署、验证 Solidity 合约',
    aliases: ['开发合约', '合约开发', '智能合约', '编译合约', '测试合约', '合约测试', '部署合约', '验证源码', '发行代币', '发一个币', 'erc20', 'erc721', 'nft', 'solidity', 'smart contract', 'deploy contract', 'compile contract', 'test contract', 'foundry', 'hardhat'],
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

export async function capabilityStatus(tool: ToolDefinition, config: Config, dir = '.') {
  const name = tool.name; const family = name.split('_')[0]!;
  let status = 'unverified'; let reason = '尚未在当前环境连接或执行该业务';
  const requirements: string[] = [];
  const easLocal = /^eas_(schema_encode|schema_decode|private_data_)/.test(name);
  const group = !easLocal && /^viem_|^evm_(?!status|verify_message)|^eas_|^workstation_diagnose$/.test(name) ? 'evm' : family === 'ipfs' ? 'ipfs' : undefined;
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
    const cwd = await resolveWorkingDir(config, dir);
    const found = existsSync(join(cwd, 'node_modules/hardhat/package.json'));
    status = found ? 'available' : 'not_installed';
    reason = found ? '项目已安装 Hardhat；业务仍需实际运行' : '目标项目未安装 Hardhat';
    if (!found) requirements.push('hardhat');
  }
  if (name === 'dev_forge_deploy_local' && (!config.allowWrites || !config.rpcUrl || !config.chainId)) { status = config.allowWrites ? 'configuration_error' : 'missing_authorization'; reason = '需要本机 Anvil RPC/chainId、显式 from、宿主授权及 BCA_ALLOW_WRITES=true'; }
  if (name === 'dev_forge_verify' && !config.allowWrites) { status = 'missing_authorization'; reason = '源码上传需要 BCA_ALLOW_WRITES=true 与 submit=true'; }
  return { name, status, reason, missing: requirements, check: 'configuration-and-local-files' };
}

export const workstationContextSchema = z.strictObject({
  chainFamily: z.string().optional(), chainId: z.string().optional(), hash: z.string().optional(),
  address: z.string().optional(), dir: z.string().optional(), provider: z.string().optional(),
  task: z.enum(['compile', 'test', 'deploy', 'develop']).optional(),
});
type Context = z.output<typeof workstationContextSchema>;

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
  async function guide(id: string, context: Context) {
    const station = workstations.find((item) => item.id === id);
    if (!station) throw new Error('未知工作站');
    const facts = station.facts.filter((key) => !context[key as keyof Context] && !(key === 'chainId' && config.chainId));
    const mismatches: string[] = [];
    if (context.chainFamily && context.chainFamily.toLowerCase() !== 'evm') mismatches.push(`不支持 ${context.chainFamily} 目标`);
    if (context.chainId && config.chainId && context.chainId !== String(config.chainId)) mismatches.push(`请求链 ${context.chainId} 与配置链 ${config.chainId} 不同；不自动换链`);
    const develop = station.id === 'evm-develop';
    const project = develop && context.dir ? await inspectProject(config, context.dir) : undefined;
    const provider = context.provider?.toLowerCase() ?? project?.selected ?? (develop ? undefined : 'rpc');
    if (develop && !provider) facts.push('provider');
    if (provider && !(develop ? ['foundry', 'hardhat'] : ['rpc', 'viem', 'tenderly']).includes(provider)) mismatches.push(`工作站未支持供应商 ${provider}`);
    let servers: string[] = [];
    try { servers = Object.keys(await loadMcpServers()); } catch { /* doctor reports config errors */ }
    if (provider === 'tenderly' && !servers.includes('tenderly')) mismatches.push('尚未配置指定的 Tenderly 服务');

    const task = develop ? context.task ?? 'develop' : 'diagnose';
    const isHardhat = provider === 'hardhat';
    const steps: { tool: string; input: Record<string, unknown>; purpose: string }[] = [];
    if (!develop) {
      steps.push(provider === 'tenderly'
        ? { tool: 'bridge_refresh', input: { server: 'tenderly' }, purpose: '读取真实 Schema，再选取 trace 工具' }
        : { tool: 'workstation_diagnose', input: { hash: context.hash ?? '<hash>' }, purpose: '读取交易、回执、源码和 trace，解释失败原因' });
    } else if (!provider) {
      steps.push({ tool: 'dev_project', input: { dir: context.dir ?? '<dir>' }, purpose: '识别项目并选择 Foundry 或 Hardhat' });
    } else {
      const input = { dir: context.dir ?? '<dir>' };
      if (task === 'compile' || task === 'develop') steps.push({ tool: isHardhat ? 'dev_hardhat_compile' : 'dev_forge_build', input, purpose: '按项目配置编译' });
      if (task === 'test' || task === 'develop') steps.push({ tool: isHardhat ? 'dev_hardhat_test' : 'dev_forge_test', input, purpose: '运行相关测试；失败后局部修复复测' });
      if (task === 'deploy' || task === 'develop') {
        if (isHardhat) facts.push('existing deployment script / host wallet authorization');
        else steps.push({ tool: 'dev_forge_deploy_local', input: { ...input, contract: '<path:Contract>', from: '<authorized local address>', submit: true }, purpose: '补全参数并授权后部署到本机 Anvil' });
        steps.push({ tool: 'viem_read', input: { address: '<deployed-address>', abi: ['<actual ABI>'], functionName: '<read-function>' }, purpose: '读取部署结果' });
      }
    }
    const required = [...new Set(steps.map((step) => step.tool))];
    const requiredCapabilities = await statuses(required, context.dir);
    const missing = requiredCapabilities.filter((item) => !['available', 'unverified'].includes(item.status));
    return { id: station.id, name: station.name, task, provider: provider ?? null,
      requiredCapabilities, missingCapabilities: missing, factsNeeded: facts, mismatches,
      executable: missing.length === 0 && mismatches.length === 0 && facts.length === 0,
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
    defineTool('workstation_guide', '按任务返回步骤与缺项；context.task 可选 compile、test、deploy、develop。',
      z.strictObject({ id: z.string(), context: workstationContextSchema.default({}) }), true, ({ id, context }) => guide(id, context)),
    defineTool('workstation_search', '中英文问题检索；编译和测试不要求部署权限。返回步骤，由宿主执行。',
      z.strictObject({ query: z.string().min(1), context: workstationContextSchema.default({}) }), true, async ({ query, context }) => {
        const normalized = query.toLowerCase();
        if (/\b(solana|bitcoin|sui|aptos)\b|索拉纳|比特币/.test(normalized) && !context.chainFamily) return { candidates: [], reason: '当前工作站仅支持 EVM；其他链可通过工具目录调用' };
        const candidates = [];
        for (const station of workstations) {
          const matches = station.aliases.filter((alias) => normalized.includes(alias.toLowerCase()));
          if (!matches.length) continue;
          const details = await guide(station.id, { ...context, task: context.task ?? taskFor(normalized) });
          candidates.push({ ...details, score: matches.length, reasons: matches, selectable: details.mismatches.length === 0 && details.missingCapabilities.length === 0 });
        }
        candidates.sort((a, b) => Number(b.selectable) - Number(a.selectable) || Number(b.executable) - Number(a.executable) || b.score - a.score);
        return { candidates, ambiguity: candidates.length > 1 && candidates[0]!.score === candidates[1]!.score ? '请明确诊断交易或开发合约' : null,
          reason: candidates.length ? '按任务及当前配置匹配' : '未匹配已支持任务，请补充目标' };
      }),
  ];
}

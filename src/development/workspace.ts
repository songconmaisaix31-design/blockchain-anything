import { readFile, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { parse } from 'smol-toml';
import { z } from 'zod';
import type { Config } from '../config.js';
import { assertConfiguration, requireWrites } from '../config.js';
import { defineTool } from '../types.js';
import { addressSchema, bytesSchema, submitSchema } from '../providers/common.js';
import { withClient } from '../chains/viem.js';
import { parseJsonOutput, resolveWorkingDir, resolveWorkingPath, run } from './exec.js';

export async function inspectProject(config: Config, dir = '.') {
  const cwd = await resolveWorkingDir(config, dir);
  const files = await readdir(cwd);
  const foundry = files.includes('foundry.toml') ? parse(await readFile(join(cwd, 'foundry.toml'), 'utf8')) : null;
  const hardhat = files.filter((file) => /^hardhat\.config\.(ts|js|cjs|mjs)$/.test(file));
  const pkg = files.includes('package.json') ? JSON.parse(await readFile(join(cwd, 'package.json'), 'utf8')) : null;
  return { directory: cwd, foundry, hardhat, dependencies: { ...pkg?.dependencies, ...pkg?.devDependencies },
    selected: foundry && hardhat.length ? null : foundry ? 'foundry' : hardhat.length ? 'hardhat' : null,
    ambiguity: foundry && hardhat.length ? '同时存在 Foundry/Hardhat，请明确本次工具' : null,
    note: '只读取配置，没有执行 Hardhat 配置或替换项目/编译器' };
}

async function contractId(config: Config, cwd: string, contract: string) {
  const match = /^(.+\.sol):([A-Za-z_][A-Za-z0-9_]*)$/.exec(contract);
  if (!match) throw new Error('contract 应为 src/File.sol:Contract');
  const path = await resolveWorkingPath(config, join(cwd, match[1]!));
  return `${relative(cwd, path)}:${match[2]}`;
}

export function workspaceTools(config: Config) {
  return [
    defineTool('dev_project', '读取现有 Foundry/Hardhat 配置、依赖与编译器要求，不执行项目配置。', z.strictObject({ dir: z.string().default('.') }), true,
      ({ dir }) => inspectProject(config, dir)),
    defineTool('dev_hardhat_test', '复用项目已安装 Hardhat 执行 test；可只运行一个测试文件。',
      z.strictObject({ dir: z.string().default('.'), path: z.string().optional() }), false, async ({ dir, path }) => {
        const cwd = await resolveWorkingDir(config, dir);
        const pkg = JSON.parse(await readFile(join(cwd, 'node_modules/hardhat/package.json'), 'utf8'));
        const bin = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin?.hardhat;
        if (!bin) throw new Error('项目未安装 Hardhat CLI');
        const cli = await resolveWorkingPath(config, join(cwd, 'node_modules/hardhat', bin));
        const args = [cli, 'test'];
        if (path) args.push(await resolveWorkingPath(config, join(cwd, path)));
        const result = await run(process.execPath, args, { cwd, timeoutMs: config.timeoutMs });
        return { ...result, taskStatus: result.exitCode === 0 ? 'succeeded' : 'business_failed' };
      }),
    defineTool('dev_forge_deploy_local', '通过官方 forge create 将已有合约部署到本机 Anvil；仅支持 loopback + 31337/1337、显式 unlocked from，确认回执及代码。',
      z.strictObject({ dir: z.string().default('.'), contract: z.string(), from: addressSchema, constructorArgs: z.array(z.string().refine((value) => !value.startsWith('-') || /^-\d+(?:\.\d+)?$/.test(value), '构造参数不能包含 CLI 选项')).default([]), submit: submitSchema }), false,
      async ({ dir, contract, from, constructorArgs }) => {
        requireWrites(config, false); assertConfiguration(config, 'evm');
        const url = new URL(config.rpcUrl ?? 'http://invalid');
        if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || ![31337n, 1337n].includes(config.chainId ?? 0n)) throw new Error('仅支持本机 31337/1337 Anvil；公共链部署交给宿主钱包授权');
        return withClient(config, async (client) => {
          const version = await client.request({ method: 'web3_clientVersion' });
          if (!/anvil/i.test(version)) throw new Error('目标 RPC 未识别为 Anvil');
          const cwd = await resolveWorkingDir(config, dir);
          const args = ['create', await contractId(config, cwd, contract), '--json', '--broadcast', '--unlocked', '--from', from, '--rpc-url', config.rpcUrl!];
          if (constructorArgs.length) args.push('--constructor-args', ...constructorArgs);
          const result = await run('forge', args, { cwd, timeoutMs: config.timeoutMs });
          if (result.exitCode !== 0) return { ...result, taskStatus: 'execution_failed', submissionStatus: 'unknown', next: '查询 from 的 nonce 和交易；不要自动重发' };
          const deployment = parseJsonOutput(result, 'forge create') as { deployedTo: `0x${string}`; transactionHash: `0x${string}` };
          addressSchema.parse(deployment.deployedTo);
          const receipt = await client.getTransactionReceipt({ hash: deployment.transactionHash });
          const code = await client.getBytecode({ address: deployment.deployedTo, blockNumber: receipt.blockNumber });
          return { taskStatus: receipt.status === 'success' && code && code !== '0x' ? 'succeeded' : 'business_failed', deployment, receipt,
            chainId: config.chainId, codePresent: !!code && code !== '0x', network: 'local Anvil', fetchedAt: new Date().toISOString() };
        });
      }),
    defineTool('dev_forge_verify', '调用官方 forge verify-contract --verifier sourcify --watch；会向公共服务上传源码，不签署交易。',
      z.strictObject({ dir: z.string().default('.'), contract: z.string(), address: addressSchema, constructorArgs: bytesSchema.optional(), submit: submitSchema }), false,
      async ({ dir, contract, address, constructorArgs }) => {
        requireWrites(config, false); assertConfiguration(config, 'evm');
        if (!config.chainId) throw new Error('需要 BCA_CHAIN_ID');
        const cwd = await resolveWorkingDir(config, dir);
        const args = ['verify-contract', address, await contractId(config, cwd, contract), '--chain', String(config.chainId), '--verifier', 'sourcify', '--watch'];
        if (constructorArgs) args.push('--constructor-args', constructorArgs);
        const result = await run('forge', args, { cwd, timeoutMs: config.timeoutMs });
        return { ...result, taskStatus: result.exitCode === 0 ? 'succeeded' : 'business_failed', chainId: config.chainId, address, source: 'forge / Sourcify', fetchedAt: new Date().toISOString() };
      }),
  ];
}

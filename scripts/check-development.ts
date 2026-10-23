/**
 * Real-path check for the development tools. It uses the public example
 * projects and the official local CLIs. It never installs dependencies and
 * never deploys a contract.
 *
 * Usage:
 *   npx tsx scripts/check-development.ts
 *
 * Optional:
 *   BCA_CHECK_FOUNDRY_PROJECT, BCA_CHECK_HARDHAT_PROJECT, BCA_CHECK_SKILLS_PROJECT
 *   BCA_RPC_URL, BCA_CHAIN_ID, BCA_CHECK_CAST_ADDRESS (enables the cast check)
 */
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { developmentTools } from '../src/development/index.js';

const repoRoot = resolve(import.meta.dirname, '..');
process.env.BCA_DEVELOPMENT_ROOTS ??= repoRoot;
if (!process.env.BCA_SLITHER_BIN) {
  const candidates = [
    join(repoRoot, '.work', 'pyenv', 'Scripts', 'slither.exe'),
    join(repoRoot, '.work', 'pyenv', 'bin', 'slither'),
  ];
  const local = candidates.find((candidate) => existsSync(candidate));
  if (local) process.env.BCA_SLITHER_BIN = local;
}

const foundryProject = process.env.BCA_CHECK_FOUNDRY_PROJECT ?? 'examples/contracts/foundry';
const hardhatProject = process.env.BCA_CHECK_HARDHAT_PROJECT ?? 'examples/contracts/hardhat';
const skillsProject = process.env.BCA_CHECK_SKILLS_PROJECT ?? '.work/check-skills';

const tools = developmentTools();
const byName = new Map(tools.map((tool) => [tool.name, tool]));
const steps: Array<{ step: string; ok: boolean | null; detail: unknown }> = [];
let failed = false;

async function run(step: string, name: string, input: unknown, required = true): Promise<unknown> {
  const tool = byName.get(name);
  if (!tool) throw new Error(`工具目录缺少 ${name}`);
  try {
    const result = await tool.execute(input);
    steps.push({ step, ok: true, detail: result });
    return result;
  } catch (error) {
    failed ||= required;
    steps.push({ step, ok: false, detail: error instanceof Error ? error.message : String(error) });
    if (required) throw error;
    return null;
  }
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function projectPath(label: string): string {
  return isAbsolute(label) ? label : resolve(repoRoot, label);
}

function json(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => typeof item === 'bigint' ? item.toString() : item, 2);
}

async function main(): Promise<void> {
  if (!existsSync(join(projectPath(foundryProject), 'lib', 'forge-std'))) {
    throw new Error(`Foundry 项目缺少 lib/forge-std；先运行 forge install foundry-rs/forge-std（${foundryProject}）`);
  }
  if (!existsSync(join(projectPath(foundryProject), 'lib', 'openzeppelin-contracts'))) {
    throw new Error(`Foundry 项目缺少 lib/openzeppelin-contracts；先运行 forge install OpenZeppelin/openzeppelin-contracts（${foundryProject}）`);
  }
  if (!existsSync(join(projectPath(hardhatProject), 'node_modules', 'hardhat'))) {
    throw new Error(`Hardhat 项目缺少 node_modules/hardhat；先在 ${hardhatProject} 运行 npm install`);
  }
  await mkdir(isAbsolute(skillsProject) ? skillsProject : resolve(repoRoot, skillsProject), { recursive: true });

  const status = await run('status', 'development_status', {});
  const statusRecord = record(status);
  if (Array.isArray(statusRecord.configErrors) && statusRecord.configErrors.length > 0) {
    failed = true;
    steps.push({ step: 'status config', ok: false, detail: statusRecord.configErrors });
  }

  await run('doctor', 'development_doctor', { project: hardhatProject });

  const build = record(await run('foundry build', 'foundry_build', { project: foundryProject }));
  if (build.success !== true) throw new Error('forge build 未成功');
  if (typeof build.contractCount !== 'number' || build.contractCount < 1) throw new Error('forge build 未返回合约制品');

  const abi = record(await run('foundry inspect abi', 'foundry_inspect', { project: foundryProject, contract: 'BCACounter', field: 'abi' }));
  if (!Array.isArray(abi.value) || abi.value.length < 1) throw new Error('forge inspect 未返回 ABI');

  const forgeTest = record(await run('foundry test', 'foundry_test', { project: foundryProject, matchPath: 'test/BCACounter.t.sol' }));
  if (forgeTest.success !== true) throw new Error('forge test 存在失败');
  const forgeSummary = record(forgeTest.summary);
  if (typeof forgeSummary.tests !== 'number' || forgeSummary.tests < 1) throw new Error('forge test 未执行测试');

  const hardhatCompile = record(await run('hardhat compile', 'hardhat_compile', { project: hardhatProject }));
  if (hardhatCompile.success !== true) throw new Error('hardhat compile 未成功');
  if (typeof hardhatCompile.artifactCount !== 'number' || hardhatCompile.artifactCount < 1) throw new Error('hardhat compile 未返回 artifact');

  const hardhatTest = record(await run('hardhat test', 'hardhat_test', { project: hardhatProject }));
  if (hardhatTest.success !== true) throw new Error('hardhat test 存在失败');

  const slither = record(await run('slither analyze', 'slither_analyze', { project: foundryProject }));
  if (slither.success !== true) throw new Error('slither 分析未成功');

  const catalog = record(await run('skills catalog', 'skills_catalog', {}));
  if (!Array.isArray(catalog.sources) || catalog.sources.length < 7) throw new Error('skills_catalog 未返回 7 个来源');

  const install = record(await run('skills install', 'skills_install', {
    project: skillsProject,
    source: 'openzeppelin',
    skills: ['setup-solidity-contracts'],
    agent: 'opencode',
  }));
  if (!Array.isArray(install.installed) || !install.installed.includes('setup-solidity-contracts')) throw new Error('skills_install 未安装目标技能');

  const list = record(await run('skills list', 'skills_list', { project: skillsProject, agent: 'opencode' }));
  if (!Array.isArray(list.installed) || list.installed.length < 1) throw new Error('skills_list 未发现已安装技能');

  const read = record(await run('skills read', 'skills_read', { project: skillsProject, name: 'setup-solidity-contracts', agent: 'opencode' }));
  if (typeof read.content !== 'string' || !read.content.includes('setup-solidity-contracts')) throw new Error('skills_read 未返回完整 SKILL.md');

  const castAddress = process.env.BCA_CHECK_CAST_ADDRESS;
  if (castAddress && process.env.BCA_RPC_URL && process.env.BCA_CHAIN_ID) {
    const call = record(await run('cast call', 'foundry_call', {
      to: castAddress,
      signature: process.env.BCA_CHECK_CAST_SIGNATURE ?? 'number()(uint256)',
    }));
    if (call.chainId === undefined) throw new Error('cast call 未返回 chain ID');
  } else {
    steps.push({ step: 'cast call', ok: null, detail: '未设置 BCA_RPC_URL、BCA_CHAIN_ID 和 BCA_CHECK_CAST_ADDRESS，未执行' });
  }

  const summary = {
    ok: !failed,
    skipped: steps.filter((step) => step.ok === null).length,
    failed: steps.filter((step) => step.ok === false).length,
    passed: steps.filter((step) => step.ok === true).length,
    steps,
  };
  if (process.env.BCA_CHECK_OUTPUT) {
    await writeFile(resolve(repoRoot, process.env.BCA_CHECK_OUTPUT), `${json(summary)}\n`, 'utf8');
  }
  process.stdout.write(`${json(summary)}\n`);
  if (failed) process.exitCode = 1;
}

main().catch((error: unknown) => {
  process.stderr.write(`${json({ ok: false, error: error instanceof Error ? error.message : String(error) })}\n`);
  process.exitCode = 1;
});

import { readdir, realpath, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import type { DevelopmentConfig } from './config.js';
import { relativeToRoot, resolveProject } from './config.js';
import { assertInside, listFiles, makeDevTool, parseJson, readTextFile, relativePath } from './helpers.js';
import { resolveNpxCli, runCommand, stripAnsi } from './process.js';

const AGENT_IDS = ['opencode', 'claude-code', 'codex', 'cursor'] as const;
type AgentId = typeof AGENT_IDS[number];
const AGENT_DIRS: Record<AgentId, string> = {
  opencode: '.agents/skills',
  'claude-code': '.claude/skills',
  codex: '.codex/skills',
  cursor: '.cursor/skills',
};

const SOURCE_IDS = [
  'openzeppelin',
  'trailofbits',
  'goplus',
  'alchemy',
  'uniswap',
  'allium',
  'heurist',
] as const;
type SourceId = typeof SOURCE_IDS[number];

export interface SkillSource {
  id: SourceId;
  title: string;
  repo: string;
  url: string;
  verifiedRef: string;
  license: string;
  skills: string[];
  notes: string;
}

export const SKILL_SOURCES: readonly SkillSource[] = [
  {
    id: 'openzeppelin',
    title: 'OpenZeppelin Skills',
    repo: 'OpenZeppelin/openzeppelin-skills',
    url: 'https://github.com/OpenZeppelin/openzeppelin-skills',
    verifiedRef: '6f215af60eb60017ab1a933ce9d22a479cd42b26',
    license: 'AGPL-3.0',
    notes: '官方 Contracts 开发、项目初始化与升级技能；AGPL 条款需在使用/分发前确认。',
    skills: [
      'develop-secure-contracts',
      'review-sui-contracts',
      'setup-cairo-contracts',
      'setup-solidity-contracts',
      'setup-stellar-contracts',
      'setup-stylus-contracts',
      'setup-sui-contracts',
      'upgrade-cairo-contracts',
      'upgrade-solidity-contracts',
      'upgrade-stellar-contracts',
      'upgrade-stylus-contracts',
    ],
  },
  {
    id: 'trailofbits',
    title: 'Trail of Bits Skills',
    repo: 'trailofbits/skills',
    url: 'https://github.com/trailofbits/skills',
    verifiedRef: '196a9073ab10d35bacf111f945e02c00b2c6883a',
    license: 'CC-BY-SA-4.0',
    notes: '官方安全审计 marketplace；这里只登记与 Solidity 开发/审计直接相关的子集，实际仓库还包含更多非 EVM 技能。',
    skills: [
      'entry-point-analyzer',
      'token-integration-analyzer',
      'guidelines-advisor',
      'audit-prep-assistant',
      'secure-workflow-guide',
      'property-based-testing',
      'variant-analysis',
      'differential-review',
    ],
  },
  {
    id: 'goplus',
    title: 'GoPlus Security Skills',
    repo: 'GoPlusSecurity/skills',
    url: 'https://github.com/GoPlusSecurity/skills',
    verifiedRef: 'd6e6072f8edba0191355abb0db0dabae8b9cad58',
    license: 'Apache-2.0',
    notes: '技能依赖 GoPlus MCP 与 API 凭据；MCP 连接由 M 轨道负责，本项目只提供官方技能安装/读取入口。',
    skills: [
      'token-risk-scanner',
      'safe-token-factory',
      'malicious-address-detection',
      'approval-security-detection',
      'phishing-site-detection',
      'transaction-simulation',
    ],
  },
  {
    id: 'alchemy',
    title: 'Alchemy Skills',
    repo: 'alchemyplatform/skills',
    url: 'https://github.com/alchemyplatform/skills',
    verifiedRef: '4caf3e555c3af8dbb9e5b540aed558aef986d885',
    license: 'MIT',
    notes: '包含 API、CLI、MCP 与无密钥 agentic-gateway 路径；MCP 连接由 M 轨道负责。',
    skills: ['alchemy-api', 'alchemy-cli', 'alchemy-mcp', 'agentic-gateway', 'allium', 'opensea'],
  },
  {
    id: 'uniswap',
    title: 'Uniswap AI Skills',
    repo: 'Uniswap/uniswap-ai',
    url: 'https://github.com/Uniswap/uniswap-ai',
    verifiedRef: '1a43e968a39537d5a73aeca20dd1ed9d96f502fa',
    license: 'MIT',
    notes: '官方 v4 hook、swap 集成、viem 与流动性规划技能；不执行真实交易。',
    skills: [
      'swap-integration',
      'v4-security-foundations',
      'v4-hook-generator',
      'viem-integration',
      'liquidity-planner',
      'swap-planner',
    ],
  },
  {
    id: 'allium',
    title: 'Allium Skills',
    repo: 'allium-labs/skills',
    url: 'https://github.com/allium-labs/skills',
    verifiedRef: 'e55c69c22da2b80dd5f4478cf249a1cdb0948b64',
    license: '未声明（上游仓库无 LICENSE 文件）',
    notes: '官方分析工作流技能；数据访问依赖 Allium CLI 或 Allium MCP。使用前请向上游确认许可。',
    skills: [
      'allium-data',
      'allium-investigation',
      'data-matching',
      'bridge-analysis',
      'dex-analysis',
      'lending-analysis',
      'rwa-analysis',
      'stablecoin-analysis',
      'alchemy-api',
      'alchemy-agentic-gateway',
    ],
  },
  {
    id: 'heurist',
    title: 'Heurist Mesh Skill',
    repo: 'heurist-network/heurist-mesh-skill',
    url: 'https://github.com/heurist-network/heurist-mesh-skill',
    verifiedRef: 'f116a8423010e06f500b89c94d490ed79ad12945',
    license: '未声明（上游仓库无 LICENSE 文件）',
    notes: '官方 Mesh 技能；API key 或 x402 支付由调用者配置。使用前请向上游确认许可。',
    skills: ['heurist-mesh-skill'],
  },
];

function sourceById(id: SourceId): SkillSource {
  const source = SKILL_SOURCES.find((entry) => entry.id === id);
  if (!source) throw new Error(`未知的官方技能来源：${id}`);
  return source;
}

function skillsDirectory(projectPath: string, agent: AgentId): string {
  return join(projectPath, AGENT_DIRS[agent]);
}

async function resolveInstalledSkill(projectPath: string, agent: AgentId, name: string): Promise<{ directory: string; relative: string }> {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) throw new Error('技能名称只能包含小写字母、数字和连字符');
  const skillsDir = skillsDirectory(projectPath, agent);
  const candidate = resolve(skillsDir, name);
  assertInside(projectPath, candidate);
  const resolved = await realpath(candidate);
  assertInside(projectPath, resolved);
  if (!(await stat(resolved)).isDirectory()) throw new Error(`未安装技能：${name}`);
  return { directory: resolved, relative: relativePath(projectPath, resolved) };
}

async function readLock(projectPath: string): Promise<{ lock: unknown; error: string | null }> {
  const path = join(projectPath, 'skills-lock.json');
  try {
    const info = await stat(path);
    if (!info.isFile()) return { lock: null, error: 'skills-lock.json 不是普通文件' };
    const text = (await readTextFile(path, 2 * 1024 * 1024)).content;
    return { lock: parseJson<unknown>(text, 'skills-lock.json'), error: null };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { lock: null, error: null };
    return { lock: null, error: error instanceof Error ? error.message : String(error) };
  }
}

export function skillsTools(dev: DevelopmentConfig) {
  const config = dev.base;
  return [
    makeDevTool(config, 'skills_catalog',
      '列出已核对的官方 Agent Skills 来源、固定 ref、许可证和可用技能名称；不联网、不返回技能正文。',
      z.strictObject({}), true,
      async () => ({
        verifiedAt: '2026-10-23',
        installer: {
          command: `npx -y skills@${dev.skillsVersion} add <repo> --skill <name> --agent <agent> --copy --yes`,
          version: dev.skillsVersion,
          package: 'https://www.npmjs.com/package/skills',
          scope: 'project-local（默认不写用户全局目录）',
          agents: AGENT_IDS.map((id) => ({ id, directory: AGENT_DIRS[id] })),
        },
        sources: SKILL_SOURCES,
      })),
    makeDevTool(config, 'skills_install',
      '在配置的项目内用官方 skills CLI 安装指定官方技能（项目局部副本），返回实际来源 ref、许可证和安装结果；不写全局 Agent 配置。',
      z.strictObject({
        project: z.string().min(1).max(1024).describe('安装技能的项目目录（相对 BCA_DEVELOPMENT_ROOTS）'),
        source: z.enum(SOURCE_IDS).describe('官方技能来源 id'),
        skills: z.array(z.string().min(1).max(100)).min(1).max(20).describe('该来源中已登记的技能名称'),
        agent: z.enum(AGENT_IDS).default('opencode').describe('项目局部技能目录对应的 Agent'),
      }), false,
      async ({ project, source: sourceId, skills, agent }) => {
        const source = sourceById(sourceId);
        const unknown = skills.filter((name) => !source.skills.includes(name));
        if (unknown.length > 0) throw new Error(`该来源未登记以下技能：${unknown.join(', ')}`);
        const resolved = await resolveProject(dev, project);
        const npxCli = await resolveNpxCli();
        const repoUrl = `https://github.com/${source.repo}.git`;
        let resolvedRef: string | null = null;
        try {
          const ref = await runCommand('git', ['ls-remote', repoUrl, 'HEAD'], {
            cwd: resolved.path,
            timeoutMs: 60_000,
            maxOutputBytes: 64 * 1024,
          });
          const match = ref.code === 0 ? /^([0-9a-f]{40})\s+HEAD$/m.exec(ref.stdout) : null;
          resolvedRef = match?.[1] ?? null;
        } catch {
          resolvedRef = null;
        }
        const args = [
          '-y',
          `skills@${dev.skillsVersion}`,
          'add',
          source.repo,
          ...skills.flatMap((name) => ['--skill', name]),
          '--agent',
          agent,
          '--copy',
          '--yes',
        ];
        const result = await runCommand(process.execPath, [npxCli, ...args], {
          cwd: resolved.path,
          timeoutMs: Math.min(900_000, Math.max(dev.timeoutMs, 600_000)),
          maxOutputBytes: dev.maxOutputBytes,
        });
        const output = stripAnsi(`${result.stdout}${result.stderr}`).trim();
        if (result.code !== 0) {
          throw new Error(`官方 skills CLI 安装失败（退出码 ${result.code}）：${output.slice(-2000)}`);
        }
        const installDirectory = skillsDirectory(resolved.path, agent);
        const installed: string[] = [];
        for (const name of skills) {
          try {
            await stat(join(installDirectory, name, 'SKILL.md'));
            installed.push(name);
          } catch {
            // Report the incomplete installation below instead of claiming success.
          }
        }
        if (installed.length !== skills.length) {
          const missing = skills.filter((name) => !installed.includes(name));
          throw new Error(`安装命令返回成功，但以下技能缺少 SKILL.md：${missing.join(', ')}`);
        }
        return {
          project: relativeToRoot(resolved.root, resolved.path),
          source: { id: source.id, repo: source.repo, verifiedRef: source.verifiedRef, license: source.license },
          resolvedRef,
          resolvedRefNote: resolvedRef ? null : 'git ls-remote 未取得实际 ref；安装内容以 skills-lock.json 的 hash 为准',
          agent,
          installDirectory: relativePath(resolved.path, installDirectory),
          installed,
          output: output.slice(-4000),
        };
      }),
    makeDevTool(config, 'skills_list',
      '发现项目内已安装的官方 Agent Skills（按目录与 SKILL.md 判断），并读取官方 skills-lock.json 的来源/hash；不解析 YAML。',
      z.strictObject({
        project: z.string().min(1).max(1024),
        agent: z.enum(AGENT_IDS).default('opencode'),
      }), true,
      async ({ project, agent }) => {
        const resolved = await resolveProject(dev, project);
        const directory = skillsDirectory(resolved.path, agent);
        const installed: Array<Record<string, unknown>> = [];
        try {
          const entries = await readdir(directory, { withFileTypes: true });
          entries.sort((left, right) => left.name.localeCompare(right.name));
          for (const entry of entries) {
            if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
            if (!/^[a-z0-9][a-z0-9-]*$/.test(entry.name)) continue;
            const skillDirectory = resolve(directory, entry.name);
            let realDirectory: string;
            try {
              realDirectory = await realpath(skillDirectory);
              assertInside(resolved.path, realDirectory);
              if (!(await stat(realDirectory)).isDirectory()) continue;
            } catch {
              installed.push({ name: entry.name, error: '目录不可访问或超出项目根目录' });
              continue;
            }
            let bytes = 0;
            let hasSkillMd = false;
            try {
              bytes = (await stat(join(realDirectory, 'SKILL.md'))).size;
              hasSkillMd = true;
            } catch {
              hasSkillMd = false;
            }
            const listing = await listFiles(realDirectory, 500);
            installed.push({ name: entry.name, hasSkillMd, skillMdBytes: bytes, files: listing.files.length, truncated: listing.truncated });
          }
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
        const lock = await readLock(resolved.path);
        return {
          project: relativeToRoot(resolved.root, resolved.path),
          agent,
          skillsDirectory: relativePath(resolved.path, directory),
          installed,
          lock: lock.lock,
          lockError: lock.error,
        };
      }),
    makeDevTool(config, 'skills_read',
      '读取项目内已安装官方 Skill 的完整 SKILL.md 或指定参考文件，并列出同目录文件与许可证文件；不解析或执行技能指令。',
      z.strictObject({
        project: z.string().min(1).max(1024),
        name: z.string().min(1).max(100).describe('已安装技能名称'),
        agent: z.enum(AGENT_IDS).default('opencode'),
        file: z.string().min(1).max(512).optional().describe('技能目录内的相对文件；默认 SKILL.md'),
      }), true,
      async ({ project, name, agent, file }) => {
        const resolved = await resolveProject(dev, project);
        const skill = await resolveInstalledSkill(resolved.path, agent, name);
        const relativeFile = file ?? 'SKILL.md';
        if (relativeFile.startsWith('/') || relativeFile.startsWith('\\') || relativeFile.split(/[\\/]/).includes('..')) {
          throw new Error('file 必须是技能目录内的相对路径');
        }
        const target = resolve(skill.directory, relativeFile);
        assertInside(skill.directory, target);
        const realTarget = await realpath(target);
        assertInside(skill.directory, realTarget);
        const info = await stat(realTarget);
        if (!info.isFile()) throw new Error('file 必须指向普通文件');
        const maxBytes = relativeFile === 'SKILL.md'
          ? Math.min(dev.maxFileBytes, 4 * 1024 * 1024)
          : dev.maxReadBytes;
        const content = await readTextFile(realTarget, maxBytes);
        const listing = await listFiles(skill.directory, 500);
        const licenseEntry = listing.files.find((entry) => /^LICENSE(?:\.|$)/i.test(entry.path));
        let licenseText: string | null = null;
        let licenseFile: string | null = null;
        if (licenseEntry && licenseEntry.bytes <= 64 * 1024) {
          licenseFile = licenseEntry.path;
          licenseText = (await readTextFile(join(skill.directory, licenseEntry.path), 64 * 1024)).content;
        }
        return {
          project: relativeToRoot(resolved.root, resolved.path),
          agent,
          name,
          file: relativeFile.split('\\').join('/'),
          path: relativePath(resolved.path, realTarget),
          bytes: content.bytes,
          content: content.content,
          files: listing.files,
          truncated: listing.truncated,
          licenseFile,
          licenseText,
        };
      }),
  ];
}

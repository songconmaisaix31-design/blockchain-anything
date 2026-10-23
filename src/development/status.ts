import { z } from 'zod';
import type { DevelopmentConfig } from './config.js';
import { describeRoots, resolveProject, relativeToRoot } from './config.js';
import { findHardhatCli, hasHardhatConfig } from './hardhat.js';
import { makeDevTool } from './helpers.js';
import { probeCommand, resolveNpxCli } from './process.js';
import { SKILL_SOURCES } from './skills.js';
import { slitherEnvironment } from './slither.js';

export function statusTools(dev: DevelopmentConfig) {
  const config = dev.base;
  return [
    makeDevTool(config, 'development_status',
      '读取开发工具配置状态：允许的项目根目录、官方 CLI、技能来源与限制；不联网，不执行工具。',
      z.strictObject({}), true,
      async () => ({
        workingRoot: dev.base.workingRoot,
        rootsSource: dev.rootsSource,
        roots: await describeRoots(dev),
        binaries: {
          forge: dev.forgeBin,
          cast: dev.castBin,
          slither: dev.slitherBin,
          hardhat: '项目本地 node_modules/hardhat（由 hardhat_compile/hardhat_test 解析）',
        },
        skills: {
          installerPackage: 'skills',
          installerVersion: dev.skillsVersion,
          verifiedAt: '2026-10-23',
          sources: SKILL_SOURCES.map((source) => ({
            id: source.id,
            repo: source.repo,
            verifiedRef: source.verifiedRef,
            license: source.license,
            skillCount: source.skills.length,
          })),
        },
        limits: { timeoutMs: dev.timeoutMs, maxOutputBytes: dev.maxOutputBytes, maxReadBytes: dev.maxReadBytes },
        configErrors: dev.errors,
        connectionVerified: false,
        verification: '状态仅表示配置；development_doctor、foundry_build、hardhat_compile、slither_analyze 执行实际检查',
      })),
    makeDevTool(config, 'development_doctor',
      '实际探测官方 Forge、Cast、Slither 与项目内 Hardhat CLI 是否可执行，并检查官方 skills CLI；需要项目时只接受配置根目录内的目录。',
      z.strictObject({
        project: z.string().min(1).max(1024).optional().describe('可选：同时检查该 Hardhat 项目的本地 CLI'),
      }), true,
      async ({ project }) => {
        let projectPath: string | null = null;
        let projectLabel: string | null = null;
        if (project) {
          const resolved = await resolveProject(dev, project);
          projectPath = resolved.path;
          projectLabel = relativeToRoot(resolved.root, resolved.path);
        }
        const cwd = projectPath ?? dev.base.workingRoot;
        const [forge, cast, slither] = await Promise.all([
          probeCommand(dev.forgeBin, ['--version'], cwd),
          probeCommand(dev.castBin, ['--version'], cwd),
          probeCommand(dev.slitherBin, ['--help'], cwd, 20_000, 256 * 1024, slitherEnvironment(dev.slitherBin)),
        ]);
        let hardhat: Record<string, unknown> = { available: null, skipped: true, error: '未提供 project' };
        if (projectPath) {
          if (!(await hasHardhatConfig(projectPath))) {
            hardhat = { available: false, error: '项目缺少 hardhat.config.ts/js/mjs/cjs' };
          } else {
            try {
              const cli = await findHardhatCli(projectPath);
              hardhat = { ...(await probeCommand(process.execPath, [cli, '--version'], projectPath)), cli: '项目本地 node_modules/hardhat' };
            } catch (error) {
              hardhat = { available: false, error: error instanceof Error ? error.message : String(error) };
            }
          }
        }
        let skills: Record<string, unknown>;
        try {
          const npxCli = await resolveNpxCli();
          skills = { ...(await probeCommand(process.execPath, [npxCli, '-y', `skills@${dev.skillsVersion}`, '--version'], cwd, 120_000)), npxCliFound: true };
        } catch (error) {
          skills = { available: false, npxCliFound: false, error: error instanceof Error ? error.message : String(error) };
        }
        return {
          project: projectLabel,
          cwd,
          checks: { forge, cast, slither, hardhat, skills },
          allAvailable: forge.available && cast.available && slither.available && skills.available === true && hardhat.available !== false,
          configErrors: dev.errors,
        };
      }),
  ];
}

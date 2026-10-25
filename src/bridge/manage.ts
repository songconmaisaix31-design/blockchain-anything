import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import type { Config } from '../config.js';
import { defineTool } from '../types.js';
import { submitSchema } from '../providers/common.js';
import { resolveWorkingDir } from '../development/exec.js';
import { textOrEmpty, replaceWithBackup } from '../project-files.js';
import { MCP_PRESETS } from './config.js';

export const connectSchema = z.strictObject({
  preset: z.string().min(1), name: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/).optional(),
  keyEnv: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/).optional().describe('API key 环境变量名；不传密钥值'),
  header: z.string().regex(/^[A-Za-z0-9-]+$/).optional(),
  oauth: z.boolean().default(false).describe('用固定版本 mcp-remote 桥接 OAuth，首次调用时登录'), submit: submitSchema,
});

export function bridgeManagementTools(config: Config) {
  return [defineTool('bridge_configure', '将官方 MCP 预设写入项目 .bca/mcp.json，保留原条目；下次发现读取真实上游工具。', connectSchema, false,
    async ({ preset: id, name = id, keyEnv, header, oauth }) => {
      if (process.env.BCA_MCP_CONFIG || process.env.BCA_MCP_SERVERS) throw new Error('当前使用外部 MCP 配置；请先编辑该配置或移除环境覆盖，再使用项目 connect');
      const preset = MCP_PRESETS.find((item) => item.id === id);
      if (!preset) throw new Error('未知预设；使用 bca bridge servers --input {} 查看可接入服务');
      if (!preset.url && !preset.command) throw new Error(`${preset.label} 需要按官方文档配置本机命令：${preset.docs}`);
      if (!!keyEnv !== !!header) throw new Error('keyEnv 和 header 必须一起提供');
      if (keyEnv && !preset.url) throw new Error('请求头认证仅适用于 HTTP 服务；stdio 服务请在配置中设置 env');
      if (oauth && (!preset.url || keyEnv)) throw new Error('OAuth 需要托管服务地址，不能同时配置 API key');
      const root = await resolveWorkingDir(config);
      await mkdir(join(root, '.bca'), { recursive: true });
      const directory = await resolveWorkingDir(config, '.bca');
      const path = join(directory, 'mcp.json');
      const document = JSON.parse(await textOrEmpty(path) || '{"mcpServers":{}}');
      if (!document || typeof document !== 'object' || Array.isArray(document) || !document.mcpServers || typeof document.mcpServers !== 'object' || Array.isArray(document.mcpServers)) throw new Error('.bca/mcp.json 需要 mcpServers 对象');
      const entry = { preset: id,
        ...(oauth ? { command: 'npx', args: ['-y', 'mcp-remote@0.15.2', preset.url!] } : {}),
        ...(keyEnv && header ? { headers: { [header]: `\${${keyEnv}}` } } : {}) };
      // Existing user headers, transport overrides and read-only permissions stay intact.
      if (Object.hasOwn(document.mcpServers, name) && JSON.stringify(document.mcpServers[name]) !== JSON.stringify(entry)) throw new Error(`服务 ${name} 已存在不同配置；请编辑 .bca/mcp.json 或选择新 name`);
      Object.defineProperty(document.mcpServers, name, { value: entry, enumerable: true, configurable: true, writable: true });
      const change = await replaceWithBackup(path, JSON.stringify(document, null, 2) + '\n');
      return { taskStatus: 'succeeded', name, change, docs: preset.docs, auth: preset.auth,
        missingEnvironment: keyEnv && !process.env[keyEnv] ? [keyEnv] : [],
        nextCall: { tool: 'bridge_refresh', input: { server: name } },
        note: '配置已保存；连接和业务在实际调用时检查，新增工具不会自动获得写权限。' };
    })];
}

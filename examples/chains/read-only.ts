/**
 * 链与存储工具的直接 TypeScript 调用示例。
 *
 * 只调用已配置的服务；未配置的项目会打印真实错误并继续下一项。
 * 不执行任何写入、交易签名或付费存储。
 *
 *   npx tsx examples/chains/read-only.ts
 */
import { chainStorageTools } from '../../src/chains/index.js';

const tools = chainStorageTools();
const byName = new Map(tools.map((tool) => [tool.name, tool]));

console.log(JSON.stringify({ tools: tools.map((tool) => ({ name: tool.name, readOnly: tool.readOnly })) }, null, 2));

const checks: Array<{ tool: string; input: unknown }> = [
  { tool: 'viem_chain', input: {} },
  { tool: 'sign_status', input: {} },
  { tool: 'sui_status', input: {} },
  { tool: 'aptos_status', input: {} },
  { tool: 'sas_status', input: {} },
  { tool: 'walrus_status', input: {} },
  { tool: 'seal_status', input: {} },
  { tool: 'arweave_status', input: {} },
];

for (const check of checks) {
  const tool = byName.get(check.tool);
  if (!tool) throw new Error(`工厂缺少工具 ${check.tool}`);
  try {
    const result = await tool.execute(check.input);
    console.log(JSON.stringify({ tool: check.tool, ok: true, result }));
  } catch (error) {
    console.log(JSON.stringify({ tool: check.tool, ok: false, error: error instanceof Error ? error.message : String(error) }));
  }
}

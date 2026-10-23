import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { bridgeTools } from '../src/bridge/index.js';
import type { ToolImplementation } from '../src/types.js';

const { values } = parseArgs({
  options: {
    config: { type: 'string' },
    provider: { type: 'string' },
    call: { type: 'string' },
    input: { type: 'string' },
    public: { type: 'boolean', default: false },
    verbose: { type: 'boolean', default: false },
  },
});

const tools = new Map<string, ToolImplementation>(bridgeTools().map((tool) => [tool.name, tool]));
function tool(name: string): ToolImplementation {
  const found = tools.get(name);
  assert(found, `bridge 缺少工具 ${name}`);
  return found;
}
const invoke = async (name: string, input: unknown): Promise<any> => tool(name).execute(input);

if (values.config) process.env.BCA_MCP_SERVERS = resolve(values.config);

function textLength(value: unknown): number {
  return JSON.stringify(value).length;
}

async function checkProvider(provider: string) {
  const status = await invoke('services_status', { provider });
  const listed = await invoke('services_list_tools', { provider, allPages: true });
  return {
    provider,
    server: status.server,
    protocolVersion: status.protocolVersion,
    tools: listed.count,
    pages: listed.pages,
    nextCursor: listed.nextCursor,
    truncated: listed.truncated,
  };
}

async function runPublicChecks() {
  await mkdir(resolve('.work'), { recursive: true });
  const configPath = resolve('.work/check-services-public.json');
  await writeFile(
    configPath,
    JSON.stringify(
      {
        mcpServers: {
          coingecko: { type: 'http', url: 'https://mcp.api.coingecko.com/mcp' },
          openzeppelin: { type: 'http', url: 'https://mcp.openzeppelin.com/contracts/solidity/mcp' },
          chainstack: { type: 'http', url: 'https://mcp.chainstack.com/mcp' },
        },
      },
      null,
      2,
    ),
  );
  process.env.BCA_MCP_SERVERS = configPath;

  const failures: string[] = [];
  const results: unknown[] = [];
  for (const provider of ['coingecko', 'openzeppelin', 'chainstack']) {
    try {
      results.push(await checkProvider(provider));
    } catch (error) {
      failures.push(`${provider} initialize/tools/list: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const calls = [
    {
      provider: 'coingecko',
      tool: 'execute',
      input: {
        code: "async function run(client) { return await client.simple.price.get({ vs_currencies: 'usd', ids: 'bitcoin' }); }",
        intent: 'BCA services check',
      },
    },
    {
      provider: 'openzeppelin',
      tool: 'solidity-erc20',
      input: { name: 'BCA Check Token', symbol: 'BCAC' },
    },
    {
      provider: 'chainstack',
      tool: 'get_platform_status',
      input: {},
    },
  ];

  for (const item of calls) {
    try {
      const callResult = await invoke('services_call_tool', {
        provider: item.provider,
        tool: item.tool,
        arguments: item.input,
        confirmSideEffects: true,
      });
      results.push({
        provider: item.provider,
        tool: item.tool,
        resultBytes: textLength(callResult.result),
        firstText: callResult.result?.content?.[0]?.type === 'text'
          ? String(callResult.result.content[0].text).slice(0, 160)
          : null,
      });
    } catch (error) {
      failures.push(`${item.provider}.${item.tool}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (values.verbose) console.log(JSON.stringify(results, null, 2));
  else {
    console.log(
      JSON.stringify(
        results.map((item: any) =>
          item.tool
            ? { provider: item.provider, tool: item.tool, resultBytes: item.resultBytes, firstText: item.firstText }
            : item,
        ),
        null,
        2,
      ),
    );
  }
  if (failures.length > 0) {
    throw new Error(`公开检查存在失败：\n${failures.join('\n')}`);
  }
}

async function runConfigured() {
  if (!values.provider) {
    const providers = await invoke('services_providers', {});
    console.log(JSON.stringify(providers, null, 2));
    return;
  }
  const result = await checkProvider(values.provider);
  if (values.call) {
    const input = values.input ? JSON.parse(values.input) : {};
    const callResult = await invoke('services_call_tool', {
      provider: values.provider,
      tool: values.call,
      arguments: input,
      confirmSideEffects: true,
    });
    console.log(JSON.stringify({ ...result, call: { tool: values.call, result: callResult.result } }, null, 2));
    return;
  }
  console.log(JSON.stringify(result, null, 2));
}

try {
  if (values.public) await runPublicChecks();
  else await runConfigured();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

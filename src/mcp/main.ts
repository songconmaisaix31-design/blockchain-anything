#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio, type StdioServerHandle } from '@modelcontextprotocol/server/stdio';
import { createToolkit } from '../toolkit.js';
import { Console } from 'node:console';
import { VERSION } from '../version.js';
import { resultExitCode } from '../outcome.js';

export function createMcpServer(): McpServer {
  const toolkit = createToolkit();
  const server = new McpServer({ name: 'bca', version: VERSION }, {
    instructions: '使用 tools/list 查看实际工具与严格输入 Schema。写入或签署必须有进程配置授权和 submit=true；链上字段公开，IPFS add 会向配置的节点传输文件。',
  });
  server.server.onclose = () => { void toolkit.close().catch(() => process.stderr.write('部分上游 MCP 会话关闭未确认\n')); };
  for (const tool of toolkit.tools) {
    server.registerTool(tool.name, {
      description: tool.description,
      inputSchema: tool.inputSchema,
      annotations: { readOnlyHint: tool.readOnly },
    }, async (input) => {
      try {
        const result = await toolkit.invoke(tool.name, input);
        return { isError: resultExitCode(result) !== 0, content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: { result } };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: 'text', text: error instanceof Error ? error.message : '工具调用失败' }],
        };
      }
    });
  }
  return server;
}

export function startMcpServer(): StdioServerHandle {
  // Third-party SDK diagnostics must never share the stdio protocol stream.
  globalThis.console = new Console({ stdout: process.stderr, stderr: process.stderr });
  const server = createMcpServer();
  return serveStdio(() => server, {
    onerror: () => { process.stderr.write('MCP 传输或协议处理失败\n'); },
  });
}

if (import.meta.main) {
  try {
    if (process.argv.length > 2) throw new Error('MCP stdio 入口不接受命令行参数');
    startMcpServer();
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ code: 'BCA_MCP_ERROR', message: error instanceof Error ? error.message : 'MCP 启动失败' })}\n`);
    process.exitCode = 1;
  }
}

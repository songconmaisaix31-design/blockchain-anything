# BCA 使用指南

BCA 提供共享的 TypeScript SDK、Incur CLI 和官方 MCP stdio 服务。工具目录来自 `createToolkit().tools`；全部业务操作通过同一个 `invoke(name, input)` 执行。输入使用严格 Zod Schema，额外字段会导致失败；输出中的大整数使用十进制字符串。

## 从源码安装和运行

需要 Node.js 24 和 npm。在项目根目录执行：

```sh
npm ci
npm run typecheck
npm run build
node dist/cli/main.js --help
node dist/cli/main.js tools
```

`dist/cli/main.js` 是 `bca` 可执行入口，保留 Node.js shebang。需要在本机使用短命令时运行 `npm link`，之后使用 `bca`。包保持 `private: true`，当前从源码构建使用。

开发时可直接执行 `npx tsx src/cli/main.ts tools`。修改源文件后重新构建，再启动使用 `dist` 的客户端。环境文件需显式加载：

```sh
node --env-file=.env dist/cli/main.js tools
node --env-file=.env dist/cli/main.js call evm_status --input '{}'
```

根据仓库的 `.env.example` 创建自己的 `.env`，填写实际配置。程序不会自动加载环境文件。

## CLI 发现和调用

以下示例使用 `npm link` 后的命令；也可将 `bca` 替换为 `node dist/cli/main.js`。JSON 示例采用单引号包围，适用于 Bash 和 PowerShell 7；其他 shell 需按其规则传递同样的 JSON 字符串。

```sh
bca tools
bca tools content_cid
bca content cid --help
bca content cid --schema
bca --llms --json

bca call content_cid --input '{"path":"README.md"}'
bca content cid --input '{"path":"README.md"}'
bca evm status --input '{}'
bca eas schema_encode --input '{"schema":"string note","fields":[{"name":"note","type":"string","value":"公开说明"}]}'
```

`tools` 输出实际实现的名称、说明、完整输入 JSON Schema、`readOnly` 和 `annotations.readOnlyHint`。`tools <name>` 只返回该工具。工具名称按第一个下划线划分命令组，例如 `eas_schema_encode` 对应 `bca eas schema_encode`。

`--schema` 描述 CLI 的位置参数和 `--input` 字符串；业务输入的完整 Schema 通过 `bca tools <name>` 获取。`--help` 和 `--llms` 使用 Incur 的发现能力。普通调用默认输出 JSON，`--json` 可显式指定 JSON，`--full-output` 可查看 Incur 的结果封装。失败退出码非零；调用者应先检查退出码，再解析结果。

必须传入 `--input`；无参数工具使用 `{}`。发现目录不代表网络已配置或连接成功。使用 `evm_status` 查看配置状态，使用 `evm_chain`、`eas_status`、`ipfs_status` 分别执行实际连接检查。

## 配置和写入

| 配置 | 用途 |
| --- | --- |
| `BCA_WORKING_ROOT` | 文件工作根目录，默认进程当前目录；MCP 客户端建议传绝对路径 |
| `BCA_RPC_URL`、`BCA_CHAIN_ID` | 明确指定 EVM RPC 和预期 chain ID |
| `BCA_EAS_ADDRESS`、`BCA_SCHEMA_REGISTRY_ADDRESS` | 当前网络中实际部署的合约地址 |
| `BCA_IPFS_URL` | 实际 Kubo RPC API 地址 |
| `BCA_ALLOW_WRITES` | 默认 `false`；仅 `true` 开启写入和签署 |
| `BCA_PRIVATE_KEY` | 仅用于受控本地开发的签署器，由进程环境提供 |

完整限制和默认值见 [适配器与配置](providers.md)。没有网络配置时可使用本地 CID、Schema 编解码和个人消息验签。服务 URL 由操作者配置，工具输入不能覆盖 URL 或工作根目录。

Schema 注册、声明、撤销和链下签署要求进程开启写入、配置签署器，并传入 `submit:true`。IPFS add 要求写入开启和 `submit:true`。签署私钥不放入命令参数、工具输入、声明或公开文件；日志和错误不输出进程秘密。

提交后等待回执失败时，错误中保留已有交易哈希。先使用 `evm_receipt` 查询状态，再决定后续操作；调用者不应自动重试写入。同一签署账户的链上写入按顺序执行。

## MCP stdio

三个命令均启动同一个官方 MCP SDK 服务：

```sh
node dist/mcp/main.js
node dist/cli/main.js mcp
node dist/cli/main.js --mcp
```

服务使用 stdin/stdout 交换 JSON-RPC，stdout 不输出启动提示。诊断写入 stderr。客户端关闭 stdin 后服务结束。`mcp` 和 `--mcp` 仅支持 stdio 启动，不接受其他参数；帮助使用 `bca mcp --help`。

以下为支持 `mcpServers` 配置格式的客户端示例。将路径替换为本机的绝对路径，`command` 也可以使用 Node.js 可执行文件的绝对路径：

```json
{
  "mcpServers": {
    "bca": {
      "command": "node",
      "args": ["C:/projects/blockchain-anything/dist/mcp/main.js"],
      "env": {
        "BCA_WORKING_ROOT": "C:/projects/blockchain-anything",
        "BCA_ALLOW_WRITES": "false"
      }
    }
  }
}
```

也可将 `args` 设置为 `["--env-file=C:/projects/blockchain-anything/.env", "C:/projects/blockchain-anything/dist/mcp/main.js"]`，由 Node.js 加载配置。客户端会继承部分环境变量；请在启动配置中明确写入授权和工作根目录。

官方 SDK client 的调用方式：

```js
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const client = new Client({ name: 'bca-client', version: '1.0.0' });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: ['C:/projects/blockchain-anything/dist/mcp/main.js'],
  env: {
    BCA_WORKING_ROOT: 'C:/projects/blockchain-anything',
    BCA_ALLOW_WRITES: 'false',
  },
});
try {
  await client.connect(transport);
  console.log(await client.listTools());
  const result = await client.callTool({ name: 'content_cid', arguments: { path: 'README.md' } });
  if (result.isError) throw new Error(JSON.stringify(result.content));
  console.log(result);
} finally {
  await client.close();
}
```

MCP 工具使用原生名称，输入 Schema 由官方 SDK 从共享 Zod Schema 转换。`annotations.readOnlyHint` 与共享目录一致。调用失败返回 `isError:true`，错误参数不会终止整个服务。成功结果在 text 内容中使用 JSON，并在 `structuredContent.result` 中提供相同数据。

MCP 模块也可通过 `blockchain-anything/mcp` 导入 `createMcpServer()` 和 `startMcpServer()`；导入模块不会自动启动服务。`startMcpServer()` 返回带 `close()` 的连接句柄。

## TypeScript SDK

源码构建后可直接导入 `dist/index.js`；将本地包安装到其他项目后使用包名导入：

```ts
import { createToolkit, type Toolkit, type ToolDefinition } from 'blockchain-anything';

const toolkit: Toolkit = createToolkit();
const tools: ToolDefinition[] = toolkit.tools;
const result = await toolkit.invoke('content_cid', { path: 'README.md' });
console.log(tools.map((tool) => tool.name), result);
```

SDK 只导出共享 toolkit 和公共类型。配置在创建实例时读取，配置改变后创建新实例。SDK 调用失败会抛出脱敏异常。

## 使用边界

当前接入 EVM、EAS、标准 CID 和 Kubo。raw CID 标识文件原字节；Kubo add 返回 UnixFS 根 CID。文件 CID 不证明来源或质量。EAS 链上字段公开；IPFS add 会传输实际文件并请求配置节点固定保存。

个人消息验证限定 EIP-191 EOA 恢复。链下声明验证只报告实际执行的签名和 domain 检查；撤销、时间戳、有效期和来源信任的未检查状态随结果返回。环境变量签署器仅面向本地开发，生产钱包和密钥设施尚未接入。

MCP 只提供 stdio。官方 SDK client 的发现和调用检查不包含原生 Codex 控制器事件审计；真实 SQLite、HTTP 服务、控制器会话和逐项 `event_id` 验证需单独执行。公共测试网、生产交易和 npm 公开发布的实际状态以项目状态文档为准。

实现使用 [Incur 官方说明](https://github.com/wevm/incur/blob/main/README.md) 和 [官方 MCP SDK stdio API](https://ts.sdk.modelcontextprotocol.io/v2/serving/stdio)，实际依赖版本由 lockfile 固定。

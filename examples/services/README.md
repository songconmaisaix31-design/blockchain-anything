# MCP 服务配置示例

`mcp-servers.example.json` 是标准 `mcpServers` 配置，覆盖本模块已核实的官方预设。复制到：

```text
<BCA_WORKING_ROOT>/.bca/mcp-servers.json
```

或设置：

```bash
# PowerShell
$env:BCA_MCP_SERVERS = "C:\path\to\mcp-servers.json"

# bash
export BCA_MCP_SERVERS=/path/to/mcp-servers.json
```

`.bca/` 已在 `.gitignore` 中；不要把真实 key 提交到仓库。

## 快速检查

```bash
# 不需要凭证的三个公开服务
npx tsx scripts/check-services.ts --public --verbose

# 查看当前配置与预设
npx tsx scripts/check-services.ts

# 指定 provider 做 initialize + tools/list
npx tsx scripts/check-services.ts --config .bca/mcp-servers.json --provider coingecko

# 真实调用一个工具
npx tsx scripts/check-services.ts --config .bca/mcp-servers.json --provider coingecko \
  --call execute --input '{"code":"async function run(client) { return await client.simple.price.get({ vs_currencies: '\''usd'\'', ids: '\''bitcoin'\'' }); }"}'
```

## OAuth

OAuth 服务使用官方 `mcp-remote`，先单独授权一次：

```bash
npx -y mcp-remote@0.15.2 https://mcp.alchemy.com/mcp
```

浏览器完成登录后，token 存在 mcp-remote 自己的缓存目录（默认 `~/.mcp-auth`）。本模块的配置示例使用同一条命令，后续调用会复用缓存；不读取、不打印 token。

需要浏览器授权的官方端点：

| 服务 | URL |
| --- | --- |
| Alchemy | `https://mcp.alchemy.com/mcp` |
| Allium | `https://mcp.allium.so` |
| Dune | `https://api.dune.com/mcp/v1` |
| Token Terminal | `https://mcp.tokenterminal.com/mcp` |
| Messari | `https://mcp.messari.io/mcp` |
| Coinbase Wallet | `https://wallet-mcp.coinbase.com` |
| Tenderly | `https://mcp.tenderly.co/mcp` |

各服务的账号/计划要求、API key 变量和实际验证结果见 [services.md](../../docs/integrations/services.md)。

## 秘密

- 只通过配置中的 `env`、`headers` 或 `${ENV_NAME}` 注入。
- 不要把 key 放到工具参数、聊天、仓库或提交信息。
- thirdweb 的 project secret 在官方 URL 查询参数中；本模块的状态和错误输出会移除查询串。

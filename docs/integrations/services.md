# MCP 服务聚合

更新日期：2026-10-23。实现使用官方 `@modelcontextprotocol/client` 2.3.1，CLI/MCP/SDK 共用同一套工具。

## 配置

操作者通过 `BCA_MCP_CONFIG` 指向一个标准 `mcpServers` JSON 文件，或通过 `BCA_MCP_SERVERS` 直接提供同一份 JSON。两者只能设置一个。

```json
{
  "mcpServers": {
    "coingecko": { "preset": "coingecko" },
    "alchemy": { "url": "https://mcp.alchemy.com/mcp" },
    "local": {
      "command": "C:/Program Files/nodejs/node.exe",
      "args": ["dist/mcp/main.js"],
      "cwd": "C:/projects/blockchain-anything",
      "env": { "BCA_WORKING_ROOT": "C:/projects/blockchain-anything" }
    }
  }
}
```

- `url` 使用 Streamable HTTP；`command` 使用 stdio。
- `${ENV_NAME}` 可在 `url`、`headers`、`args`、`env` 中展开；缺少变量时立即失败。
- 工具调用者只能传服务名、上游工具名和参数，不能传任意 URL、命令或 Token。
- `bridge_servers` 不返回 Token、请求头值或命令行参数值。
- 连接在每次工具调用结束时关闭；上游 `isError` 会让本次调用失败并保留上游错误文本。

## 工具

| 工具 | 作用 |
| --- | --- |
| `bridge_servers` | 列出已配置服务（脱敏）与官方预设 |
| `bridge_discover` | 初始化 + `tools/list`，保留完整 `inputSchema`/`outputSchema`/`annotations` 与分页 |
| `bridge_call` | 调用上游真实工具；`isError` 时失败 |
| `bridge_resources` | 资源与资源模板列表 |
| `bridge_read_resource` | 按 URI 读取资源 |
| `bridge_prompts` | 提示模板列表 |

## 已核实预设

| 预设 | 地址 | 授权 | 状态 |
| --- | --- | --- | --- |
| CoinGecko | `https://mcp.api.coingecko.com/mcp` | 无（部分工具可能需 key） | 端点已核实；本机代理上游不可达，未完成实际调用 |
| Alchemy | `https://mcp.alchemy.com/mcp` | OAuth + 手机验证 | 端点与登录页已核实；等待用户手机验证 |
| Allium | `https://mcp.allium.so` | OAuth | 端点已核实；登录页 CDP 读取超时 |
| Tenderly / Chainstack / thirdweb / Nansen / Dune / Token Terminal / Messari / GoPlus / Kaito | 未登记公开端点 | 账户/API key | 只保留官方文档入口，按文档配置，不伪造地址 |
| OpenZeppelin / Slither MCP | 本地 stdio | 本地 | 需要操作者提供启动命令；Slither MCP 依赖 Slither 安装 |

## 实际验证（2026-10-23）

`npm run check:bridge` 使用仓库构建出的真实官方 MCP stdio 服务作为目标：

- 初始化成功，协议版本 `2025-11-25`。
- `tools/list` 返回 26 个工具（当时目录；后续新增工具后为 54 个），保留完整输入 Schema。
- `bridge_call` 调用 `content_cid` 返回真实 CID `bafkreih3cs4k5237cwflkexvohtc5loacfx5dzl7gbpom6wsucdlmlev4a`。
- 调用不存在的工具时外层以非零退出码失败，错误文本来自上游。

**未执行**：任何外部供应商 MCP 的真实 `tools/list`/`callTool`。原因是本机代理 7890 的上游对 Google/GitHub/CoinGecko 等持续超时（DeepSeek 可通），不是代码层失败。OAuth 需要操作者浏览器授权，网页登录成功不代替 API 调用。

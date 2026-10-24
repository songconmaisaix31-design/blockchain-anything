# 官方服务与 MCP

BCA 使用官方 MCP TypeScript Client，支持 stdio 与 Streamable HTTP。配置仅由操作者提供：`BCA_MCP_CONFIG` 指向 JSON 文件，或 `BCA_MCP_SERVERS` 为 JSON 字符串，两者互斥。`url`、`headers`、`args`、`env` 支持 `${ENV_NAME}` 展开；缺变量只使对应服务不可用，其他有效服务仍可连接。

| 工具 | 行为 |
| --- | --- |
| bridge_servers | 脱敏列出配置与官方预设；不把配置等同于连接成功 |
| bridge_discover | 上游 tools/list，保留 Schema、annotations 和 cursor |
| bridge_call | 原生 callTool；上游 isError 传播为失败 |
| bridge_resources / bridge_read_resource | 资源、资源模板列表与原生读取 |
| bridge_prompts / bridge_get_prompt | 提示列表与带参数获取 |

无 session 的调用结束后关闭连接。连续工作流使用 `bridge_open → bridge_refresh → bridge_call → bridge_close`，详见 [会话指南](../guides/workstations.md)。上游 `readOnlyHint` 仅作参考，明确的官方映射或操作者 `readOnlyTools` 许可允许只读调用；其余要求写入开关与 `submit:true`。不自动重试业务。完整刷新最多读取 20 页，超过上限明确失败。

配置会在每次调用重读，同长度修改和环境变量变更立即生效。URL/凭据不作为工具输入；子进程 stderr 不转发到协议输出。请求头和配置中的秘密会从异常中屏蔽。

## 服务矩阵（2026-10-23）

| 项目 | 官方入口 / 示例 | 授权 | 实际结果 |
| --- | --- | --- | --- |
| [OpenZeppelin](https://github.com/OpenZeppelin/openzeppelin-mcp) | preset openzeppelin，npx @openzeppelin/contracts-mcp@0.8.0 | 本地 | 发现与 ERC20 生成通过 |
| [CoinGecko](https://docs.coingecko.com/ai-integration/mcp-server) | https://mcp.api.coingecko.com/mcp；public.json | 公开入口 | 发现与 search_docs 调用通过；未验证所有行情方法 |
| [Alchemy](https://www.alchemy.com/docs/build-with-ai) | https://mcp.alchemy.com/mcp；alchemy.json | OAuth | 配置就绪，账户验收待完成 |
| [Tenderly](https://tenderly.co/blog/validating-agentic-workflows-with-tenderly-mcp-server/) | https://mcp.tenderly.co/mcp；oauth.json | OAuth | 待凭据与模拟调用 |
| [Chainstack](https://github.com/chainstacklabs/mcp-server) | https://mcp.chainstack.com/mcp；chainstack.json | API key | 待凭据 |
| [thirdweb AI](https://portal.thirdweb.com/changelog/nebula-is-now-thirdweb-ai) | https://api.thirdweb.com/mcp；thirdweb.json | secretKey | 待凭据 |
| [Nansen](https://academy.nansen.ai/articles/2711728-get-started-with-nansen-mcp) | https://mcp.nansen.ai/ra/mcp；nansen.json | NANSEN-API-KEY | 待凭据 |
| [Dune](https://docs.dune.com/api-reference/agents/quickstart) | https://api.dune.com/mcp/v1；dune.json | x-dune-api-key | 待凭据 |
| [Allium](https://docs.allium.so/ai/mcp/overview) | https://mcp.allium.so；allium.json | Bearer API key 或 OAuth | 待凭据；官方 get_skill 同样通过 bridge_call 读取 |
| [Token Terminal](https://tokenterminal.com/docs/mcp/introduction) | https://mcp.tokenterminal.com/mcp；tokenterminal.json | OAuth | 待账户授权 |
| [Messari](https://docs.messari.io/mcp-server/hosted) | https://mcp.messari.io/mcp；messari.json | OAuth 流程 + Messari API key | 待账户权限 |
| [GoPlus](https://github.com/GoPlusSecurity/goplus-mcp) | npx goplus-mcp@1.0.1；goplus.json | key / secret | 待凭据与原生调用 |
| [Slither MCP](https://github.com/trailofbits/slither-mcp) | uvx 官方仓库；slither.json | 本地环境 | 2026-10-23 已真实发现及分析；2026-10-24 补测 CLI 状态分类。完整审计仍未代验 |
| [Coinbase Wallet](https://docs.cdp.coinbase.com/ai-agents/coinbase-for-agents/wallet-mcp) | https://wallet-mcp.coinbase.com；coinbase-wallet.json | OAuth | 待钱包授权 |
| [Kaito Pro](https://www.pro.kaito.ai/portal) | 无可核实的通用官方 API/MCP | 商业账户 | 未适配；仅保留准确的发现信息 |

文件均位于 `examples/services/`。当前 CoinGecko 上游暴露 `execute` 与 `search_docs`，执行前以当次发现的 Schema 为准。

## OAuth

复用成熟的 `mcp-remote@0.15.2` 客户端，示例通过 stdio 转接。先由操作者在交互终端运行配置中的命令，完成浏览器授权；令牌由 mcp-remote 管理。BCA 不自行实现 OAuth，也不会将网页已登录当作 API 验证通过。

直接 HTTP 配置适合已经具有有效授权头的服务；仅填 OAuth 服务 URL 并不能完成登录。Allium 旧域名 mcp-oauth.allium.so 将于 2026-10-31 停用；Chainstack 旧 rpc-nodes-mcp 与 Base MCP 不再作为新接入使用。

Bankr、Brian、Heurist Mesh 采用原生 SDK/HTTP 适配，见 [钱包与 Agent](wallets-agents.md)。新供应商优先复用此桥接，不复制上游工具实现。

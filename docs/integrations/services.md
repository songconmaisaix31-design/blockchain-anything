# 官方 MCP 服务聚合

更新日期：2026-10-23。轨道 M，分支 `codex/bca-services`，基线 `b76a569`。

本模块只做成熟 MCP 服务的连接聚合：用官方 `@modelcontextprotocol/client` 完成 stdio / Streamable HTTP 连接，用官方 `mcp-remote` 完成 OAuth，动态读取上游 `tools/list`，原样转发 `tools/call`。没有自研协议、身份、签名、调度或工具清单；没有 mock、假 API、替身服务或 catch 后 fallback。

资料核对：已完整读取用户提供的 OpenZeppelin、Slither/Trail of Bits、GoPlus、Alchemy、thirdweb、Chainstack、Nansen、CoinGecko、Allium、Token Terminal、Messari、Kaito、Coinbase Wallet、Heurist、Bankr、Brian、base-mcp、rpc-nodes-mcp 页面。`https://tenderly.co/blog/validating-agentic-workflows-with-tenderly-mcp-server/` 返回 HTTP 429，改用 Tenderly 当前官方 `https://docs.tenderly.co/mcp-server` 与 quickstart；`https://dune.com/blog/dune-mcp` 返回 HTTP 404，改用 Dune 当前官方 `https://docs.dune.com/docs/agents/mcp`；`base/base-mcp` 的 `main` README 返回 404，按仓库默认分支 `master` 读取归档说明。所有接口以这些当前官方页面为准。

## 入口与结构

| 文件 | 作用 |
| --- | --- |
| `src/bridge/index.ts` | 导出同步工厂 `bridgeTools(): ToolImplementation[]`，实现 9 个聚合工具 |
| `src/bridge/config.ts` | 解析标准 `mcpServers` JSON、`${ENV}` 展开、URL/header/args 校验、秘密脱敏 |
| `src/bridge/client.ts` | 官方 SDK 的 stdio / Streamable HTTP 会话、超时、分页、错误映射、进程树关闭 |
| `src/bridge/presets.ts` | 只登记已从官方文档核实的预设和明确不可用的项目 |
| `scripts/check-services.ts` | 实际连接检查入口（公开 keyless 路径 + 配置项） |
| `examples/services/mcp-servers.example.json` | 可直接复制的标准配置示例 |

根层 CLI/MCP 注册由集成 Agent 负责；本模块不修改 `src/toolkit.ts`、`src/types.ts`、`src/config.ts`、`src/cli/`、`src/mcp/` 或 `package.json`。

## 配置

配置使用标准 `mcpServers` JSON，由操作者维护：

- 环境变量 `BCA_MCP_SERVERS` 指定文件路径；
- 未指定时读取 `<BCA_WORKING_ROOT>/.bca/mcp-servers.json`（`.bca/` 已加入 `.gitignore`）；
- 相对路径按 `BCA_WORKING_ROOT`（未设置时为进程工作目录）解析。

只接受以下字段：

```json
{
  "mcpServers": {
    "coingecko": {
      "type": "http",
      "url": "https://mcp.api.coingecko.com/mcp"
    },
    "slither": {
      "type": "stdio",
      "command": "uvx",
      "args": ["--from", "git+https://github.com/trailofbits/slither-mcp", "slither-mcp"],
      "timeoutMs": 300000
    }
  }
}
```

- `type`：`stdio`、`http` 或 `streamable-http`；不支持旧的 SSE 传输，也不会自动回退到 SSE。
- stdio：`command`、`args`、`env`、`cwd`。命令以数组方式启动，不经过 shell。
- HTTP：`url`、`headers`。强制 HTTPS；只有 `localhost` / `127.0.0.1` / `::1` 允许 HTTP。
- 扩展字段：`timeoutMs`（1000–600000，默认取 `BCA_MCP_TIMEOUT_MS` 或 60000）、`allowWriteTools`（默认 `false`）。
- 字符串支持 `${ENV_NAME}` 展开；缺少变量时只让该 provider 失败，不影响其他 provider。
- 私钥、Token、API key 只放配置/环境变量，任何工具参数都不接受秘密、URL 或命令。
- 错误、状态和发现结果不会返回 header 值、env 值、args、URL 查询串或 userinfo；日志中的 endpoint 统一替换为 `[ENDPOINT]`。

`allowWriteTools` 与调用门禁：

- 默认只允许上游 `tools/list` 中 `annotations.readOnlyHint === true` 的工具直接调用；
- 未标注或未找到的工具必须由调用者传 `confirmSideEffects: true`；
- 操作者可在单个 provider 上设置 `"allowWriteTools": true` 关闭该门禁；
- 本轨道没有执行任何转账、交易、签名或生产写入测试。

## 聚合工具

| 工具 | 输入 | 行为 | 只读 |
| --- | --- | --- | --- |
| `services_providers` | `{}` | 列出官方预设、操作者自定义服务、配置错误和明确不可用的项目；不连接网络 | 是 |
| `services_status` | `provider`, `timeoutMs?` | 真实 MCP `initialize`，返回 serverInfo、协议版本、capabilities、instructions | 是 |
| `services_list_tools` | `provider`, `cursor?`, `allPages?`, `maxPages?`, `timeoutMs?` | 真实 `tools/list`，保留完整 `inputSchema` / `outputSchema` / `annotations` / `_meta`；默认一页，`allPages=true` 循环取完 | 是 |
| `services_call_tool` | `provider`, `tool`, `arguments?`, `confirmSideEffects?`, `timeoutMs?` | 真实 `tools/call`，保留原始 `content` / `structuredContent`；上游 `isError=true` 时外层抛错 | 否 |
| `services_list_resources` | 同上分页参数 | 真实 `resources/list` | 是 |
| `services_list_resource_templates` | 同上分页参数 | 真实 `resources/templates/list` | 是 |
| `services_read_resource` | `provider`, `uri`, `timeoutMs?` | 真实 `resources/read`，原样返回 text/blob | 是 |
| `services_list_prompts` | 同上分页参数 | 真实 `prompts/list` | 是 |
| `services_get_prompt` | `provider`, `name`, `arguments?`, `timeoutMs?` | 真实 `prompts/get` | 是 |

分页返回 `nextCursor`、`pages`、`truncated`；不伪造工具列表，不缓存成静态目录。每次调用新建会话，`finally` 中关闭 transport；stdio 启动器（`npx` / `uvx`）在 Windows 上使用 `taskkill /T` 关闭整个进程树，避免子进程持有 stdio。

错误语义：

- HTTP 401/403：明确报告未授权/权限不足，并给出该 provider 的认证方式；
- HTTP 404/429：明确报告端点或速率限制；
- 超时：报告实际毫秒数，提示 `timeoutMs` 或稍后重试；
- 连接失败：报告 `ECONNRESET` 等网络错误，不伪装成鉴权成功；
- 上游 `isError=true`：外层抛出 `上游工具 <name> 返回 isError：<上游文本>`；
- 未配置 / 缺环境变量 / 未知 provider / 已废弃项目：立即失败，不回退。

## 官方预设与验证结果

“适配”表示桥接代码与官方入口已实现；“配置”表示操作者需要在 `mcpServers` 中加入对应项；“实际调用”只记录本轮真实执行过的路径。

| 项目 | 官方入口 | 认证 | 适配 | 实际调用结果 | 限制 / 备注 |
| --- | --- | --- | --- | --- | --- |
| CoinGecko | `https://mcp.api.coingecko.com/mcp` | 无 | 是 | `initialize` 成功（server 8.2.1），`tools/list` 2 个工具，`execute` 实际返回 BTC/USD 价格 | 免费端点共享速率限制；Pro 需 key |
| OpenZeppelin Contracts | `https://mcp.openzeppelin.com/contracts/solidity/mcp` | 无 | 是 | `initialize` 成功（0.7.2），`tools/list` 8 个工具，`solidity-erc20` 返回真实源码；`resources/list` 8 个 UI 资源，`resources/read` 返回 684057 字节 HTML | 其他语言使用 variants 中的官方 URL；生成结果不构成审计 |
| Chainstack | `https://mcp.chainstack.com/mcp` | 无（平台工具可选 Bearer key） | 是 | `initialize` 成功（1.11.4），`tools/list` 23 个工具，`get_platform_status` 实际返回 `status=UP` 与 3 条事件 | 本机代理链路上偶发 `ECONNRESET`，重试后成功；不是代码降级 |
| Slither MCP | `uvx --from git+https://github.com/trailofbits/slither-mcp slither-mcp` | 本地 | 是 | `initialize` 成功（slither-mcp 2.14.7），`prompts/list` 返回 1 个 prompt；`tools/list` 被上游 `ValueError: Circular reference detected (id repeated)` 阻断 | 上游工具 schema 序列化缺陷；未执行分析工具，不声称通过 |
| GoPlus | `npx -y goplus-mcp@1.0.1` | API key + secret | 是 | 无凭证下 `initialize` 成功（1.0.0），`tools/list` 7 个工具；未做业务调用 | 业务调用需要 `GOPLUS_API_KEY` / `GOPLUS_API_SECRET`；无凭证时进程日志明确报错 |
| Alchemy | `https://mcp.alchemy.com/mcp` | OAuth | 是 | 无 OAuth 时 HTTP 401；未执行浏览器 OAuth | 主 Agent 浏览器授权后可继续 |
| Allium | `https://mcp.allium.so` | OAuth 或 Bearer key | 是 | 无 OAuth 时 HTTP 401；未执行浏览器 OAuth | 旧 `mcp-oauth.allium.so` 已弃用，不使用 |
| Dune | `https://api.dune.com/mcp/v1` | OAuth 或 `x-dune-api-key` | 是 | 无 OAuth 时 HTTP 401；未执行浏览器 OAuth | OAuth scope `mcp:dune:full`；长查询可配 `timeoutMs` |
| Token Terminal | `https://mcp.tokenterminal.com/mcp` | OAuth 2.1 + PKCE | 是 | 无 OAuth 时 HTTP 401；未执行浏览器 OAuth | 免费计划仅有限 `research` 工具 |
| Messari | `https://mcp.messari.io/mcp` | OAuth + 浏览器输入 API key | 是 | 无 OAuth 时 HTTP 401；未执行浏览器 OAuth | 需要 Enterprise + AI Toolkit 权限 |
| Coinbase Wallet | `https://wallet-mcp.coinbase.com` | OAuth + Coinbase Wallet 批准 | 是 | 无 OAuth 时 HTTP 401；未执行浏览器 OAuth | 写入工具会要求钱包逐次批准；本轨道不测试转账 |
| Tenderly | `https://mcp.tenderly.co/mcp` | OAuth（WorkOS） | 是 | 无 OAuth 时 HTTP 401；未执行浏览器 OAuth | 需要已开通 MCP 的付费计划；否则 403 |
| Nansen | `https://mcp.nansen.ai/ra/mcp` | `NANSEN-API-KEY` header | 是 | 无 key 下 `initialize` 成功（3.2.4），`tools/list` 53 个工具；业务调用在无 key 时连接被重置 | 需要 API credits；连接器 OAuth 端点为 `.../connector-curated/mcp`，工具集较少 |
| thirdweb AI | `https://api.thirdweb.com/mcp?secretKey=...` | project secret key | 是 | 无 key 时 HTTP 401；未做业务调用 | 旧 Nebula 已下线；secret 只从环境变量注入，不写入输出 |

OpenZeppelin 其他已核实的官方 hosted 变体：

- `https://mcp.openzeppelin.com/contracts/cairo/mcp`
- `https://mcp.openzeppelin.com/contracts/confidential/mcp`
- `https://mcp.openzeppelin.com/contracts/stellar/mcp`
- `https://mcp.openzeppelin.com/contracts/stylus/mcp`
- `https://mcp.openzeppelin.com/contracts/tron/mcp`
- `https://mcp.openzeppelin.com/contracts/uniswap-hooks/mcp`
- `https://mcp.openzeppelin.com/contracts/sui/mcp`

## 需要主 Agent 执行浏览器 OAuth 的准确入口

这些服务没有可用 API key 替代，或官方推荐 OAuth；本 Worker 不操作浏览器、不读取 cookie、不打印 token。主 Agent 在 Chrome 中执行一次即可，mcp-remote 会把 token 存在自己的缓存目录（默认 `~/.mcp-auth`），后续 `bridgeTools()` 复用同一命令时无需再次登录。

统一启动命令（在任意终端运行；它会启动本地回调代理并打开浏览器）：

```bash
npx -y mcp-remote@0.15.2 <MCP_URL>
```

一次只授权一个服务，避免默认回调端口 3334 冲突；授权完成后可停止该临时进程，token 缓存会保留。

| 服务 | `<MCP_URL>` | 授权端点（mcp-remote 会附加 client_id/state/PKCE 参数） | 账号/权限要求 |
| --- | --- | --- | --- |
| Alchemy | `https://mcp.alchemy.com/mcp` | `https://auth.alchemy.com/oauth/authorize` | Alchemy 账户；无需 API key |
| Allium | `https://mcp.allium.so` | `https://mcp.allium.so/authorize` | Allium 账户（Google/SSO/email）；按 credits 计费 |
| Dune | `https://api.dune.com/mcp/v1` | `https://dune.com/oauth/mcp/authorize`，scope `mcp:dune:full`，PKCE S256 | Dune 账户 |
| Token Terminal | `https://mcp.tokenterminal.com/mcp` | `https://mcp.tokenterminal.com/api/auth/authorize` | Token Terminal 账户；免费计划有限 research |
| Messari | `https://mcp.messari.io/mcp` | `https://mcp.messari.io/oauth/authorize` | Messari Enterprise + AI Toolkit + 浏览器输入 API key |
| Coinbase Wallet | `https://wallet-mcp.coinbase.com` | `https://wallet-mcp.coinbase.com/authorize`，scopes `agent_wallet:transact` / `agent_wallet:escalate` | Coinbase Wallet（原 Base App）/ Coinbase 账户；写入逐次批准 |
| Tenderly | `https://mcp.tenderly.co/mcp` | `https://authkit.tenderly.co/oauth2/authorize` | 已开通 MCP 的 Tenderly 付费计划 + 至少一个项目；否则 403 / `quota_limit_reached` |
| Nansen（可选 OAuth） | `https://mcp.nansen.ai/ra/connector-curated/mcp` | 由 Nansen 连接器决定 | Nansen 账户；默认配置使用 API key，OAuth 工具集较少 |

mcp-remote 启动后会在终端打印形如 `Please open the following URL to authorize: https://.../authorize?...` 的地址；主 Agent 把该 URL 在 Chrome 打开并完成登录即可。授权 URL 含一次性 `state` / PKCE challenge，不能在 Worker 侧预生成或复用。

上表的授权端点已通过各服务的 `/.well-known/oauth-protected-resource` 与 `/.well-known/oauth-authorization-server` 实际读取核对（Dune 为官方文档给出的端点）；没有自行构造 OAuth 请求。

API key / secret 类服务不需要浏览器：

- GoPlus：`GOPLUS_API_KEY`、`GOPLUS_API_SECRET`
- thirdweb：`THIRDWEB_SECRET_KEY`
- Nansen：`NANSEN_API_KEY`
- Dune（替代）：`DUNE_API_KEY`
- Allium（替代）：`ALLIUM_API_KEY`
- Chainstack（平台工具可选）：`CHAINSTACK_API_KEY`

## 明确不可用或已迁移的项目

| 项目 | 结论 | 证据 |
| --- | --- | --- |
| Bankr | 只有 API，没有官方 MCP | 官方文档只列 Agent API / Wallet API / OpenAPI；由 W 轨道接入 API |
| Brian | 维护中的服务只有 REST API / SDK；官方 `mcp-server-brian` 是 2025-03 的本地 Bun 包装器，未发布 npm，需 `BRIAN_API_KEY` | 不作为当前 hosted MCP 预设；由 W 轨道接入 API |
| Heurist Mesh | 官方是 Skill + REST/x402，没有 MCP 端点 | 由 D/W 轨道接入官方 Skill |
| Kaito | 没有公开 API 文档、公开端点或官方 MCP；API 页面只提供 Contact Sales | 标记阻塞，不编造接口 |
| base-mcp | 仓库已归档，npm 包已弃用 | 官方迁移到 `https://wallet-mcp.coinbase.com`；本模块只公布 `coinbase-wallet` |
| rpc-nodes-mcp | 仓库已弃用 | 官方迁移到 `https://mcp.chainstack.com/mcp`；本模块只公布 `chainstack` |

GOAT 的归档与替代接入由 W 轨道处理；本轨道没有把任何已废弃端点包装成可用预设。

## 实际验证命令与结果

环境：Windows，Node.js `v24.19.0`（本 Worker）与主工作区 `v24.16.0`，npm `11.13.0`，Orca `1.4.230`，Foundry `1.7.1`。测试配置在 `.work/mcp-servers.json`（已忽略，不提交秘密）。

```bash
npm run typecheck
# 通过

npm run build
# 通过

npx tsx scripts/check-services.ts --public --verbose
# 退出码 0；CoinGecko initialize + 2 tools + execute 价格调用
# OpenZeppelin initialize + 8 tools + solidity-erc20 源码
# Chainstack initialize + 23 tools + get_platform_status（status=UP）
```

分项真实调用：

```bash
BCA_MCP_SERVERS=.work/mcp-servers.json npx tsx .work/probe.ts coingecko list
BCA_MCP_SERVERS=.work/mcp-servers.json npx tsx .work/probe.ts openzeppelin call solidity-erc20 '{"name":"BCA Test Token","symbol":"BCAT"}'
BCA_MCP_SERVERS=.work/mcp-servers.json npx tsx .work/probe.ts chainstack call get_platform_status '{}'
BCA_MCP_SERVERS=.work/mcp-servers.json npx tsx .work/probe.ts openzeppelin resources
BCA_MCP_SERVERS=.work/mcp-servers.json npx tsx .work/probe.ts openzeppelin read 'ui://openzeppelin/solidity-erc20.html'
BCA_MCP_SERVERS=.work/mcp-servers.json npx tsx .work/probe.ts slither status
BCA_MCP_SERVERS=.work/mcp-servers.json npx tsx .work/probe.ts slither prompts
BCA_MCP_SERVERS=.work/mcp-servers.json npx tsx .work/probe.ts goplus list
```

未授权路径（直接 HTTP，不带 OAuth）：

```bash
BCA_MCP_SERVERS=.work/mcp-servers.json npx tsx .work/probe.ts alchemy status
# HTTP 401，明确提示使用 mcp-remote OAuth

BCA_MCP_SERVERS=.work/mcp-servers.json npx tsx .work/probe.ts allium status
# HTTP 401（本机 Node 直连；代理链路可能先出现 ECONNRESET）

BCA_MCP_SERVERS=.work/mcp-servers.json npx tsx .work/probe.ts dune status
BCA_MCP_SERVERS=.work/mcp-servers.json npx tsx .work/probe.ts tokenterminal status
BCA_MCP_SERVERS=.work/mcp-servers.json npx tsx .work/probe.ts messari status
BCA_MCP_SERVERS=.work/mcp-servers.json npx tsx .work/probe.ts coinbase-wallet status
BCA_MCP_SERVERS=.work/mcp-servers.json npx tsx .work/probe.ts tenderly status
# 均为 HTTP 401，未把初始化/401 当作业务成功
```

`isError` 传播检查：

```bash
BCA_MCP_SERVERS=.work/mcp-servers.json npx tsx .work/probe.ts coingecko call execute \
  '{"code":"async function run(client) { throw new Error('\''bridge-iserror-check'\''); }"}'
# 外层失败：上游工具 execute 返回 isError：Error: bridge-iserror-check
```

写门禁检查：

```bash
BCA_MCP_SERVERS=.work/mcp-servers.json npx tsx .work/gate.ts
# 未带 confirmSideEffects 时拒绝 OpenZeppelin solidity-erc20（该上游无 readOnlyHint）
```

## 实际依赖与版本

`package.json` / lockfile 不新增依赖。桥接直接使用仓库已有的官方 SDK：

- `@modelcontextprotocol/client` 2.3.1（Apache-2.0）

运行时通过 `npx` / `uvx` 获取的官方工具（不写入项目依赖，不全局安装）：

| 工具 | 版本/来源 | 许可 |
| --- | --- | --- |
| `mcp-remote` | 0.15.2（npm） | MIT |
| `goplus-mcp` | 1.0.1（npm） | MIT |
| `@openzeppelin/contracts-mcp` | 0.8.0（官方 npm，本地替代时才用） | AGPL-3.0-only |
| `@coingecko/coingecko-mcp` | 8.3.0（官方 npm，本地替代时才用） | Apache-2.0 |
| `slither-mcp` | git commit `17755731bf7aba6e5ed4d72e116d9d394430b1e2`，运行版本 2.14.7 | AGPL-3.0 |

Slither 与 OpenZeppelin 本地包为 AGPL；本模块默认使用 OpenZeppelin 官方 hosted 端点，Slither 以独立本地进程调用，不复制或再分发其代码。使用方需自行遵守 AGPL 的网络服务条款。

## 未完成项

- 所有 OAuth 服务未由本 Worker 完成浏览器授权，因此没有业务工具调用结果；需主 Agent 按上表授权后复测。
- Tenderly 需要付费 MCP 计划；未开通时不能通过重试绕过。
- Messari 需要 Enterprise + AI Toolkit 权限；没有可用 key。
- GoPlus、thirdweb、Nansen 没有本轮可用凭证；只有 initialize / tools/list 结果，没有业务调用。
- Slither `tools/list` 被上游 circular-reference 序列化错误阻断；未执行分析工具，未降低验收标准。
- 本轮实际连接到的上游都只返回一页 `tools/list` / `resources/list` / `prompts/list`；`nextCursor` 与 `allPages` 代码路径已实现但未被真实分页响应触发，保留为未实测项。
- Chainstack 在本机代理链路上偶发 TLS `ECONNRESET`；重试可成功，但应在集成检查中保留真实失败记录。
- 本轨道不执行公共链资产交易、资金划转、生产部署、付费订阅或 npm 发布。

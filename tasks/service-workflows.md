# Dune、GoPlus、Tenderly 真实业务

2026-10-29，基线 `main@4f52761d01b3c379eb5b736f1e3bcb3389c92e19`，工作区干净。用户要求优先复用本机配置，执行真实业务，发现功能缺口直接修复；确实缺少账户或凭据时报告具体缺项。

## 范围和协作

沿用本次任务已批准的 Codex 子 Agent。主 Agent 检查本机配置和浏览器登录、执行 Dune/Tenderly 真实业务、维护文档并完成最终检查；不输出凭据，不创建收费订阅，不发送公共链交易。

| 轨道 | Agent / Worktree / Branch | write_paths | 工作 |
| --- | --- | --- | --- |
| GoPlus | providers / `C:/Users/DW/.codex/worktrees/task-providers/blockchain-anything` / `codex/service-goplus` | `src/providers/goplus.ts`、`scripts/check-goplus.ts`、`docs/guides/goplus.md` | 复用现有 HTTP 组件调用官方公开风险 API，实际验证代币风险结果；提交并推送 |
| 集成 | integration / `C:/Users/DW/.codex/worktrees/task-integration/blockchain-anything` / `codex/service-integration` | `src/toolkit.ts`、`src/workstations/search.ts`、`src/workstations/catalog.ts`、`package.json`、必要的已有指南与服务说明 | GoPlus 轨道完成后合并，衔接工具注册、发现和工作站；真实 CLI/MCP 检查 |

开发者只修改各自文件，不覆盖其他贡献。领域问题交回原开发者。中间结果保存到已忽略的 `.work/`；主 Agent 负责本文件、状态、交接和用户决定文档。

实际 Dune OAuth 超时暴露 Windows 子进程清理缺口，GoPlus 轨道同一 Worker 继续负责 `src/bridge/session.ts`、`scripts/check-sessions.ts` 和必要的 `src/development/exec.ts` 共享清理函数；集成 Agent 待其完成后合并并检查。

## 验证内容

- 本机环境、已知客户端 MCP 配置与 OAuth 缓存只输出配置是否存在和缺项。
- Dune 使用真实目录和 Schema，查询真实链数据并读取执行结果；没有账户权限时保留官方错误。
- GoPlus 对公开真实 ERC20 合约执行风险读取，核对官方成功码和地址对应风险数据。公开 API 是明确的调用入口，已选择 MCP 时保留 MCP 的认证条件与错误。
- Tenderly 复用同一 MCP 会话设置真实项目并模拟交易，保留模拟结果；不向公共链发送交易。
- 修复后执行相关真实调用、类型检查和构建，必要时验证 CLI/MCP 入口。账户限制如实保留。

## 当前结果

检查时，已知 Codex、Claude、Cursor、Gemini、OpenCode 和 Claude Desktop 配置中未找到三项服务，进程及 Windows 用户/系统环境未发现对应凭据变量，原 OAuth 缓存没有 token。随后复用 Chrome 的 Google 登录，完成用户确认的 Tenderly 授权。项目本机 `.bca/mcp.json` 已配置 Tenderly 与 Dune OAuth，token 由官方 mcp-remote 缓存；凭据未写入仓库。

GoPlus 公开工具提交 `e270ebb111ff6fa21d0bccc6be31c556955144a6`。`node --import tsx scripts/check-goplus.ts` 对 Ethereum 与 Base 的 USDC 实际返回 `code=1`、`token_symbol=USDC`、`is_open_source=1`、`is_proxy=1`、`is_honeypot=0`；链 31337 返回 `code=2022`，Ethereum 零地址返回空数据，两者均抛出明确错误。结果保留官方全部原始字段与查询时间。公开 API 缺少的字段不能判定为没有风险。

Tenderly 通过当前 BCA `bridge_open` / `bridge_discover` 读取 60 个真实工具；同一会话的 `list_projects` 与 `set_active_project` 成功。已有默认项目的 `trace_transaction` 返回官方错误：`MCP access is not included in the plan of the active project's owner`。控制台显示免费计划。该账户尚未完成交易追踪或模拟；需要具备 MCP 权限的项目，未开通订阅。

Dune 已完成账户初始化并使用免费 View-only 计划；OAuth 成功，实际发现 33 个工具。`getUsage` 返回 `subscriptionPlanName=visitor_fluid_engine`、`creditsUsed=0`、`creditsQuota=0`；`searchTables` 返回 Base 的 blocks、transactions、traces 表及真实字段和分区结构。按该结构提交最近七个完整 UTC 日期的交易数查询，显式选择 `performance=free`，`createAndExecuteQuery` 返回 `Your account is read-only. Upgrade to create content or run queries.`，没有成功创建查询或执行标识，没有查询结果可读取。

用户随后明确授权自行配置并登录申请 MCP。已通过当前账号向官方 `support@dune.com` 与 `support@tenderly.co` 分别发送开发/评估接入申请，说明项目和实际限制，要求先确认权限、计划和价格，不自动开通订阅。两封邮件发送成功；服务方尚未授予业务权益。现有 OAuth token 保留在官方本机缓存，可在权限开通后继续调用。

最终集成提交 `a6730b72527fc4813d4d64619802fb196f455b61` 注册公开工具，并接入搜索及 `securityInput=token` 工作站，同时包含 Windows 会话清理修复。`goplus-public` 可明确选择公开入口；已有同名配置、显式 server 或配置别名仍选择原 MCP。钱包、非 EVM、冲突链参数保留缺项或错误。

| 命令 | 实际结果 |
| --- | --- |
| `npm run typecheck`、`npm run build` | GoPlus 开发与集成检查通过 |
| `node --import tsx scripts/check-goplus.ts` | Ethereum/Base USDC 真实结果及不支持链/空数据拒绝通过 |
| `npm run check:workstations -- guides` | 各工作站指南通过 |
| `npm run smoke -- --scope interfaces` | 最终集成串行检查通过；CLI 与 MCP 入口识别 127 个工具，使用原有超时设置 |
| 集成目录 `node .work/check-service-integration.mjs` | CLI Ethereum USDC、官方 MCP SDK 经 BCA stdio 查询 Base USDC 均通过，返回 19 个原始风险字段；实际目录 127 个工具 |
| `npm run check:sessions`、`npm run check:sessions -- --windows-tree` | 真实 OpenZeppelin 会话行为通过；Windows 正常关闭与独立缓存的 Dune OAuth 超时后，各自观察到的 5 个进程均退出 |

Windows 清理修复提交 `047f7dfe126cbd0fa48b4af2f4cd4cc1078f47eb` 在官方 SDK 清空 PID 前结束本次启动的进程树，复用现有 `taskkill` 清理逻辑。MCP 与本地命令使用 10 秒总清理期限，`taskkill` 使用其中 8 秒，其结果及管道关闭均需确认。OAuth 检查使用独立缓存，在 50 秒内观察到官方新建的 verifier，随后实际触发 SDK 的 60 秒初始化超时并确认全部进程退出。官方 Anvil 超时清理也已验证。非 Windows 保持官方 SDK 生命周期，本次未实际测试其他操作系统的该修复。

集成检查同时验证显式 server、混合大小写配置别名、与公开入口同名的 MCP 配置、缺少 key/secret、钱包与 Solana 范围和冲突链参数。没有执行公共链交易，没有开通付费订阅或发布 npm。Dune 查询与 Tenderly 模拟的业务权限等待官方处理申请。

# 钱包、Agent 与交易生态接入

更新日期：2026-10-24。轨道 W（`codex/bca-wallets`）。本文只记录实际接入、实际命令和真实限制；没有把说明文档、链接目录或不存在的接口当作适配。

## 边界

- BCA 只聚合成熟 SDK/API/CLI。没有新增 Agent 调度器、钱包、身份、支付或交易协议。
- 官方 MCP 由 M 轨道负责；本轨道不重复实现 MCP client。本轨道提供官方 SDK、官方 REST API、官方 Python SDK 和上层兼容入口。
- 未执行公共网络资金交易、生产部署、付费订阅或 npm 发布。所有链上写入验证仅限本机 Anvil；Safe/x402 只做本地签名或 `/verify`，不广播、不结算。
- 缺少供应商凭证时，对应工具在调用时明确失败；不会阻止其他工具使用。
- AgentKit 的遥测请求只在单次 SDK 调用期间被本地屏蔽（`cca-lite.coinbase.com`），不改变任何链上结果。

## 快速入口

```bash
# 类型检查和构建
npm run typecheck
npm run build

# 本轨道真实检查（启动本机 Anvil，使用公开只读 Solana/Base Sepolia/x402/Mesh/CCXT）
npx tsx scripts/check-wallets.ts

# elizaOS 真实 runtime 注册与 action 调用
npx tsx examples/agents/eliza-plugin.ts --invoke

# GAME Python SDK（先安装 game_sdk）
PYTHONPATH=.work/pysite python examples/agents/game_bca_plugin.py --check
```

## 项目状态

| 项目 | 接入方式 | 实际验证 | 当前状态 / 限制 |
| --- | --- | --- | --- |
| Coinbase AgentKit | `@coinbase/agentkit@0.10.4` + `ViemWalletProvider` | 本机 Anvil：地址、chain ID、余额、action 列表、1 wei 本地转账与回执 | 已验证。公共网络转账未执行；遥测在调用期间本地屏蔽 |
| Solana Agent Kit | `solana-agent-kit@2.0.10` + `@solana-agent-kit/plugin-token@2.0.9` | 公开 Solana RPC：SOL 余额、TPS、Dexscreener ticker → mint、action/method 列表 | 已验证只读。未配置私钥时使用进程内临时密钥；`tokens.jup.ag` 在当前网络不可达，token_data 调用如实失败 |
| elizaOS | `@elizaos/core@2.0.0-alpha.77`，真实 `AgentRuntime` + `Plugin.actions` | 注册 35 个 BCA action，调用 `BCA_WALLET_GOAT_STATUS` 成功 | 已验证注册与调用；未接模型/对话循环 |
| Virtuals GAME | 官方 `game_sdk==0.1.5`（PyPI），真实 `Function` + `WorkerConfig` | `--check` 通过 `bca_call` 执行真实 BCA CLI `content_cid` | 已验证 Function/Worker 结构；完整 Agent 需要 `GAME_API_KEY`（console.game.virtuals.io） |
| Olas / Open Autonomy | 官方 `open-autonomy==0.21.29` / `open-aea==2.2.9`，真实 `Behaviour` + `SkillContext` | `aea --version`、`aea create --empty`、`aea scaffold skill` 成功；`olas_bca_behaviour.py` 执行真实 BCA `content_cid` | 已验证 skill 侧调用；完整 AEA/服务运行需要 connections/Tendermint/IPFS，未执行 |
| Heurist Mesh | 官方 REST API（`mesh.heurist.xyz`） | 公开 `metadata.json`（43 agents）与 `mesh_schema`；`mesh_request` 需要 key | 目录/Schema 已验证；付费请求未执行 |
| Bankr | 官方 Agent API（`https://api.bankr.bot`，OpenAPI 3.0） | 无 key：`/wallet/me` 明确失败；工具已按官方 schema 实现 | 需要 Agent API key；未执行 prompt/资金操作 |
| Brian | 官方 `@brian-ai/sdk@0.3.7` | 无 key：`ask` 明确失败 | 需要 Brian API key；未执行付费/交易请求 |
| Safe | `@safe-global/protocol-kit@8.0.10` + `@safe-global/api-kit@5.0.4` | Base Sepolia 预测 Safe 地址、创建并本地签名真实 Safe 交易，返回 safeTxHash/签名 | 已验证本地签名；未部署/执行；API Kit 需要 key 或自建 tx service |
| x402 | `@x402/core@2.28.0` + `@x402/evm@2.28.0` | `/supported` 返回 11 种能力；本地签名 EIP-3009；公共 facilitator `/verify` 接受签名结构并以 `invalid_exact_evm_insufficient_balance` 拒绝 | 签名路径已验证；无测试网 USDC，未完成结算 |
| CCXT | `ccxt@4.5.89` | Kraken 公共 `BTC/USD` ticker、市场/OHLCV 代码路径 | 已验证公开只读；不使用 API key，不下单 |
| Hummingbot | 官方 `hbot` CLI 固定子命令（`--version`/`status --json`/`doctor`） | 当前 Windows/Python 3.13 环境未安装 `hbot`，工具明确 `ENOENT` | 安装阻塞：PyPI `20260922` 在 `coincurve` 构建失败；官方推荐 conda 或 Docker |
| GOAT | 不加载依赖，仅记录归档状态与迁移 | 上游 README 明确 `[Archived]`；npm `@goat-sdk/core@0.5.0`；GitHub API archived=false、last push 2026-07-02 | 未集成、不新增依赖；不声称已恢复维护 |

## Coinbase AgentKit

- 工具：`wallet_agentkit_wallet`、`wallet_agentkit_actions`、`wallet_agentkit_transfer_local`。
- 配置：`BCA_RPC_URL`、`BCA_CHAIN_ID`、`BCA_PRIVATE_KEY`；本地转账还需要 `BCA_ALLOW_WRITES=true`。
- `wallet_agentkit_transfer_local` 只允许 chain ID `1337`/`31337`，并等待真实回执。
- 不使用 CDP key；本实现走 `ViemWalletProvider`。CDP 钱包/AgentKit 的官方 MCP 由 M 轨道处理。
- 实测：Anvil 31337，`0xf39F...2266` 的 1 wei 转账回执 `success`。

## Solana Agent Kit

- 工具：`wallet_solana_status`、`wallet_solana_balance`、`wallet_solana_tps`、`wallet_solana_token_address`、`wallet_solana_token_data`、`wallet_solana_actions`。
- 配置：`BCA_SOLANA_RPC_URL`；可选 `BCA_SOLANA_PRIVATE_KEY`（base58 或 JSON 数组）。
- 未配置私钥时生成进程内临时 keypair，仅用于只读调用；输出明确标记 `signerMode=ephemeral`。
- 实测公开主网 RPC：余额 0、TPS > 0、`SOL` ticker 解析为 mint 地址、TokenPlugin 注册 `GET_TOKEN_DATA` 等 action。
- `wallet_solana_token_data` 依赖上游 `tokens.jup.ag`；当前网络 TLS 不可达，真实失败，未伪造数据。

## elizaOS

- `src/agents/eliza.ts` 导出 `createElizaPlugin(tools)` 和 `bcaToolsToElizaActions(tools)`；使用官方 `Plugin.actions` 契约。
- `examples/agents/eliza-plugin.ts` 创建真实 `AgentRuntime`、注册插件并可选执行 action。
- 实测注册 35 个 action；`BCA_WALLET_GOAT_STATUS` 返回成功。
- `@elizaos/core@2.0.0-alpha.77` 的类型入口没有导出 `Plugin` 类型，因此本仓库声明了与官方 `plugin.d.ts`/`components.d.ts` 对齐的结构类型；运行时仍使用官方 `AgentRuntime`。

## Virtuals GAME

- `examples/agents/game_bca_plugin.py` 使用官方 `game_sdk` 的 `Function`、`Argument`、`WorkerConfig`。
- `bca_call` 通过固定 `node <cli> call <tool> --input <json>` 调用 BCA，工具名做严格正则校验，`shell=False`，60 秒超时。
- 实测：`--check` 执行 `content_cid`，返回真实 README CID 和原始字节数。
- 完整 GAME `Agent`/`Worker` 运行需要 `GAME_API_KEY`；本次未配置，因此未调用托管 planner。

## Olas / Open Autonomy

- 官方入口：`open-autonomy==0.21.29`（PyPI），依赖 `open-aea==2.2.9`；官方文档 https://stack.olas.network/open-autonomy/。
- 本机 Python 3.13 安装成功（`.work/olas-site`）；`aea, version 2.2.9` 可执行。`aea create bca_agent --local --empty` 和 `aea scaffold skill bca_tools` 均成功。
- `autonomy --version` 因缺少可选 `aea_cli_ipfs` 失败；不作为已验证的 Open Autonomy CLI 结果。
- `examples/agents/olas_bca_behaviour.py` 使用官方 `aea.skills.base.Behaviour` 和 `SkillContext` 创建真实组件，`act()` 调用 BCA CLI `content_cid` 并返回真实 README CID。
- 完整 AEA/Open Autonomy 服务运行需要 connections、Tendermint 0.34.19、IPFS、Docker 等外部服务；本次未执行。BCA 的兼容入口是 AEA skill/Behaviour 调用 BCA CLI，而不是复制 Olas 的共识/调度框架。

## Heurist Mesh

- 公开目录：`https://mesh.heurist.ai/metadata.json`；Schema：`https://mesh.heurist.xyz/mesh_schema?agent_id=...`；请求：`POST /mesh_request`。
- `HEURIST_API_KEY`（或 `BCA_HEURIST_API_KEY`）用于 credits；官方 skill 还支持 x402 与 Inflow，本次未配置资金，因此未执行付费请求。
- 实测：目录 43 个 agent；`TrendingTokenAgent` schema 返回两个工具及 0.2 credits 价格。
- 未实现 MCP；Heurist 官方 MCP 由 M 轨道核查。

## Bankr

- 官方 OpenAPI：`https://docs.bankr.bot/openapi/api.yaml`；Base URL `https://api.bankr.bot`；认证 `X-API-Key`。
- 工具：`wallet_bankr_wallet`、`wallet_bankr_portfolio`、`wallet_bankr_prompt`、`wallet_bankr_job`。
- `wallet_bankr_prompt` 是异步任务提交，可能触发 key 允许的链上操作；必须显式 `submit=true` 且 `BCA_ALLOW_WRITES=true`，本轨道未用真实账户执行。
- 配置入口：https://bankr.bot/api-keys （Agent API 默认开启；Max Mode/Bankr Club 可能需要订阅或 credits）。
- 无 key 时实测返回明确配置错误，不伪造成功。

## Brian

- 官方 SDK：`@brian-ai/sdk@0.3.7`；默认 API `https://api.brianknows.org`。
- 工具：`wallet_brian_status`、`wallet_brian_ask`、`wallet_brian_transact`。
- `transact` 只返回 calldata，不签名、不广播；`ask` 需要 `knowledgeBase`，默认 `default`。
- 配置：`BRIAN_API_KEY`（或 `BCA_BRIAN_API_KEY`）；无 key 时实测明确失败。
- 官方 MCP `mcp-server-brian` 由 M 轨道负责；本轨道只做非 MCP SDK。

## Safe

- 工具：`wallet_safe_status`、`wallet_safe_service`、`wallet_safe_info`、`wallet_safe_predict`、`wallet_safe_sign_transaction`。
- Protocol Kit 走 `BCA_SAFE_RPC_URL` 或 `BCA_RPC_URL`；`BCA_SAFE_CHAIN_ID` 或 `BCA_CHAIN_ID`。
- API Kit 需要 `BCA_SAFE_API_KEY` 或 `BCA_SAFE_TX_SERVICE_URL`；官方 `safe.global` 服务要求 key。
- 实测 Base Sepolia：预测地址 `0xc750...35aD`，未部署；创建并本地签名 1 wei 交易，返回 safeTxHash `0x475e...6bb7`，未执行。
- 未部署 Safe、未提交 Transaction Service、未执行多签。

## x402

- 工具：`wallet_x402_supported`、`wallet_x402_create_payment`、`wallet_x402_verify`。
- 配置：`BCA_X402_FACILITATOR_URL`（默认 `https://x402.org/facilitator`）；签名密钥 `BCA_X402_PRIVATE_KEY`（回退 `BCA_PRIVATE_KEY`）。
- 使用 `@x402/core` + `@x402/evm` 的 exact scheme；默认网络 `eip155:84532`，默认资产由 SDK 的 `getDefaultAsset` 给出（Base Sepolia USDC，`name=USDC`、`version=2`）。
- 实测：`/supported` 11 种能力；本地签名通过 viem `verifyTypedData`；公共 facilitator `/verify` 接受签名结构，因新账户无 USDC 返回 `invalid_exact_evm_insufficient_balance`。未调用 `/settle`，未转移资产。
- 注意：Anvil 默认账户在 Base Sepolia 上有 EIP-7702 delegation（`eth_getCode` 返回 `0xef0100...`），会被 facilitator 当作智能账户走 ERC-1271；因此 x402 测试使用独立随机密钥，避免误判。

## CCXT

- 工具：`trading_ccxt_status`、`trading_ccxt_markets`、`trading_ccxt_ticker`、`trading_ccxt_ohlcv`。
- 配置：`BCA_CCXT_EXCHANGE`（默认 `coinbase`）及调用参数；不读取/不使用 API key。
- 实测 Kraken 公共 `BTC/USD` ticker 返回真实 last；未创建订单、未使用私有 API。
- Binance 在当前网络返回 451（地域限制），因此默认示例使用 Kraken/Coinbase；工具会把上游错误原样传播。

## Hummingbot

- 工具：`trading_hummingbot_version`、`trading_hummingbot_status`、`trading_hummingbot_doctor`。
- 只运行固定 `hbot` 子命令，`shell=False`，超时后终止；不启动/停止 bot，不连接交易所，不下单。
- 配置：`BCA_HBOT_BIN`（默认 `hbot`），工作目录为 `BCA_WORKING_ROOT`。
- 真实安装尝试：`python -m pip install --target .work/hummingbot-site hummingbot==20260922` 在 `coincurve` 构建阶段失败（Python 3.13/Windows 无可用 wheel，scikit-build-core 报错）。官方推荐 conda 源安装或 Docker；本机 Docker daemon 未运行，因此未执行 `hbot` 的实际启动。
- 当前工具真实返回 `spawn hbot ENOENT`；未声称 Hummingbot 已验证。

## GOAT

- 上游 `https://github.com/goat-sdk/goat` README 顶部明确 `[Archived] This repository is a read-only historical snapshot`。
- npm `@goat-sdk/core` 最新观察到 `0.5.0`；GitHub API 的 `archived` 字段在 2026-10-23 观察为 `false`，最后 push 为 2026-07-02。两个信号不一致，因此按“上游自述归档、不新增长期依赖”处理。
- 不加载 GOAT 运行时，不声称其恢复维护；`wallet_goat_status` 只返回核验事实和迁移范围（AgentKit / Solana Agent Kit / Safe / x402）。

## 环境变量

| 变量 | 用途 | 必填 |
| --- | --- | --- |
| `BCA_RPC_URL` / `BCA_CHAIN_ID` / `BCA_PRIVATE_KEY` | AgentKit、EVM、Safe 默认配置 | 对应工具需要 |
| `BCA_ALLOW_WRITES` | 本地转账、Safe 签名、Bankr prompt 的显式开关 | 写入/签名时 |
| `BCA_SOLANA_RPC_URL` | Solana Agent Kit RPC | Solana 工具 |
| `BCA_SOLANA_PRIVATE_KEY` | Solana 签署账户；省略时为只读临时密钥 | 否 |
| `BCA_X402_FACILITATOR_URL` | x402 facilitator | 否（默认官方） |
| `BCA_X402_PRIVATE_KEY` | x402 专用签名密钥；回退 `BCA_PRIVATE_KEY` | x402 签名 |
| `BCA_SAFE_CHAIN_ID` / `BCA_SAFE_RPC_URL` | Safe Protocol Kit 网络 | Safe 工具 |
| `BCA_SAFE_API_KEY` / `BCA_SAFE_TX_SERVICE_URL` | Safe Transaction Service | API Kit 工具 |
| `BANKR_API_KEY` / `BCA_BANKR_API_KEY` | Bankr Agent API | Bankr |
| `BRIAN_API_KEY` / `BCA_BRIAN_API_KEY` | Brian SDK | Brian |
| `HEURIST_API_KEY` / `BCA_HEURIST_API_KEY` | Heurist Mesh credits | Mesh 请求 |
| `BCA_CCXT_EXCHANGE` | CCXT 默认公开交易所 | 否 |
| `BCA_HBOT_BIN` | Hummingbot `hbot` 可执行文件 | 否（默认 `hbot`） |

## 集成依赖（交给集成 Agent）

以下为本轨道实际 import 的顶层包；版本为本机实际安装版本，未写入 `package.json`/`package-lock.json`：

- `@coinbase/agentkit@0.10.4`
- `solana-agent-kit@2.0.10`
- `@solana-agent-kit/plugin-token@2.0.9`
- `@solana/web3.js@1.99.0`
- `bs58@4.0.1`
- `@elizaos/core@2.0.0-alpha.77`（examples/check 的 runtime；插件工厂本身只用结构类型）
- `@safe-global/protocol-kit@8.0.10`
- `@safe-global/api-kit@5.0.4`
- `@x402/core@2.28.0`
- `@x402/evm@2.28.0`
- `ccxt@4.5.89`
- `@brian-ai/sdk@0.3.7`
- `viem@2.52.2`
- 既有 `ethers@6.17.0`、`zod@4.6.7`

`@x402/fetch` 已安装但本轨道未直接 import，不需要加入正式依赖。Hummingbot 是外部 CLI，不是 npm 包。

## 实际命令与结果

| 命令 | 结果 |
| --- | --- |
| `npm run typecheck` | 通过 |
| `npm run build` | 通过 |
| `npx tsx scripts/check-wallets.ts` | 35 个工具；Anvil 地址/余额/本地转账、Solana 余额/TPS/ticker、Safe 预测/签名、x402 supported/签名/verify、Mesh 目录/schema、CCXT ticker、elizaOS 35 actions、缺 key 明确失败均通过；Solana token_data 与 Hummingbot 为真实上游/安装阻塞 |
| `npx tsx examples/agents/eliza-plugin.ts --invoke` | 真实 AgentRuntime 注册并调用 action |
| `PYTHONPATH=.work/pysite python examples/agents/game_bca_plugin.py --check` | `content_cid` 返回真实 README CID，GAME Function/Worker 构建成功 |
| `PYTHONPATH=.work/olas-site python examples/agents/olas_bca_behaviour.py` | 真实 `Behaviour.act()` 返回 README CID；`aea --version` 为 2.2.9 |
| `npx tsx .work/test-x402-digest.ts` | 本地 `verifyTypedData` 为 true；Anvil 默认地址在 Base Sepolia 有 7702 code，故测试改用随机 x402 密钥 |

## 未完成项

- Bankr / Brian：没有 API key，未执行真实 prompt/ask/transact。
- Heurist Mesh：没有 credits/资金，未执行付费 `mesh_request`；x402/Inflow 支付路径未启用。
- Safe：没有 API key/自建 Transaction Service，未执行 API Kit 读取；未部署 Safe、未执行交易。
- x402：没有测试网 USDC，未完成 `/verify` 成功和 `/settle`。
- Solana：`tokens.jup.ag` 不可达，`wallet_solana_token_data` 未完成；未执行任何 Solana 交易。
- Hummingbot：未安装 `hbot`，未做本地 paper config/启动；安装阻塞已记录。
- Olas：`autonomy` CLI 缺少可选 `aea_cli_ipfs`；完整多 Agent 运行需要 Tendermint/IPFS/Docker。`aea` 与 Behaviour 调用已验证。
- 公共网络资金交易、生产部署、付费订阅、npm 发布均未执行。

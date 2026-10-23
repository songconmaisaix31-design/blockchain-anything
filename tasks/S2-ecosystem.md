# S2 成熟区块链生态接入

> 本文保留初始轨道与授权范围。原 Worker 执行已停止，本轮由主 Agent 直接接手；实际实现与验收以 [S2-progress.md](S2-progress.md) 为准。

日期：2026-10-23。基线 `a133367f45dcb87476aec137d17adc5b6d233b18`。用户授权接入其完整项目清单，实际测试通过后合并主线；继续只做工具聚合、复用成熟技术、局部修复和够用的测试。

主 Agent 负责官方资料核对、浏览器授权、公共文档、协调、最终检查与 main 合并。开发客户端使用 Orca 管理的 OpenCode 2.0.31，显式选择官方 `deepseek/deepseek-flash`；本机 `auth list` 已确认 DeepSeek 凭证已保存。官方说明旧 V4 Flash 名称目前由 V4.1 Flash 提供服务；禁止切换到 Alibaba。每条轨道固定 Worker、Worktree、Branch，独占以下路径，不修改他人文件。完成后 commit/push，集成 Agent 最后统一连接工具目录和依赖。

Orca 运行 `run_f881ab4d9b55` 已启动五个开发 Worker。各工作区使用忽略的本地 `opencode.json`，限定 `enabled_providers` 为 `deepseek`，主模型和小模型均为 `deepseek/deepseek-flash`，官方 API 地址为 `https://api.deepseek.com`。五个实际终端均已显示 `DeepSeek V4.1 Flash 1017 DeepSeek`。主分支工作区使用 `codex/bca-ecosystem`；全部新增能力仍处于开发和实际验证阶段。

| 轨道 / 分支 | 负责项目 | 独占 write_paths |
| --- | --- | --- |
| M / `codex/bca-services` | 官方 MCP 连接；OpenZeppelin、Slither MCP、Tenderly、GoPlus、Alchemy、thirdweb、Chainstack、Nansen、Dune、CoinGecko、Allium、Token Terminal、Messari、Coinbase Wallet、Bankr/Brian/Heurist 可用的官方服务；Kaito 官方可用接口核查 | `src/bridge/`、`docs/integrations/services.md`、`examples/services/`、`scripts/check-services.ts` |
| D / `codex/bca-development` | Forge/Cast、Hardhat、Slither 原生工具；OpenZeppelin、Trail of Bits、GoPlus、Alchemy、Uniswap、Allium、Heurist 官方 Skills | `src/development/`、`docs/integrations/development.md`、`examples/contracts/`、`examples/skills/`、`scripts/check-development.ts` |
| W / `codex/bca-wallets` | AgentKit、Solana Agent Kit、elizaOS、GAME、Olas、Safe、x402、CCXT、Hummingbot；Bankr/Brian/Mesh 的非 MCP 接口或上层兼容；GOAT 归档状态与维护中的替代接入 | `src/wallets/`、`src/agents/`、`src/trading/`、`docs/integrations/wallets-agents.md`、`examples/agents/`、`scripts/check-wallets.ts` |
| C / `codex/bca-chains` | Sign Protocol、Solana Attestation Service、Sui、Aptos、Walrus、Seal、Arweave；EAS delegation、批量操作、时间戳、PrivateData；viem | `src/chains/`、`src/storage/`、`src/providers/eas.ts`、`docs/integrations/chains-storage.md`、`examples/chains/`、`scripts/check-chains.ts` |
| P / `codex/bca-provenance` | OpenTimestamps、RISC Zero、cheqd、W3C VC、in-toto、SLSA、Sigstore/Cosign、OpenLineage、C2PA | `src/provenance/`、`src/identity/`、`docs/integrations/provenance.md`、`examples/provenance/`、`scripts/check-provenance.ts` |
| I / `codex/bca-ecosystem-integration` | 合并上述分支、必要导入和配置衔接、正式依赖与 lockfile、CLI/MCP 集成检查 | `src/toolkit.ts`、`src/index.ts`、必要的 `src/types.ts`、`src/cli/`、`src/mcp/`、`package.json`、`package-lock.json`、`.env.example`、集成检查 |

共同接口沿用 `ToolImplementation`、`defineTool` 和 `createToolkit()`。各模块导出同步工具工厂，真正的 SDK/CLI/MCP 调用放在异步 execute 中；不改变既有 20 工具语义。新增依赖按实际安装版本在各轨道交接中列明，由 I 写入正式 package/lockfile；开发可用 `npm install --no-save --package-lock=false` 安装真实依赖。

原生 MCP 用官方 client/transport 发现并调用，保留上游 Schema、分页、结果及错误；官方 CLI/SDK 直接调用。Skills 使用官方来源和成熟安装/读取方式；Agent 框架提供真实可运行的兼容入口。归档仓库保留准确迁移记录，不把旧服务名包装成仍可用的服务。无官方公开接口、付费权限或验证失败属于真实未完成项，禁止用链接目录或假 API 代替接入。

先完整读取用户提供的相关链接及其当前官方说明。每项只验证本项目实际连接的必要路径，使用真实 SDK、公开真实数据或 Agent 创建的公开测试项目；无 mock、自研协议、通用命令执行器、调度器或完成证明系统。文件通过编辑工具修改，中间结果放忽略的 `.work/`，禁止 `/tmp`。领域错误交回原 Worker。

用户允许利用本机浏览器登录态和 Google 账户完成官方登录与验证；主 Agent 处理这些 UI 操作，Worker 不访问个人浏览器资料或输出密钥。生产交易、钱包资金划转、付费订阅和 npm 发布仍不执行。服务需要 OAuth/凭证时准确报告官方入口与所需权限，浏览器登录成功不代替 API/MCP 实际调用。

验收：每项标记适配、配置、实际调用结果和限制；类型/构建与 CLI/MCP 主路径通过；主 Agent 检查提交后才合并 main。未完成项目保持未完成，不通过降低范围获得“全部通过”。

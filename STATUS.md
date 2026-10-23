# BCA 当前状态

更新日期：2026-10-23。S1 基线已完成；S2 已由主 Agent 直接接手，当前交付 **54 个工具**，其中 MCP 桥接、开发工具、viem 与 EAS 扩展已完成实际验证。

## 进行中的 S2

五个 OpenCode/DeepSeek Worker 在 17:44–21:10 期间没有产生代码或提交。用户确认后，主 Agent 已通过 Orca 结束这些 Dispatch/终端并保留 worktree，改为直接实现。逐项状态见 [S2 进度](tasks/S2-progress.md)。

| 内容 | 状态 |
| --- | --- |
| S1：EAS/EVM、CID、Kubo，20 个工具 | 已完成，见下文 |
| MCP 桥接（6 个工具） | 已实现；真实 stdio MCP 初始化、发现、调用、错误传播通过 |
| 开发工具（12 个工具） | 已实现；solc 离线编译、Skills 读取通过；Forge 受本机 solc/网络限制，Cast 受本会话 TCP 限制 |
| viem（6 个工具） | 已实现；真实 Anvil 部署、读写、回执、日志通过 |
| EAS 扩展（+10 个工具） | 已实现；真实 Anvil 批量声明/撤销、时间戳、Delegated、PrivateData 通过 |
| 外部 MCP 供应商真实调用 | 未完成：本机代理上游超时；Alchemy 待用户手机验证 |
| Sign/SAS/Sui/Aptos/Walrus/Seal/Arweave | 未开始 |
| 来源/身份与钱包/Agent 轨道 | 未开始 |
| main 合并、推送 | 未完成：GitHub 不可达 |

## 验证命令与结果（2026-10-23）

| 命令 | 结果 |
| --- | --- |
| `npm run typecheck`、`npm run build` | 通过 |
| `npm run check:bridge` | 通过；真实 stdio + Streamable HTTP MCP，初始化成功，54 个工具，真实 CID，上游错误使外层失败 |
| `node dist/cli/main.js call dev_status --input '{}'` | Forge/Cast/Anvil 1.7.1、Hardhat 本地依赖、solc 0.7.3、Slither 未安装 |
| `node dist/cli/main.js call dev_solidity_compile --input '{"path":"examples/contracts/src/Counter.sol"}'` | 编译成功，返回 ABI/bytecode，无诊断 |
| `node dist/cli/main.js call dev_skill_list --input '{"maxResults":5}'` | 读取本机 `~/.agents/skills` 成功 |
| `dev_forge_build`（offline） | 真实失败：没有匹配 `^0.7.0` 的 solc，且无法下载；工具返回 `ok:false`，未伪造成功 |
| 真实 Anvil viem 脚本 | `viem_chain/block/balance`、部署 Counter、`viem_read` 0→1、`viem_transaction`、`viem_logs` 全部通过 |
| 真实 Anvil EAS 脚本 | 多声明 2 个 UID、时间戳、PrivateData 证明、Delegated 签名/提交/撤销、批量撤销全部通过 |
| `git diff --check` | 通过 |

## 真实限制与未执行操作

- 外部 MCP 供应商（CoinGecko、Alchemy、Allium、Tenderly、Chainstack、thirdweb、Nansen、Dune、Token Terminal、Messari、GoPlus、Kaito）尚未完成真实 `tools/list`/`callTool`。预设和配置入口已实现；本机代理到外网上游持续超时。
- Alchemy 官方强制手机短信/语音验证；Allium 登录页 CDP 读取超时。网页登录成功不等于 MCP 授权完成。
- Slither 未安装；Forge 没有本机 solc，网络被阻断无法下载。
- 公共测试网写入、生产交易、npm 公开发布、生产钱包和原生 Codex 控制器审计未执行。包保持 `private: true`。
- `main` 尚未合并；本轮提交尚不能推送，原因是 GitHub 连接失败。

# BCA 当前状态

更新日期：2026-10-23。用户已审批方案并授权开发，产品定位为成熟区块链工具聚合。

S2 已开始：按 [生态接入计划](tasks/S2-ecosystem.md) 接入新增项目。新增能力尚未验收；用户授权在完整接入与实际验证通过后合并 main。以下为已完成的 S1 基线。

| 内容 | 状态 |
| --- | --- |
| 设计与工具研究 | 已完成，基线 `87df777` |
| README 与开发要求 | 已按最新指令更新 |
| SDK、CLI、MCP | 已集成，共用 20 个实际工具 |
| 实际依赖与构建 | 固定依赖和 lockfile 已提交，类型检查与构建通过 |
| 真实签名和入口检查 | CID、Schema、EIP-191、Anvil EAS 链下签名及三个 MCP stdio 入口通过 |
| Kubo | 隔离离线节点的 add/read、字节一致性和读取上限检查通过 |
| Base Sepolia | 官方 EAS/Registry 的只读连接、代码、关联和版本检查通过 |
| EAS 链上生命周期 | 真实 Anvil 上官方合约 register/get、attest/get/receipt/revoke 全部通过 |
| 安装包 | npm pack 后隔离安装，CLI 与官方 MCP client 检查通过 |
| 原生 Codex 控制器验证 | 未执行 |
| 生产交易与 npm 发布 | 未执行 |

当前分支 `codex/bca-toolkit`，远程 origin 指向用户指定的 GitHub 仓库。主工作区 Node.js `v24.16.0`，开发检查环境 Node.js `v24.19.0`；npm `11.13.0`、Orca `1.4.230`、Anvil `1.7.1`、Kubo `0.43.1`。集成提交为 `bcb60029304a255a12c6fb0c75bb00b73cfd43d6`，包含 A、B 和 EAS 读取字段修复。

## 验证命令与结果

| 命令 | 结果 |
| --- | --- |
| `npm run typecheck`、`npm run build` | 通过 |
| `npm ci --ignore-scripts --no-audit --no-fund`、`npm run build` | 主工作区安装 471 个包并构建成功 |
| `node dist/cli/main.js tools`、`node dist/cli/main.js content cid --input '{"path":"README.md"}'` | 主工作区入口运行成功，返回实际工具目录及当前 README 的 raw CID |
| `npx tsx .work/adapter-check.ts` | A：实际文件 CID、Schema、EIP-191、真实官方合约域和链下签名及相关拒绝行为通过 |
| `npx tsx .work/eas-read-check.ts` | A 局部复测：完整命名字段、大整数、缺失记录语义通过 |
| `node .work/check-interfaces.mjs`、`node .work/check-help.mjs` | B：CLI、SDK 导出及三个 stdio 入口通过 |
| `npm run smoke -- --scope onchain` | chain ID 31337，真实 EAS 生命周期通过，撤销时间从零变为非零 |
| `npm run smoke -- --scope ipfs` | 离线 Kubo add/read 字节一致，超限读取拒绝 |
| `npm run smoke -- --scope package` | 真实安装包 CLI JSON/错误退出与官方 MCP 的 20 工具、调用、结构化错误通过 |
| `node dist/cli/main.js call eas_status --input '{}'` | 显式配置 Base Sepolia 84532、官方地址且关闭写入后，只读检查通过 |
| `git diff --check` | 通过 |

`.work` 中的局部检查脚本保留在对应 Worker 工作目录；仓库提供统一的 `scripts/smoke.ts` 复测入口。按问题范围复测，没有重复运行已通过的完整检查。实际输入文件版本、CID、公共网络配置和复现方法见 [运行检查指南](docs/guides/verification.md)，轨道提交见 [S1 记录](tasks/S1-toolkit.md)。各检查创建的 Anvil、Kubo 和 MCP 子进程均已终止。

## 真实限制与未执行操作

当前适配为 EVM/EAS、CID 和 Kubo；MCP 使用 stdio。环境变量私钥签署仅用于受控本地开发，生产钱包尚未集成。链下验签未执行撤销、时间戳、有效期和来源信任检查，结果明确返回这些标记。

公共测试网写入、生产交易、npm 公开发布和原生 Codex SQLite/HTTP/会话/event_id 审计未执行。包保持 `private: true`。安装存在上游传递依赖弃用提示；本轮未执行完整依赖安全审计。

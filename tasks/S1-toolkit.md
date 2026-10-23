# S1 区块链工具聚合开发计划

日期：2026-10-23。用户批准开发、README 覆盖和成熟技术复用，要求够用的测试与局部修复。

## 轨道与所有权

| 轨道 | Worker / Worktree / Branch | 独占 write_paths |
| --- | --- | --- |
| A SDK 适配 | Orca Codex，独立 Worktree，`codex/bca-adapters` | `package.json`、`package-lock.json`、`tsconfig.json`、`.env.example`、`src/toolkit.ts`、`src/types.ts`、`src/config.ts`、`src/providers/`、`docs/guides/providers.md` |
| B 产品入口 | Orca Codex，独立 Worktree，`codex/bca-interfaces` | `src/cli/`、`src/mcp/`、`src/index.ts`、`docs/guides/usage.md` |
| I 集成 | A/B 完成后 Orca Codex，独立 Worktree，`codex/bca-integration` | 合并 A/B；`scripts/smoke.ts`、必要导出/配置衔接；领域错误交回原 Worker |
| 主 Agent | Local Codex，当前 Worktree，`codex/bca-toolkit` | README、HANDOFF、STATUS、`docs/SPEC.md`、`docs/TASKS.md`、`docs/QUESTIONS.md`、`docs/TOOLBOX.md`、`tasks/` |

Worker 不得覆盖他人贡献。全部文件通过文件编辑工具修改。中间材料仅在各自 `.work/`，禁止 `/tmp`、mock、视觉操作、Git 回滚和 force push。各轨道完成后 commit/push。I 合并后主 Agent 最终检查、更新文档并 push。

## 共同接口

A 提供 `src/toolkit.ts` 的 `createToolkit()`，返回 `{ tools, invoke }`：

- `tools` 为数组，每项含 `name: string`、`description: string`、`inputSchema: z.ZodObject`、`readOnly: boolean`。
- `invoke(name: string, input: unknown): Promise<unknown>` 严格校验输入后调用真实 SDK；未知工具和错误输入立即抛出错误。
- 工具名 `<family>_<operation>`；family 为 `evm`、`eas`、`content`、`ipfs`。入口从实际目录读取名称。
- 返回可 JSON 序列化，bigint 为十进制字符串，不输出秘密，日志不写 stdout。
- 配置从进程环境读取；没有 RPC/签署/IPFS 配置仍能发现工具、执行本地内容操作；依赖缺失配置的操作立即失败。

B 直接使用该接口，不复制业务实现，不创建替身。接口和依赖修改交由 A。B 可读取 A 的实际产物执行检查，不用假实现绕过编译错误。

## 构建约定

Node.js 24、TypeScript ESM。CLI 为 `src/cli/main.ts` → `dist/cli/main.js`，bin 为 `bca`。MCP 为 `dist/mcp/main.js`，SDK 为 `dist/index.js`。package 保持 `private: true`，包含 typecheck/build/smoke 脚本，固定依赖版本与 lockfile。

## 验收与执行记录

一次类型/构建与真实 smoke，覆盖文件 CID、官方 EAS 生命周期、签名及篡改拒绝、CLI/MCP、Kubo add/read、打包入口。只针对发现问题局部修复复测。没有公共测试网钱包和余额时明确记录未执行，不执行生产交易。

主客户端为 Local Codex。开发使用 Orca 1.4.230 管理的原生 Codex；A/B/I 的实际 provider 模型标识均为 `gpt-6-astra`，由 Orca 状态返回。A 的读取字段返修沿用原 Worktree、分支及写入范围，使用 `gpt-6-astra`、high reasoning effort。

Run：`run_9e6ec5edbcd6`。A 的 Worktree 为 `C:/Users/DW/orca/workspaces/blockchain-anything/bca-adapters`，Dispatch 为 `ctx_48443c9206f5`。B 的 Worktree 为 `C:/Users/DW/orca/workspaces/blockchain-anything/bca-interfaces`，Task 为 `task_d4a194b9d312`。两个路径独立，不共享文件写入。

执行环境：主工作区 Node.js 24.16.0；A 实际命令环境 Node.js 24.19.0；npm 11.13.0、Anvil 1.7.1。官方 Kubo 0.43.1 Windows 发行包已下载到主工作区 `.work/`，并通过发行摘要校验。

| 交付 | Commit / Dispatch | 实际检查 |
| --- | --- | --- |
| A | `79b6fe4fdf1a0e3bd28cdae5cf43dc61ec8abb4e` | 类型/构建；真实 CID、Schema、EIP-191、官方 Anvil 合约域与链下签名；篡改、错误网络和路径越界拒绝 |
| B | `bf25d7119afd15909826a4f7c2602ed37bbc81ff` / `ctx_19f25f52e4a7` | 类型/构建；CLI 发现和两种调用；官方 MCP client 检查三个 stdio 入口、20 工具、实际 CID 和失败后继续调用 |
| A 局部返修 | `611457462b28d30e3f5f69d4f43fc147d8e33475` / `ctx_b8849d24a84b`，沿用 A Worktree 与分支 | 类型检查及 `npx tsx .work/eas-read-check.ts` 通过；真实官方合约验证完整命名字段、十进制大整数及缺失 UID 的官方语义 |
| I | `bcb60029304a255a12c6fb0c75bb00b73cfd43d6` / `ctx_363c0cc54aa8`，Worktree `C:/Users/DW/orca/workspaces/blockchain-anything/bca-integration` | 类型/构建、真实 EAS 生命周期、离线 Kubo add/read、安装包 CLI/MCP 和公共 Base Sepolia 只读检查通过 |

A/B/I 及 A 局部返修已完成并 push，终端按 Orca 交付状态释放；代码保留在各自分支和 Worktree。主 Agent 已将集成提交 fast-forward 合并到 `codex/bca-toolkit`。只对实际发现的问题局部修复和复测，集成阶段没有重复完整的 A/B 检查。当前没有未解决的开发阻塞。

主工作区运行 `npm ci --ignore-scripts --no-audit --no-fund` 和 `npm run build` 成功；`node dist/cli/main.js tools` 及当前 README 的 `content cid` 调用成功。最终检查 `git diff --check` 通过。Orca 已确认本 Run 的全部开发终端均已释放。

公共测试网写入、生产交易、npm 公开发布、生产钱包接入和原生 Codex 控制器审计未执行；普通 MCP client 与本地节点结果按实际范围报告。

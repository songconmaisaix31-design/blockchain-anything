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

主客户端为 Local Codex。开发使用 Orca 1.4.230 管理的原生 Codex；A 的实际 provider 模型标识为 `gpt-6-astra`，由 Orca 状态返回。没有手动覆盖模型配置。

Run：`run_9e6ec5edbcd6`。A 的 Worktree 为 `C:/Users/DW/orca/workspaces/blockchain-anything/bca-adapters`，Dispatch 为 `ctx_48443c9206f5`。B 的 Worktree 为 `C:/Users/DW/orca/workspaces/blockchain-anything/bca-interfaces`，Task 为 `task_d4a194b9d312`。两个路径独立，不共享文件写入。

执行环境已核实 Node.js 24.16.0、npm 11.13.0 和 Anvil 1.7.1。B 的首次启动因 Codex 工作区发现超时退出，第二次启动未在默认时间内就绪；已按 Orca 返回结果清理对应终端并在同一 Task/Worktree 重试，未创建重复编辑任务。

# BCA 交接

更新日期：2026-10-23（Asia/Shanghai）。

## 阅读顺序

1. [STATUS.md](STATUS.md)。
2. [docs/QUESTIONS.md](docs/QUESTIONS.md) 中的已确认决定和待确认项。
3. [docs/SPEC.md](docs/SPEC.md)、[docs/TOOLBOX.md](docs/TOOLBOX.md)。
4. [docs/TASKS.md](docs/TASKS.md)、[tasks/S0-plan.md](tasks/S0-plan.md)。

## 当前授权

用户于 2026-10-23 指定参考 [morluto/rea](https://github.com/morluto/rea)，交付完整方案、工具选型和开发任务；**确认后开始开发**。本轮允许提交方案文档并推送到用户指定的 [blockchain-anything](https://github.com/songconmaisaix31-design/blockchain-anything) 仓库。

当前规格是一套完整设计建议。尚未确认的实现语言、组件、首发链、签署器、实际案例和发布范围不得解释成既定决定。继续工作前读取用户对文档的最新修改。

## 仓库基线

- 本地接管时只有 `.git`，无 Commit、远程和项目文件。
- 用户随后提供远程仓库；远程基线为 `c537c9772e0e529e1d8001bf845f786a89ff7b7f`，包含 README 和 MIT LICENSE。
- 设计分支 `codex/bca-design` 从该基线建立。README 按本轮用户提出的通用证明与身份方向更新。
- 当前文件均为设计、规划和状态记录；没有安装项目依赖、启动服务或部署合约。

## 下一步

取得 [待确认事项](docs/QUESTIONS.md) 的决定后，按 [开发任务](docs/TASKS.md) 启动对应阶段。需要并行开发时，使用 Orca CLI 分配互斥 `write_paths`、固定 Worker、Worktree 和 Branch；当前没有已启动的开发轨道。

真实 Codex 验证继续遵守用户指定范围：Agent 创建的公开 Git 项目、真实原生控制器、实际 HTTP 服务、真实 SQLite 和实际会话文件；原生文件与命令工具关闭，逐条核对 `event_id`。本轮没有执行该验证。

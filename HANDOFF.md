# BCA 交接

更新日期：2026-10-23。

先读 [STATUS.md](STATUS.md)、[docs/QUESTIONS.md](docs/QUESTIONS.md)，再读 [规格](docs/SPEC.md)、[任务](docs/TASKS.md) 和 [开发计划](tasks/S1-toolkit.md)。

用户已批准开发，确定只做区块链工具聚合，尽可能复用成熟技术。README 按该定位覆盖，测试只保留够用的实际检查，错误局部修复和复测。

工作分支 `codex/bca-toolkit`，设计基线 `87df7770030fe1f05ff7effc862476746f7f6f57`。远程为 `https://github.com/songconmaisaix31-design/blockchain-anything.git`。

通过 Orca CLI 分配互斥范围；Worker 负责开发、验证、返修、提交和推送；集成 Agent 在轨道完成后合并；主 Agent 负责文档和最终检查。不要恢复已移除的自定义协议设计。

原生 Codex 控制器审计要求见 TASKS，普通 MCP client 检查不能替代该结果。生产交易和 npm 公开发布未执行。

# BCA 交接

更新日期：2026-10-23。

当前任务已进入 [S2 生态接入](tasks/S2-ecosystem.md)。用户授权完整清单接入、真实验证通过后的 main 合并，以及 OpenCode/DeepSeek 官方模型和本机浏览器登录验证。下文为已完成 S1 基线；S2 新增能力必须逐项实际验证后更新状态。

先读 [STATUS.md](STATUS.md)、[docs/QUESTIONS.md](docs/QUESTIONS.md)，再读 [规格](docs/SPEC.md)、[任务](docs/TASKS.md) 和 [开发计划](tasks/S1-toolkit.md)。

用户已批准开发，确定只做区块链工具聚合，尽可能复用成熟技术。README 按该定位覆盖，测试只保留够用的实际检查，错误局部修复和复测。

工作分支 `codex/bca-toolkit`，已合并代码集成提交 `bcb60029304a255a12c6fb0c75bb00b73cfd43d6`。远程为 `https://github.com/songconmaisaix31-design/blockchain-anything.git`。

当前实现提供 20 个共用工具：EVM 5 个、EAS 10 个、Content 2 个、IPFS 3 个。CLI 使用 Incur，MCP 使用官方 SDK，底层复用 ethers、EAS SDK、multiformats 和 kubo-rpc-client。安装构建后可运行 `node dist/cli/main.js tools`；MCP 入口为 `node dist/mcp/main.js`。使用方法见 [README](README.md) 与 [使用指南](docs/guides/usage.md)。

必要检查已经通过：真实 Anvil 官方 EAS 生命周期、签名、实际 Kubo 读写、CLI、三个 MCP stdio 入口、安装包和 Base Sepolia 只读检查。EAS 查询保持完整命名字段及官方缺失记录语义。按故障位置局部复测，详见 [运行检查指南](docs/guides/verification.md)。

通过 Orca CLI 分配互斥范围；Worker 负责开发、验证、返修、提交和推送；集成 Agent 在轨道完成后合并；主 Agent 负责文档和最终检查。不要恢复已移除的自定义协议设计。

原生 Codex 控制器审计要求见 TASKS，普通 MCP client 检查不能替代该结果。当前仅支持 stdio 与本地开发签署器；公共测试网写入、生产交易、npm 公开发布和原生控制器审计未执行。当前实现没有等待用户审批或代为测试的事项。

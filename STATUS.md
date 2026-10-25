# BCA 当前进度

2026-10-25，版本 0.3.0，开发分支 `codex/bca-s2-complete`。保持 `private:true`，尚未发布 npm 或合并 main。

- 已实现：共享 SDK/CLI/MCP 入口、两个 EVM 工作站、客户端安装配置、官方 MCP 连接复用，以及 S2 生态适配。
- 本轮精简：按编译/测试/部署生成步骤，新增 `bca find`，按需返回 Schema，删除运行时“验证记录”，压缩 doctor 和重复进度文档。
- 待完成：Windows/WSL2 原生客户端验收、需要账户的供应商业务路径、公共测试网源码上传验证。具体命令见本地交接。

| 记录 | 内容 |
| --- | --- |
| [本轮检查与精简](docs/acceptance/2026-10-25.md) | 问题、修改、实际验证及剩余限制 |
| [上一轮工作站验收](docs/acceptance/2026-10-24.md) | 真实失败交易诊断、编译/测试/部署、setup 与会话 |
| [本地 Agent 交接](docs/acceptance/BCA-LOCAL-AGENT-HANDOFF-20261024.md) | 环境和账户受阻路径的命令与验收标准 |
| [S2 逐项状态](tasks/S2-progress.md) | 各生态适配已验证范围与缺项 |
| [S2 实际运行](docs/acceptance/2026-10-23.md) | 运行证据及修复记录 |

已验证范围按各记录的日期与环境解释。新建工具入口不会自动改变其业务验收状态。

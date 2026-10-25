# BCA 交接

当前进度见 [STATUS](STATUS.md)，v1 实际结果见 [本轮记录](docs/acceptance/2026-10-25-v1.md)。用户 D14 已授权合并，更新此前等待完整生态验收的合并时点。

共享入口是 `src/toolkit.ts`。新增产品入口复用现有实现：`development/project.ts` 创建并运行项目，`workstations/search.ts` 检索真实目录，`bridge/manage.ts` 保存官方 MCP 预设。setup 生成客户端配置和自动读取的工作流入口。

使用 Node 24.16+；`npm ci` 会通过 prepare 构建。按变更选择相关检查：`check:v1` 跑新建项目和真实 OpenZeppelin MCP；`check:setup` 跑实际打包安装；`check:next -- onchain` 跑本地链开发与诊断；`check:sessions` 跑连接边界。只有改动或失败涉及相应路径时才复测，不重复全生态验收。

Windows 原生实测见 [Windows 记录](docs/acceptance/2026-10-25-windows.md)。默认 `npm ci` 受 Foundry 1.7.1 postinstall 的 cmd 语法阻塞；使用 `--ignore-scripts` 并手动构建后，核心 CLI/MCP、Foundry 本地链和 Kubo 路径已通过。`check:setup` 的 npm 启动、doctor 的 npm 客户端识别、PowerShell nextCommand 及进程清理仍有已复现问题。

后续优先完成用户实际任务带出的缺口。账户/资金/平台缺项仍见 [原生客户端与服务交接](docs/acceptance/BCA-LOCAL-AGENT-HANDOFF-20261024.md)，该历史文档中的合并时点以 D14 为准。保持 private；未执行公共 npm 发布或生产交易。

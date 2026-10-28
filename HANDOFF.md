# BCA 交接

当前进度见 [STATUS](STATUS.md)，v1 实际结果见 [本轮记录](docs/acceptance/2026-10-25-v1.md)。用户 D14 已授权合并，更新此前等待完整生态验收的合并时点；2026-10-29 用户进一步要求将 Windows 修复合入 `main`。

共享入口是 `src/toolkit.ts`。新增产品入口复用现有实现：`development/project.ts` 创建并运行项目，`workstations/search.ts` 检索真实目录，`bridge/manage.ts` 保存官方 MCP 预设。setup 生成客户端配置和自动读取的工作流入口。

使用 Node 22.12+（22 LTS）或 Node 24 LTS；`npm ci` 会通过 prepare 构建。按变更选择相关检查：`check:v1` 跑新建项目和真实 OpenZeppelin MCP；`check:setup` 跑实际打包安装；`check:next -- onchain` 跑本地链开发与诊断；`check:sessions` 跑连接边界。只有改动或失败涉及相应路径时才复测，不重复全生态验收。

Windows 修复覆盖敏感环境变量大小写、Solidity import 与技能真实路径边界，附带同长度 MCP 配置更新检查。主线使用 solc 0.8.35；`smoke -- --scope windows,development,interfaces` 验证 Windows、真实本地链开发和入口。环境及合并记录见 [Windows 验证任务](tasks/windows-availability.md)。

后续优先完成用户实际任务带出的缺口。账户/资金/平台缺项仍见 [原生客户端与服务交接](docs/acceptance/BCA-LOCAL-AGENT-HANDOFF-20261024.md)，该历史文档中的合并时点以 D14 为准。保持 private；未执行公共 npm 发布或生产交易。

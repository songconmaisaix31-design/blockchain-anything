# BCA 交接

当前进度见 [STATUS](STATUS.md)，供应商发现与工作站结果见[任务记录](tasks/task-discovery.md)。D14 授权通过相关真实验证的改动合并主线；D16 确定本轮功能范围，D17 明确批准本轮使用 Codex 子 Agent。后续并行默认遵循最新 Swarm CLI 执行协议。

Dune、GoPlus、Tenderly 后续结果见[真实业务记录](tasks/service-workflows.md)。本机项目已配置并授权 Dune/Tenderly OAuth，官方缓存可复用；Dune 只读计划拒绝执行查询，Tenderly 默认项目缺少 MCP 业务权益。已向两家官方支持发送开发/评估权限申请，等待回复。GoPlus 公开代币风险读取不需要账户，沿用 `goplus_token_security`；钱包、授权检查及账户限定字段仍沿用官方 MCP 配置。Windows MCP 关闭和授权超时会清理本次启动的进程树。

共享入口是 `src/toolkit.ts`。`development/project.ts` 创建并运行 Counter/ERC20/ERC721 项目，`development/workspace.ts` 完成本机 Anvil 部署和 NFT 铸造；`workstations/search.ts` 检索工具与供应商，`bridge/config.ts` 维护唯一预设及认证模板，`bridge/manage.ts` 保存配置。各工作站步骤在 `workstations/catalog.ts`，宿主补全实际参数并执行，错误与缺项保留。

使用 Node 22.12+（22 LTS）或 Node 24 LTS；`npm ci` 会通过 prepare 构建。按变更选择相关检查：`check:v1` 跑新建项目和真实 OpenZeppelin MCP；`check:setup` 跑实际打包安装；`check:next -- onchain` 跑本地链开发与诊断；`check:sessions` 跑连接边界。只有改动或失败涉及相应路径时才复测，不重复全生态验收。

供应商与新工作站使用 `scripts/check-discovery.ts` 和 `scripts/check-workstations.ts`。前者调用真实 OpenZeppelin，`--dune` 额外检查官方无授权错误；后者支持 `guides`、`nft`、`slither`、`all`，Slither 需安装官方程序并配置目标编译器。有效账户业务仍需凭据验证，不能将发现成功当作查询或安全检查业务通过。

Windows 修复覆盖敏感环境变量大小写、Solidity import 与技能真实路径边界，附带同长度 MCP 配置更新检查。主线使用 solc 0.8.35；`smoke -- --scope windows,development,interfaces` 验证 Windows、真实本地链开发和入口。环境及合并记录见 [Windows 验证任务](tasks/windows-availability.md)。

后续优先完成用户实际任务带出的缺口。账户/资金/平台缺项仍见 [原生客户端与服务交接](docs/acceptance/BCA-LOCAL-AGENT-HANDOFF-20261024.md)，该历史文档中的合并时点以 D14 为准。保持 private；未执行公共 npm 发布或生产交易。

# BCA 当前进度

2026-10-25，版本 1.0.0。精简改动已通过 PR #1 合并 main（`9ef990a`）；v1 产品入口已完成相关真实验证，按 D14 授权交付 main。保持 `private:true`，未发布 npm。

- 产品入口：`find / init / build / test / connect / setup / doctor`，共用 SDK/CLI/MCP 实现。
- 实际任务：Counter / OpenZeppelin ERC20 创建、Foundry/Hardhat 编译测试、官方 MCP 发现和调用、EVM 失败诊断、本地 Anvil 部署并读回状态。
- 精简原则：按任务调用现有工具，按需读取 Schema，沿用官方组件；不增加评分、覆盖率门槛或重复运行时验收记录。
- 已知缺项：Windows/macOS 原生客户端、账户型服务业务路径、公共测试网源码上传验证。保留实际未测状态，不阻塞已验证主线。

本轮实际检查与限制集中在 [v1 记录](docs/acceptance/2026-10-25-v1.md)。历史参考：[精简审阅](docs/acceptance/2026-10-25.md)、[工作站](docs/acceptance/2026-10-24.md)、[S2 生态](tasks/S2-progress.md)。

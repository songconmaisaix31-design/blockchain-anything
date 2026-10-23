# BCA 交接

更新日期：2026-10-23。

用户已批准开发；项目只做成熟区块链工具聚合，复用官方 SDK/CLI/MCP/Skills，不自研协议；只做够用的测试，发现错误后局部修复、局部复测。原始目标与完整生态清单见 ChatGPT/Codex 桌面端线程 `01a166cb-b930-7970-b9b4-9b00d2239c5e`，关键结论已整理在 `.work/takeover-context.md`。

当前分支 `codex/bca-ecosystem`。S1 的 20 个工具已完成并验证；S2 已由主 Agent 直接接手，交付 54 个工具：

- MCP 桥接 6 个：标准 `mcpServers` 配置、stdio/Streamable HTTP、发现、调用、资源、提示。
- 开发工具 12 个：solc 离线编译、Forge/Hardhat/Slither、Cast、Skills。
- viem 6 个、EAS 扩展 10 个（批量、时间戳、Delegated、PrivateData）。

先读 [STATUS.md](STATUS.md)、[S2 进度](tasks/S2-progress.md)、[MCP 服务](docs/integrations/services.md)、[开发工具](docs/integrations/development.md) 和 [链与存储](docs/integrations/chains-storage.md)。

仍未完成：外部 MCP 供应商的真实调用、Sign/SAS/Sui/Aptos/Walrus/Seal/Arweave、来源/身份、钱包/Agent 框架；`main` 尚未合并。当前阻塞是本机代理到外网上游超时（DeepSeek 可通）、GitHub 不可达，以及 Alchemy 账户手机验证需要用户完成。没有经过真实调用通过的项目不得标记为完成。

必要检查已通过：`npm run typecheck`、`npm run build`、`npm run check:bridge`、真实 Anvil 上的 viem 与 EAS 扩展脚本、solc 离线编译、Skills 读取。具体命令和未执行项见 STATUS。

远程为 `https://github.com/songconmaisaix31-design/blockchain-anything.git`；网络恢复后先推送当前分支，再按 S2 进度继续。

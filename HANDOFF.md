# BCA 交接

更新日期：2026-10-29。

项目聚合成熟区块链 SDK/CLI/MCP/Skills，当前分支 `codex/bca-ecosystem` 提供 54 个工具。用户已授权开发、真实验证、局部修复、提交和推送；本轮要求测试 Windows 可用性并修复问题。

先读 [STATUS.md](STATUS.md)、[Windows 验证任务](tasks/windows-availability.md) 和 [S2 进度](tasks/S2-progress.md)。

本轮已完成：

- Windows 11 / PowerShell 7 / Node.js 24 的类型、构建、CLI/MCP、真实 Anvil EAS 生命周期与签名、Kubo 离线存取、npm 包安装后入口验证。
- Cast/viem 真实链调用，Forge 构建与测试，Hardhat 编译，Slither 分析及 Skills 读取。
- Solidity import 与 Skills 的真实路径边界修复、Windows 混合大小写敏感环境变量过滤、MCP 配置更新即时生效。
- 在现有 smoke 中补充 `windows` 和 `development` 范围；桥接脚本覆盖同长度配置修改与环境变量重新展开。使用方法见 [运行检查指南](docs/guides/verification.md)。

本机 Slither 位于 `.work/windows-tools/Scripts`，调用时显式加入进程 PATH；Kubo 位于 `.work/kubo-dist/kubo/ipfs.exe`。Forge 已可使用 Solidity 0.7.6，Hardhat 2.22.4 实际编译通过。Slither 分析保留两项 `solc-version` 信息提示和原始非零退出码。

仍未完成：外部 MCP 供应商真实调用、Sign/SAS/Sui/Aptos/Walrus/Seal/Arweave、来源/身份、钱包/Agent 框架及 `main` 合并。Alchemy 手机验证需要用户完成。公共测试网写入、生产交易、npm 发布和原生 Codex 控制器事件审计均未执行。

远程：`https://github.com/songconmaisaix31-design/blockchain-anything.git`。GitHub 与 npm 本次连接成功。没有实际调用通过的项目不得标记为完成。

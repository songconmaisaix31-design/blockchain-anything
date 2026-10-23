# BCA 交接

更新：2026-10-23。已批准的开发要求继续有效：只聚合成熟区块链基础设施，尽量复用官方 SDK/CLI/MCP/Skills；测试够用即可，错误局部修复、局部复测。

本轮分支 codex/bca-s2-complete，基于生态分支 4194200；工具由 54 增至 104。代码入口为 src/toolkit.ts，新增实现按 chains/storage/wallets/agents/trading/provenance/identity 分组。README 已重写，配置见 .env.example 与 examples/services。

先读 [STATUS](STATUS.md) 和 [S2 逐项清单](tasks/S2-progress.md)。本轮通过了 build、check:s2、check:bridge、真实打包安装、本地 EAS 生命周期、OZ 编译/生成、Forge、Slither 分析、Sui/Aptos/Solana 公开读取、Arweave、VC、AgentKit 钱包详情、Solana Agent Kit balance、CCXT 公开行情和 Python MCP 示例。无需反复跑这些不相关路径。

最新真实运行见 [验收报告](docs/acceptance/2026-10-23.md)：新增 Safe、Hardhat/Cast、Sign/SAS、Walrus/Seal、x402 supported、cheqd、RISC Zero、Cosign/SLSA/in-toto/C2PA 验收。Safe 自定义网络缺口通过原生 contractNetworks 修复，并完成批量待签 hash 局部复测。

Slither MCP 示例也已固定官方源码和 uv.lock 中的依赖版本，cwd 与项目对齐；发现 23 工具，实际分析返回 9 合约，详见开发指南。

下一步需要的是待验收项目的服务凭据、Bitcoin 节点和 OpenLineage 后端，详见清单。缺失时保持未验收；不硬编码凭据、不发送生产交易、不执行付费订阅。Kaito 没有已核实通用接口，GOAT 已停止维护。

AgentKit 工厂与 Solana Agent Kit 在独立 Worker 内执行。AgentKit 0.10.4 背景 analytics 存在未处理拒绝；不能去掉隔离后仍声称运行稳定。工具超时不代表链上操作未提交，不自动重试。

新鲜 checkout 使用 Node 24、npm ci、npm run build。可选 Agent 宿主依赖需按 examples/agents 单独安装；来源验证工具需在 PATH 安装各官方 CLI。不要将开发机 .work 内临时程序和测试凭据当作产品依赖。

所有生态项目真实验收后再合并 main，这一条件尚未满足。代码推送开发分支用于继续接入与审阅；保持 npm private:true。

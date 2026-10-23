# BCA · Blockchain-Anything

**Tokenize nothing, attest everything.**

BCA 是面向开发者和 AI Agent 的区块链工具聚合项目。通过统一的 CLI、MCP 和 TypeScript SDK，调用成熟的链上声明、账户、签名、内容寻址和存储工具。

文档、数据集、模型、Agent 定义、工作流和事件可以使用已有协议记录内容摘要、发布声明、引用前序声明和查询撤销状态。BCA 保留底层协议的原生标识和验证语义。

## 使用的基础设施

| 能力 | 复用的技术 | BCA 的职责 |
| --- | --- | --- |
| 链上与链下声明 | Ethereum Attestation Service（EAS）官方 SDK 与合约 | Schema 编码、发布、查询、撤销、链下签名和验证 |
| EVM 账户与交易 | ethers | 网络、余额、回执、消息签名验证及交易连接 |
| 内容寻址 | multiformats、CIDv1、SHA-256 | 为实际文件计算标准 CID |
| 内容存储 | IPFS Kubo RPC 客户端 | 向用户配置的节点添加文件和读取内容 |
| 终端入口 | Incur | 命令发现、参数校验和结构化输出 |
| Agent 入口 | 官方 MCP TypeScript SDK | stdio 工具发现和调用 |

首批适配 EAS/EVM 和 IPFS。其他链按其官方 SDK、实际部署和可验证能力增加独立适配器。项目不自行定义链上身份协议、代币、授权协议、Hash 格式或智能合约。

## 开发状态

用户已审批方案并授权开始开发。当前正在实现工具聚合包；安装命令、实际工具目录和验证结果将在实现完成后写入本页。

包在开发期间保持私有发布设置，可执行文件名为 `bca`。生产网络、付费服务和 npm 公开发布不在本次执行范围内。

## 开发要求

- 优先复用官方 SDK、已部署协议和成熟库；项目代码集中在配置、参数转换、错误传播和入口适配。
- CLI 与 MCP 复用同一份工具定义和执行函数，保留 chain ID、合约地址、原生 UID、CID 和交易哈希。
- 查询与写入分别配置。写入明确指定网络、签署器和提交意图；密钥不作为 MCP 参数或命令行参数传递。
- 配置、网络、编码或链上错误立即报告，不返回伪造成功结果。
- 只做够用的验证：类型与构建检查、一次真实操作检查；发现错误后局部修改并复测受影响部分。
- 使用真实 SDK、真实节点和实际文件；测试不使用 mock、伪造 RPC 或虚构原生协议。

## 项目文档

- [规格与支持边界](docs/SPEC.md)
- [成熟工具与公链资料](docs/TOOLBOX.md)
- [REA 产品结构参考](docs/REA-REFERENCE.md)
- [开发任务](docs/TASKS.md)
- [已审批决定](docs/QUESTIONS.md)
- [本轮开发计划](tasks/S1-toolkit.md)
- [当前状态](STATUS.md) · [交接](HANDOFF.md)

## 许可证

[MIT](LICENSE)。第三方工具保留各自的许可和署名。

# BCA · Blockchain-Anything

**Tokenize nothing, attest everything.**

BCA 的产品目标是提供通用链上存证与身份协议：让 Agent、文档、数据集、模型、工作流、实体对象、凭证描述和事件记录拥有可验证的身份、声明、版本关系与授权。

用户通过自然语言提出任务，Agent 通过 MCP 操作 BCA；开发者通过 CLI 和 SDK 使用同一套业务能力。底层复用现有声明协议、身份标准、密码学库与公链工具。

**当前状态：设计方案待确认。仓库尚未实现或发布 BCA CLI、MCP 服务、SDK 和合约。文档中的命令、接口、目录及组件均为设计建议。**

## 产品能力

| 能力 | 设计目标 |
| --- | --- |
| Object | 分别标识长期对象、不可变内容版本和组合成员 |
| Attestation | 签署来源、权限、质量和执行声明，支持有效期与撤销 |
| Identity | 区分主体、控制者、签署密钥、代理执行者，管理轮换与恢复 |
| Capability | 委派受资源、动作、受众和时间限制的权限 |
| Verification | 分项验证内容、签名、权限、状态、最终性、可用性和信任策略 |
| Composition | 核验数据、工具、执行、产物和验证者之间的有向关系 |
| Providers | 按实际能力接入公链、存储、签署器和可选 ZK 验证器 |

内容摘要证明内容一致；签名证明某个密钥签署了声明。来源、执行过程、现实身份和质量结论还需要明确的证据来源与验证规则。

## 设计文档

- [产品规格与协议设计](docs/SPEC.md)：原语、生命周期、隐私、验证、MCP 与 CLI。
- [工具选型与公链能力](docs/TOOLBOX.md)：官方来源、建议组合、适配边界。
- [REA 产品结构参考](docs/REA-REFERENCE.md)：已读取的源码与可借鉴部分。
- [开发任务与验收](docs/TASKS.md)：依赖顺序、文件责任和真实验证要求。
- [用户决定与待确认事项](docs/QUESTIONS.md)：区分已确认方向和建议。
- [当前状态](STATUS.md)、[交接入口](HANDOFF.md)、[S0 记录](tasks/S0-plan.md)。

建议的主实现组合为 TypeScript、官方 MCP TypeScript SDK、Incur、EAS/EVM、multiformats/IPLD、标准签名及能力授权库。Solana、Sui、Aptos、Bitcoin 和 Cosmos 的适配范围分别定义，发布时按实测能力声明支持。

## 许可证

[MIT](LICENSE)。集成第三方代码和工具时保留其适用的许可与署名。

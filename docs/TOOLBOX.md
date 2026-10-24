# 成熟区块链工具与公链资料

核查日期：2026-10-23。当前选型已批准，实际安装版本和验证结果以 package-lock.json、STATUS 和使用指南为准。以下资料来自官方项目；读过资料不等于已完成适配或验收。

## 当前采用的组件

| 能力 | 成熟组件 | 聚合边界 |
| --- | --- | --- |
| CLI | [Incur](https://github.com/wevm/incur) | 命令、帮助、结构化输出 |
| MCP | [官方 TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk) | 分离的 server/client 包，当前接入 stdio |
| Schema | [Zod](https://zod.dev/) | CLI/MCP 共用严格参数定义 |
| 声明 | [EAS SDK](https://github.com/ethereum-attestation-service/eas-sdk) | Schema、链上/链下签名、查询、撤销，保留原生 UID |
| EVM | [ethers v6](https://docs.ethers.org/v6/) | 明确 RPC、chain ID、签署器和回执 |
| 内容 | [multiformats](https://github.com/multiformats/js-multiformats) | CIDv1、raw codec、标准 SHA-256 |
| IPFS | [kubo-rpc-client](https://github.com/ipfs/js-kubo-rpc-client)、[Kubo](https://github.com/ipfs/kubo) | 操作者配置节点，实际 add/read，不提供托管存储 |
| 本地 EVM | [Anvil](https://getfoundry.sh/anvil/overview/) | 部署并运行官方 EAS 合约，用于本地真实交易检查 |

安装时核对官方文档和对应版本的类型声明。EAS SDK 依赖 ethers；保持兼容版本，不自行替代 ABI 编码、签名或 CID 实现。

## EAS 适配边界

官方部署表包含多个 EVM 网络，各链合约版本可能不同。根据选定网络核对合约地址、字节码和签名域，保留 chain ID 与合约地址。Base Sepolia 是公共测试网目标；本地 Anvil 明确配置真实部署地址。[官方部署表](https://github.com/ethereum-attestation-service/eas-contracts#deployments)

Schema 注册、attest、get、revoke 和链下签名直接调用 SDK。EAS delegation、批量、时间戳和 PrivateData 等能力只有接入并实际运行后才能标记支持。PrivateData 的 Merkle 选择披露具有特定语义，不能推断为通用 ZK。[官方 SDK](https://github.com/ethereum-attestation-service/eas-sdk)

链下签名验证与链上撤销、时间戳、到期和发行者信任是分别进行的检查。Safe 直接调用、EOA delegated 和 EIP-1271 合约签名各有支持条件，不能从一种结果推断另一种兼容性。

## 公链扩展资料

以下是可复用的扩展来源，未计入当前已实现工具。

| 生态 | 成熟基础设施 | 适配时核实 |
| --- | --- | --- |
| 其他 EVM 网络 | [Sign Protocol](https://docs.sign.global/for-builders/address-book) | 当前 SDK、合约、代提交签名和索引服务组合 |
| Solana | [Solana Attestation Service](https://github.com/solana-foundation/solana-attestation-service) | 实际部署版本、对应 SDK、Credential/Schema/Attestation 生命周期 |
| Sui | [Sui SDK](https://sdk.mystenlabs.com/)、[Walrus](https://docs.wal.app/)、[Seal](https://www.docs.sui.io/sui-stack/seal/security-best-practices) | 原生对象、blob 期限、加密和解密授权 |
| Aptos | [官方 SDK](https://aptos.dev/build/sdks)、[Objects](https://aptos.guide/build/smart-contracts/objects) | 已有模块和资源操作，不为功能对称编写自有声明合约 |
| Bitcoin | [OpenTimestamps](https://opentimestamps.org/) | 时间证明生成与验证，保留时间证明本身的范围 |
| Cosmos / cheqd | [cheqd 状态列表](https://docs.cheqd.io/product/studio/status-lists) | DID/VC 状态、发行者信任及服务部署 |

SAS 的部署和主分支版本需要独立核查。此前研究读取的 2.0.0 变更记录标记尚未部署，不能据此宣称当前公链已运行该版本。[SAS 版本记录](https://github.com/solana-foundation/solana-attestation-service/blob/master/CHANGELOG.md)

Seal 对后续密钥请求施加权限，已交付的密钥不能收回；同一 key ID 的后续密文也需要考虑已持有密钥者。[Seal 安全模型](https://www.docs.sui.io/sui-stack/seal/security-best-practices)

## 来源与签署工具

已有来源证据可在需要时通过其官方工具导入，并在 EAS 字段引用原始材料。输入格式解析、签名和验证继续由对应成熟组件完成。

| 工具 | 用途 |
| --- | --- |
| [in-toto](https://github.com/in-toto/attestation/blob/main/spec/v1/statement.md)、[SLSA](https://slsa.dev/spec/) | 已有构建和产物来源记录 |
| [Sigstore / Cosign](https://docs.sigstore.dev/about/threat-model/) | 签名包、发行身份与透明日志 |
| [OpenLineage](https://openlineage.io/docs/spec/object-model/) | Dataset、Job、RunEvent |
| [C2PA SDK / c2patool](https://opensource.contentauthenticity.org/docs/) | 媒体来源与签名 |
| [Safe](https://docs.safe.global/advanced/smart-account-modules) | 外部组织签署和原生阈值执行 |
| [W3C VC 2.0](https://www.w3.org/TR/vc-data-model-2.0/) | 外部凭证导入和验证 |

这些来源没有成为当前包的隐含依赖或支持承诺。引入时保留原文、原签名、原标识和信任边界。

## 存储和证明

IPFS 的内容寻址不保证永久可用，pinning 和节点维护需要持续进行。raw CID 标识文件原字节，UnixFS 根 CID 可能因分块与封装产生不同值。[IPFS 持久性](https://docs.ipfs.tech/concepts/persistence/)

[Arweave](https://github.com/ArweaveTeam/arweave-js)、Walrus 和 [RISC Zero](https://dev.risczero.com/api/zkvm/receipts) 可按明确用途增加适配。付费永久存储、blob 期限和指定程序证明使用各自原生语义，不统一成虚构的全功能后端。

每个新增工具需要实际安装、调用和足够验证；测试关注本项目适配产生的错误，不重复建设上游组件的测试体系。

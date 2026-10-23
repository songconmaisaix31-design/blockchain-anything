# 工具选型与公链能力

核查日期：2026-10-23。以下来源均为官方规范、官方文档或项目仓库。主方案及扩展范围等待用户确认；“已核查”表示读过相应资料，不表示已经安装、运行、审计或完成链上验收。

## 1. 建议的主实现组合

建议使用一个 TypeScript 项目，通过共同业务层提供 CLI、MCP 与 SDK。EAS/EVM 承担首个完整链上声明生命周期；内容、签名、身份和授权使用各自的成熟实现。BCA 自己定义对象语义、映射规则、验证策略与适配边界。

| 责任 | 建议工具 | 选择依据与实现边界 |
| --- | --- | --- |
| 运行与类型 | Node.js 24 LTS、TypeScript | 与 REA 和主要链 SDK 的 JS 生态一致；安装时固定满足全部依赖要求的补丁版本 |
| CLI | [Incur](https://github.com/wevm/incur) | Schema、子命令、JSON 输出、帮助和 Agent 发现；REA 已采用。内置 MCP 功能不替代 BCA 显式业务授权 |
| MCP | [官方 TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk) | 当前 main 为稳定 v2，拆分为 `@modelcontextprotocol/server`、`@modelcontextprotocol/client`；支持 stdio、HTTP 和标准 Schema |
| 输入输出 | [Zod](https://zod.dev/) 与 JSON Schema | 所有入口复用同一业务契约，严格拒绝非法字段和未支持版本 |
| 内容标识 | [multiformats](https://github.com/multiformats/js-multiformats)、[DAG-CBOR](https://github.com/ipld/js-dag-cbor) | 现成 CID、multihash 与规范数据编码；目录另用成熟 UnixFS 库 |
| JSON 规范化 | [RFC 8785](https://www.rfc-editor.org/rfc/rfc8785)、`canonicalize` | 用于 BCA 原生声明；外来签名证据保留原字节 |
| 声明信封 | [in-toto Statement](https://github.com/in-toto/attestation/blob/main/spec/v1/statement.md)、[DSSE](https://github.com/secure-systems-lab/dsse) | 类型化 subject/predicate 与标准签名输入；BCA 定义自身 predicate，不修改外来签名对象 |
| 签名与透明日志 | [Sigstore JS](https://github.com/sigstore/sigstore-js)、Node.js crypto | Sigstore 用于 CI/开发者证明导入；离线签名使用标准信封与成熟密码学实现，不强制依赖在线 OIDC |
| EVM 声明 | [EAS SDK](https://github.com/ethereum-attestation-service/eas-sdk) | Schema、链上/链下声明、签名代提交、批量、撤销与时间戳 |
| EVM 客户端 | [ethers v6](https://docs.ethers.org/v6/) | 配合 EAS SDK 的 signer/provider 使用；指定 RPC，避免自动选择其他服务 |
| 身份解析 | [did-resolver](https://github.com/decentralized-identity/did-resolver) 与明确选定的 method resolver | 通用接口自身不实现具体 DID method；需要单独验证 did:key、did:pkh 的实现和历史解析边界 |
| 服务侧授权 | [Eclipse Biscuit WASM](https://github.com/eclipse-biscuit/biscuit-wasm) | JS 可复用 `@biscuit-auth/biscuit-wasm`；离线权限收缩与逻辑 authorizer，外部状态负责撤销 |
| 选择披露 | [Identity Common TypeScript](https://github.com/openwallet-foundation-labs/identity-common-ts) 的 `@sd-jwt/core`、`@owf/crypto` | 按 RFC 9901 生成/验证 disclosure；原 sd-jwt-js 仓库已声明 2026-09 停止功能开发并迁移，安装时核对当前维护包 |
| 文件加密 | [age](https://github.com/FiloSottile/age) | 官方工具和 age v1 格式支持文件加密；按实际授权调用，无需自定义容器 |
| 组织签署 | [Safe](https://docs.safe.global/advanced/smart-account-modules) | 阈值控制和可选权限模块；使用实际合约签名验证。Module 的执行权限需要单独审查 |
| 本地索引 | [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) | 真实事务、迁移与索引；需要在 Windows 和目标 Node 版本实测原生模块安装 |
| 文件与存储 | 本地文件、官方 S3 SDK、[Kubo/Helia](https://docs.ipfs.tech/) | 私有与公开存储分开配置；存储后核对内容，pinning 和费用由显式策略管理 |

SDK v2 当前对应 MCP 2026-07-28。实际支持的客户端和协议版本要通过原生客户端测试记录，不能照抄 REA 文档中的特定连接生命周期。[官方传输规范](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports)

签名依赖需要采用已修复版本：`@sigstore/core <=3.2.0` 存在 DSSE payloadType 绑定问题，修复版本为 `3.2.1`；安装时核对当前修复版本及相关依赖组合。其当前源码的 Node 24 要求至少 24.15.0，不能只按“Node 24”选择任意补丁版本。[官方公告](https://github.com/advisories/GHSA-jfc7-64v2-mr8c)、[core 要求](https://github.com/sigstore/sigstore-js/tree/main/packages/core)

## 2. 公链与声明服务

| 生态 | 现成组件 | 适合 BCA 的用途 | 需要实现或核实 |
| --- | --- | --- | --- |
| Ethereum / EVM L2 | EAS、ethers、Safe | 通用声明、批量、撤销、离线签名与组织控制 | 实际网络部署、ABI、签名域、最终性、链下信封映射 |
| 多个 EVM 网络 | Sign Protocol | 结构化声明、撤销理由、索引、链上和 Arweave 数据模式 | 当前 SDK 与 1.1.4 合约的代提交兼容、服务依赖和离线验证 |
| Solana | Solana Attestation Service、Solana 官方客户端 | Credential、Schema、Attestation 和授权发行人 | 当前部署版本、SDK 包名、关闭账户后的历史及状态验证 |
| Sui | Sui SDK/CLI、Move Objects、Walrus、Seal | 对象状态、数据存储、加密与解密授权 | BCA 声明/撤销合约、权限映射和历史语义 |
| Aptos | Aptos SDK/CLI、Move Objects | 资源组合、签名、事件与链上对象 | BCA 声明/撤销模块与身份映射 |
| Bitcoin | OpenTimestamps | 内容存在时间证明 | 独立时间戳验证；身份、授权、撤销由其他声明提供 |
| Cosmos / cheqd | DID、DID-Linked Resources、VC 状态列表 | 身份、发行者与凭证状态适配 | BCA 与 VC 映射、可信发行者和实际服务部署 |

### 2.1 EAS

官方部署表列出 Ethereum、Optimism、Base、Arbitrum One/Nova、Polygon、Scroll、zkSync、Celo、Telos、Soneium、Ink、Unichain、Blast、Linea 等主网。各链合约版本不同；核查时 Base 主网 EAS 为 1.0.1，EIP712Proxy 单独列为 1.2.0。实现以选定网络的实际部署工件为依据。[官方部署表](https://github.com/ethereum-attestation-service/eas-contracts#deployments)

EAS SDK 的 delegation 允许第三方提交已签名的声明或撤销并支付 gas；BCA 仍需独立验证 Agent 的业务权限。`PrivateData` 提供基于 Merkle 的选择披露。引用、到期、可撤销标志与链下状态都必须纳入 BCA 验证器。[官方 SDK](https://github.com/ethereum-attestation-service/eas-sdk)

### 2.2 Sign Protocol

当前维护清单包含 Ethereum、Optimism、BNB、Gnosis、Polygon、opBNB、Base、Arbitrum One、Celo，版本标记为 1.1.4；维护中的测试网列出 Sepolia。部署记录必须随适配器版本确认。[地址清单](https://docs.sign.global/for-builders/address-book)

1.1.4 的代提交采用 EIP-712 域、每 attester 的 nonce 和 deadline，拒绝旧格式签名。合约具有批量声明/撤销操作。其文档中的 offchain 创建流程依赖 API key；不能将该模式解释为无服务依赖的本地签名。[合约变更记录](https://github.com/EthSign/sign-protocol-evm/blob/main/CHANGELOG.md)、[SDK 声明流程](https://docs.sign.global/for-builders/index-1/npm-sdk/usage/attestations)

Sign 是需要相应网络或数据模式时的独立 provider，不作为 EAS 失败后的自动替换。

### 2.3 Solana

SAS 使用 Credential、Schema 和 Attestation；发行权限由授权签名人配置控制。撤销通过关闭 Attestation 账户完成，历史查询需要交易/事件来源。暂停 Schema 与撤销既有声明分别处理。[SAS 官方仓库](https://github.com/solana-foundation/solana-attestation-service)

仓库 2.0.0 变更记录日期为 2026-09-25，并明确尚未部署。当前主分支包名为 `@solana/attestation` / `solana-attestation`，部分官方教程仍列旧包名。必须以实际程序二进制、对应 SDK 和发布标签完成联调，不根据 main 分支推断主网能力。[SAS 版本记录](https://github.com/solana-foundation/solana-attestation-service/blob/master/CHANGELOG.md)

### 2.4 Sui 与 Aptos

Sui 的 Objects、Walrus 和 Seal 分别提供链上对象、存储和解密授权。Seal 的撤销限制未来密钥请求，无法收回已交付密钥；相同 key ID 的新密文仍受旧密钥持有者影响，密钥交付也不自动产生链上审计记录。[Seal 安全模型](https://www.docs.sui.io/sui-stack/seal/security-best-practices)

Aptos Objects 可组合多个资源，官方 SDK/CLI 可操作 Move 资源和交易。本轮未核实到提供完整 EAS 同等声明生命周期的官方通用服务；应将适配范围写为待开发的 BCA Move 模块。[Aptos Objects](https://aptos.guide/build/smart-contracts/objects)、[Aptos SDK](https://aptos.dev/build/sdks)

### 2.5 Bitcoin 与 Cosmos

[OpenTimestamps](https://opentimestamps.org/) 适合对公开摘要生成并验证存在时间证明。该证明只承担其时间证明语义。

[cheqd 状态列表](https://docs.cheqd.io/product/studio/status-lists) 可作为 DID/VC 相关状态资源的接入点。DID、凭证签名和状态都需与具体可信发行者策略共同验证。

## 3. 身份与授权标准

| 标准/工具 | 建议用途 | 必须保留的边界 |
| --- | --- | --- |
| [W3C DID Core](https://www.w3.org/TR/did/) | 身份解析及 verification relationship | 轮换、恢复和历史解析取决于具体 DID method |
| [W3C VC 2.0](https://www.w3.org/TR/vc-data-model-2.0/) | 外部可验证凭证导入/导出 | 签名和状态验证不替代验证方对发行者的信任决定 |
| [ERC-8004](https://eips.ethereum.org/EIPS/eip-8004) | Agent 外部身份、信誉与验证信息关联 | 当前 Draft；Identity Registry 使用可转让 ERC-721，核心 BCA 身份不依赖它 |
| [Biscuit](https://www.biscuitsec.org/docs/why-biscuit/) | CLI/MCP 服务授权与权限收缩 | bearer token，调用者绑定、撤销状态、受众和重放保护由服务执行 |
| [UCAN](https://github.com/ucan-wg/spec) | 与采用 UCAN 的系统互操作 | 当前主规范 1.0.0；Delegation/Invocation 与 Revocation 分开，不能假定所有实现已支持撤销 |
| [ReCap / ERC-5573](https://eips.ethereum.org/EIPS/eip-5573) | 钱包中的能力授权同意表达 | 当前 Draft；目标服务认证实际调用者仍需独立实现 |
| [MCP OAuth](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization) | HTTP 接入授权 | 对象签名与具体链上操作权限另外校验 |

授权主方案选择 Biscuit，UCAN/ReCap 仅在外部系统需要时通过显式导入器接入。Biscuit 撤销依赖外部状态，且父令牌撤销应覆盖派生令牌。[官方撤销说明](https://www.biscuitsec.org/docs/guides/revocation/)

## 4. 来源、工作流与创意资产

| 工具 | 对象映射与用途 |
| --- | --- |
| [in-toto](https://github.com/in-toto/attestation/blob/main/spec/v1/statement.md) | 保留已有 Statement，并为 BCA 类型定义独立 predicate |
| [Sigstore / Cosign](https://docs.sigstore.dev/about/threat-model/) | 导入发布者身份、签名包及透明日志验证；另外执行发行者信任策略 |
| [SLSA](https://slsa.dev/spec/) | 软件、模型构建流程中的来源记录；只承诺实际具备的来源等级 |
| [OpenLineage](https://openlineage.io/docs/spec/object-model/) | Dataset、Job、RunEvent 与 Facets 映射成输入、运行和产物关系 |
| [C2PA SDK / c2patool](https://opensource.contentauthenticity.org/docs/) | 读取已有媒体来源与签名结果；原始证据和验证限制随对象保存 |

这些格式使用官方 SDK 或成熟工具解析。外部原签名对象不改写；BCA 新建映射声明引用原内容和验证结果。业务关系、原声明真实性与当前信任策略分别检查。

DSSE 认证 `PAE(payloadType,payload)`，keyid 仅作查找提示；Sigstore bundle 的单签能力与 BCA 多签阈值聚合分别实现。[DSSE 协议](https://github.com/secure-systems-lab/dsse/blob/master/protocol.md)、[in-toto 信封规则](https://github.com/in-toto/attestation/blob/main/spec/v1/envelope.md)

## 5. 存储与 ZK

| 工具 | 适用范围 | 生命周期边界 |
| --- | --- | --- |
| [IPFS](https://docs.ipfs.tech/concepts/persistence/) | 内容寻址与公开对象分发 | pinning、复制和持久保存需要持续维护 |
| [Arweave JS](https://github.com/ArweaveTeam/arweave-js) | 明确选择长期公开保存的内容 | HTTP 200 仅表示收到交易，确认状态需另行读取 |
| [Walrus](https://docs.wal.app/llms.txt) | Sui 生态 blob、CLI/HTTP/TypeScript 接入 | blob 默认公开，有 epoch 生命周期；Blob ID 与 Sui Blob object ID 分开 |
| [RISC Zero](https://dev.risczero.com/api/zkvm/receipts) | 指定程序的可选计算证明 | 校验 receipt、guest image ID 和 journal；外部输入来源继续单独验证 |

加密使用现成认证加密库，签署器使用平台密钥存储或外部钱包接口。公开存储、加密访问、承诺和 ZK 是单独能力，发布说明按实际完成项列示。

## 6. 组件引入验收

每个 provider 记录实际发布标签、安装版本、许可、运行环境、网络部署和已测操作。需要确认当前安全修复及接口兼容性，记录实际调用结果。

核心 EAS 适配验收使用官方合约和真实 SDK；本地开发链测试与公共测试网测试分别报告。额外链、钱包、存储和 ZK 有自己的真实验证任务，未运行的功能不声明兼容。项目当前没有安装上述依赖或完成这些验收。

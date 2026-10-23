# BCA 产品与协议设计建议

日期：2026-10-23。状态：待用户确认。本文给出一套相互一致的设计；字段、组件及接口在确认前均不作为已冻结协议。官方能力核查见 [TOOLBOX.md](TOOLBOX.md)，执行顺序见 [TASKS.md](TASKS.md)。

## 1. 产品目标与使用方式

BCA 为任意资源建立可引用对象，为主体建立可追溯身份，为行为与属性建立可验证声明，并让多个系统按照明确的授权和信任规则使用这些声明。

用户可以要求 Agent：“登记这个数据集，为这次运行签署来源声明，并检查产物是否满足我们信任的验证规则。” Agent 通过 MCP 调用 BCA；人和自动化脚本通过 CLI 或 SDK 调用同一业务服务。验证者能够导出公开材料，在独立环境中复核。

产品分成三个相互连接的部分：

| 部分 | 职责 | 交付物 |
| --- | --- | --- |
| 协议 | 对象标识、声明类型、身份控制、授权、状态和验证语义 | 版本化规格、Schema、互操作样例 |
| 工具 | 导入、签署、验证、提交、撤销、查询、组合和导出 | CLI、MCP、TypeScript SDK、使用 Skill |
| 适配器 | 连接声明服务、链、存储、签署器与领域标准 | 能力表、版本约束、独立真实验收 |

自然语言理解由接入的 Agent 完成。BCA 接收经过 Schema 校验的结构化参数，返回确定的操作结果。

## 2. 需要补充的产品语义

| 问题 | 设计要求 |
| --- | --- |
| 内容变化后身份如何延续 | 长期对象、内容版本、声明和链上记录分别标识 |
| 谁可以对对象作出哪些声明 | 主体控制权限、领域发行资格和服务访问权限分别验证 |
| 签名和现实事实之间的关系 | 保存证据来源、验证方法与限制；实物需要独立绑定证据 |
| 撤销、过期、轮换、恢复 | 为声明、授权、密钥和身份控制各自定义状态与生效时间 |
| 离线验证的时间范围 | 报告状态证据时间；当前授权缺少新鲜状态时拒绝执行 |
| 组合成员失效后的行为 | 依赖策略定义必要成员、阈值、状态传播和历史验证规则 |
| 多链记录的可信关系 | 验证源链、部署、发行者和最终性；跨链消息单独处理 |
| 原始内容丢失 | 内容可用性和链上记录存在分别报告；明确保留和续期责任 |
| 隐私泄露 | 创建公开对象前处理 secret、低熵内容和关联元数据 |
| 声誉被刷高 | 按用途、评价者、时间与算法版本计算；保留原始评价声明 |
| SDK、索引与合约版本不同 | 固定并验证实际部署组合；索引数据必须能回查链上来源 |

## 3. 原语与标识

### 3.1 标识分工

| 标识 | 建议表示 | 含义 |
| --- | --- | --- |
| `objectId` | `urn:uuid:<UUID>` | 长期逻辑对象；由控制者签署注册声明建立绑定 |
| `contentId` | CIDv1，原始文件使用 raw codec + SHA-256 | 精确字节内容；跨链保持一致 |
| `versionId` | CIDv1，DAG-CBOR 编码的版本描述 | 内容、类型、被承诺元数据、前序版本与组合成员的不可变版本 |
| `statementId` | CIDv1，raw codec + 规范 JSON 声明字节摘要 | 一条语义声明；签名和后续链上提交不改变该标识 |
| `evidenceId` | 原始证据字节的 CIDv1 | 一个签名信封、外部声明或证明文件的精确表示；保留原签名字节 |
| `anchorRef` | 网络、协议、合约/程序、UID、交易和事件位置 | 声明在指定链上的具体记录 |

`BCA ID` 在产品文案中表示 BCA 对象引用；API 必须使用上述明确字段。`objectId` 的唯一字符串不证明控制权。内容相同的两个主体可以分别登记对象；去重以内容引用进行，控制关系分别验证。

原始文件按读取到的精确字节生成 `contentId`。版本元数据使用 `@ipld/dag-cbor`，BCA 原生声明的规范 JSON 使用 RFC 8785 实现库；禁止自己编写编码器或解析器。外部已签名声明按其原格式保存为证据。JSON 数值限制在所选规范允许的范围，金额、超大整数和精确小数采用有类型的字符串。未知编码、算法和版本直接拒绝。

目录使用成熟 UnixFS 导入库，并固定文件排序、路径规则、分块器、CID 版本与元数据选项。符号链接、大小写冲突和特殊文件必须有明确策略，未允许的类型立即失败。改变编码或分块配置会得到不同标识，配置版本随对象记录。

文件的精确字节 CID 与分块存储的根 CID 分别记录。大文件导入 IPFS 后的 UnixFS root 作为 `storageRoot`，与文件 `contentId` 建立明确映射；下载重建后再核验精确字节，不能假定 raw CID 一定可被 IPFS 网关直接解析。

### 3.2 ObjectVersion

建议必需字段为 `schemaVersion`、`objectId`、`kind`、`content`、`metadata`、`parents`、`members`。其中：

- `kind` 是版本化类型 URI，内置 file、dataset、model、agent-definition、tool、workflow、event、physical-object、credential-reference、collection 类型。
- `content` 是互斥联合类型：`public` 含明文 CID/媒体类型/字节数；`encrypted` 含密文 CID、密文格式和允许公开的加密参数；`commitment` 含约定 profile 和公开承诺证据 CID。私有的明文 CID、disclosures、密钥位置不进入公开版本。现实实体的内容是描述与绑定证据，无法直接对实物本身计算文件摘要。
- `metadata` 只含允许公开或在私有范围保存的事实。声明者观点、质量评价和授权放入独立声明。
- `parents` 指向精确 `versionId`，支持分支和合并。控制者签署的版本声明决定某分支的有效更新；时间最新不自动取得控制权。
- `members` 引用精确版本并说明角色和顺序语义。无序集合按规范排序；有序集合保持顺序。
- 可变化的下载地址、存储续期和镜像关系通过独立位置声明更新。它们不能悄悄改变已签名的版本内容。

“当前版本”是根据控制声明、分支规则与验证时间求得的查询结果。存在相互冲突的更新时返回冲突，要求控制者按已声明规则解决。

版本描述是 `parents`、`members` 不可变结构的权威来源；独立 version/relation 声明表达发行者对关系的判断和授权，不能改变既有结构。声明 subject 摘要、predicate 中的 CID、对象 ID、版本描述及关系端点必须相互一致，冲突立即拒绝。

### 3.3 Attestation

BCA 原生声明使用 in-toto Statement v1 的外层结构：`_type`、`subject`、`predicateType`、`predicate`。BCA 字段放在自有版本化 `predicate` 中。原生 profile 的 `subject.digest` 记录所引用对象版本规范字节的摘要，`predicate` 明确对应的 CID、算法和对象引用。

外部 SLSA、Sigstore 等声明保留原 payload、subject、predicateType、签名和原始证据格式，按其标准验证原字节，不要求它采用 BCA 的 JCS 编码。需要关联 BCA 对象时，新建 BCA 映射声明引用其 `evidenceId` 和实际验证结果；原签名只认证原声明。

声明包括发行主体、控制声明引用、签署用途、有效起止、证据引用、相关声明、状态引用和适用范围。区分 `occurredAt`（声明的事件时间）、`issuedAt`（发行者报告时间）、`anchoredAt`（链上记录时间）。链上时间不能证明内容最早创建时间。

签名采用标准信封和算法实现。BCA 原生 DSSE profile 固定 `payloadType=application/vnd.in-toto+json`，实际签名/验证输入为标准 `PAE(payloadType, payload)`，同时绑定类型和原始 payload 字节。验证后检查原生规范编码并核算 `statementId`，不能重排收到的 JSON 后替换签名输入。DSSE 的 `keyid` 仅是未认证查找提示；实际密钥必须通过已签主体/控制引用及可信解析结果验证。多个签名认证同一份 payload，阈值按获授权的不同控制者计数，同一控制者的重复签名或多个 key ID 不能重复满足阈值。

签名集合不参与 `statementId`。签名信封的精确字节另有 `evidenceId`；新增签名产生新的证据引用。当前 Sigstore bundle 存在单签约束，多名签署者可分别保留各自 bundle，由 BCA 核验同一 payload 和控制阈值，不能无条件将多签 DSSE 转成单个 Sigstore bundle。

链无关签名与链上代提交签名分开验证：前者绑定声明字节，EAS 的 EIP-712 签名绑定其指定域和操作。不能把任意 DSSE 签名直接交给 EAS 作为 delegated attestation 签名。

建议的声明类型：

| 类型 | 主要语义 |
| --- | --- |
| `registration` / `control` | 对象登记、主体控制者与签署用途 |
| `version` / `relation` | 版本前序、派生关系、组合成员 |
| `provenance` | 来源事实、采集方法、原证据引用 |
| `execution` | 实际输入、工具、执行者、输出和观察覆盖范围 |
| `validation` | 验证方法、输入、指标、结果、验证者及版本 |
| `capability` | 主体具备的能力声明，发布者与判断依据 |
| `access-policy` | 服务实际执行的访问策略及版本 |
| `status` | 声明撤回、授权撤销、密钥泄露和控制更新 |
| `storage` | 位置、可用期限、保留条件、加密描述与付款责任 |

能力声明表达主体被声明具备某种能力。访问授权是允许调用指定操作的授权凭据，两者拥有不同验证规则。

## 4. Identity 与控制生命周期

主体可以是 Human Operator、Agent、组织或服务。Agent 的长期身份、Agent 定义版本、每次运行和模型权重分别登记，避免一次更新模型就改变全部历史身份。

主体记录引用稳定 `objectId` 和当前有效的控制声明。控制声明包括 `controllers`、阈值、签署用途、有效期、前序控制声明、恢复控制者与恢复条件。初始注册由初始控制者签署；验证者仍需明确是否信任该初始主体。

建议用成熟 DID 解析工具处理已有 DID：`did:key` 用于不可变公钥标识，`did:pkh` 用于链账户关联。`did:key` 自身没有轮换功能；BCA 主体通过控制声明更新签署密钥，保留同一长期对象。链账户链接需双方签署或方法所要求的可验证控制证明，不能仅填入地址字符串。[did:key 规范](https://w3c-ccg.github.io/did-key-spec/)

正常轮换由当前控制阈值批准；恢复仅可由预先登记的恢复控制者依照约定阈值、等待期和挑战规则执行。签署域绑定主体、前序控制版本和唯一操作，拒绝重放。恢复方案尚未登记时，不能承诺密钥遗失可恢复。EVM 组织控制者可使用 Safe，合约签名按 ERC-1271 验证；多签不能简化为只检查一条 EOA 签名。

正常轮换在历史密钥与控制证据可获得时保留历史签名验证。ERC-1271 合约签名还需绑定链、合约、区块号/哈希与相应历史状态，材料不足返回未知。密钥泄露声明可以影响历史信任，验证策略决定追溯范围；仅凭签名自报的早期时间不能证明其在泄露前产生，需要可信时间戳等额外依据。

对 `statementId` 的时间戳只证明声明内容已存在。需要证明某条签名早于泄露时，可信时间证明必须绑定包含该签名的 `evidenceId` 或完整 bundle 摘要。新增签名需要自身可验证的时间依据。

ERC-8004 当前规范使用 ERC-721 身份。建议通过外部身份关联适配器接入；BCA 的对象创建、身份创建和证明路径均无需 ERC-721。是否接受 NFT 转让导致关联控制者变化，必须使用用户确认的关联策略。

## 5. Capability 与执行授权

建议以 Biscuit 承担 BCA 服务侧能力凭据，使用官方实现生成、收缩与验证。每次执行须验证调用者、凭据、父级状态、服务策略和本次操作参数。

授权规则至少包括：发行者、受委派主体、资源范围、动作集合、服务受众、起止时间、可继续委派范围与深度、父级引用、撤销标识。费用上限、链 ID、目标合约和允许方法属于链上操作限制。子授权只允许缩小父授权的范围与时效。

Biscuit 是 bearer token。需要绑定特定 Agent 的授权，必须在 authorizer 中校验服务端已经认证的调用者公钥或身份与凭据中的主体；根据请求签名、唯一 nonce 和有效时间抵抗重放。不能信任调用参数自行声明的调用者身份。授权 token 不进入公开链、普通日志或公开声明。

`attenuate` 保留原来绑定的调用者并缩小权限。向另一个 Agent 委派时，由获授权发行服务通过 `issue` 核验父授权及继续委派权限，签发绑定新主体的子凭据，并保存不可变父凭据引用、深度、权限上界和父级状态来源。Biscuit 追加限制不能把父级 Alice 绑定改成 Bob。该路径需要发行服务可用；离线收缩不等同跨主体发行。

EAS delegated attestation 的用途是代为提交已签名操作。Agent 能否读取私有数据、签署新声明、调用工具或花费资金，由独立业务授权决定。HTTP MCP 的 OAuth access token 证明调用服务的许可；具体 BCA 操作仍要经过上述验证。

### 5.1 撤销与状态新鲜度

- 执行 BCA authorizer 的服务在撤销授权后必须拒绝其所有后代授权。校验覆盖整个委派链，不能只检查末端 token。
- 发布授权的控制者维护签名状态资源，可由 EAS 等提供可审计的状态记录。凭据指定状态来源、版本与 `maxAge`，不自动切换来源。
- 在线执行必须获取满足策略新鲜度的状态；缺失、查询失败或超过 `maxAge` 时立即拒绝执行。
- 离线验证可以核验签名和携带的状态证据，报告 `checkedAt`、`validUntil` 和当前状态未知。不得把这一结果解释成当前访问授权。
- 声明撤回、授权撤销、密钥撤销、存储删除、内容替换分别记录。不可撤销的底层声明只能增加状态声明，并明确底层记录本身仍存在。

已经交付的 EAS delegated 签名可能被第三方直接提交，BCA 服务授权撤销不能使其自动失效。待提交签名使用目标部署真实支持的 deadline、nonce 失效等机制控制；已发布声明使用其撤销路径。状态报告分别说明服务授权、链上待提交签名和既有声明的状态。

### 5.2 可执行授权与可发现声明

将权限描述登记在链上不保证资源服务会执行该权限。BCA 的 HTTP 服务、签署器及存储代理必须在实际动作前调用共同 authorizer；外部工具只有在安装并验证相应适配后才能声明支持受控访问。

## 6. Privacy、凭证和存储

### 6.1 三种对象公开方式

| 模式 | 公开内容 | 验证方式 |
| --- | --- | --- |
| public | 允许公开的内容、元数据和签名声明 | 获取内容并直接检查摘要与声明 |
| encrypted | 密文 CID、最少必要元数据、加密算法及 key reference | 先验证密文完整性；获授权后解密并验证私有承诺 |
| commitment | 带足够随机性的承诺值及必要 Schema | 持有者披露开口材料或提供特定属性证明 |

建议 commitment 的第一个明确 profile 采用 RFC 9901 SD-JWT：通过当前维护的 Identity Common TypeScript 中 `@sd-jwt/core` 与 `@owf/crypto` 实现；使用 SHA-256、每条 disclosure 独立的 32 字节随机盐和标准 disclosure 编码。隐藏 claim 保存完整明文内容 CID；公开 issuer-signed JWT 绑定 BCA profile 版本、`objectId`、issuer 和有效期，并使用专用 `typ` 区分用途。公开版本只引用该证据的 CID；disclosures、盐和明文摘要保存到受控私有存储。验证时核对发行者、profile、对象、disclosure 摘要与所披露内容；持有者认证场景额外要求标准 key binding、受众和 nonce。该 profile 提供选择披露，任意属性 ZK 使用独立 ProofAdapter。[RFC 9901](https://www.rfc-editor.org/rfc/rfc9901.html)、[维护中的实现](https://github.com/openwallet-foundation-labs/identity-common-ts)

该 profile 需要用户确认并完成真实发行/披露/验证后才能启用。公共 JWT 与对象关联可能被关联分析，不能宣称不可关联。API secret 本身不作为 disclosure 内容。

低熵秘密不能仅计算公开原文哈希；身份、文件名、访问时间和关联关系也可能泄露。建议文件加密 profile 采用 age v1 格式，调用官方 age 工具，使用标准接收者密钥和每文件生成的密钥材料；不自行设计加密容器或解析器。大文件解密必须完成格式认证后才交付完整产物，失败的部分输出不能作为成功内容发布。授权读取由持有服务密钥的受控适配器执行。承诺与明文摘要不得在公开路径中同时泄露隐藏目标。[age 官方工具](https://github.com/FiloSottile/age)

API 凭证对象只登记服务、凭证描述、作用域、持有者、有效期和安全存储引用。实际 secret 保存在操作系统凭证库或指定 secret manager，由授权组件在调用时读取。CLI 参数、MCP 响应、链上 payload、测试证据和公开日志不承载 secret。

撤销访问限制后续密钥交付与资源读取。已取得的明文或解密密钥无法通过链上状态更新收回。使用 Seal 时，权限变化后的新版本必须考虑新的 key ID 与密钥；相关限制来自其官方安全模型。

### 6.2 存储适配器

核心提供本地文件与私有 S3 兼容存储；公开内容可选择 IPFS。Arweave 用于明确要求长期公开保存的对象，Walrus 用于具有 epoch 保留策略的对象。存储选择必须显式记录，失败时停止当前操作。

存储声明包括提供者、公开内容或密文 CID、`storageRoot`、表示格式/导入参数、位置、保留期限、可删除性、复制要求、费用承担者和最后验证时间。私有明文摘要仅存在于受控材料中。IPFS pinning、Walrus 续期和对象存储生命周期各自管理。加密、数据可用性和链上存在时间是独立能力。

大文件使用流式处理和成熟的分块、CAR、UnixFS 库。上传完成后执行完整读取校验或使用能满足所选验证策略的内容证明；仅抽样时必须报告抽样范围。对象上链状态不应掩盖原文不可读取。

## 7. 链上记录与多链

### 7.1 EAS 主适配方案

建议使用 EAS SchemaRegistry 和 EAS 合约，承载 BCA 版本化声明摘要。payload 需要绑定协议版本、`statementId`、主体/对象引用、声明类型和证明引用；包含 CID 时保留完整算法与编码语义。敏感对象按隐私 profile 只提交允许公开的承诺值。

EAS schema UID、resolver、revocable 设置、attester、有效期和 refUID 均进入验证。`refUID` 是单一声明引用；多输入的组合关系保存在签名 statement 中，由 BCA 验证器解析。单纯发布一个摘要不证明该 statement 的内容或签署权限已经验证。

`issuer` 是声明责任主体，DSSE signer 具有其签署用途授权；链上 attester 必须通过主体账户关联或发布授权证明其作用。无法证明关联的账户只能标为第三方存证者。transaction sender/relayer 单独记录，不由它推断原发行者。要求历史签名时间时，链上记录还需绑定实际 `evidenceId`。

分别支持：离线签署、链下声明验证、直接提交、delegated 提交、批量提交、查询及撤销。是否采用 resolver 强制约束 BCA schema 由实际合约需求决定；仅做存证时由 BCA 验证器检查完整签名材料。可访问链上摘要但缺少原声明时，只能确认摘要记录存在。

Safe 直接调用 EAS 与合约签名 delegated 是不同能力。某些 verifier 的输入受固定 `r/s/v` 签名格式限制，支持 ERC-1271 校验不自动证明兼容任意 Safe 多签。按实际部署、ABI 和签名路径分别完成验证后才标为可用。

建议使用 Base Sepolia 进行首个真实公共链验收，生产网络由用户确认。实现必须从官方部署工件选择实际 ABI 和版本，并核查 RPC 返回的链 ID、合约代码及相关版本信息，禁止静默改用其他链。

### 7.2 提交与恢复

签署前展示或返回目标网络、合约、schema、操作、公开字段、attester、提交者、费用估算和费用上限。用户可以通过事先授权策略允许 Agent 执行范围内动作；策略未覆盖的操作不能自行扩大权限。

操作状态区分 `signed`、`submitted`、`included`、`finalized`、`reverted`、`replaced`、`unknown`。SDK 收到交易哈希只表示提交得到响应；达到链策略要求后才能报告最终确认。超时和客户端取消不能撤销已广播交易。

能够返回 raw transaction 的签署器在广播前计算并保存链上交易哈希。仅支持发送的外部钱包保存其实际请求标识和返回交易哈希；Safe 保存 Safe transaction 标识，并在执行后另存链上交易哈希。尚未取得链上哈希时按对应钱包协议查询，不能宣称已预计算。广播结果未知时围绕原请求/交易查询；不得生成新的业务签名后自动重复提交。底层允许重复声明时明确返回所有 anchor；`statementId` 相同不意味着链上天然幂等。批量操作按实际合约的原子性返回结果，各链行为分别实现。

保存交易哈希、区块号/哈希、日志位置、链 ID、合约、UID 和最终性检查时间。索引器用于检索；关键验证回查链上。RPC 验证模式说明所信任的节点，只有实际验证了轻客户端或状态证明才可标为该证明级别。

### 7.3 多链模型

同一 `statementId` 可以具有多个 `anchorRef`。每条链使用独立的 finality、revocation、部署版本和索引规则。策略明确要求任一指定链、全部指定链或指定阈值；验证材料不足时保持未知或拒绝。

声明在签署时固定权威状态来源、允许的撤回主体和状态规则。撤销某个 anchor 只影响该链记录；权威状态来源对 statement 的撤回作用于所有引用它的当前验证，不能以另一条链仍存在有效 anchor 覆盖。状态来源迁移须经原规则授权，并保留版本和历史。

链间业务消费优先在链下验证源链回执。确需目标链合约读取源链状态时，另行选择消息或证明协议，记录验证者集合、升级权限、延迟与重组处理；它属于独立交付项。

Solana SAS、Sui、Aptos、OpenTimestamps 和 cheqd 的能力见 [TOOLBOX.md](TOOLBOX.md)。Sui/Aptos 的通用声明模块需要单独实现和验收；现成对象模型不自动提供完整 BCA 生命周期。

## 8. Composable Attestations 与执行证明

组合关系采用有类型的有向图。用于依赖验证的子图必须为 DAG；引用按不可变版本及声明绑定。`used`、`generatedBy`、`derivedFrom`、`validatedBy`、`supersedes` 表达不同语义，不能通过邻接关系推断执行。

Execution 声明绑定 Agent 身份与定义版本、每次运行 ID、输入版本、工具版本、请求与返回摘要、产物版本、观察来源和执行范围。工具运行事实由执行边界或真实控制器记录产生。Agent 自己生成的自然语言说明仅作为该 Agent 的自述来源。

所有日志完整性的声明需要可核对的捕获范围、起止条件和遗漏处理；有真实签名的若干事件不足以证明没有未记录事件。采集日志只覆盖获授权公开任务的实际工具输入输出和必要事件，不要求模型私有推理内容。

验证器逐一检查必要节点、边的依据、签名、权限、状态与时间。可选分支不能掩盖必要证据失败；必要子声明撤销使依赖该声明的当前策略检查失败。历史验证按指定时间和历史状态证据执行。

验证策略须指定信任的发行者/验证者、所需独立性、阈值、方法版本和可接受证明类型。质量评价记录评估数据版本、指标、阈值、随机性及测量条件；同一控制者的多个身份不能未经判断就满足“独立验证者”要求。

读取深度、节点数、字节数与请求期限由实际资源约束配置，触及限制返回未完成原因，不能报告全图通过。引用默认只从允许的存储位置解析，防止远程对象诱导服务读取内网、任意本地文件或执行内容。

## 9. Verification 与信任策略

验证是独立核心能力。建议输出以下字段，每项包括 `state`、依据、检查时间和限制：

| 检查项 | 检查内容 |
| --- | --- |
| `contentIntegrity` | 内容与版本/statement 的编码和摘要一致 |
| `signatureValidity` | 签名对原字节有效，算法和签署者解析受支持 |
| `issuerBinding` | 签署密钥对应指定主体与签署用途 |
| `authorization` | 操作权限、委派链、范围、受众与恢复规则 |
| `status` | 声明有效期、撤销、密钥状态及证据新鲜度 |
| `chainFinality` | 指定部署上的记录与当前链状态符合最终性策略 |
| `dataAvailability` | 所需内容可获取，或说明离线/不可用/仅有承诺 |
| `dependencyIntegrity` | 必要组合节点和关系已验证且无循环 |
| `proofValidity` | 指定 ZK、时间戳、透明日志或领域证明的验证结果 |
| `issuerTrust` | 当前验证方是否信任发行者在该领域作出该类声明 |
| `policyDecision` | 按显式 policy 版本得出的 accept / reject / indeterminate |

各检查项使用 `pass`、`fail`、`unknown`、`not-applicable`。`not-applicable` 必须由策略允许；材料缺失不得伪装成不适用。离线模式对链状态和即时撤销保留时间边界。

协议不提供脱离用途的统一“真实”布尔值。调用者可以明确要求只验证签名完整性，也可以要求完整当前可信验证；两种结果展示其 scope。任一必要检查已确定失败时整体 `reject`；没有必要失败但缺少必要材料时为 `indeterminate`；全部必要检查满足策略时为 `accept`。执行授权对 `reject` 和 `indeterminate` 均拒绝。

可信发布者名单、允许 schema、最少验证者数、状态 `maxAge`、最终性、允许存储来源和证明要求构成版本化 policy。导出的验证报告绑定 policy 的内容版本、`verifyAt` 和输入引用，其他验证者可依据相同公开材料复核。

信誉作为 policy 上层计算：按领域、指标、时间窗口、评价者和算法版本输出带依据的分数；防止互相背书、重复评价和控制者关联造成误导。首个核心交付提供可验证历史与策略查询，是否发布评分算法由用户单独确认。

## 10. 选择披露与可选 ZK

选择字段披露、不可关联披露和任意计算证明是分别声明的能力。EAS Merkle private data 可以证明已承诺字段的成员关系，不能据此宣称具有任意属性 ZK。

建议 ProofAdapter 接收证明系统标识、证明格式版本、验证器/程序标识、公开输入、被绑定的对象与声明、proof location 和信任参数。它只验证显式支持的命题和算法，未安装或未支持时返回能力不可用。

RISC Zero 候选适配器验证 receipt、预期 guest image ID 和 journal；journal 必须绑定输入承诺、输出摘要、声明类型及业务上下文，禁止接受不相关程序生成的有效 receipt。外部输入来源及日志完整性继续由独立检查负责。

ZK 交付需要选定真实命题、实际 witness、生成程序、验证程序、依赖版本、内存/时间成本与链上验证方式。任务验收包含篡改公开输入、错误程序 ID 和错误对象引用的拒绝结果。未完成该交付前，能力表不得标记 ZK 为可用。

## 11. MCP、CLI 与 SDK 产品结构

### 11.1 入口与共享结构

建议 TypeScript + Node.js 24 LTS，单一包提供 `bca` CLI、`bca mcp` 和 SDK exports。Incur 负责 CLI 参数、帮助与结构化输出；MCP 使用官方 TypeScript server/client SDK。二者调用同一 application 层、Schema、authorizer 和 providers，避免形成两个签署或验证实现。

| 建议路径 | 职责 |
| --- | --- |
| `src/domain/` | 对象、声明、授权和验证的纯领域规则 |
| `src/contracts/` | 版本化输入、输出和错误 Schema |
| `src/application/` | 导入、签署、验证、提交、撤销和组合业务 |
| `src/providers/` | 链、EAS、存储、DID、签署器、Biscuit 与 ZK 适配 |
| `src/cli/`、`src/mcp/`、`src/sdk/` | 用户入口与协议转换 |
| `src/composition/`、`src/config/` | 显式依赖装配与配置校验 |
| `src/persistence/` | 真实 SQLite 的本地对象索引、声明和回执引用 |
| `skills/bca/`、`docs/` | 操作指南、规格和真实案例 |
| `tests/` | 实际库、真实服务与公开链验证 |

SQLite 支持 CLI 多进程和 MCP 的本地索引，使用真实事务、唯一约束和迁移；缓存结果携带观察时间，不能成为链上状态权威。原始大文件与证明放在约定存储中，数据库保存必要引用和检索字段。密钥材料不写入普通索引。

### 11.2 操作目录建议

下表中同一行的每个操作分别拥有输入和输出 Schema。CLI 支持 `--json`，SDK 暴露同名业务方法；MCP 名称使用下列英文标识。

| CLI 设计 | MCP 设计 | 主要输入与结果 |
| --- | --- | --- |
| `bca capabilities` | `bca_capabilities` | 返回实际 provider、版本、可用操作及原因 |
| `bca object import` | `bca_object_import` | 显式源、类型、公开模式；返回对象/内容/版本引用 |
| `bca object inspect` / `versions` | `bca_object_inspect` / `bca_object_versions` | 引用和查询范围；返回描述、版本及来源 |
| `bca object compose` | `bca_object_compose` | 精确成员版本、角色和顺序；返回组合版本 |
| `bca identity create` / `inspect` | `bca_identity_create` / `bca_identity_inspect` | 主体、控制者和用途；返回控制声明引用 |
| `bca identity rotate` / `recover` | `bca_identity_rotate` / `bca_identity_recover` | 前序控制版本及授权签名；返回控制更新 |
| `bca attestation sign` | `bca_attestation_sign` | statement 与 signer reference；返回标准签名信封 |
| `bca attestation publish` | `bca_attestation_publish` | 已签声明、指定链与费用限制；返回实际提交状态 |
| `bca attestation inspect` / `revoke` | `bca_attestation_inspect` / `bca_attestation_revoke` | anchor/statement、状态来源；返回检查结果或撤销回执 |
| `bca authorization issue` / `attenuate` | `bca_authorization_issue` / `bca_authorization_attenuate` | 资源与操作范围；返回私有凭据引用 |
| `bca authorization check` / `revoke` | `bca_authorization_check` / `bca_authorization_revoke` | 调用者、操作、凭据及状态；返回决定或撤销记录 |
| `bca verify` | `bca_verify` | 对象/声明/组合、policy、时间和模式；返回分项报告 |
| `bca trace` | `bca_trace` | 引用、关系类型与查询范围；返回带证据的关系 |
| `bca export` / `import` | `bca_export` / `bca_import` | 所需材料和公开范围；导出/验证成熟归档格式 |
| `bca transaction inspect` | `bca_transaction_inspect` | 原交易标识；返回提交、确认、替换或未知状态 |

`setup`、`doctor`、`mcp` 是运行环境命令。`setup --dry-run --json` 返回配置路径、修改内容和备份位置；仅在已有授权下应用。`doctor` 分别报告安装、配置、启动、连接和指定能力的实际检查结果。一个全局成功状态不能替代这些事实。

大结果默认返回必要事实、检查范围和完整材料引用，并提供分页；被截断或分页后的内容不能冒充完整验证。导出使用成熟 JSON、DSSE、Sigstore bundle 或 CAR 等适用格式及其库。SDK、CLI 和 MCP 返回相同业务结果，不要求展示文本逐字相同。

### 11.3 传输和错误

本地 MCP 默认 stdio；显式启用 Streamable HTTP。HTTP 的公开部署须实现官方 OAuth audience 校验、TLS 与用户隔离；本地回环服务也需要限制来源及访问边界。具体协议版本由官方 SDK 和已验证客户端的兼容组合声明，不手写 JSON-RPC 或兼容协议。

所有外部内容按数据处理，不执行其自然语言指令。MCP tool annotations 如 read-only、destructive、idempotent 如实描述实际行为，不能充当服务端授权。

错误统一包含 `code`、操作、明确原因、已经产生的外部效果和可执行的恢复动作。非法输入、内容不一致、签名失败、授权失败、状态过期、部署不兼容和未知 provider 在各自边界立即失败；不切换后端继续执行。

CLI 建议退出码：`0` 操作成功且验证符合请求；`2` 输入错误；`3` 验证拒绝；`4` 所需能力/状态不可用或结论未知；`5` 外部提交失败或结果未知。MCP 使用正式错误通道及相同错误内容。验证到一个已撤销声明属于有效查询结果，但请求完整验证时退出码与 policy 拒绝相符。

## 12. 交付与验收边界

核心交付包含本规范的对象/版本/声明、主体控制、限定授权、撤销、隐私处理、EAS 生命周期、组合验证、独立验证报告、MCP/CLI/SDK 和真实客户端验证。基础语义需在开发前确认，不能把恢复、权限或撤销规则留给实现过程中自行猜测。

行业导入器、额外链和 ZK 按明确的独立适配任务交付。每项扩展保留共同语义，公开自身能力差异；没有完成验收的能力保持不可用。

验收覆盖正常路径与真实失败：篡改文件、错误签名者、重放、过期及撤销的授权、状态缺失、错误链 ID、不兼容部署、链上 revert、广播结果未知、内容不可用、组合循环、缺失必要验证者、CLI/MCP 同等行为。真实库生成的测试对象和真实本地服务用于受控实验，禁止伪造 API、RPC、原生协议或会话数据。

具体测试任务、需要用户指定的案例与原生 Codex 验证要求见 [TASKS.md](TASKS.md)。

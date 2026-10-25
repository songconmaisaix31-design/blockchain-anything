# 适配器与配置

`createToolkit()` 从进程环境读取配置，返回 `{ tools, invoke }`。`tools` 的每项提供 `name`、`description`、Zod v4 严格对象 `inputSchema` 和 `readOnly`。`invoke(name, input)` 返回可 JSON 序列化的数据；bigint 使用十进制字符串。未知工具、额外字段、输入错误和实际 SDK 错误会抛出异常。

依赖固定为 EAS SDK 2.10.0、ethers 6.17.0、multiformats 14.0.5、kubo-rpc-client 7.1.0、Zod 4.6.7；入口使用 Incur 0.7.1 和官方 MCP server/client 2.3.1。EAS 使用其官方 CommonJS 导出，Node.js ESM 通过 `createRequire` 加载。

## 进程配置

环境文件由调用者显式加载，例如 `node --env-file=.env dist/cli/main.js tools`。配置在创建 toolkit 时固定；修改环境后重新创建实例。没有网络配置仍可发现全部已实现工具、执行 Schema 编解码、个人消息验签和本地 CID 操作。配置值格式错误会立即失败。

| 环境变量 | 语义与默认值 |
| --- | --- |
| `BCA_RPC_URL` | 操作者指定的 HTTP(S) EVM RPC，无默认值 |
| `BCA_CHAIN_ID` | 必须明确填写预期 chain ID，十进制正整数字符串 |
| `BCA_EAS_ADDRESS` | 实际部署的 EAS 合约地址，无默认值 |
| `BCA_SCHEMA_REGISTRY_ADDRESS` | 该 EAS 关联的实际 SchemaRegistry 地址，无默认值 |
| `BCA_PRIVATE_KEY` | 仅用于本地开发的签署私钥；公共 API 不接收私钥 |
| `BCA_ALLOW_WRITES` | 仅字面值 `true` 开启写入，默认 `false` |
| `BCA_WORKING_ROOT` | 文件访问根目录，默认当前工作目录 |
| `BCA_IPFS_URL` | 操作者指定的 HTTP(S) Kubo RPC API，无默认值 |
| `BCA_MAX_FILE_BYTES` | 本地文件最大字节数，默认 16777216 |
| `BCA_MAX_READ_BYTES` | IPFS 读取最大字节数，默认 1048576 |
| `BCA_TIMEOUT_MS` | 单次 RPC 请求、IPFS 操作及交易回执等待上限，默认 30000 毫秒 |

网络配置没有隐式主网或测试网。使用 Base Sepolia 时应从 [EAS 官方部署清单](https://docs.attest.org/docs/quick--start/contracts) 取得当前地址并明确设置 RPC 和 chain ID。本地链使用实际部署地址。

`evm_status` 只报告配置与写入能力，`connectionVerified` 始终为 `false`。`evm_chain` 查询实际 chain ID；`eas_status` 另外核对两个地址的合约代码、EAS 关联的 Registry 和版本；`ipfs_status` 查询实际 Kubo 版本。每次网络操作重新验证对应前提，发现配置与链不匹配立即失败。合约检查证明地址上存在代码且接口和关联符合调用要求，不证明代码经过审计。

## 工具目录

| 名称 | 输入 | 返回内容 |
| --- | --- | --- |
| `evm_status` | `{}` | 全部适配器配置状态，无 URL 或私钥 |
| `evm_chain` | `{}` | chain ID、最新区块字段、连接检查结果 |
| `evm_balance` | `address` | `balanceWei` 十进制字符串 |
| `evm_receipt` | `transactionHash` | `found` 与官方 receipt JSON |
| `evm_verify_message` | `message, signature, expectedSigner` | `signatureValid`、恢复地址、EIP-191 EOA 验证范围 |
| `eas_schema_encode` | `schema, fields: [{name,type,value}]` | ABI `data` |
| `eas_schema_decode` | `schema, data` | 官方嵌套 `fields`，整数序列化为字符串 |
| `eas_status` | `{}` | 实际网络、合约版本及检查结果 |
| `eas_schema_get` | `uid` | `found, schema, chainId` |
| `eas_schema_register` | `schema, revocable, resolverAddress?, submit:true` | 原生 Schema `uid`、交易哈希与 receipt |
| `eas_attest` | `schema, data, revocable, recipient?, expirationTime?, refUID?, valueWei?, submit:true` | 原生声明 `uid`、交易哈希与 receipt |
| `eas_get` | `uid` | `found, attestation, chainId` |
| `eas_revoke` | `schema, uid, valueWei?, submit:true` | 撤销的 `uid`、交易哈希与 receipt |
| `eas_offchain_sign` | 声明字段及 `time, submit:true`，不含 `valueWei` | `signer, attestation, onchainSubmitted:false` |
| `eas_offchain_verify` | `expectedSigner, attestation` | 具体签名/domain 检查结果及未检查项 |
| `content_cid` | `path` | CIDv1/raw/sha2-256、原文件字节数 |
| `content_inspect` | `cid` | CID 版本、codec、multihash |
| `ipfs_status` | `{}` | 节点版本与实际连接结果 |
| `ipfs_add` | `path, submit:true` | Kubo UnixFS CID、原字节数、DAG 大小、固定保存状态 |
| `ipfs_read` | `cid, maxBytes?` | 完整内容的 base64、字节数与 CID |

金额、chain ID、EAS 时间戳在工具输入中使用十进制字符串；`revocable` 使用 JSON boolean。`expirationTime` 默认 `"0"` 表示无过期时间；`recipient` 和 `resolverAddress` 默认零地址；`refUID` 默认零 bytes32；`valueWei` 默认 `"0"`。Schema 字段保留官方类型和值的语义，大整数使用字符串，ABI 解析由官方 SchemaEncoder 完成。

`eas_schema_get` 的 `schema` 为具名对象，包含 `uid, resolver, revocable, schema`。`eas_get` 的 `attestation` 为具名对象，包含 `uid, schema, refUID, time, expirationTime, revocationTime, recipient, revocable, attester, data`，其中三个时间字段均为十进制字符串。读取结果按官方 SDK 字段显式投影。缺失 Schema 沿用 SDK 行为，抛出 `Schema not found`；缺失声明返回 `found:false`，并保留合约返回的完整零值字段。

## 写入与签名

Schema 注册、声明、撤销和链下签署同时需要 `BCA_ALLOW_WRITES=true`、本地开发签署器及输入中的 `submit:true`。IPFS add 需要写入开启和 `submit:true`。所有这些工具标记为 `readOnly:false`。

EAS SDK 构造交易，ethers 完成填充、签署、提交与一次确认的限时等待。广播前从已签署交易取得原生交易哈希；提交或等待失败会在异常中保留 `transactionHash`。客户端不自动重试业务写入，操作者应先用 `evm_receipt` 查询状态。一个 toolkit 可执行多个调用；同一账户的链上写入应按顺序调用，账户 nonce 由 ethers 和节点处理。

链下签署采用官方 EAS Version2，salt 由 SDK 生成。验证输入是 `eas_offchain_sign` 返回的 `attestation` 加调用者明确给出的 `expectedSigner`。预期 domain 来自已核验网络和合约版本；外层及 message 的版本必须为 2。SDK 验证 UID、types、primaryType 和签名。`signatureValid` 仅表达这些检查；结果明确返回 `revocationChecked:false`、`timestampChecked:false`、`expirationChecked:false` 和 `trustChecked:false`。有效期、链上撤销和来源可信度仍需调用者按场景核对。

个人消息验证按 UTF-8 字符串执行 EIP-191 EOA 恢复，不执行 EIP-1271 合约钱包验证。环境变量私钥仅限本地开发；生产钱包或密钥设施尚未集成。

## 文件与 IPFS

文件访问先通过 `realpath` 验证根目录与目标，拒绝路径越界和符号链接逃逸，打开后再次确认路径及文件标识。只读取普通文件，读取过程持续执行字节上限。工具调用者不能覆盖工作根目录或服务地址。

`content_cid` 对整个文件原字节计算标准 raw CID，不向 IPFS 传输。`ipfs_add` 调用真实 Kubo add，设置 `cidVersion:1`、`rawLeaves:false` 和 `pin:true`，返回原生 UnixFS DAG 根 CID。两个 CID 的编码对象不同。固定保存表示请求该节点 pin，不保证其他节点持久保存或内容可信。

`ipfs_read` 仅接受可解析的 CID，向 Kubo 请求最多上限加一字节；超过上限立即终止并抛出异常。输出始终使用 base64，保留任意二进制内容。调用者设置的 `maxBytes` 只能降低进程读取上限。

## 官方资料与验证

- [EAS SDK 官方说明与源码](https://github.com/ethereum-attestation-service/eas-sdk)
- [ethers v6 Provider 与 FetchRequest](https://docs.ethers.org/v6/api/providers/jsonrpc/)
- [multiformats 官方 CID API](https://github.com/multiformats/js-multiformats)
- [Kubo RPC Client 官方说明](https://github.com/ipfs/js-kubo-rpc-client)

类型检查 `npm run typecheck` 与构建 `npm run build` 已通过。本轨道运行 `npx tsx .work/adapter-check.ts`，读取真实 README 文件，检查 CID、Schema 编解码、配置缺失、越界路径、严格输入和 EIP-191；在 Anvil chain ID 31337 部署官方 EAS/SchemaRegistry 1.7.1，检查合约代码、domain、链下签名、篡改拒绝、错误 chain ID 与无合约代码地址拒绝，全部通过。检查后已终止该脚本启动的 Anvil。

完整 EAS Schema/attest/revoke 生命周期、Kubo add/read、CLI/MCP 与包入口检查由集成轨道的 `npm run smoke` 执行。公共 Base Sepolia 交易、生产交易、npm 发布及原生 Codex 控制器审计不属于本轨道已验证结果。

EAS 读取局部检查 `npx tsx .work/eas-read-check.ts` 已通过：在独立 loopback Anvil 部署官方合约并准备真实 Schema/声明，核对两个读取工具的全部命名字段、缺失 UID 的实际结果和超过安全整数范围的十进制时间字符串。`npm run typecheck` 已通过；局部检查启动的 Anvil 已在 finally 中终止。

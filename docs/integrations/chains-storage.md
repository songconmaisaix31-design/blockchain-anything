# 链与存储接入

更新日期：2026-10-23。本文件记录轨道 C 的实际实现、配置、真实调用结果和未完成项。BCA 只聚合成熟项目提供的 SDK、CLI 或官方服务，不新增自有协议、身份、Hash 或调度系统。

## 工厂与边界

`src/chains/index.ts` 导出同步工厂：

```ts
import { chainStorageTools } from './src/chains/index.js';

const tools = chainStorageTools(); // ToolImplementation[]
```

工厂不接收配置参数。每个工具在 `execute` 内重新读取进程环境并执行真实 SDK/RPC 调用；缺少配置、网络不匹配或上游失败时立即抛错，不静默回退到其他网络。EAS 的 `easTools(config)` 工厂保持原签名，由集成轨道与 `chainStorageTools()` 并列注册。

## 已适配项目

| 项目 | 使用组件 | 工具 | 实际验证 |
| --- | --- | --- | --- |
| viem | viem 2.57.10 | `viem_chain`、`viem_block`、`viem_balance`、`viem_read`、`viem_transaction`、`viem_logs` | 真实 Anvil 31337：chain/block/balance、EAS `version()` 读取、交易/回执、事件日志全部通过 |
| Sign Protocol | `@ethsign/sp-sdk` 1.2.7 | `sign_status`、`sign_schema_get`、`sign_attestation_get`、`sign_delegated_sign_attestation` | Sepolia 11155111：官方地址 `0x878c...39c5`、版本 `1.1.4`、Schema 56165 与声明 1388 的真实链上读取通过；单字段 Schema `0xdb63` 的委托签名由链上 `getDelegatedAttestHash` 生成并验签通过，未广播 |
| Solana Attestation Service | `@solana/attestation` 2.1.0 + `@solana/kit` 8.5.0 | `sas_status`、`sas_credential_get`、`sas_schema_get`、`sas_attestation_get` | Solana 主网：程序 `22zo...BdG` 可执行；真实 Credential/Schema/Attestation 账户读取与 Schema 数据解码通过 |
| Sui | `@mysten/sui` 2.37.0（gRPC） | `sui_status`、`sui_object`、`sui_balance`、`sui_transaction` | Sui 主网：链标识、Walrus 系统对象、余额与对象历史交易读取通过 |
| Aptos | `@aptos-labs/ts-sdk` 7.5.0 | `aptos_status`、`aptos_account`、`aptos_balance`、`aptos_resource` | Aptos 主网：账本、账户 0x1、APT 余额与资源读取通过 |
| Walrus | `@mysten/walrus` 1.2.36 | `walrus_status`、`walrus_blob_metadata`、`walrus_blob_read`、`walrus_blob_object` | Testnet：链标识、当前存储费用、真实 Blob 对象读取通过；blob 内容读取未执行（见未完成项） |
| Seal | `@mysten/seal` 1.5.0 | `seal_status`、`seal_encrypt`、`seal_parse` | Testnet：3 个官方密钥服务器对象、阈值 2 加密（400 字节密文）与密文解析通过；解密未执行 |
| Arweave | `arweave` 2.1.0 | `arweave_status`、`arweave_transaction`、`arweave_data` | `arweave.net`：网络信息、真实交易元数据与 12517 字节数据读取通过 |

EAS 扩展继续使用 `@ethereum-attestation-service/eas-sdk` 2.10.0，新增 10 个工具：

| 工具 | 说明 |
| --- | --- |
| `eas_multi_attest` | 一次交易批量发布声明，返回回执中的全部原生 UID |
| `eas_multi_revoke` | 一次交易批量撤销 |
| `eas_timestamp` | 官方合约链上时间戳（`bytes32`） |
| `eas_delegated_sign` / `eas_delegated_attest` | 官方 Delegated 哈希签名与中继提交 |
| `eas_delegated_sign_revoke` / `eas_delegated_revoke` | Delegated 撤销签名与中继提交 |
| `eas_private_data_build` | 使用官方 `PrivateData` 构造 Merkle 树与多值披露证明 |
| `eas_private_data_verify` | 使用官方 `PrivateData.verifyMultiProof` 验证披露证明 |
| `eas_private_data_verify_tree` | 使用官方 `PrivateData.verifyFullTree` 重算根并比较 |

PrivateData 的选择披露只证明被披露值与根的关系，不等同于通用零知识证明。链下 EAS 验签仍不检查撤销、时间戳、有效期和发行者信任。

## 配置

所有值由操作者显式提供，没有隐式主网/测试网默认值。EVM 类工具沿用 `BCA_RPC_URL`、`BCA_CHAIN_ID`、`BCA_PRIVATE_KEY`、`BCA_ALLOW_WRITES`、`BCA_TIMEOUT_MS`；其余配置如下。

| 环境变量 | 说明 |
| --- | --- |
| `BCA_SUI_NETWORK` | `mainnet`、`testnet`、`devnet`、`localnet`，必须与端点一致 |
| `BCA_SUI_RPC_URL` | Sui gRPC fullnode，例如 `https://fullnode.mainnet.sui.io:443` |
| `BCA_APTOS_NETWORK` | `mainnet`、`testnet`、`devnet`、`local`、`custom` |
| `BCA_APTOS_NODE_URL` | Aptos fullnode REST 根地址，例如 `https://fullnode.mainnet.aptoslabs.com/v1` |
| `BCA_SOLANA_RPC_URL` | Solana JSON-RPC，例如 `https://api.mainnet-beta.solana.com` |
| `BCA_ARWEAVE_GATEWAY` | Arweave 网关根 URL，例如 `https://arweave.net` |
| `BCA_SEAL_SERVERS` | JSON 数组：`[{"objectId":"0x...","weight":1,"aggregatorUrl":"https://..."}]`，`aggregatorUrl` 仅委员会模式需要 |
| `BCA_SEAL_THRESHOLD` | 默认加密阈值，正整数 |
| `BCA_SEAL_PACKAGE_ID` | 应用自己的 Seal 策略包 ID；SDK 要求包对象为第一个版本 |
| `BCA_SEAL_VERIFY_KEY_SERVERS` | `true`/`false`，是否请求 `/v1/service` 校验密钥服务器 |
| `BCA_IPV4_ONLY` | `true` 时 viem 使用 Node `http`/`https` 强制 IPv4；默认关闭 |

Sign Protocol 的合约地址取自安装版本 SDK 的官方 `chainInfo`，不额外接受任意地址。SDK 1.2.7 的 Sepolia 与 Base 主网地址与当前官方部署表一致；Base Sepolia 在官方文档中已是旧部署，使用前需按官方地址表核对。

## 真实验证

命令：

```powershell
$env:ANVIL_BIN = 'C:/Users/DW/.local/bin/anvil.exe'
npx tsx scripts/check-chains.ts
```

脚本启动本机 Anvil，部署 npm 依赖中的官方 EAS `SchemaRegistry`/`EAS` artifacts，然后按项目独立执行；任一项目失败不会阻止其他项目，最终以非零退出码报告失败。2026-10-23 全量执行结果：`eas`、`sign`、`sui`、`aptos`、`sas`、`walrus`、`seal`、`arweave` 全部 `passed`。

EAS/viem 实际结果（链 ID 31337）：注册 Schema、单条声明、批量 2 条声明、时间戳、PrivateData 根与披露证明、委托签名/提交/撤销、批量撤销、viem 交易/回执/日志全部通过；篡改 PrivateData 披露值被拒绝。

公共网络实际结果：

- Sign Protocol：Sepolia `0x878c92FD89d8E0B93Dc0a3c907A2adc7577e39c5`，`version()` 返回 `1.1.4`，读取最新 Schema 与声明成功。
- Sui：主网链标识 `4btiui...DR6S`，Walrus 系统对象版本与历史交易读取成功。
- Aptos：主网 chain ID 1，账户 0x1 的 APT 余额 `11120868786` octas 与资源读取成功。
- SAS：主网程序 `22zoJMtdu4tQc2PzL74ZUT7FrwgB1Udec8DdW4yw4BdG`，Credential `12nA4...pbnx`（名称 `hackshield`）、Schema 与 Attestation 账户读取和解码成功。
- Walrus：Testnet 当前 1 MiB / 1 epoch 存储费用 `storageCost=181637`、`writeCost=363207`；真实 Blob 对象读取成功。
- Seal：Testnet 官方密钥服务器对象读取、阈值 2 加密与密文解析成功。
- Arweave：网络版本 `arweave.N.1`，交易 `bNbA3...Dt_U` 的 12517 字节数据读取成功。

## 未完成与限制

- Walrus `walrus_blob_read` / `walrus_blob_metadata` 未执行真实内容读取：Testnet 会周期性清理数据，本次可验证的 Blob 对象已过期；本轨道不执行存储写入。工具使用官方 SDK 的真实存储节点读取路径，但未取得成功结果。
- Seal 解密未实现：`SealClient.decrypt` 需要应用自己的 Move `seal_approve*` 策略包、钱包签名的 `SessionKey` 和对应 PTB；本轨道不部署 Move 包，也不接触钱包签名。
- Sign Protocol 委托签名已用真实 Sepolia Schema `0xdb63` 验证 `signatureValid=true`，但未在公共网络提交交易；公共写入不在本轮范围。
- 未执行任何公共链资金交易、存储付费、生产部署、npm 发布或付费订阅。Sui/Aptos/Solana 仅只读。
- 未验证原生 Codex 控制器审计；普通工具调用不等于该审计结果。

## 依赖版本（由集成轨道写入正式 package/lockfile）

`viem@2.57.10`、`@ethsign/sp-sdk@1.2.7`、`@mysten/sui@2.37.0`、`@mysten/walrus@1.2.36`、`@mysten/seal@1.5.0`、`@aptos-labs/ts-sdk@7.5.0`、`@solana/attestation@2.1.0`、`@solana/kit@8.5.0`、`arweave@2.1.0`。这些版本由 `npm install --no-save --package-lock=false` 实际安装并用于上述检查，未修改 `package.json`/`package-lock.json`。

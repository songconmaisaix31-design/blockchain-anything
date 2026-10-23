# 链与存储

所有操作保留原生数据结构与标识，SDK 在调用时加载。以 `bca tools <name>` 的输入 Schema 为准。

| 组件 | 工具 | 配置与边界 |
| --- | --- | --- |
| ethers / viem | evm_*、viem_* | BCA_RPC_URL + BCA_CHAIN_ID；实际网络不符立即失败 |
| EAS SDK | eas_*（20 个） | EAS/Registry 地址；包含批量、delegation、时间戳、PrivateData；不把签名有效等同于发行者可信 |
| [Sign Protocol](https://docs.sign.global/developer-center/sign-protocol-client-sdk) | sign_schema、sign_attestation、sign_attest、sign_revoke | BCA_SIGN_CHAIN 为官方 EvmChains 名称，如 baseSepolia；同时核对 RPC 与该链；写入需开发密钥和 submit |
| [Sui](https://sdk.mystenlabs.com/sui) | sui_balance、sui_object、sui_transaction、sui_transaction_inspect | BCA_SUI_RPC_URL 为 gRPC base URL；BCA_SUI_NETWORK 明确网络标签；inspect 离线解析交易 |
| [Aptos](https://aptos.dev/build/sdks/ts-sdk) | aptos_ledger、aptos_account、aptos_view | BCA_APTOS_RPC_URL 含 /v1；view 支持标量参数 |
| [Solana / SAS](https://github.com/solana-foundation/solana-attestation-service) | solana_balance、sas_attestation、sas_schema | BCA_SOLANA_RPC_URL；sas-lib 解码并检查 owner；调用方核对 schema、credential、signer 和 expiry |
| multiformats / Kubo | content_*、ipfs_* | raw CID 与 UnixFS 根 CID 分开；IPFS add 需写入授权 |
| [Walrus](https://docs.wal.app/usage/web-api.html) | walrus_read、walrus_store | BCA_WALRUS_AGGREGATOR / BCA_WALRUS_PUBLISHER；官方 HTTP /v1/blobs；上传文件可能消耗存储额度 |
| [Seal](https://seal-docs.wal.app/) | seal_encrypt | Sui RPC + BCA_SEAL_SERVERS JSON；校验官方 key server，保留 packageId/id，返回密文不返回对称密钥 |
| [Arweave](https://github.com/ArweaveTeam/arweave-js) | arweave_info、arweave_transaction、arweave_read、arweave_verify | 默认 arweave.net，可配置网关；有界读取；验签不代表网络已确认 |

Seal 服务器配置格式：

```json
[
  { "objectId": "0x<64个十六进制字符>", "weight": 1 }
]
```

从 Seal 官方部署说明选择网络匹配的对象和 packageId，勿把示意值当作部署地址。S2 仅提供加密入口；策略部署、SessionKey 授权与解密仍由官方 Seal 集成承担。

## 真实验证

2026-10-23：Anvil 上 EAS 生命周期通过；此前已验证的 viem 与 EAS 扩展保留原结果。Sui testnet balance、Aptos testnet ledger（chain_id=2）、Solana devnet balance 读取通过。Arweave 网关信息、离线原生交易签名验证通过；Sui Transaction 离线解析通过。

Sign/SAS 尚缺选定网络的真实声明样本；Walrus 上传/读取、Seal 真实 key server 加密尚未验证。未发送公共链交易、未上传用户文件。公开读路径验证不替代签署、存储和权限路径验收。

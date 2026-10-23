# 链与存储

更新日期：2026-10-23。当前已实际接入 viem 和 EAS 扩展；其他链/存储仍待逐项实现与验证。

## viem

实现位于 `src/chains/viem.ts`，使用安装版本 viem 2.57.10。每次调用先核对 RPC 的实际 chain ID 与 `BCA_CHAIN_ID`，不匹配立即失败。

| 工具 | 作用 |
| --- | --- |
| `viem_chain` | 连接、chain ID 核对、最新区块号 |
| `viem_block` | 区块字段（不返回完整交易） |
| `viem_balance` | 原生币余额（wei 字符串） |
| `viem_read` | 只读合约调用（ABI 由调用者提供） |
| `viem_transaction` | 交易与回执；未找到时 `found=false` |
| `viem_logs` | 明确范围的 `eth_getLogs` |

`BCA_IPV4_ONLY=true` 时使用 Node `http`/`https` 强制 IPv4 的 `fetchFn`，仅用于本机双栈异常环境；默认关闭。

## EAS 扩展

在原有 10 个 EAS 工具上新增：

| 工具 | 作用 |
| --- | --- |
| `eas_multi_attest` | 一次交易批量声明，返回回执中的全部 UID |
| `eas_multi_revoke` | 一次交易批量撤销 |
| `eas_timestamp` | 官方合约链上时间戳 |
| `eas_delegated_sign` / `eas_delegated_attest` | 官方 Delegated EIP-712 签名与中继提交 |
| `eas_delegated_sign_revoke` / `eas_delegated_revoke` | Delegated 撤销签名与中继提交 |
| `eas_private_data_build` | 官方 PrivateData 构造 Merkle 树与多值披露证明 |
| `eas_private_data_verify` | 验证多值披露证明 |
| `eas_private_data_verify_tree` | 从完整树重算根并比较 |

PrivateData 的 Merkle 选择披露只证明被披露字段与根的关系，不等同于通用 ZK；链下验签仍不检查撤销、时间戳、有效期和发行者信任。

## 实际验证（2026-10-23，真实 Anvil 31337）

使用官方 `eas-contracts` artifacts 部署真实 SchemaRegistry 与 EAS 合约，然后通过统一 toolkit 调用：

- 注册 Schema，`eas_multi_attest` 一次发布 2 条声明，返回 2 个不同 UID；`eas_get` 均能读回。
- `eas_timestamp` 返回非零链上时间戳。
- `eas_private_data_build` 生成根 `0x4784c6316dec257be063a96bf841e99b40f53562c45aaa7ced69c558633373aa`；`verify` 为 true，`verify_tree` 根匹配。
- `eas_delegated_sign` + `eas_delegated_attest` 得到 UID `0x48ed3b8bfb02490f2f20f479b1f7ed3f50e92db723964943364bd4cbd060f6aa`；随后 Delegated 撤销成功，`revocationTime` 非零。
- `eas_multi_revoke` 一次撤销 2 条声明，链上状态均更新。

viem 在同一 Anvil 上完成：`viem_chain`、`viem_block`、`viem_balance`、部署 Counter、`viem_read`（0→1）、`viem_transaction`（交易与回执）和 `viem_logs`（0 条）全部通过。

## 未完成

- Sign Protocol、Solana Attestation Service、Sui SDK、Aptos SDK。
- Walrus、Seal、Arweave。
- 上述项目需要真实 SDK 安装、官方接口核对和实际调用；没有通过前不标记为支持。

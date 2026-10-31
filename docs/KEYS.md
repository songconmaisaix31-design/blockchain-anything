# 密钥与外部账户清单

> 更新时间：2026-10-31 · 对应 v1.3
> 原则：**要钱的先空缺**。本文只列出"能免费拿到"的凭据；付费服务只登记名称与价格，不实现、不引导购买。
> 所有变量都通过环境变量或 `/etc/bca-demo.env` 注入，**不写进工具输入、不进代码、不进仓库**。

## 0. 先说结论：跑通全套需要几个 key

| 场景 | 需要什么 | 花钱吗 |
| --- | --- | --- |
| 152 个工具全部注册、可检索 | **什么都不需要** | 免费 |
| 链上读取、发币、发 NFT（本地 Anvil） | `BCA_RPC_URL` + `BCA_CHAIN_ID` | 免费（本机 Anvil） |
| 主网只读：价格、TVL、NFT、跨链、授权、合约体检 | `BCA_RPC_URL` 指向任意公共 RPC | 免费 |
| Safe Harbor 登记查询 / 交易复盘 / 价差净额 | 同上 | 免费 |
| **授权扫描覆盖全历史** | `BCA_ETHERSCAN_API_KEY` | **免费额度即可** |
| **fork 重放（攻击复盘 / 救援推演）** | `BCA_ARCHIVE_RPC_URL` + 本机 `anvil` | **免费额度即可** |
| 子图查询 | `BCA_GRAPH_API_KEY` | 免费额度即可 |
| 上链前模拟 | `BCA_TENDERLY_*` 三件套 | 免费额度即可 |
| 账户抽象回执 | `BCA_BUNDLER_URL` | 免费额度即可 |
| 线上 Demo 的 Agent 推理 | `STEPFUN_API_KEY` | 已注入服务器 |

**也就是说：演示这套"靠近钱"的完整链路，不需要付一分钱。**

---

## 1. 免费可申请（建议按这个顺序补齐）

| 变量 | 用途 | 去哪申请 | 备注 |
| --- | --- | --- | --- |
| `BCA_ETHERSCAN_API_KEY` | Etherscan v2 API：合约 ABI、**全历史 Approval 日志** | <https://etherscan.io/apis> | 一把 key 覆盖多链（`chainid` 参数）。没有它 `approval_scan` 只能扫最近区块窗口，工具会把覆盖范围写进返回值 |
| `BCA_ARCHIVE_RPC_URL` | 能读**历史区块状态**的归档节点，用于 `fork_replay` | Alchemy / QuickNode / Infura 免费额度 | 公共 RPC 基本都不保留历史状态。实测 `https://gateway.tenderly.co/public/mainnet` 可用（有 2 万条结果上限） |
| `BCA_GRAPH_API_KEY` | The Graph 去中心化网关子图查询 | <https://thegraph.com/studio> | 托管子图已 301，必须用网关 |
| `BCA_TENDERLY_ACCOUNT` / `_PROJECT` / `_ACCESS_KEY` | `tx_simulate` 上链前模拟 | <https://tenderly.co> | 三个必须同时设置，缺一个工具直接报缺哪个 |
| `BCA_BUNDLER_URL` | ERC-4337 bundler（Pimlico / Alchemy） | <https://docs.pimlico.io> | 用于 `aa_entrypoints` / `aa_userop_receipt` |
| `BCA_IPFS_GATEWAY` | NFT 元数据网关 | 自建或公共 | 公共网关对共享出口 IP 常限流（429），建议自建 |

注入方式（服务器）：

```sh
bash .work/deploy/set-key.sh BCA_ETHERSCAN_API_KEY <你的 key>
bash .work/deploy/set-key.sh BCA_ARCHIVE_RPC_URL https://eth-mainnet.g.alchemy.com/v2/<key>
```

文件写在 `/etc/bca-demo.env`，权限 600，注入过程不回显。

---

## 2. 付费的：全部留空，只登记不实现

| 服务 | 做什么 | 价格 | 状态 |
| --- | --- | --- | --- |
| Forta Attack Detector | 实时攻击检测 | **$399/月** | ❌ 空缺。理由：公共 RPC 的 `txpool_status` / `eth_pendingTransactions` 已实测可用，先自建 |
| Ironblocks | 事前拦截 | **$1,289/月** | ❌ 空缺。同上 |
| Hypernative | 实时风控（Balancer 事件中 21 分钟锁定可暂停池） | 企业议价 | ❌ 空缺 |
| EigenPhi | MEV 分类与套利钱包 API | 需 key | ❌ 空缺。理由：先自建路径还原 |
| Nansen / Arkham | 地址标签与实体归因 | 订阅制 | ❌ 空缺。`fund_trace` 因此未实现 |
| zeromev | MEV 区块数据 | 免费 | ❌ **已不可用**：实测返回 530，Cloudflare 层就挂了 |

**空缺的原因不是省钱**：这一层供应商极不稳定（zeromev 已经挂了），自建采集是刚需而不是可选项。等自建能力跑稳，再决定要不要买。

---

## 3. 与"靠近钱"直接相关的工具与凭据对照

| 工具 | 需不需要 key | 说明 |
| --- | --- | --- |
| `safeharbor_registry` | ❌ 不需要 | 直接读链上注册表 `0x3267…5a2c`（CreateX 全链同址），`list` 模式需要节点支持历史日志 |
| `mempool_watch` | ❌ 不需要 | 需要 geth 风格节点暴露 `txpool_status` / `eth_pendingTransactions`；不暴露时工具如实返回 warning |
| `tx_call_tree` | ❌ 不需要 | 有 `debug_traceTransaction` 就用，没有就降级为回执日志并明确说明 |
| `arb_scan` | ❌ 不需要 | Uniswap V3 池 + Chainlink 喂价，全部走已配置 RPC |
| `fork_replay` | ⚠️ 需要 `BCA_ARCHIVE_RPC_URL` + 本机 `anvil` | 公共 RPC 没有历史状态，fork 不起来 |
| `allowance_check` | ❌ 不需要 | 直接 `allowance()` 调用 |
| `approval_scan` | ⚠️ 建议 `BCA_ETHERSCAN_API_KEY` | 没有就按 `windowBlocks`（默认 50 万）扫最近区块，并在返回值里写明覆盖不完整 |
| `nft_approval_check` | ❌ 不需要 | `isApprovedForAll` / `getApproved` 直读 |
| `contract_posture` | ❌ 不需要 | 字节码 + ERC-1967/1822/1167 存储槽直读 |
| `wallet_posture` | ⚠️ 建议 `BCA_ETHERSCAN_API_KEY` | 同上 |

---

## 4. 安全边界（与密钥同等重要）

- 工具输入**从不接收私钥**；`BCA_PRIVATE_KEY` 只允许出现在环境变量，且仅用于本地开发。
- 默认 `BCA_ALLOW_WRITES=false`；写操作需要显式 `submit: true` 与明确发送地址。
- `fork_replay` 只在本机临时 fork 上运行，进程用完即杀，改动不进主网。
- 错误输出会做脱敏：URL、query 参数、任何名字里带 KEY/TOKEN/SECRET 的环境变量值都会被替换成 `[REDACTED]`。
- 付费数据源即使将来接入，也只用于**只读检测与解释**，不用于自动交易。

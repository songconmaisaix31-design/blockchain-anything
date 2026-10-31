# 区块链项目集成规划

> 本文回答一个问题：**接下来该接哪些项目、按什么顺序接、凭什么判断该不该接。**
>
> 配套阅读：[长期展望](VISION.md) · [商业模式](BUSINESS.md) · [验证记录](../tasks/S2-progress.md)
>
> 盘点基线：2026-10-31，142 个工具 / 55 家上游。

## 1. 现状盘点

先把已有的排开，避免重复投入。

| 类别 | 已接入 | 覆盖程度 |
| --- | --- | --- |
| EVM 基础读写 | viem（余额/区块/链信息/日志）、RPC trace | 够用 |
| 合约开发 | Foundry（init/build/test/deploy/verify）、Cast、Anvil、solc、Hardhat、Slither | 完整 |
| 源码与验证 | Sourcify | 仅源码，**缺 ABI 与交易解码** |
| 其他公链 | Solana（Kit / AgentKit / **SPL 持仓**）、Sui（gRPC / SDK）、Aptos（SDK） | v1.2 补了 SPL 持仓；仍缺 Solana NFT 与交易历史 |
| NFT | **ERC-721 直读**（balance / owner / metadata） | 合约层够用；**缺市场数据**（地板价、挂单） |
| 跨链 | **Across 报价**、**Wormholescan 消息** | 只读报价与状态；执行仍留给宿主钱包 |
| 安全检测 | GoPlus 代币安全、Slither 静态分析 | 代币维度够，**缺交易/地址维度** |
| 存储与内容 | IPFS/Kubo、Arweave、Walrus、Seal、CID 计算 | 完整 |
| 身份与凭证 | EAS（20 个工具）、did:key、VC-JWT、cheqd、SAS、Sign Protocol | **过重**，一家占 16% |
| 来源与审计 | SLSA、Sigstore、in-toto、C2PA、OTS、risc0、OpenLineage | 完整 |
| 行情与协议数据 | CCXT、Hummingbot、**Chainlink 喂价**、**DefiLlama**、**Jupiter** | v1.1 已补链上价格、协议 TVL 与 Solana 报价；**仍缺 NFT 与跨链报价** |
| 钱包与支付 | Safe、x402 | 只读为主 |
| Agent 协作 | AgentKit、MCP bridge | 完整 |

一句话结论：**开发侧很厚，数据侧偏薄，DeFi 与 L2 基本空白。**

最能说明问题的一个测试：Agent 问「这个代币现在多少钱」，我们只能去币安/OKX 查中心化价格；问「这个地址在 Uniswap 里有多少 LP」，直接答不了；问「这笔交易实际改了什么状态」，只能靠 trace 硬解。

## 2. 准入标准

不是所有热门项目都该接。用五条筛：

1. **Agent 真的会问**。有没有一类用户问题非得它才能回答？如果一个工具只在人类手动操作时有用，优先级降一级。
2. **只读优先**。只读工具可以默认开启、零授权风险；写操作必须进写入闸门，成本高得多。
3. **凭据可得**。有公开接口或免费额度的优先。需要企业合同才能跑通的，先挂在 P2 观察。
4. **不与现有工具重复**。已经有 viem 能覆盖的，不为了"多一个供应商"再接一遍。
5. **失败语义说清楚**。上游超时、限流、无数据，必须能区分——Agent 最怕的是"看起来成功但其实没查到"。

## 3. 三条接入路径

| 路径 | 适用 | 成本 | 维护 |
| --- | --- | --- | --- |
| **桥接（bridge）** | 上游**已有官方 MCP 服务** | 极低：`bca connect <name>` 存配置，`bridge_call` 直接调 | 跟随上游，几乎零维护 |
| **适配（SDK）** | 有成熟 SDK、调用形态固定 | 中：每个工具一个 schema + 执行器 | 跟版本升级 |
| **直连（HTTP）** | 只有 REST，逻辑简单 | 低：一次 fetch + 统一错误映射 | 跟 API 变更 |

**选型原则：凡是上游提供官方 MCP 的，一律走桥接，不自己写适配器。** 这是我们和"再包一层 SDK"最本质的区别——MCP 已经是标准，重复封装只会增加维护面。

已确认可走桥接的预设：Dune、Nansen、Chainstack、Thirdweb、Slither、OpenZeppelin。其余候选在接入前需先核实是否已有官方 MCP。

## 4. P0：已交付（v1.1）

八项已实现并合并进主分支，工具总数 127 → 135、上游 44 → 50。状态如实标注：

| 项目 | 工具 | 补了什么 | 状态 |
| --- | --- | --- | --- |
| **Chainlink Price Feeds** | `chainlink_price` | 链上喂价（价格、精度、更新时间、陈旧判定），主网内置 8 个常用对 | ✅ 8 个交易对全部真实读数通过 |
| **DefiLlama** | `defillama_protocol`、`defillama_chains` | 协议 TVL 与 7 日变化、各链 TVL 排名 | ✅ 实测 Uniswap 36 亿、Aave 155 亿；420 条链排名 |
| **Jupiter** | `jupiter_quote` | Solana 兑换报价与路由 | ✅ 实测 1 SOL → 94.99 USDC |
| **Etherscan v2** | `explorer_abi` | 已验证合约的 ABI 与函数清单 | ⏳ 需 `BCA_ETHERSCAN_API_KEY`，未配置时返回明确提示 |
| **ERC-4337** | `aa_entrypoints`、`aa_userop_receipt` | EntryPoint 版本、UserOperation 回执 | ⏳ 需 `BCA_BUNDLER_URL` |
| **交易预执行** | `tx_simulate` | 上链前模拟：是否回滚、gas、错误原因 | ⏳ 需 Tenderly 三个变量 |

设计上守住三条：

1. **缺凭据必须说清缺哪个变量**，而不是笼统报错。实测四个需要密钥的工具都会直接点名环境变量。
2. **缺数据不伪造结论**。`aa_userop_receipt` 查不到返回 `found: false`，`chainlink_price` 给出 `stale` 判定但说明"喂价按偏离阈值与心跳更新，不代表一定异常"。
3. **只读，不进写入闸门**。八项全部 readOnly，模拟与报价都不构造、不签名、不广播。

P0 的验收标准：八个工具各用真实主网数据跑通一次；失败场景（地址无效、无数据、限流、缺凭据）能返回可区分的错误；credits 定价符合"本地计算 0、只读 1、付费上游 3–4"的规则。

已跑通的三项覆盖了原先最刺眼的空白：**链上价格、协议规模、Solana 报价**。三项加密钥才能验证的，接口已就位，等 operator 提供凭据即可点亮。

## 5. P1：已交付（v1.2）

原本的 P1 清单里，凡是能靠公开接口或已配置 RPC 完成的都已实现，共 7 个工具，工具总数 135 → 142、上游 50 → 55。

| 项目 | 工具 | 补了什么 | 状态 |
| --- | --- | --- | --- |
| **NFT 数据** | `nft_balance`、`nft_owner`、`nft_metadata` | ERC-721 持仓数量、持有者、tokenURI 解析（含元数据 JSON） | ✅ 直读合约，无需密钥；BAYC 实测通过 |
| **跨链报价** | `across_quote` | 跨链费用与到账时间预估 | ✅ 实测 0.1 ETH 主网→Base，费率 0.0114%、2 秒到账 |
| **跨链消息** | `wormhole_tx_status` | 按交易哈希查 Wormhole 消息记录 | ✅ 实测返回 10 条消息 |
| **Solana 深度** | `solana_tokens` | SPL 代币持仓（支持 Token-2022，可按 mint 过滤） | ✅ 实测；大钱包 3125 个账户场景已处理 |
| **子图** | `subgraph_query` | 任意子图的 GraphQL 查询 | ⏳ 需 `BCA_GRAPH_API_KEY` |

**为什么 NFT 不走 Reservoir**：Reservoir 需要 API key，而且从当前网络不可达；ERC-721 的 `balanceOf` / `ownerOf` / `tokenURI` 用已配置的 RPC 就能直读，零密钥、零第三方依赖。代价是没有地板价、挂单这类市场数据——那部分等接入带 key 的市场聚合器再补。

**踩到的两个坑**：

1. 公共 IPFS 网关对共享出口 IP 限流（`ipfs.io`、`dweb.link` 直接 429，`cloudflare-ipfs.com` 不可达），只有 `gateway.pinata.cloud` 能用。现在按候选列表逐个回退，并支持 `BCA_IPFS_GATEWAY` 指定自建网关。
2. Token-2022 的程序地址如果写错，RPC 会报 `Invalid parameter: String is the wrong size`——这类"地址看起来对但长度不对"的错误很容易被忽略。

## 6. P2：观察名单（不排期）

- **法币入金（MoonPay / Transak）**：涉及合规与 KYC，与"能力层"定位有张力，先不碰。
- **Intent / 撮合（CoW Swap、1inch Fusion）**：形态还在演化，等接口稳定。
- **AI 推理链（Bittensor / Atoma）**：与"链上能力"相关但不是 Agent 的高频需求。
- **MPC / 托管钱包**：触碰私钥，与"不持私钥"的安全叙事冲突，除非有强需求，否则不做。
- **MEV 与排序（Flashbots）**：受众窄，先观察。

## 7. 不建议接的

负面清单比清单更重要：

- **重写已有能力的**。再用另一家 SDK 包一遍 `balance`，只会让目录变长、检索变差。
- **需要用户私钥才能用的**。违反"不持私钥、不托管资金"的边界。
- **只提供网页、没有稳定 API 的**。今天能抓，明天就挂，维护成本无底洞。
- **需要企业合同才能试跑的**。没有免费额度就无法验证，接进来也是"注册了但跑不通"。
- **数据来源不可追溯的**。Agent 会把它当事实用，来源不明的数据比没有数据更危险。

## 8. 结构性问题（比接新项目更该先做）

1. **供应商命名要统一**。现在目录里有 `Sui / Aptos / Sign Protocol`、`C2PA / in-toto / OpenLineage / OTS` 这种复合名，Agent 检索时会当成一个供应商，统计和定价都会失真。建议一工具一供应商，多来源用 `source` 字段标注。
2. **EAS 过重**。20 个工具占 16%，但实际使用频率远低于余额查询。建议做使用度评估，低频的合并或折叠进 `eas_call` 一个通用入口。
3. **缺口要有兜底**。凡是当前答不了的类别（DeFi、NFT、L2），`capability_search` 应明确返回"该类别尚未接入"，而不是让 Agent 自己猜或编。
4. **每个新供应商先做探针**。先接 1 个只读工具验证连通性与数据结构，跑通再扩到 3–5 个，避免一次性铺开又全部回滚。

## 9. 节奏建议

| 版本 | 目标 | 集成量 | 判定标准 |
| --- | --- | --- | --- |
| v1.1 ✅ | 补齐四类高频问题 | P0 八项 | 已交付：三项真实跑通，三项等凭据 |
| v1.2 ✅ | 生态做深 | P1 六项 | 已交付：NFT 直读、跨链报价与消息、Solana 持仓；子图等 key |
| v2.0 | 结构治理 | 命名统一、EAS 收敛、缺口兜底 | 目录可被 Agent 稳定检索，无复合供应商名 |

不追求工具数量增长。**127 个能用的工具，比 300 个注册但跑不通的有价值。**

# S2 逐项接入进度

更新：2026-10-23。开发分支：codex/bca-s2-complete，基于 codex/bca-ecosystem 的 4194200。原五条 Worker 轨道已停止；本轮主 Agent 接手实现。分支名表示实现目标，验收状态以下表为准。

“入口就绪”表示调用官方实现的代码与配置存在；“通过”只针对列出的实际操作。缺凭据或样本的项目维持待验收。

| 项目 | 实现方式 | 实际状态 / 剩余条件 |
| --- | --- | --- |
| OpenZeppelin Contracts MCP | 官方 MCP stdio | 发现、ERC20 生成通过 |
| OpenZeppelin Skills | skills CLI + dev_skill_read | 安装与读取通过 |
| Trail of Bits Skills | 官方安装源 + 通用技能读取 | 入口就绪，未运行完整审计 |
| Slither | 官方 CLI + MCP 配置 | CLI 实际分析通过、有 finding；MCP 待运行 |
| Tenderly | 官方 MCP + OAuth 配置 | 待授权及交易模拟验收 |
| GoPlus | 官方 MCP stdio 配置 | 待 key/secret；官方 Skills 实装未验收 |
| Alchemy | 官方 MCP + 官方 Skills 安装方式 | 待账户授权与调用 |
| thirdweb AI | 官方 MCP secretKey 配置 | 待凭据 |
| Uniswap AI | 官方 Skills 安装与读取入口 | 未执行兑换、流动性或部署工作流 |
| Chainstack | 统一官方 MCP | 待凭据；不使用废弃 rpc-nodes-mcp |
| Nansen | 官方 MCP | 待 API key |
| Dune | 官方 MCP | 待 API key |
| CoinGecko | 官方 MCP | discovery 与 search_docs 通过 |
| Allium | 官方 MCP / 原生 get_skill | 待 API key 或 OAuth |
| Token Terminal | 官方 MCP / mcp-remote | 待 OAuth |
| Messari | 官方 MCP / mcp-remote | 待 OAuth + API 权限 |
| Kaito | 无已核实官方通用接口 | 未适配；保留发现记录 |
| AgentKit | 官方 kit actions + 隔离 Worker | 本地真实钱包详情读取通过；其他 actions 未代验 |
| Coinbase Wallet MCP | 当前官方服务 | 待 OAuth 钱包授权 |
| Solana Agent Kit | 官方 tools 转 NativeAgentAction | 真实 TokenPlugin 发现 26 actions，devnet BALANCE_ACTION 读取通过；未执行交易 |
| elizaOS | plugin actions 调用 toolkit | handler 调用通过；完整 runtime 未验收 |
| Heurist Mesh | 官方 schema/HTTP + Skill 来源 | 入口就绪，待 API key 和业务调用 |
| GAME | 官方 GameFunction | 本地 function 通过；托管 Agent 待 key |
| Olas / Open Autonomy | 官方 Python MCP 消费示例 | 真实 MCP CID 通过；完整服务未部署 |
| Bankr | 官方 Agent API prompt/job | 入口就绪，待 API key |
| Brian | 官方 BrianSDK.transact | 入口就绪，待 API key |
| GOAT | 归档状态与迁移记录 | 不引入已停止维护的依赖 |
| Foundry | Forge / Cast / Anvil | Forge 测试和 Anvil EAS 通过；Cast 单独网络操作未复测 |
| Hardhat | 项目 package.bin 原生 compile | 入口就绪，待真实项目编译验收 |
| viem | 6 个原生 EVM 工具 | 基线真实 Anvil 读写/回执/日志已通过 |
| Safe | 官方 Protocol Kit | 查询/unsigned transaction 就绪，待 Safe 钱包样本 |
| x402 | 官方 core HTTP/schema/facilitator | header 通过；facilitator 授权验证未验收；不结算 |
| CCXT | 官方 public exchange API | registry、配置 httpsProxy 后 Kraken BTC/USD ticker 通过 |
| Hummingbot | 官方 API status | 待服务地址及授权 |
| EAS 扩展 | 官方 SDK | 基线已通过批量、delegation、时间戳、PrivateData |
| Sign Protocol | 官方 SDK | 查询/创建/撤销就绪；待声明样本与网络验收 |
| Solana Attestation Service | 官方 sas-lib | schema/attestation 解码与 owner 检查就绪；待链上样本 |
| Sui | 官方 gRPC SDK | testnet balance 与离线 Transaction 解析通过 |
| Aptos | 官方 TS SDK | testnet ledger 通过 |
| Walrus | 官方 publisher/aggregator HTTP | 入口就绪，待服务与真实 blob |
| Seal | 官方 SDK | 加密入口就绪，待 key server/packageId |
| Arweave | 官方 arweave-js | info、离线交易签名验证通过 |
| OpenTimestamps | 官方 ots CLI | info 通过；Bitcoin 证明 verify 未验收 |
| RISC Zero | 官方 verifier ABI + viem eth_call | 待匹配部署的真实 proof |
| cheqd | 官方 DID querier | 待 RPC/DID |
| W3C VC | did-jwt-vc / did:key | 真签名、时间与篡改拒绝通过；不含信任/吊销 |
| in-toto | 官方 in-toto-verify | 入口就绪，待可信 layout/keys/links |
| SLSA | 官方 slsa-verifier | 入口就绪，待真实产物/provenance |
| Sigstore / Cosign | 官方 cosign | 入口就绪，待 bundle/身份或公钥 |
| OpenLineage | 原生 RunEvent HTTP | 入口就绪，待后端 |
| C2PA | 官方 c2patool | 入口就绪，待媒体 manifest 样本 |

## 接着验收

仅对新增配置对应的真实路径做一次局部验收，记录调用名、网络、结果与限制。不得把工具目录条目、配置模板或链接当作外部调用成功；不得用模拟账户、假 API 或缩减清单换取“全部通过”。所有外部服务条件满足后，再按已授权要求合并 main。

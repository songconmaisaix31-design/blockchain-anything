# S2 逐项接入进度

2026-10-24 补充：现有可执行回归脚本及交接文档所列公开只读路径已集中复验；Hardhat 3.21.0 compile/test（含真实断言失败）、Slither 0.11.6 状态分类、标准代理和嵌套诊断 partial、MCP 动态 Schema 通知均已补测。Windows/WSL2/客户端、账户服务、后端和未实现功能的完整接手清单见 [本地 Agent 验收标准](../docs/acceptance/BCA-LOCAL-AGENT-HANDOFF-20261024.md)。以下表格保留此前服务范围，不能把表中历史通过扩张为所有功能通过。

更新：2026-10-23。开发分支：codex/bca-s2-complete，基于 codex/bca-ecosystem 的 4194200。原五条 Worker 轨道已停止；本轮主 Agent 接手实现。分支名表示实现目标，验收状态以下表为准。

“入口就绪”表示调用官方实现的代码与配置存在；“通过”只针对列出的实际操作。缺凭据或样本的项目维持待验收。

| 项目 | 实现方式 | 实际状态 / 剩余条件 |
| --- | --- | --- |
| OpenZeppelin Contracts MCP | 官方 MCP stdio | 发现、ERC20 生成通过 |
| OpenZeppelin Skills | skills CLI + dev_skill_read | 安装与读取通过 |
| Trail of Bits Skills | 官方安装源 + 通用技能读取 | 入口就绪，未运行完整审计 |
| Slither | 官方 CLI + MCP 配置 | CLI 分析通过、有 finding；MCP 固定官方锁文件版本后发现 23 工具，真实分析返回 9 合约 |
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
| Foundry | Forge / Cast / Anvil | Forge、Anvil EAS 通过；本轮 Cast chain/block/balance/call 通过 |
| Hardhat | 项目 package.bin 原生 compile | 真实 Counter 项目编译及 artifact 检查通过；Hardhat 2 对 Node 24/solc 0.8.35 有兼容警告 |
| viem | 6 个原生 EVM 工具 | 基线真实 Anvil 读写/回执/日志已通过 |
| Safe | 官方 Protocol Kit | 官方 Safe 1.4.1 本地部署；owners/threshold/nonce、批量待签交易与链上 hash 一致；补上自定义 contractNetworks |
| x402 | 官方 core HTTP/schema/facilitator | header、公共测试网 facilitator supported 通过；支付授权 verify 尚未验收；不结算 |
| CCXT | 官方 public exchange API | registry、配置 httpsProxy 后 Kraken BTC/USD ticker 通过 |
| Hummingbot | 官方 API status | 待服务地址及授权 |
| EAS 扩展 | 官方 SDK | 基线已通过批量、delegation、时间戳、PrivateData |
| Sign Protocol | 官方 SDK | Base Sepolia schema 0x1 读取通过；创建/撤销未验收 |
| Solana Attestation Service | 官方 sas-lib | devnet 真实 schema/attestation 解码、程序 owner 检查通过 |
| Sui | 官方 gRPC SDK | testnet balance 与离线 Transaction 解析通过 |
| Aptos | 官方 TS SDK | testnet ledger 通过 |
| Walrus | 官方 publisher/aggregator HTTP | 官方测试网 publisher 上传 71 字节，aggregator 读回逐字节一致 |
| Seal | 官方 SDK | 两个官方测试网 key server、threshold=2 加密通过；未运行解密策略 |
| Arweave | 官方 arweave-js | info、离线交易签名验证通过 |
| OpenTimestamps | 官方 ots CLI | info 通过；verify 实际失败：未配置 Bitcoin 节点 cookie/rpcpassword |
| RISC Zero | 官方 verifier ABI + viem eth_call | 官方 V3 proof + Base Sepolia verifier eth_call 通过；错误 journalDigest 被链上拒绝 |
| cheqd | 官方 DID querier | 官方 testnet RPC 返回真实 DID 文档、版本元数据 |
| W3C VC | did-jwt-vc / did:key | 真签名、时间与篡改拒绝通过；不含信任/吊销 |
| in-toto | 官方 in-toto-verify | 官方工具执行真实 cp 任务，签署 layout/link 后验证通过 |
| SLSA | 官方 slsa-verifier | 官方 v2.7.1 二进制与 release provenance 验证通过，含 Rekor 及源仓库/tag |
| Sigstore / Cosign | 官方 cosign | 官方 Cosign v3.1.4 二进制 + bundle，以明确 identity/issuer 验证通过 |
| OpenLineage | 原生 RunEvent HTTP | 入口就绪，待后端 |
| C2PA | 官方 c2patool | 官方 C.jpg 解析与签名/hash 检查通过；报告保留 signingCredential.untrusted |

完整执行证据及失败记录见 [本轮验收报告](../docs/acceptance/2026-10-23.md)。

## 接着验收

仅对新增配置对应的真实路径做一次局部验收，记录调用名、网络、结果与限制。不得把工具目录条目、配置模板或链接当作外部调用成功；不得用模拟账户、假 API 或缩减清单换取“全部通过”。所有外部服务条件满足后，再按已授权要求合并 main。

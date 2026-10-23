# BCA 当前状态

更新：2026-10-23。S2 在已有 54 个工具基础上新增 50 个，当前 **104 个工具**共用 SDK/CLI/MCP 入口。五个生态方向均已有适配代码和使用文档；整体联网验收尚未完成，需要凭据、部署与真实样本的项目见 [逐项清单](tasks/S2-progress.md)。不把入口实现和全部外部服务已验收混为一谈。

最新追加验收见 [2026-10-23 实际运行报告](docs/acceptance/2026-10-23.md) 与 [原始结果摘要](docs/acceptance/2026-10-23.json)。

## 本轮实际运行

环境：Node 24.19.0；固定 npm lockfile；官方 SDK、真实文件、真实本地 Anvil。只执行必要主路径，出错后局部修复与复测。

| 检查 | 结果 |
| --- | --- |
| TypeScript build | 通过；同时执行完整类型检查 |
| npm run check:s2 | 通过：VC-JWT 真签名/篡改拒绝、did:key、Sui Transaction、x402 header、CCXT registry、Arweave 原生交易签名、GAME Function、eliza handler；104 tools |
| npm run check:bridge | 通过：真实 stdio 与 Streamable HTTP、发现、CID 调用、错误传播；104 tools |
| npm run smoke -- --scope package | 通过：0.2.0 实际打包、隔离安装，包内 CLI/MCP 发现与调用 104 个工具 |
| npm run smoke -- --scope onchain | 通过：Anvil 上部署官方 EAS/Registry，Schema 注册、attest/read/revoke 等主路径 |
| dev_solidity_compile ExampleToken | 通过：solc 0.8.35 + OpenZeppelin Contracts 5.6.1，8 个合约，无诊断 |
| dev_forge_test examples/contracts | 通过：官方 Forge 1.7.1，Counter.testIncrement，离线编译 |
| dev_slither_analyze Counter | 成功分析，返回 1 个 solc-version detector；exitCode 255 如实保留 |
| OpenZeppelin MCP | tools/list 与官方 ERC20 生成通过 |
| CoinGecko MCP | tools/list 与 search_docs 通过 |
| Sui / Aptos / Solana | testnet balance / testnet ledger / devnet balance 公开读取通过 |
| Aptos CLI stdout | 修复后可作为单份 JSON 解析；SDK 提示进入 stderr |
| Arweave | 公共网关 info 与离线签名验证通过；未提交交易 |
| AgentKit | 真实 AgentKit + ViemWalletProvider + Anvil；2 actions，get_wallet_details 通过，隔离调用后进程正常退出 |
| Solana Agent Kit | 官方 2.0.10 + TokenPlugin 2.0.9；26 actions，devnet BALANCE_ACTION 读取真实临时地址，返回 0 SOL |
| Olas/Python MCP 示例 | 官方 Python MCP client 初始化、CID 调用通过；未运行完整 Olas 服务 |
| OpenTimestamps | 官方 hello-world.txt.ots 的 ots_info 通过；未验证 Bitcoin 确认时间 |
| OpenZeppelin Skills | 官方 skills CLI 安装与 BCA 读取；不代表完整合约开发工作流验收 |
| CCXT Kraken ticker | 通过：复用 CCXT httpsProxy 配置后读到 BTC/USD 公开行情 |
| Kubo / 包安装复验 | 本轮真实离线 add/read、字节一致检查；实际打包安装后的 104 工具 CLI/MCP 通过 |
| Safe | 官方 Safe 1.4.1 + Anvil；查询与 batch hash 对照合约通过；新增 contractNetworks 配置 |
| Hardhat / Cast | Counter 实际编译生成 artifact；Cast 四个只读工具通过；Hardhat 2 有运行时版本支持警告 |
| Sign / SAS | Base Sepolia schema；Solana devnet Schema 与 attestation 读取通过 |
| Walrus / Seal | 官方免费测试网 71 字节上传读回一致；两个官方 key server 的 threshold=2 加密通过 |
| x402 / cheqd | 公共 facilitator supported、testnet DID 查询通过 |
| Cosign / SLSA / in-toto | 官方程序对真实签名文件与来源证明验证通过 |
| C2PA | 官方媒体样本验证返回签名/hash 成功，保留 signingCredential.untrusted |
| RISC Zero | Base Sepolia 官方 verifier 对有效 proof 通过、错误 journalDigest 拒绝 |
| Slither MCP | 固定官方源码/依赖并对齐 cwd 后，发现 23 工具、实际分析返回 9 合约 |
| ots_verify | 实际执行失败：缺 Bitcoin 节点 cookie/rpcpassword；未确认时间戳 |


本轮按用户要求重新运行核心、接口、打包和 Kubo。此前 EAS 扩展、viem 读写仍保留原结果，未因 Safe 局部修改反复运行。历史复测记录见 [verification](docs/guides/verification.md)。

## 本轮局部修复

- 更新 solc 到 0.8.35，支持 OpenZeppelin 5 的真实 import 与 Foundry remappings/libs。
- Foundry npm 启动器丢失失败码：改为调用其官方平台二进制。
- TSX 命令在本环境创建 IPC pipe 失败：脚本改为 node --import tsx。
- MCP 配置缓存无法识别同长度修改：移除错误缓存；command 可覆盖 preset URL。
- 上游 SDK 输出污染 CLI/MCP stdout：诊断统一到 stderr。
- AgentKit analytics 未处理拒绝可能退出进程：官方 SDK 在独立 Node Worker 内执行，不修改 SDK、不自动重试 action。
- Python MCP 2.3 使用 is_error 字段：在示例处修复并局部复测。
- CCXT 在当前环境直连 DNS 失败：增加操作者 BCA_CCXT_PROXY，交由官方 httpsProxy 处理，公开行情局部复测通过。
- Solana Agent Kit 的 Vercel 工具对象以数字索引为键：适配器优先保留原生 id/name，修复后真实 balance action 通过。
- Worker 继承 --input-type 时无法启动文件入口：过滤该入口参数，局部验证错误传播正常。Forge 非法参数也已确认返回非零退出码 2。

- 本轮真实 Safe 部署发现 SDK 需要自定义网络合约地址：增加 BCA_SAFE_CONTRACT_NETWORKS，直接复用 Protocol Kit；仅复测查询/批量待签 hash，通过。

- Slither MCP 浮动依赖导致 tools/list 循环引用：示例固定官方源码和 uv.lock 版本；对齐 cwd 后，真实分析成功。

## 尚未验收

服务凭据：Alchemy、Tenderly、Chainstack、thirdweb、Nansen、Dune、Allium、Token Terminal、Messari、GoPlus、Coinbase Wallet、Brian、Bankr、Mesh、Hummingbot。

剩余具体路径：Sign 创建/撤销、x402 支付授权验证、OTS 的 Bitcoin 数据源、OpenLineage 后端。完整 elizaOS / GAME 托管 Agent / Olas 服务及完整 Skills 工作流尚未完成。Safe、SAS、Walrus、Seal、cheqd 与来源工具只按上表列出的范围验收。

Kaito 无已核实通用官方接口，不能声称已适配。GOAT 已归档，不新增其运行依赖。

本轮使用官方免费 Walrus 测试网 publisher 上传了自生成验收文本；未使用用户文件或生产资金，未执行公共链业务交易签署、资金划转、生产交易、付费订阅、npm 发布或原生 Codex 控制器审计。包保持 private:true。依照已批准的“全部项目真实验证后合并主线”条件，当前保留开发分支，尚不声明 S2 全量验收或合并 main。

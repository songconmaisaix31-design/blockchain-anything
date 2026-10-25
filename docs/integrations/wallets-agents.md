# 钱包、支付与 Agent

## 钱包和执行边界

| 组件 | BCA 入口 | 原生行为与配置 |
| --- | --- | --- |
| [Safe Protocol Kit](https://docs.safe.global/sdk/protocol-kit) | safe_info、safe_prepare | 查询 owners/threshold/nonce；生成 unsigned Safe transaction + hash；配置 EVM RPC，不签署或执行 |
| [x402](https://github.com/coinbase/x402) | x402_decode、x402_supported、x402_verify | 官方 header 编解码与 facilitator；BCA_X402_FACILITATOR；验证授权不结算 |
| [CCXT](https://github.com/ccxt/ccxt) | ccxt_exchanges、ccxt_ticker、ccxt_orderbook | 公开市场，无 API key、无下单；可选 BCA_CCXT_PROXY 使用原生 httpsProxy |
| [Hummingbot](https://github.com/hummingbot/hummingbot-api) | hummingbot_status | 读取 /bot-orchestration/status；BCA_HUMMINGBOT_URL / BCA_HUMMINGBOT_AUTH（完整 Authorization 值） |
| [Brian](https://github.com/brian-knows/brian-sdk) | brian_prepare | 官方 BrianSDK.transact；自然语言生成待执行数据，BCA_BRIAN_API_KEY |
| [Bankr](https://docs.bankr.bot/agent-api/overview/) | bankr_prompt、bankr_job | 官方 Agent API；BCA_BANKR_API_KEY；prompt 可能触发实际交易，需写入开关和 submit |
| [Heurist Mesh](https://github.com/heurist-network/heurist-mesh-skill) | mesh_schema、mesh_call | 原生 schema 和 /mesh_request；BCA_HEURIST_API_KEY；call 可能消耗额度，需显式提交 |
| [Coinbase Wallet MCP](https://docs.cdp.coinbase.com/ai-agents/coinbase-for-agents/wallet-mcp) | bridge_* | 官方 OAuth 服务，配置见 services；不接旧 Base MCP |

默认服务地址可用 BCA_BRIAN_URL、BCA_BANKR_URL、BCA_MESH_URL 替换为操作者指定的正式服务。BCA 不在工具输入中接收 Token。

Safe 在本地或私有链上需要通过 `BCA_SAFE_CONTRACT_NETWORKS` 传入官方 Protocol Kit 的 `contractNetworks` 地址配置，例如 `{"31337":{"multiSendAddress":"0x...","multiSendCallOnlyAddress":"0x..."}}`。地址必须对应该链上已部署的官方合约；也支持 singleton、proxy factory、fallback handler 等原生地址字段，ABI 使用 SDK 内置版本。已收录部署的公共链无需此配置。参见 [Safe 初始化文档](https://docs.safe.global/reference-sdk-protocol-kit/initialization/init)。

## Agent 框架

BCA 复用宿主已创建的 Agent/Wallet 实例，不拥有模型循环、角色记忆和调度。

| 宿主 | 导出 / 示例 | 已验证范围 |
| --- | --- | --- |
| Coinbase AgentKit | fromAgentKit(realKit, schemaToJson)，agentkit.mjs | 真实 ViemWalletProvider + Anvil；发现 2 actions，读取钱包详情 |
| Solana Agent Kit | fromSolanaAgentKit(createVercelAITools(agent, agent.actions), schemaToJson)，solana-agent-kit.mjs | 官方 TokenPlugin 发现 26 actions，devnet BALANCE_ACTION 返回临时地址 0 SOL；未执行交易 |
| elizaOS | asElizaPlugin(toolkit) | action handler 实际调用 CID；未启动完整 elizaOS runtime |
| Virtuals GAME | asGameFunctions(toolkit) | 官方 GameFunction 执行 CID；未调用托管 GAME Agent API |
| Olas / Open Autonomy | olas_mcp.py 使用官方 Python MCP client | MCP 初始化与 CID 调用；未部署完整 Autonomy 服务 |
| OpenAI-compatible function calling | asFunctionTools(toolkit) | 返回工具 JSON Schema；执行仍调用 toolkit.invoke |

可选框架依赖在 `examples/agents/package.json`，按需安装，不增加 BCA 根包的框架运行依赖：

```sh
npm --prefix examples/agents ci --ignore-scripts
BCA_AGENTKIT_MODULE=examples/agents/agentkit.mjs node --env-file=.env dist/cli/main.js call agent_actions --input '{"provider":"agentkit"}'
```

本地工厂 default export 返回真实 NativeAgentAction[]。agent_call 还要求 BCA_ALLOW_WRITES=true 和 submit:true，因为 SDK actions 可签署、转账。AgentKit 示例仅使用受控本地开发 BCA_PRIVATE_KEY；Solana 示例的宿主依赖、密钥格式见文件注释。

每次 agent_actions / agent_call 在独立 Node Worker 中加载工厂；操作结束即终止该工作线程，不自动重试。发现了 AgentKit 0.10.4 后台 analytics HTTP 400 未处理拒绝的问题，这个边界保证异常不会退出整个 BCA 服务。操作完成前发生异常仍返回失败；已提交交易的状态应在原链查询。直接在宿主调用 fromAgentKit 时，SDK 生命周期与后台日志由宿主管理。

Python 示例依赖 `mcp==2.3.0`：

```sh
python -m pip install -r examples/agents/requirements.txt
python examples/agents/olas_mcp.py /absolute/path/blockchain-anything/dist/mcp/main.js
```

[GOAT](https://github.com/goat-sdk/goat) 上游声明停止维护；本项目记录迁移到现有 AgentKit / Solana Agent Kit / MCP 的路径，不新引入归档包。

Safe 官方合约本地部署后的查询与批量待签 hash 验证通过；x402 公共 facilitator 的 supported 读取通过。x402 支付授权验签、Hummingbot、Brian、Bankr、Mesh 业务调用尚需操作者服务配置。CCXT registry 与配置原生代理后的 Kraken BTC/USD 行情读取通过；未执行任何下单或支付。

# 工作站与会话

`bca find "任务"` 返回相关工作站、当前缺项和实际工具入口。宿主补全参数并执行步骤；搜索本身不写配置或提交交易。`workstation_guide({id,context})` 可以直接读取某个工作站的步骤。

## EVM 交易诊断

配置 `BCA_RPC_URL` 和 `BCA_CHAIN_ID`。`workstation_search` 只选择任务；`workstation_diagnose` 实际调用共享的 `viem_transaction`、`evm_proxy`、`evm_contract_source`、`evm_trace`。

```bash
node --env-file=.env dist/cli/main.js workstation diagnose --input '{"hash":"<真实哈希>"}'
# 使用 dev_solidity_compile 完整输出作本地编译产物
node dist/cli/main.js call dev_solidity_compile --input '{"path":"src/MyToken.sol"}' > compiled.json
node --env-file=.env dist/cli/main.js workstation diagnose --input '{"hash":"<真实哈希>","artifact":"compiled.json","contractName":"MyToken"}'
```

源码服务使用 Sourcify v2 的 `/v2/contract/{chainId}/{address}`。本地编译结果/服务提供的 runtime code 必须和指定区块代码一致，才将 ABI 纳入诊断。当前严格匹配对 immutable、link reference 会保留未匹配状态；本地产物的源码与映射来自操作者提供的编译结果，没有替代公开源码验证。

先读取真实回执。失败时尝试 RPC `debug_traceTransaction`，structLogs 不支持则尝试 callTracer。对于匹配源码的直接调用，将 trace PC 映射到 solc sourceMap；自定义错误通过官方 viem 解码。没有 trace、源码或匹配映射时返回 `complete:false` 和缺口。空 structLogs 也不能给出源码位置；Anvil 需要启动时带 `--steps-tracing`。

代理识别固定区块读取 ERC-1967 implementation/beacon slot 和标准 ERC-1167 字节码。beacon 仅检测、不解引用；其他模式未知。当前只为直接根调用映射源码位置，代理或嵌套失败需要宿主核对实际执行实现与调用深度。升级发生在交易内或同区块时，区块结束状态不足以证明该笔交易使用的实现。

证据保留 chain ID、交易/区块、来源和获取时间。本轮没有链上结果缓存。历史区块结果不等于未来模拟/交易结果。

缺 trace 时可明确选择已授权 Tenderly：`bridge_refresh({server:"tenderly"})` 读取真实工具 Schema，再由宿主选取相应调用；不要猜工具名。需要 fork 时，宿主使用官方 `anvil --fork-url ... --fork-block-number <固定区块>` 或 `cast run <hash> --rpc-url ...`，核对同一区块内前序交易和历史状态。BCA 本轮未验收公共交易 fork 重放或 Tenderly 账户路径。

## EVM 合约开发

先 `dev_project({dir})`。原工程有 Foundry/Hardhat 时遵循已有配置；两者同时存在时需要用户/宿主选择。需要生成模板时通过官方 OpenZeppelin MCP 或已安装官方技能；工具发现后按真实 Schema 调用。已有源码可以直接进入编译步骤。

`bca find "只编译合约" --dir contracts` 只返回编译步骤；测试请求只返回测试步骤，Foundry/Hardhat 会按自己的规则编译所需源码。这两类任务不需要 RPC 或部署授权。通过 SDK/MCP 使用 `workstation_search({query,context:{dir,task:"compile"}})`；直接调用 guide 时同样支持 `context.task`。完整开发流程使用 `task:"develop"`。没有项目配置或同时存在两个框架时，先明确 provider。

Foundry 路径：
1. `dev_forge_build({dir})`。
2. `dev_forge_test({dir,matchPath})`；只修复、复跑失败的相关路径。
3. 本机 `anvil --host 127.0.0.1 --chain-id 31337 --steps-tracing`。
4. 配置对应 RPC、链和写入许可，宿主确认后调用 `dev_forge_deploy_local({dir,contract:"src/File.sol:Contract",from:"<明确本地地址>",submit:true})`。
5. `viem_read` 查询部署地址和真实 ABI，核对预期行为。
6. 需要公开源码验证时调用 `dev_forge_verify`，沿用官方 `forge verify-contract --verifier sourcify --watch`；源码上传需明确许可。本地部署验收不等于公共网络源码验证通过。

公共链部署由宿主使用原项目脚本和官方钱包，BCA 新增入口不读取私钥或提交主网交易。Hardhat 对应 `dev_hardhat_compile`、`dev_hardhat_test`，部署仍由宿主执行原脚本，当前不声称 Hardhat 完整部署工作站已经验收。

## NFT 创建

`bca find "创建 NFT"` 要求明确 `chainFamily`。选择 EVM 后，`nft-create` 工作站使用 OpenZeppelin ERC721URIStorage 和 Ownable，创建者拥有铸造权限，每个 tokenId 保存自己的 tokenURI。模板包含铸造与元数据、重复 tokenId 拒绝、非所有者拒绝三个真实合约测试。

```bash
bca init nft --template erc721 --name "My Collection" --symbol NFT
bca build nft
bca test nft
```

本地操作使用真实 Anvil。启动 `anvil --host 127.0.0.1 --chain-id 31337`，设置对应 `BCA_RPC_URL`、`BCA_CHAIN_ID=31337` 和 `BCA_ALLOW_WRITES=true`，由宿主明确选择 Anvil 的 unlocked 账户：

1. `dev_forge_deploy_local({dir:"nft",contract:"src/MyNFT.sol:MyNFT",from,submit:true})` 返回实际 `deployment.deployedTo` 和回执。
2. `dev_erc721_mint_local({address:deployedTo,from,recipient,tokenId:"7",tokenUri,submit:true})` 调用 `safeMint(address,uint256,string)`，确认回执并读取同一区块的 `ownerOf`、`tokenURI`。
3. `dev_cast_call({to:deployedTo,signature:"tokenURI(uint256)(string)",args:["7"]})` 可再次读取；使用编译产物的 ABI 时也可调用 `viem_read`。

tokenURI 由操作者提供。使用 IPFS 时，先通过已配置 Kubo 的 `ipfs_add` 上传实际元数据，再将返回 CID 组成 URI。铸造入口只接受本机 31337/1337 Anvil；提交后回执或结果读取失败会保留交易哈希，不自动重新提交。

`bca find "Solana NFT"` 返回 Solana Agent Kit 路径。默认 `examples/agents/solana-agent-kit.mjs` 仅加载 TokenPlugin，需要配置兼容的 `@solana-agent-kit/plugin-nft` 与 core 版本。设置 `BCA_SOLANA_AGENT_MODULE`、`BCA_SOLANA_RPC_URL` 后，调用 `agent_actions({provider:"solana-agent-kit"})` 检查实际 NFT actions 与输入 Schema；宿主按实际 Schema 选择和调用。本轮未执行 Solana NFT 铸造。

## 链上数据查询

`bca find "用 Dune 查询 Base 最近七天的交易量"` 选择 `onchain-data`，保持 Dune 供应商与 Base 目标。缺连接时返回 `bridge_configure`，缺凭据时列出 `BCA_DUNE_API_KEY`。已配置的自定义服务名称沿用原配置。

`context` 可提供 `chain`、`chainId`、`chainFamily`、`protocol`、`metric`、`timeRange`。工作站先要求读取实际 MCP 工具目录及相关 Schema，再由宿主准备数据表、字段与查询参数，执行查询并根据服务返回的执行标识读取结果。查询执行和结果导出可能使用账户 credits，真实账户权限、超时和额度错误由上游返回；失败后不切换供应商或自动重发查询。完整账户业务仍需实际凭据验证。

## 安全检查

`security-check` 按输入选择路径；输入类型不清楚时返回缺少 `securityInput`。

| 输入 | context | 步骤 |
| --- | --- | --- |
| ERC20 代币风险 | `securityInput:"token"`、`address`、`chainId` | `goplus_token_security` 读取 GoPlus 官方公开 API；显式指定 MCP 配置时读取该服务的 token 工具 |
| 钱包、其他地址或授权风险 | `securityInput:"address"`、`address`、`chainId` | 发现 GoPlus MCP 实际工具，按对象选择 address 或 approval 检查 |
| 本地源码 | `securityInput:"source"`、`target` | `dev_slither_analyze` 运行真实 Slither，返回官方发现及位置 |
| 待执行交易 | `securityInput:"transaction"`、`chainId`、`transaction:{from,to,data,value}` | 发现 Tenderly 实际模拟工具，按 Schema 填入交易，不发送该链上交易 |

Slither 需要安装官方 `slither-analyzer` 和目标项目所需编译器；`BCA_SOLC_PATH` 可显式指定 solc。Findings 是分析结果，发现问题的非零退出码会连同官方 JSON 保留；编译或分析失败不会标记成功。GoPlus 与 Tenderly 结果各自保留来源和未检查字段，不合成为安全保证。

`bca find "GoPlus 代币风险" --provider goplus-public --chainId 1 --address <ERC20地址>` 返回可直接调用的公开查询步骤。公开接口只接受 EVM ERC20 合约；仅提供普通 `address` 时工作站保留地址检查路径。缺失风险字段表示上游未提供，空结果会报错，不能据此判定钱包或代币安全。已选择 GoPlus MCP 配置名称时沿用其认证与工具目录；服务失败不会切换到公开 API。

## MCP 会话和刷新

旧的无 session 调用仍使用短连接。长工作流在同一个 SDK toolkit 或 MCP 服务中：

```ts
const opened = await toolkit.invoke('bridge_open', { server: 'openzeppelin' });
// 使用实际返回的 session；以下调用均需传同一 server + session。
await toolkit.invoke('bridge_refresh', { server: 'openzeppelin', session: opened.session });
await toolkit.invoke('bridge_call', {
  server: 'openzeppelin', session: opened.session,
  tool: 'solidity-erc20', arguments: { name: 'MyToken', symbol: 'MTK' },
});
await toolkit.invoke('bridge_close', { session: opened.session });
await toolkit.close();
```

会话归属单个 toolkit，最多 16 个、空闲 5 分钟关闭。同一会话同时执行会被拒绝；配置身份含解析后的 URL/环境变量/凭据但只保存摘要、不输出秘密。Schema 快照 30 秒失效、官方 list_changed 通知会失效；`bridge_refresh` 强制重新 tools/list，记录官方版本与 Schema 摘要变化。刷新内容属于未验证数据，不自动加入业务步骤或增加权限。

断连、工具错误或配置/凭据变化关闭会话，后续必须显式重新打开。SDK 自有 OAuth 凭据的外部变化由服务返回错误识别。本层不自动重放工具调用。独立 CLI 进程退出会关闭自己创建的会话，不能跨进程使用 session ID。

上游只读 annotation 仅为参考。已核对的映射包括 OpenZeppelin 三种 Solidity token 生成工具、CoinGecko `search_docs`。其他上游工具由操作者声明精确只读许可，例如：

```json
{"mcpServers":{"local-service":{"command":"node","args":["/absolute/official/server.js"],"readOnlyTools":["verified_read_tool"]}}}
```

未映射且未获只读许可的工具需要既有写开关及 `submit:true`。这些是有限调用许可，逐笔授权仍由宿主/官方钱包完成。官方 MCP SDK 负责 transport 关闭；`run()` 的进程组清理保证单独适用于本地 CLI 适配器。

## 目录输出

`capability_list({})` 返回名称、说明、读写标记和配置状态。指定 `name` 自动附带完整 Schema/来源；`details:true` 返回全量详细目录，`dir` 指定检查的项目。一次调用的成败由工具原结果报告。

工作站结果包括 `steps`、`requiredCapabilities`、`missingCapabilities`、`factsNeeded`、`mismatches` 和 `missingRequirements`；账户服务同时返回 `services` 的连接条件，数据查询和安全检查的业务参数放在 `request`。可选能力列在 `optionalTools`，需要时再查状态。`executable` 仅表示已知配置条件通过，实际业务由宿主按最新 Schema 执行。

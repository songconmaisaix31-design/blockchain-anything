# 工作站、证据与会话

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

Foundry 路径：
1. `dev_forge_build({dir})`。
2. `dev_forge_test({dir,matchPath})`；只修复、复跑失败的相关路径。
3. 本机 `anvil --host 127.0.0.1 --chain-id 31337 --steps-tracing`。
4. 配置对应 RPC、链和写入许可，宿主确认后调用 `dev_forge_deploy_local({dir,contract:"src/File.sol:Contract",from:"<明确本地地址>",submit:true})`。
5. `viem_read` 查询部署地址和真实 ABI，核对预期行为。
6. 需要公开源码验证时调用 `dev_forge_verify`，沿用官方 `forge verify-contract --verifier sourcify --watch`；源码上传需明确许可。本地部署验收不等于公共网络源码验证通过。

公共链部署由宿主使用原项目脚本和官方钱包，BCA 新增入口不读取私钥或提交主网交易。Hardhat 对应 `dev_hardhat_compile`、`dev_hardhat_test`，部署仍由宿主执行原脚本，当前不声称 Hardhat 完整部署工作站已经验收。

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

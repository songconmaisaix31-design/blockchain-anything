# BCA · Blockchain Anything

**在 Codex、Claude Code 或终端中，找到区块链工具并完成真实任务。**

BCA v1 把官方 SDK、CLI 和 MCP 接成一个入口。已有 Agent 负责对话、编辑代码和任务循环；BCA 提供工具发现、项目操作、连接管理与真实结果。CLI、MCP、TypeScript SDK 共用实现。

## 安装到项目

需要 **Node >=24.16.0 <25**、npm 和 Git。在目标项目目录执行：

```sh
npm exec --yes --package=git+https://github.com/songconmaisaix31-design/blockchain-anything.git#main -- bca setup --client both --install
```

只使用一个客户端时，把 `both` 换成 `codex` 或 `claude`。首次安装需要联网下载依赖。BCA 保持 `private:true`，没有发布到公共 npm；上面的命令从 GitHub 源码构建。

安装会准备项目内持久运行目录和官方 Foundry，配置 MCP，并把 `BCA-WORKFLOW.md` 的入口写入 `AGENTS.md` / `CLAUDE.md`。保留原有配置和指引，修改前备份，重复运行不会重复添加内容。在客户端信任项目并批准 MCP 后，可以直接提出任务。

终端使用已安装版本（Linux/macOS/WSL2）：

```sh
alias bca='node .bca/runtime/node_modules/blockchain-anything/dist/cli/main.js'
bca doctor
```

也可以从 checkout 执行 `npm ci`（会自动构建），再用 `node dist/cli/main.js` 代替 `bca`。[本地产物安装和平台说明](docs/guides/setup.md)。

## 创建并运行合约

```sh
bca init contracts --template erc20 --name 'My Token' --symbol TOKEN --supply 1000
bca build contracts
bca test contracts
```

默认模板是 Counter；ERC20 复用 OpenZeppelin Contracts，`supply` 按最小单位计。新建操作拒绝覆盖已有目录。已有 Foundry/Hardhat 项目直接运行 `build` / `test`，保留原项目配置；两种框架并存时用 `--provider foundry|hardhat` 选择。Foundry 可用 `--offline`，测试可用 `--match-path`。

Agent 对应调用 `project_init` 和 `project_run`。本地编译、测试无需 RPC 或签名权限。编译/测试失败保留诊断，CLI 业务失败退出 2，执行失败退出 1；MCP 返回 `isError`。

## 从问题找到能力

```sh
bca find '只编译合约' --dir contracts
bca find 'Solana 余额'
bca find '计算文件 CID'
bca tools content_cid
bca call content_cid --input '{"path":"contracts/src/MyToken.sol"}'
```

`find` 检索实际工具目录，返回匹配项、必填参数、可用条件和调用入口；EVM 开发或诊断任务还会给出相关步骤。`--details` 查看完整 Schema。检索能力由 `capability_search` 提供；指定工具时也可调用 `capability_list({name:"viem_logs"})`。

需要上游新增能力时，保存官方 MCP 配置并读取它的实时目录：

```sh
bca connect openzeppelin
bca find 'generate ERC20' --server openzeppelin --details
bca call bridge_call --input '{"server":"openzeppelin","tool":"solidity-erc20","arguments":{"name":"MyToken","symbol":"TOKEN"}}'
```

配置保存在项目 `.bca/mcp.json`，CLI 与 MCP 都自动读取。`BCA_MCP_CONFIG` 或 `BCA_MCP_SERVERS` 可覆盖项目配置。需要 API key 时使用 `--key-env 环境变量名 --header 请求头名称`，需要 OAuth 的托管服务使用 `--oauth`；账户权限按服务要求提供。已有不同配置不会被覆盖。[服务接入说明](docs/integrations/services.md)。

连续调用可用 `bridge_open → bridge_call → bridge_close` 复用连接。发现工具不会自动获得写权限；真实业务结果以调用为准。

## EVM 诊断与本地部署

```sh
bca find '这笔交易为什么失败' --chainId 31337 --hash <真实交易哈希>
bca call workstation_diagnose --input '{"hash":"<真实交易哈希>","artifact":"compiled.json"}'
bca find '部署合约' --dir contracts
```

诊断组合回执、代理识别、源码和 RPC trace；缺少 trace 或源码时返回已有证据及缺项。本地部署使用官方 `forge create`，限定 loopback Anvil、31337/1337、明确的发送地址和 `submit:true`，还需 `BCA_ALLOW_WRITES=true`。公共链交易沿用宿主钱包授权，未知提交状态不自动重发。[工作站说明](docs/guides/workstations.md)。

## SDK / MCP

```ts
import { createToolkit } from 'blockchain-anything';
const toolkit = createToolkit();
try {
  const result = await toolkit.invoke('capability_search', { query: 'Solana 余额' });
  // 按返回的 Schema 补全参数，调用所需工具。
} finally {
  await toolkit.close();
}
```

`bca mcp` 启动 stdio 服务。现有 EAS、IPFS/Kubo、Sui、Aptos、Solana/SAS、Sign、Walrus、Seal、Arweave、Safe、x402、CCXT、身份和来源验证适配继续保留；各生态实际验证范围见 [S2 记录](tasks/S2-progress.md)。

v1 的验证范围和已知限制集中在 [本轮记录](docs/acceptance/2026-10-25-v1.md)。Linux x64 已运行；Windows 原生核心功能的实际结果、默认安装阻塞和进程清理问题见 [Windows 记录](docs/acceptance/2026-10-25-windows.md)。Windows/macOS 原生客户端、账户型服务和公共测试网源码上传仍有未验证项。源码定位只覆盖已实现的标准代理和 trace 路径。

[开发规则](docs/TASKS.md) · [用户决定](docs/QUESTIONS.md) · [当前进度](STATUS.md) · [REA 参考](docs/REA-REFERENCE.md)

MIT。各上游组件保留自身许可证；OpenZeppelin Contracts MCP 独立进程遵循其 AGPL-3.0-only 许可。

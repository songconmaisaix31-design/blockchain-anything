# BCA · Blockchain Anything

**在 Codex、Claude Code 或终端中，找到区块链工具并完成真实任务。**

[在线文档](https://songconmaisaix31-design.github.io/blockchain-anything/) · [安装说明](docs/guides/setup.md) · [依赖安全状态](docs/guides/dependency-security.md)

BCA v1 把官方 SDK、CLI 和 MCP 接成一个入口。已有 Agent 负责对话、编辑代码和任务循环；BCA 提供工具发现、项目操作、连接管理与真实结果。CLI、MCP、TypeScript SDK 共用实现。

## 安装到项目

需要 **Node 22.12+（22 LTS）或 Node 24 LTS**、npm 和 Git。在目标项目目录执行：

```sh
npm exec --yes --package=git+https://github.com/songconmaisaix31-design/blockchain-anything.git#main -- bca setup --client both --install
```

只使用一个客户端时，把 `both` 换成 `codex` 或 `claude`。首次安装需要联网下载依赖。BCA 保持 `private:true`，没有发布到公共 npm；上面的命令从 GitHub 源码构建。

中国大陆网络环境下，若 npm 默认镜像尚未同步全部固定版本（报错示例：`ETARGET No matching version found for @mysten/seal@1.5.1`），请使用官方 registry 安装：

```sh
npm exec --yes --package=git+https://github.com/songconmaisaix31-design/blockchain-anything.git#main --registry=https://registry.npmjs.org -- bca setup --client both --install
```

Windows x64 可直接使用 PowerShell：setup 按平台安装官方 Foundry 二进制包，无需修改全局 `script-shell`。Linux/macOS 支持 x64 和 arm64；其他平台可先使用 `--workstation evm-diagnose`，或手动安装 Foundry。

安装会准备项目内持久运行目录和官方 Foundry，配置 MCP，并把 `BCA-WORKFLOW.md` 的入口写入 `AGENTS.md` / `CLAUDE.md`。保留原有配置和指引，修改前备份，重复运行不会重复添加内容。在客户端信任项目并批准 MCP 后，可以直接提出任务。

终端使用已安装版本（Linux/macOS/WSL2）：

```sh
alias bca='node .bca/runtime/node_modules/blockchain-anything/dist/cli/main.js'
bca doctor
```

也可以从 checkout 执行 `npm ci`（会自动构建，使用 `package-lock.json` 锁定源码依赖），再用 `node dist/cli/main.js` 代替 `bca`。[本地产物安装和平台说明](docs/guides/setup.md)。

## 创建并运行合约

```sh
bca init contracts --template erc20 --name 'My Token' --symbol TOKEN --supply 1000
bca build contracts
bca test contracts
```

默认模板是 Counter；ERC20 复用 OpenZeppelin Contracts，`supply` 按最小单位计。NFT 项目使用 `bca init nft --template erc721`，包含铸造权限、重复 tokenId 和 tokenURI 测试；本机 Anvil 铸造步骤见[工作站说明](docs/guides/workstations.md)。新建操作拒绝覆盖已有目录。已有 Foundry/Hardhat 项目直接运行 `build` / `test`，保留原项目配置；两种框架并存时用 `--provider foundry|hardhat` 选择。Foundry 可用 `--offline`，测试可用 `--match-path`。

Agent 对应调用 `project_init` 和 `project_run`。本地编译、测试无需 RPC 或签名权限。编译/测试失败保留诊断，CLI 业务失败退出 2，执行失败退出 1；MCP 返回 `isError`。

## 从问题找到能力

```sh
bca find '只编译合约' --dir contracts
bca find 'Solana 余额'
bca find '计算文件 CID'
bca find '用 Dune 查询 Base 最近七天的交易量'
bca find '创建 NFT'
bca find '检查合约源码安全' --target contracts
bca tools content_cid
bca call content_cid --input '{"path":"contracts/src/MyToken.sol"}'
```

`find` 检索内置工具与官方供应商，返回匹配项、必填参数、可用条件和调用入口。指定供应商或配置别名时限定该服务；缺凭据时给出环境变量名称，连接失败时保留服务错误。开发、诊断、NFT、数据查询和安全检查分别返回任务步骤；NFT 未指定链时要求补充链。`--details` 查看完整 Schema。检索能力由 `capability_search` 提供；指定工具时也可调用 `capability_list({name:"viem_logs"})`。

需要上游新增能力时，保存官方 MCP 配置并读取它的实时目录：

```sh
bca connect openzeppelin
bca find 'generate ERC20' --server openzeppelin --details
bca call bridge_call --input '{"server":"openzeppelin","tool":"solidity-erc20","arguments":{"name":"MyToken","symbol":"TOKEN"}}'
```

配置保存在项目 `.bca/mcp.json`，CLI 与 MCP 都自动读取。`BCA_MCP_CONFIG` 或 `BCA_MCP_SERVERS` 可覆盖项目配置。`bca connect dune` 自动保存 `x-dune-api-key` 对 `BCA_DUNE_API_KEY` 的引用，操作者在环境中提供实际密钥；`--name analytics` 可设置配置别名。OAuth 预设默认使用授权桥接，Dune 也可显式使用 `--oauth`。需要自定义认证时使用 `--key-env 环境变量名 --header 请求头名称`。已有配置会保留。[供应商接入说明](docs/guides/providers.md)。

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

v1 的验证范围见[初始记录](docs/acceptance/2026-10-25-v1.md)，供应商发现与三个工作站见[任务记录](tasks/task-discovery.md)。账户型服务、Solana NFT 业务和公共测试网源码上传仍有未验证项。源码定位只覆盖已实现的标准代理和 trace 路径。

[开发规则](docs/TASKS.md) · [用户决定](docs/QUESTIONS.md) · [当前进度](STATUS.md) · [REA 参考](docs/REA-REFERENCE.md)

MIT。各上游组件保留自身许可证；OpenZeppelin Contracts MCP 独立进程遵循其 AGPL-3.0-only 许可。

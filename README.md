# Blockchain Anything（BCA）

> **[Anything Universe](https://github.com/songconmaisaix31-design#anything-universe)** · *Tools for agents. Room for anything.*
>
> 链上工具入口：聚合官方 SDK、CLI 与 MCP，让 Agent 发现和调用区块链能力。
>
> 同系列：[mcpet](https://github.com/songconmaisaix31-design/mcpet) · [swarm-anything](https://github.com/songconmaisaix31-design/swarm-anything)

**面向 AI Agent、基于 MCP 协议的链上能力网关。普通人第一次拥有了创造链上规则的能力。**

[在线 Demo](https://songconmaisaix31-design.github.io/blockchain-anything/demo/) · [在线文档](https://songconmaisaix31-design.github.io/blockchain-anything/) · [安装说明](docs/guides/setup.md) · [依赖安全状态](docs/guides/dependency-security.md) · [商业模式](docs/BUSINESS.md)

市面上的 Web3 工具大多只面向懂合约的开发者。"所有人都可以写合约"是技术视角——它假设用户关心的是 Solidity、RPC 和 gas 参数。Blockchain Anything 站在用户视角：**所有人都可以创造自己的链上产品**。

用户只需要用自然语言描述想法。剩下的交给 Agent 与 BCA：生成可交互预览、把规则跑一遍、核对权限与费用、连接钱包发布到公链。BCA 把以太坊等多条成熟公链的生态能力，封装成标准化 MCP 工具集；任意兼容 MCP 的 AI Agent 都可以直接调用，不必手写 Solidity、不必对接 RPC。

## 两种视角

| | 传统 Web3 工具 | Blockchain Anything |
| --- | --- | --- |
| 面向对象 | 懂 Solidity 的开发者 | 有想法的任何人 |
| 表达方式 | 写合约、配环境、调 RPC | 用自然语言描述想法 |
| 交付物 | 一份合约源码 | 一个可发布、可运行的链上产品 |
| 失败成本 | 编译报错、部署踩坑 | 规则先跑一遍，通过再上链 |
| 接入方式 | 逐个 SDK 集成 | 一套 MCP 工具集，任意 Agent 直接调用 |

这不是把合约编辑器包装得好看一点，而是把"写合约"这件事从用户的心智负担里拿出去。BCA 负责的是能力层，让上层的 Agent 可以把注意力放在理解人的意图上。

## 一次完整的创造流程

```
描述想法  →  Agent 理解意图
          →  发现需要的链上工具      bca find
          →  生成规则并实现          bca init / build
          →  本地跑一遍真正验证      bca test
          →  核对权限与写操作边界     bca doctor
          →  钱包授权，发布上链      工作站 / 宿主钱包
```

分工是明确的：**Agent 负责对话、理解与任务循环，BCA 提供工具发现、项目操作、连接管理与真实结果。** 二者通过 MCP 协议衔接，CLI、MCP 与 TypeScript SDK 共用同一套实现，所以同一份能力既能在终端里用，也能被任意 Agent 调用。

合约编译、单元测试、本地链试运行都在本机完成，不需要 RPC、不需要签名权限——这意味着"试运行规则"这件事是真实可用的，而不是一句宣传语。写操作则需要显式授权：公共链交易沿用宿主钱包授权流程，本地一键部署仅面向明确批准的 loopback Anvil 操作。

## 场景：NFT 是入口，不是终点

NFT 是最直观的第一个入口——它是普通人最容易理解的链上规则形式。同一套能力可以延伸到更远的地方：

- **社群会员**：凭证即身份，权限规则写在链上，不再依赖中心化后台
- **电子票务**：可验证的发行来源与流转记录，天然防伪
- **链上游戏**：资产归属与规则公开，玩家真正拥有道具
- **多人协作**：所有权与贡献可追溯，分配规则自动执行
- **数字所有权凭证**：从内容到 AI 产出，锚定不可篡改的归属与来源

## 能力工具集

当前注册 **127 个工具**，全部标注来源组件、只读/写性质与前置要求，由 `capability_search` 统一检索：

| 领域 | 工具前缀 | 覆盖能力 |
| --- | --- | --- |
| 合约开发 | `dev_*`、`project_*` | 项目初始化、编译、测试、Foundry/Hardhat 双栈 |
| EVM 读写与诊断 | `evm_*`、`viem_*`、`workstation_*` | 链状态读取、trace 组合、代理识别、失败归因 |
| 链上身份与凭证 | `eas_*`、`did_*`、`vc_*`、`cheqd_*`、`sas_*`、`sign_*` | 声明、签名、凭证、撤销、信任链 |
| 资产与存储 | `ipfs_*`、`arweave_*`、`walrus_*`、`seal_*`、`content_*` | CID 计算、去中心化存储、加密访问控制 |
| 多链生态 | `solana_*`、`sui_*`、`aptos_*`、`safe_*`、`x402_*` | 跨链读写、多签、链上支付 |
| 交易与风控 | `ccxt_*`、`hummingbot_*`、`goplus_*`、`brian_*`、`ots_*`、`bankr_*` | 行情、策略、代币安全、区块浏览器数据 |
| 来源与审计 | `slsa_*`、`cosign_*`、`intoto_*`、`c2pa_*`、`risc0_*`、`provenance_*`、`openlineage_*` | 软件供应链证明、内容来源、零知识证明 |
| Agent 与桥接 | `agent_*`、`bridge_*`、`capability_*`、`system_*` | 子 Agent 协作、官方 MCP 接入、工具发现 |

每条工具都保留原始来源组件，不重复实现 ABI 编码、签名或 CID 等已成熟的基础能力。

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

安装会准备项目内持久运行目录和官方 Foundry，配置 MCP，并把 `BCA-WORKFLOW.md` 的入口写入 `AGENTS.md` / `CLAUDE.md`。保留原有配置和指引，修改前备份，重复运行不会重复添加内容。在客户端信任项目并批准 MCP 后，可以直接用自然语言提出任务。

终端使用已安装版本（Linux/macOS/WSL2）：

```sh
alias bca='node .bca/runtime/node_modules/blockchain-anything/dist/cli/main.js'
bca doctor
```

也可以从 checkout 执行 `npm ci`（会自动构建，使用 `package-lock.json` 锁定源码依赖），再用 `node dist/cli/main.js` 代替 `bca`。[本地产物安装和平台说明](docs/guides/setup.md)。

## 创建并运行链上规则

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

`bca mcp` 启动 stdio 服务。任何兼容 MCP 的 Agent 都可以把它作为链上能力层接入——这是 BCA 对外的主要形态。

## 开源免费，托管可选

BCA 采用 open-core：**框架开源、自带密钥免费、托管付费。**

自己配上游密钥跑 BCA，永远免费且不限量——你的成本就是你自己的上游账单，没有理由再向我们付一次。愿意付钱的人买的是另一件事：不用自己去申请和管理十几个上游密钥，不用处理配额、限流和合规，注册完就能用。

| | 自带密钥 | 托管 |
| --- | --- | --- |
| 价格 | 永久免费 | 订阅制，按 credits 计量 |
| 上游密钥 | 自己申请 | 平台代持 |
| 适合 | 本地开发、已有上游额度的团队 | 想直接开始、不想管密钥的人 |
| 边际成本 | 接近零 | 随用量增长 |

计费口径刻意做得克制：本地计算类工具（`content_cid`、`did_key_resolve`、链信息）计价为 0，只读查询 1 credit，付费上游 3–4 credits，**调用失败不计费，写操作不进入计量**——不靠"多写链"赚钱，权限与授权是安全边界，不是收费点。

完整定价、credits 规则、单位经济学与竞品比较见[商业模式](docs/BUSINESS.md)。当前为 v1 开源阶段，本文中的定价是待验证假设，不是已验证的经营数据。

## 路线图：给 Agent 一个不可篡改的身份

让普通人创造链上规则是第一步。下一个问题是：当大量 Agent 开始替人行动时，谁为它们的行为负责，又能被谁追溯？

BCA 后续支持为 Agent 分配不可篡改的链上身份，把 Agent 的注册信息、交互记录与经验资产锚定在链上，让 A2A（Agent-to-Agent）交互全程可追溯。它可以与蜂群 Agent 系统联动，让大量自主智能体拥有可信的链上身份、资产与可审计交互日志。

这一步建立在当前已有的 `agent_*`、`sign_*`、`identity` 与来源验证（SLSA、in-toto、C2PA）能力之上：当人创造规则、Agent 执行规则时，两者之间需要一条不可抵赖的记录。

## 验证范围与已知边界

v1 的验证范围见[初始记录](docs/acceptance/2026-10-25-v1.md)，供应商发现与三个工作站见[任务记录](tasks/task-discovery.md)，生态实际验证范围见 [S2 记录](tasks/S2-progress.md)。

保留实际未测状态，不阻塞已验证主线。当前未验证或未完成的项：

- Windows / macOS 原生客户端 UI
- 账户型服务的完整业务路径（Dune 查询执行、Tenderly 模拟受现有免费计划 MCP 权限限制）
- 公共测试网源码上传
- 源码定位只覆盖已实现的标准代理和 trace 路径
- 部分上游依赖仍有安全告警，见[依赖安全状态](docs/guides/dependency-security.md)

## 相关文档

[开发规则](docs/TASKS.md) · [用户决定](docs/QUESTIONS.md) · [当前进度](STATUS.md) · [REA 参考](docs/REA-REFERENCE.md)

MIT。各上游组件保留自身许可证；OpenZeppelin Contracts MCP 独立进程遵循其 AGPL-3.0-only 许可。

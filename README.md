<div align="center">

# Blockchain Anything (BCA)

An MCP gateway that gives an agent one catalogue of on-chain tools — plus a write gate, so discovery and permission never get mixed up.

一个面向 Agent 的 MCP 链上能力网关：给它一份统一的链上工具目录，外加一道写操作闸门，让"发现能力"和"获得授权"不再混在一起。

[![CI](https://github.com/songconmaisaix31-design/blockchain-anything/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/songconmaisaix31-design/blockchain-anything/actions/workflows/ci.yml)
[![license](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![node](https://img.shields.io/badge/node-22.12%20%7C%2024-blue.svg)](package.json)
[![version](https://img.shields.io/badge/version-1.3.0-blueviolet.svg)](package.json)

</div>

> **How to read this page / 怎么读这页**
> English first, then the same content in Chinese — not a summary, not a separate version. Tables keep both languages in one cell.
> 每段英文在前，同一内容的中文紧跟在后；不是摘要，也没有单独的中文版。表格把两种语言放进同一格。

---

## At a glance · 一眼看懂

| | |
|---|---|
| **Problem<br/>问题** | Every chain ecosystem ships its own SDK, its own auth, its own error shape. An agent can call tools; it cannot find them, and nobody wants to hand an agent unguarded write access to a chain.<br/>每个链生态都有自己的 SDK、自己的鉴权、自己的错误格式。Agent 会调工具，但找不到工具；也没人愿意把不受控的写权限交给 Agent。 |
| **Fix<br/>做法** | One registry of tool definitions, reachable three ways — `bca` CLI, MCP stdio server, TypeScript SDK — with writes off by default and every tool tagged with its upstream source component.<br/>一份工具注册表，三种入口可达——`bca` 命令行、MCP stdio 服务、TypeScript SDK；写操作默认关闭，每个工具都标注自己的上游来源组件。 |
| **Cost<br/>代价** | Node 22.12+ (22 LTS) or Node 24 LTS, npm and Git; 28 runtime dependencies and a first install that downloads them from GitHub source. Contract build and test additionally need the official Foundry binaries, which `bca setup` installs per platform.<br/>Node 22.12+（22 LTS）或 Node 24 LTS、npm 与 Git；28 个运行时依赖，首次安装要从 GitHub 源码下载。合约编译与测试还需要官方 Foundry 二进制，`bca setup` 会按平台安装。 |
| **Not<br/>不是** | Not a chain, not a wallet, not a hosted service, and not an npm package — `private: true`, so every install builds from source.<br/>不是链、不是钱包、不是托管服务，也不是 npm 包——`private: true`，所以每次安装都从源码构建。 |

## The problem · 问题在哪

An agent that wants to check a balance has three separate obstacles, and only the first one looks like a tooling problem.

一个 Agent 想查一个余额要过三道坎，而只有第一道看起来像工具问题。

| Break · 断点 | What it looks like · 具体表现 |
|---|---|
| **01 Discovery<br/>发现** | Tools are scattered across a dozen ecosystems, each with its own naming. Before calling anything, the agent has to know which SDK owns the job.<br/>工具散落在十几个生态里，命名各不相同。调用之前，Agent 得先知道这件事归哪个 SDK 管。 |
| **02 Auth<br/>鉴权** | Every upstream wants its own key, quota and rate limit, and fails with its own error shape. Five accounts, five failure modes, one afternoon of debugging.<br/>每个上游都要自己的密钥、配额和限流，报错格式还都不一样。五个账号、五种失败方式、一个下午的排查。 |
| **03 Boundary<br/>边界** | Discovery and permission are usually the same switch. One hallucinated call is enough to deploy to mainnet or sign a transaction nobody meant to sign.<br/>发现和授权通常是同一个开关。一次幻觉就够把合约发到主网，或者签一笔没人打算签的交易。 |

## The idea · 思路

One definition, three entry points, and the same behaviour in all of them. The CLI is for trying an idea out, MCP is how an agent uses it, the SDK is how another platform embeds it.

一份定义，三种入口，行为一致。CLI 用来试一个想法，MCP 是 Agent 使用它的方式，SDK 是别的平台嵌进去的方式。

| Noun · 名词 | Where · 位置 | Rule · 规则 |
|---|---|---|
| **Tool definition** | `src/providers/*`, `src/workstations/catalog.ts` | Each one records its upstream source component, read/write nature and preconditions.<br/>每个都记录上游来源组件、只读/写性质和前置条件。 |
| **Catalogue** | `capability_search` | Discovery only. Searching never grants the right to call a write tool.<br/>只管发现。检索本身不会带来调用写工具的权限。 |
| **Write gate** | `BCA_ALLOW_WRITES` (default `false`) | A write needs that flag, `submit: true` and an explicit sender.<br/>写操作需要该开关、`submit: true` 和明确的发送地址。 |
| **Connection** | `.bca/mcp.json` | Upstream MCP servers and key *references*; credentials stay in the environment.<br/>上游 MCP 服务与密钥*引用*；凭据留在环境变量里。 |
| **Provenance** | `src/provenance/`, `docs/integrations/provenance.md` | ABI encoding, signing and CID work are reused from upstream, not reimplemented.<br/>ABI 编码、签名和 CID 这类已成熟能力沿用上游，不重写。 |

The local half is real work without a chain: compiling, unit-testing and running against a loopback Anvil need no RPC and no signing rights. That is what makes "try the rule first" an actual step rather than a slogan.

本地那一半是不需要真链的真实工作：编译、单元测试、对着 loopback Anvil 试运行，都不需要 RPC 和签名权限。所以"先试规则"是一步可执行的动作，不是一句口号。

## Capabilities · 能力清单

Three entry points, one implementation:

三个入口，一套实现：

| Entry · 入口 | How to run it · 怎么跑 | What it gives you · 给你什么 |
|---|---|---|
| **CLI** | `bca find '…'`, `bca tools <name>`, `bca call <name> --input '{…}'` | The catalogue and the calls from a terminal.<br/>在终端里做检索和调用。 |
| **MCP** | `bca mcp` (stdio), or `bca setup --client both --install` to write the client config | The primary form: any MCP-capable agent gets the toolset.<br/>主要形态：任何支持 MCP 的 Agent 直接拿到这套工具。 |
| **SDK** | `import { createToolkit } from 'blockchain-anything'` | `toolkit.invoke('capability_search', …)` inside your own code.<br/>在自己的代码里 `toolkit.invoke('capability_search', …)`。 |

Tool names are the first argument to `defineTool(...)`. A static count of those registrations in this pass found **156 distinct tools across 57 prefixes** — the counting method is in the Status section below, so the number is reproducible rather than asserted.

工具名就是 `defineTool(...)` 的第一个参数。本轮对这些注册做静态计数，得到 **57 个前缀下的 156 个不同工具**——计数方法写在下面的「状态」一节，所以这个数字是可复现的，而不是断言。

| Prefix · 前缀 | Tools · 工具数 | Covers · 覆盖 |
|---|---|---|
| `eas_` | 20 | Attestations, schemas, revocation.<br/>声明、Schema、撤销。 |
| `dev_` | 17 | Solidity build/test/deploy wrappers over Foundry and Hardhat.<br/>Foundry 与 Hardhat 的编译/测试/部署封装。 |
| `bridge_` | 11 | Connecting to, calling and closing upstream MCP servers.<br/>上游 MCP 服务的连接、调用与关闭。 |
| `evm_` | 8 | Chain state reads and transaction diagnostics.<br/>链状态读取与交易诊断。 |
| `ccxt_` | 7 | Exchange market data.<br/>交易所行情。 |
| `viem_` | 6 | Typed EVM reads and logs.<br/>带类型的 EVM 读取与日志。 |
| `nft_`, `sui_`, `sign_`, `workstation_`, `arweave_` | 4 each<br/>各 4 | NFT holdings and approvals; Sui; EIP-712 style signing; diagnostic workstations; Arweave.<br/>NFT 持有与授权；Sui；签名；诊断工作站；Arweave。 |
| *the other 46 prefixes*<br/>其余 46 个前缀 | 67 | Solana, Aptos, IPFS, Walrus, x402, Chainlink, DeFiLlama, C2PA, SLSA, in-toto, RISC Zero and more.<br/>Solana、Aptos、IPFS、Walrus、x402、Chainlink、DeFiLlama、C2PA、SLSA、in-toto、RISC Zero 等。 |

There is also a separate quant module (`src/quant/`, `npm run quant`) for backtesting, walk-forward validation and a paper-trading state machine. Its own documentation states plainly that it does not promise profit and that its strategies are candidates, not a track record.

另有一个独立的量化模块（`src/quant/`、`npm run quant`），做回测、样本外验证和 paper 交易状态机。它自己的文档写得很清楚：不承诺盈利，里面的策略是候选方案，不是业绩记录。

## Quickstart · 快速开始

### Requirements · 环境要求

Node 22.12+ (22 LTS) or Node 24 LTS, npm and Git. `setup` installs the official Foundry binaries per platform — Windows x64 via PowerShell without touching the global `script-shell`; Linux and macOS on x64 and arm64.

Node 22.12+（22 LTS）或 Node 24 LTS、npm 与 Git。`setup` 按平台安装官方 Foundry 二进制——Windows x64 用 PowerShell，不需要改全局 `script-shell`；Linux 与 macOS 支持 x64 和 arm64。

### 1. Install into a project · 安装到项目

```sh
# from the target project directory · 在目标项目目录里执行
npm exec --yes --package=git+https://github.com/songconmaisaix31-design/blockchain-anything.git#main -- bca setup --client both --install
```

Replace `both` with `codex` or `claude` for a single client. The first install needs network access. On a mainland-China mirror that has not synced every pinned version (for example `ETARGET No matching version found for @mysten/seal@1.5.1`), add the official registry:

只用一个客户端时把 `both` 换成 `codex` 或 `claude`。首次安装需要联网。如果国内镜像还没同步某个固定版本（例如 `ETARGET No matching version found for @mysten/seal@1.5.1`），加上官方 registry：

```sh
npm exec --yes --package=git+https://github.com/songconmaisaix31-design/blockchain-anything.git#main --registry=https://registry.npmjs.org -- bca setup --client both --install
```

`setup` creates a persistent runtime directory, installs Foundry, writes the MCP config, and appends the `BCA-WORKFLOW.md` entry point to `AGENTS.md` / `CLAUDE.md`. It backs up before editing and does not duplicate lines on a re-run.

`setup` 会创建持久运行目录、安装 Foundry、写 MCP 配置，并把 `BCA-WORKFLOW.md` 的入口追加到 `AGENTS.md` / `CLAUDE.md`。改动前先备份，重复运行不会重复添加。

### 2. Verify · 验证

```sh
alias bca='node .bca/runtime/node_modules/blockchain-anything/dist/cli/main.js'   # Linux / macOS / WSL2
bca doctor
```

`doctor` inspects the install and configuration and repairs what it knows how to repair, so the first thing you get is a list of what is still missing rather than a stack trace. From a source checkout, run `npm ci` and use `node dist/cli/main.js` instead of `bca`.

`doctor` 检查安装与配置，能修的直接修，所以先拿到的是"还缺什么"的清单，而不是一段堆栈。用源码 checkout 时先 `npm ci`，然后用 `node dist/cli/main.js` 代替 `bca`。

### 3. Discover and call · 检索与调用

```sh
bca find 'Solana 余额'
bca tools content_cid
bca call content_cid --input '{"path":"contracts/src/MyToken.sol"}'
```

`find` returns matching tools with required parameters, availability conditions and the calling entry. `--details` shows the full schema. A documented read-only example that needs no account, key or signature is GoPlus token security:

`find` 返回匹配工具、必填参数、可用条件与调用入口，加 `--details` 看完整 Schema。一个不需要账号、密钥或签名的只读示例是 GoPlus 代币安全查询：

```sh
bca call goplus_token_security --input '{"chainId":"1","address":"0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"}'
```

Look at `access` (should be `public`), `source`, `queriedAt` and `response.result[address]`. A missing or empty upstream field means the provider did not supply that item — it does not mean the token is safe.

看 `access`（应为 `public`）、`source`、`queriedAt` 和 `response.result[address]`。上游字段缺失或为空只说明提供方没有这项数据，**不代表代币安全**。

### 4. Create and run a contract · 创建并运行合约

```sh
bca init contracts --template erc20 --name 'My Token' --symbol TOKEN --supply 1000
bca build contracts
bca test contracts
```

The default template is Counter; ERC20 reuses OpenZeppelin Contracts. `bca init nft --template erc721` covers mint permission, duplicate `tokenId` and `tokenURI` tests. Compiling and testing need no RPC and no signing rights; a failing compile keeps its diagnostics, and the CLI exits 2 for business failures and 1 for execution failures.

默认模板是 Counter，ERC20 复用 OpenZeppelin Contracts。`bca init nft --template erc721` 覆盖铸造权限、重复 `tokenId` 和 `tokenURI` 测试。编译与测试不需要 RPC 和签名权限；编译失败保留诊断，CLI 业务失败退出 2，执行失败退出 1。

## Documentation · 文档

| Doc · 文档 | Read it when · 什么时候读 |
|---|---|
| [docs/guides/setup.md](docs/guides/setup.md) | Installing, platform notes, the local runtime directory.<br/>安装、平台说明、本地运行目录。 |
| [docs/guides/usage.md](docs/guides/usage.md) | Daily CLI and MCP usage.<br/>日常 CLI 与 MCP 用法。 |
| [docs/guides/providers.md](docs/guides/providers.md) | Connecting upstream services and custom auth.<br/>接入上游服务与自定义鉴权。 |
| [docs/guides/workstations.md](docs/guides/workstations.md) | The diagnostic workstations and local deploy rules.<br/>诊断工作站与本地部署规则。 |
| [docs/guides/goplus.md](docs/guides/goplus.md) | The GoPlus query in detail.<br/>GoPlus 查询的参数与口径。 |
| [docs/guides/verification.md](docs/guides/verification.md) | How acceptance is recorded here.<br/>这个仓库怎么记录验收。 |
| [docs/guides/dependency-security.md](docs/guides/dependency-security.md) | Known advisories in upstream dependencies.<br/>上游依赖里已知的安全告警。 |
| [docs/quant-ea.md](docs/quant-ea.md) | The quant module: cost model, walk-forward, paper state machine.<br/>量化模块：成本模型、样本外验证、paper 状态机。 |
| [docs/BUSINESS.md](docs/BUSINESS.md) | Open-core split, credits, unit economics.<br/>开源与托管的划分、credits、单位经济学。 |
| [STATUS.md](STATUS.md), [HANDOFF.md](HANDOFF.md) | Where delivery stands, and what the next person needs.<br/>当前交付状态，以及接手的人需要知道什么。 |
| [docs/acceptance/](docs/acceptance) | 11 dated acceptance records, 2026-10-23 → 2026-10-31.<br/>11 份带日期的验收记录，2026-10-23 → 2026-10-31。 |
| [tasks/](tasks) | Ecosystem discovery notes and per-service workflow records.<br/>生态发现记录与各服务的实际工作流记录。 |

## Repository layout · 仓库结构

```text
blockchain-anything/
├── src/
│   ├── cli/main.ts           # bca: find, tools, call, init, build, test, connect, setup, doctor, mcp
│   ├── mcp/main.ts           # stdio MCP server
│   ├── toolkit.ts            # createToolkit() for the SDK entry
│   ├── providers/            # tool definitions, grouped by upstream
│   ├── workstations/         # catalogue.ts: task → tool set, and the search/guide logic
│   ├── development/          # Foundry / Hardhat wrappers
│   ├── bridge/               # upstream MCP connection + session management
│   ├── quant/                # backtest, walk-forward, paper trading
│   └── chains/ storage/ identity/ provenance/ wallets/ agents/ trading/
├── examples/
│   ├── services/             # 13 service presets (dune, nansen, goplus, slither, …)
│   ├── contracts/            # Foundry sample project
│   └── agents/               # agent-kit and OLAS examples
├── docs/                     # guides, integrations, acceptance records, demo page
├── tasks/                    # ecosystem and service workflow records
├── scripts/                  # 11 check-*.ts verification scripts
└── .github/workflows/ci.yml  # install + runtime checks on 3 OS/Node combinations
```

## Status · 状态

Version 1.3.0, MIT, `private: true` — not published to npm, every install builds from source.

版本 1.3.0，MIT，`private: true`——没有发布到 npm，每次安装都从源码构建。

What can be checked without trusting prose:

不靠文字描述就能核对的部分：

- **CI exists and runs installs.** `.github/workflows/ci.yml` ("Install and runtime") runs `npm ci`, `npm run check:s2`, `npm run check:setup` and a critical-level `npm audit` on Ubuntu 22.12.0, Ubuntu 24 and Windows 22.
- **The tool count is reproducible.** Matching `defineTool('<name>')` in `src/**/*.ts` finds 156 distinct names under 57 prefixes. It is a static count of definitions, not the size of the runtime catalogue, and older notes in this repository quote different totals (152 in the previous README, 125 tool entries in `STATUS.md`) — treat the runtime number as the only authoritative one.
- **11 dated acceptance records** exist under `docs/acceptance/`, and 13 service presets under `examples/services/`.
- **11 verification scripts** (`scripts/check-*.ts`) back the `npm run check:*` targets.

- **CI 是真实存在的，且真的跑安装。** `.github/workflows/ci.yml`（"Install and runtime"）在 Ubuntu 22.12.0、Ubuntu 24 和 Windows 22 上执行 `npm ci`、`npm run check:s2`、`npm run check:setup` 以及 critical 级别的 `npm audit`。
- **工具数可复现。** 在 `src/**/*.ts` 中匹配 `defineTool('<name>')` 得到 57 个前缀下的 156 个不同名字。这是定义的静态计数，不等于运行时目录大小；仓库里的旧记录给了不同的总数（旧 README 写 152，`STATUS.md` 一处写 125 个工具入口）——只有运行时返回的数字才算权威。
- **11 份带日期的验收记录**在 `docs/acceptance/` 下，`examples/services/` 下有 13 个服务预设。
- **11 个校验脚本**（`scripts/check-*.ts`）对应 `npm run check:*`。

Known limits, as recorded in the repository's own acceptance files:

已知边界，按仓库自己的验收记录：

- Windows and macOS native client UI is not built.<br/>Windows 与 macOS 原生客户端 UI 没有做。
- Account-scoped service paths are incomplete: Dune query execution and Tenderly simulation are blocked by the free plan's MCP permissions.<br/>账户型服务的业务路径不完整：Dune 查询执行与 Tenderly 模拟被免费计划的 MCP 权限拦住。
- Source-code resolution covers the implemented standard proxy and trace paths only.<br/>源码定位只覆盖已实现的标准代理与 trace 路径。
- Public testnet source upload was not verified.<br/>公共测试网的源码上传没有验证。
- Some upstream dependencies still carry security advisories; see the dependency-security guide.<br/>部分上游依赖仍有安全告警，见依赖安全说明。

This page was rewritten without installing dependencies or running `bca`: every command above comes from the repository's scripts, source and previous documentation, and none of those runs was re-observed here.

这一页是在没有安装依赖、也没有运行 `bca` 的情况下改写的：上面的每条命令都来自仓库的脚本、源码和原有文档，本轮没有重新观察它们执行。

## License · 许可

MIT. Upstream components keep their own licences; the OpenZeppelin Contracts MCP runs as a separate process under AGPL-3.0-only.

MIT。各上游组件保留自己的许可证；OpenZeppelin Contracts MCP 作为独立进程运行，遵循 AGPL-3.0-only。

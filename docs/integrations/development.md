# 开发工具接入（轨道 D）

更新日期：2026-10-23。实现位于 `src/development/`，工厂导出为
`developmentTools(config?: Config): ToolImplementation[]`。所有工具都通过现有
`defineTool` 返回 `ToolImplementation[]`，真实操作放在异步 `execute` 中。

本轨道只聚合成熟开发工具：

- **Foundry/Forge/Cast**：真实 `forge`、`cast` CLI 与标准 JSON 输出。
- **Hardhat**：项目自身安装的官方 Hardhat 3 CLI，固定只调用 `compile`、`test`。
- **Slither**：真实 `slither` CLI，`slither . --json -`。
- **Agent Skills**：官方 `skills` CLI（`skills@1.7.4`）安装、发现、读取官方技能。

没有实现编译器、分析器、Solidity parser、YAML parser、任意 shell 执行器或
部署命令。

## 工具

| 工具 | 读取标记 | 作用 |
| --- | --- | --- |
| `development_status` | 只读 | 显示项目根目录、官方 CLI 配置、Skills 来源与限制；不联网 |
| `development_doctor` | 只读 | 实际探测 `forge`、`cast`、`slither`、项目内 Hardhat 与 `skills` CLI |
| `foundry_build` | 写 | `forge build --json`；缓存命中时读取标准 `out/` 制品 |
| `foundry_inspect` | 写 | `forge inspect <contract> <field> --json`；字段使用官方制品字段白名单 |
| `foundry_test` | 写 | `forge test --json`；支持 `matchTest`、`matchContract`、`matchPath` |
| `foundry_call` | 只读 | `cast call ... --rpc-url <配置值> --json`；先核对 chain ID |
| `hardhat_compile` | 写 | 项目内 `hardhat compile`；读取标准 `artifacts/` |
| `hardhat_test` | 写 | 项目内 `hardhat test`；支持 `grep`、`noCompile` |
| `slither_analyze` | 只读 | `slither . --json - --disable-color`；默认排除依赖发现 |
| `skills_catalog` | 只读 | 官方 Skills 来源、固定 ref、许可证、技能名称 |
| `skills_install` | 写 | 官方 `skills` CLI 项目局部安装，返回实际 `resolvedRef` |
| `skills_list` | 只读 | 列出项目内已安装技能并读取官方 `skills-lock.json` |
| `skills_read` | 只读 | 返回完整 `SKILL.md` 或技能目录内参考文件、文件列表、许可证原文 |

`foundry_build` 和 `hardhat_compile` 的编译失败是正常诊断结果，返回
`success: false` 和上游输出；找不到可执行文件、超时、输出超限、路径越界、
解析失败会作为工具错误抛出。`foundry_test`/`hardhat_test` 的测试失败返回
`success: false`，不是基础设施错误。`foundry_call` 的 RPC 错误、chain ID
不匹配会立即失败。

## 配置

| 环境变量 | 默认值 | 说明 |
| --- | --- | --- |
| `BCA_DEVELOPMENT_ROOTS` | `BCA_WORKING_ROOT` | 允许的项目根目录，多个用平台路径分隔符（Windows `;`） |
| `BCA_FORGE_BIN` | `forge` | 官方 Forge 可执行文件；可配置绝对路径 |
| `BCA_CAST_BIN` | `cast` | 官方 Cast 可执行文件 |
| `BCA_SLITHER_BIN` | `slither` | 官方 Slither 可执行文件；可为 venv 内路径 |
| `BCA_SKILLS_VERSION` | `1.7.4` | 官方 `skills` npm 包版本 |
| `BCA_DEVELOPMENT_TIMEOUT_MS` | `300000` | 单次 CLI 超时；最大 1 小时 |
| `BCA_DEVELOPMENT_MAX_OUTPUT_BYTES` | `16777216` | 单次 CLI 标准输出+错误输出上限；最大 64 MiB |
| `BCA_NPX_CLI` | 自动发现 | npm `npx-cli.js` 的绝对路径（通常不需要） |
| `BCA_RPC_URL` | 无 | `foundry_call` 使用的 RPC；不接受调用者传入任意 URL |
| `BCA_CHAIN_ID` | 无 | `foundry_call` 先核对的实际 chain ID |

未配置 `BCA_RPC_URL`/`BCA_CHAIN_ID` 时，`foundry_call` 明确失败；其他开发工具
仍可独立使用。配置错误不会阻止 EVM/EAS/内容/IPFS 等既有工具创建。

## 安全边界

- 项目目录必须在 `BCA_DEVELOPMENT_ROOTS` 内；请求路径和 `realpath` 都检查，
  符号链接不能逃逸。
- 子进程通过 `spawn` 参数数组启动，不使用 shell；调用者不能提供任意命令、
  任意参数位置或任意 RPC URL。
- 不提供部署工具。`forge build`、`hardhat compile`、测试和 `cast call` 不签名、
  不发送交易。测试项目可以在本地模拟网络部署测试合约，这是测试框架自身行为。
- 子进程环境删除 `BCA_PRIVATE_KEY`；错误经共享 `safeError` 脱敏，RPC URL/密钥
  不会出现在工具错误中。
- 每个进程有超时和输出上限；超时或超限会终止进程树，避免遗留 `solc`/Hardhat
  子进程。
- Hardhat 只解析项目本地 `node_modules/hardhat` 的官方 `bin` 入口，并且只调用
  固定任务。不会下载或执行调用者指定的脚本。
- Skills 安装只写项目内 Agent 目录（`--copy`），不写用户全局配置。技能正文按
  原始文件返回，不解析 YAML，不把技能指令提升为 BCA/Agent 的系统权限。

## 安装官方工具

### Foundry

```sh
curl -L https://foundry.paradigm.xyz | bash
foundryup
forge --version
cast --version
```

本机验证版本：Forge/Cast/Anvil `1.7.1`。

### Slither

```sh
uv venv .venv
uv pip install --python .venv/Scripts/python.exe slither-analyzer
```

本机验证版本：`slither-analyzer 0.11.6`。Slither 使用 `solc-select` 管理编译器；
如果安装在项目 venv 内，`BCA_SLITHER_BIN` 指向 venv 的 `Scripts/slither.exe`
（Windows）或 `bin/slither`，工具会自动把 `VIRTUAL_ENV` 指向该 venv，使编译器
缓存留在项目内。Slither 与 Slither-MCP 为 AGPL-3.0，分发或作为网络服务使用前
需确认许可。

### Hardhat

Hardhat 必须安装在目标项目内：

```sh
npm install --save-dev hardhat
```

`hardhat_compile`/`hardhat_test` 读取 `<project>/node_modules/hardhat/package.json`
的 `bin.hardhat`，用当前 Node.js 执行该 CLI。项目还需有 `hardhat.config.ts/js/mjs/cjs`。
本机验证版本：Hardhat `3.21.0`。

### Skills

`skills_install` 使用官方 `skills` npm 包（本机验证 `1.7.4`）：

```sh
npx -y skills@1.7.4 add <owner/repo> --skill <name> --agent opencode --copy --yes
```

项目局部目录：OpenCode `.agents/skills/`、Claude Code `.claude/skills/`、
Codex `.codex/skills/`、Cursor `.cursor/skills/`。安装会生成官方
`skills-lock.json`，记录来源和内容 hash。

## 官方 Skills 来源

| id | 来源 | 验证 ref | 许可证 | 登记技能数 |
| --- | --- | --- | --- | --- |
| `openzeppelin` | `OpenZeppelin/openzeppelin-skills` | `6f215af60eb60017ab1a933ce9d22a479cd42b26` | AGPL-3.0 | 11 |
| `trailofbits` | `trailofbits/skills` | `196a9073ab10d35bacf111f945e02c00b2c6883a` | CC-BY-SA-4.0 | 8（Solidity/审计子集） |
| `goplus` | `GoPlusSecurity/skills` | `d6e6072f8edba0191355abb0db0dabae8b9cad58` | Apache-2.0 | 6 |
| `alchemy` | `alchemyplatform/skills` | `4caf3e555c3af8dbb9e5b540aed558aef986d885` | MIT | 6 |
| `uniswap` | `Uniswap/uniswap-ai` | `1a43e968a39537d5a73aeca20dd1ed9d96f502fa` | MIT | 6 |
| `allium` | `allium-labs/skills` | `e55c69c22da2b80dd5f4478cf249a1cdb0948b64` | 上游未声明 | 10 |
| `heurist` | `heurist-network/heurist-mesh-skill` | `f116a8423010e06f500b89c94d490ed79ad12945` | 上游未声明 | 1 |

`skills_catalog` 返回完整技能名称列表。Trail of Bits 仓库包含 95 个技能，这里只
登记与 Solidity/智能合约开发审计直接相关的 8 个；其余技能可用官方 installer
直接安装，但不在 BCA 的强校验名单内。

官方 installer 解析仓库默认分支 HEAD。`skills_install` 在安装前执行
`git ls-remote <repo> HEAD`，返回实际 `resolvedRef`；安装完成后检查每个请求的
技能都有 `SKILL.md`，否则报错。`skills-lock.json` 的 hash 是内容级记录。

Allium 与 Heurist 的上游仓库没有 LICENSE 文件；BCA 不复制其技能正文，只提供
从官方来源安装/读取的入口。使用或再分发前必须向上游确认许可。

## 实际验证

验证项目：`.work/sample-foundry`（Foundry 1.7.1，forge-std v1.17.0，
OpenZeppelin Contracts v5.7.0）和 `.work`（Hardhat 3.21.0 官方
`node-test-runner-viem` 模板，Counter 迁移为 `BCACounter`）。

| 操作 | 真实命令 | 结果 |
| --- | --- | --- |
| Forge 编译 | `forge build --json` | 成功；缓存命中时从 `out/` 汇总 31 个合约 |
| Forge ABI | `forge inspect BCACounter abi --json` | 返回 constructor/function ABI |
| Forge 测试 | `forge test --json` | 5/5 通过（含 fuzz 与 revert 测试） |
| Cast 只读调用 | `cast call 0x5FbDB... "number()(uint256)" --rpc-url http://127.0.0.1:8545 --json` | Anvil 31337 返回 `[0]`，chain ID 核对通过 |
| Hardhat 编译 | 项目内 `hardhat compile` | 1 个合约，读取标准 artifact ABI/bytecode |
| Hardhat 测试 | 项目内 `hardhat test` | 2 个 node:test 通过 |
| Slither | `slither . --json - --disable-color --exclude-dependencies` | 成功，返回 2 个 Informational 发现 |
| Skills 安装 | `npx -y skills@1.7.4 add ... --copy --yes` | 7 个来源各安装一个技能；`resolvedRef` 与登记 ref 一致 |
| Skills 读取 | 读取 `.agents/skills/setup-solidity-contracts/SKILL.md` | 返回 2889 字节完整正文与目录文件列表；许可证由 catalog 记录 |
| 统一检查 | `npx tsx scripts/check-development.ts` | 13/13 通过；含 Foundry 24 个制品、Forge 3/3 测试、Hardhat 1 个 artifact、Slither、7 来源 Skills 与 Anvil cast 调用 |

`forge build --json` 在缓存命中时不返回完整 `contracts`，因此实现会读取 Forge
标准 `out/` 制品；这不是自写编译产物，仍是 Forge 的输出。

## 复测

```sh
npm run typecheck
npm run build
npx tsx scripts/check-development.ts
```

`scripts/check-development.ts` 默认使用 `examples/contracts/foundry`、
`examples/contracts/hardhat` 与一个临时 Skills 项目；可用环境变量
`BCA_CHECK_FOUNDRY_PROJECT`、`BCA_CHECK_HARDHAT_PROJECT`、`BCA_CHECK_SKILLS_PROJECT`
覆盖。Foundry 需要先 `forge install` 两个官方库，Hardhat 需要先 `npm install`。
脚本不会安装依赖，也不会部署合约。

如需实际执行 `cast call`，额外设置 `BCA_RPC_URL`、`BCA_CHAIN_ID` 和
`BCA_CHECK_CAST_ADDRESS`；未设置时该一步明确标记为 skipped，不伪造通过。
`BCA_CHECK_OUTPUT=.work/check-development-result.json` 可将完整结果写入文件。

## 未包含

- 原生 Codex 控制器审计仍需主 Agent 用原生控制器执行；普通 MCP/CLI 检查不能替代。
- OpenZeppelin、Slither、GoPlus、Alchemy 等 MCP 服务连接由 M 轨道
  `src/bridge/` 负责；本轨道不重复实现 MCP client。
- Tenderly、thirdweb、Chainstack、Nansen、Dune、CoinGecko、Token Terminal、
  Messari、Coinbase Wallet、Bankr/Brian 等属于 M 或 W 轨道。
- 生产部署、公共链写入、资金划转、付费订阅和 npm 发布不在本轮范围。
- Allium/Heurist 的技能许可状态未确认；上游未声明许可证不等于可以使用。

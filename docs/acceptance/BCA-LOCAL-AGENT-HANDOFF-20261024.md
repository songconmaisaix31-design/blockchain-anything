# BCA 本地 Agent 测试交接与验收标准

日期：2026-10-24（北京时间）。接收方：用户本地 Agent。目标：在真实本机补齐平台、客户端、账户服务及后端条件，逐项给出可核对的结果。当前可执行的本地回归、补测和公开只读探测已完成；尚不能宣布全生态验收完成。

## 1. 代码与交付边界

- 仓库：<https://github.com/songconmaisaix31-design/blockchain-anything>
- 分支：`codex/bca-s2-complete`；Draft PR：<https://github.com/songconmaisaix31-design/blockchain-anything/pull/1>
- 本次已验收代码提交：`1767c5f4aaa49f899fbae55d5d3fa73d50782d37`。对应树：`ca875000fd4d14a4d7b531da5f4f638cfb0a55a8`。后续文档提交不改变实现。
- 版本：0.3.0，`private:true`；Node `>=24.16.0 <25`。当前环境为 Linux x64、Node 24.19.0、npm 11.9.0。
- 本次新增 `scripts/check-handoff.ts`，只覆盖四项原先未测路径；未引入测试框架或根包运行依赖。
- 修复一处实测问题：官方 MCP Client 默认将列表变更通知延迟 300ms 处理，期间新工具可能仍按旧快照判断。`src/bridge/session.ts` 显式设置 `debounceMs:0`，收到通知立即使快照失效。修复后重新跑构建、MCP bridge、官方会话、Schema 变更和真实安装。

本次接手任务是验收和必要的局部修复。保持 Draft，不发布 npm；不得用“配置存在”“发现工具”“离线成功”替代实际业务结果。公共链交易、支付、兑换、创建收费资源只按用户已明确授权的网络、对象和额度执行。没有这些条件时标记 BLOCKED，不自行放宽。

## 2. 当前已跑结果

以下均为本轮实际运行。原始精简证据：[2026-10-24-handoff-results.json](https://github.com/songconmaisaix31-design/blockchain-anything/blob/codex/bca-s2-complete/docs/acceptance/2026-10-24-handoff-results.json)。早期验收记录仍可参考，但不替代本机验收。

| 编号 | 命令或真实操作 | 本轮结果与通过范围 |
| --- | --- | --- |
| R01 | `npm run build`；`git diff --check` | 通过；构建含 TypeScript 类型检查 |
| R02 | `npm run check:s2` | 真实离线 SDK：VC 签名/篡改拒绝、did:key、Sui Transaction、x402 header、CCXT registry、Arweave 签名、GAME/eliza handler 通过 |
| R03 | `npm run check:next -- regressions` | topics/null/OR 原样传输、限流保持未知、坏配置隔离、进程树超时/取消/输出上限、CLI exit 2/MCP isError 通过 |
| R04 | `npm run check:next -- onchain` | 真实 Anvil 交易四种状态、事件过滤、失败交易解码/源码位置、官方 ERC20 编译→测试→部署→读取通过 |
| R05 | `npm run check:bridge` | 真实 stdio 与 Streamable HTTP 初始化、发现、调用、错误传播通过 |
| R06 | `npm run check:sessions` | 官方 OpenZeppelin MCP 两次生成、会话复用、配置变更/断线不重放、显式重连通过；修复后复跑通过 |
| R07 | `npm run check:setup` | tgz→npm exec→持久 runtime/Foundry→保留配置/备份/幂等→真实 MCP CID 通过；修复后复跑通过。缺 Codex/Claude 程序的 doctor 项按缺失报告 |
| R08 | `npm run smoke -- --scope core,onchain,interfaces,package` | 真实 EAS 注册/声明/读取/撤销、签名拒绝篡改、CLI/MCP、打包隔离安装通过 |
| R09 | `KUBO_BIN=<官方 ipfs 程序> npm run smoke -- --scope ipfs` | Kubo 0.43.1 真实离线节点 add/read、字节一致、读取上限拒绝通过；节点停止已确认 |
| R10 | `npm run check:handoff -- proxies` | 官方 OZ 5.6.1 ERC1967Proxy、Clones、BeaconProxy 实际部署并识别通过；直接失败调用可定位，ERC1967/ERC1167/嵌套失败调用均保留 partial，不伪造源码位置 |
| R11 | `npm run check:handoff -- hardhat` | 独立 Hardhat 3.21.0 项目、官方 solc 0.8.35；真实 compile、单文件测试 1 passing、故意断言失败→business_failed 通过 |
| R12 | `npm run check:handoff -- slither` | 官方 Slither 0.11.6；有 findings 且原生 exit 255 时仍为扫描 succeeded；非法源码执行失败被拒绝，无假成功 |
| R13 | `npm run check:handoff -- schema` | 官方 SDK 真实 stdio、受控服务从 1 增至 3 工具；通知后无需显式刷新即可调用事先许可的新工具；digest 改变；未许可工具即使 readOnlyHint=true 仍被拒绝 |
| R14 | Sui testnet balance、Aptos testnet ledger、Solana devnet balance、Arweave info | 四项公开节点/网关实际读取通过，Aptos chain_id=2 |
| R15 | x402 公共 facilitator supported | 实际获取支持网络/方案通过；不等于支付验签或结算通过 |
| R16 | Sepolia `evm_contract_source` | Sourcify v2 实际读取并与固定区块 runtime 匹配通过；未上传源码 |
| R17 | CoinGecko MCP `search_docs` | 官方公开服务实际调用通过；不等于全部行情工具通过 |

R13 是协议生命周期受控验收，不是伪造外部供应商业务。R10 验收了“正确保留不完整结论”，没有实现代理和嵌套源码的完整定位。R11 使用官方本地编译器配置，未替换用户已有 Hardhat 工程。

安装过程曾遇到 Kubo 分发端 HTTP 503、下载/解压失败；改用官方 GitHub release，重新下载并以 `tar --no-same-owner` 解压后真实 IPFS 测试通过。Slither 编译失败路径未输出 JSON，BCA 按执行错误返回；不能要求所有版本在失败时均产生 `success:false` JSON。

## 3. 本地执行顺序

### 3.1 获取准确版本

已有 checkout 有未提交修改时保留原目录，使用独立 worktree；不要 reset 或覆盖用户修改。在原仓库执行：

```bash
git fetch origin codex/bca-s2-complete
git worktree add --detach ../bca-local-acceptance origin/codex/bca-s2-complete
cd ../bca-local-acceptance
git rev-parse HEAD
git merge-base --is-ancestor 1767c5f4aaa49f899fbae55d5d3fa73d50782d37 HEAD
node -v
npm -v
npm ci
npm run build
```

`merge-base` 应退出 0。保存实际 HEAD；如果远端已有更新，先查看新增差异再决定追加哪些局部测试。Node 不满足上述范围先修环境，不把不支持的 Node 版本结果计为产品缺陷。

WSL2 推荐在 Linux 文件系统内独立安装依赖。Windows 原生另建 checkout、安装 Windows Node 和依赖；不能共用 WSL 的 `node_modules`、二进制或绝对路径。

### 3.2 无外部账户的基线

每条独立保存 stdout、stderr、退出码；某项失败后继续其余独立项。失败项只修对应原因后局部复测。

```bash
npm run check:s2
npm run check:next -- regressions
npm run check:bridge
npm run check:sessions
npm run check:handoff -- schema
npm run check:setup
```

这些脚本会在 `.work` 或系统临时目录生成测试文件，启动自己拥有的子进程。`check:setup` 需要 npm registry 可达；其通过不要求当前机器已经安装两个客户端，但真实使用的客户端必须在下一节单独通过。

Foundry 链测试需要 Forge/Cast/Anvil 1.7.1 和 solc 0.8.35。`npm ci` 提供官方平台包；若离线编译器未缓存，先按本机 Foundry 方式准备，或首次生成样例后在 `.work/next/contracts` 用官方 `forge build` 下载该项目指定的编译器，再复跑。不要偷偷修改 solc 版本以绕过问题。

```bash
npm run check:next -- onchain
npm run check:handoff -- proxies
```

旧 smoke 脚本通过 `ANVIL_BIN` 指定程序，不自动使用 BCA 的解析器。Bash 下可统一这样运行：

```bash
export ANVIL_BIN="$(node --import tsx --input-type=module -e 'import {resolveExecutable} from "./src/development/exec.ts";console.log(resolveExecutable("anvil"))')"
npm run smoke -- --scope core,onchain,interfaces,package
export KUBO_BIN=/absolute/path/to/official/ipfs
npm run smoke -- --scope ipfs
```

Windows PowerShell 7 对应设置：

```powershell
$env:ANVIL_BIN = node --import tsx --input-type=module -e 'import {resolveExecutable} from "./src/development/exec.ts";console.log(resolveExecutable("anvil"))'
npm run smoke -- --scope core,onchain,interfaces,package
$env:KUBO_BIN = 'C:\tools\kubo\ipfs.exe'
npm run smoke -- --scope ipfs
```

本轮已跑过的 Hardhat/Slither 可只在本机遇到对应兼容问题时复验。准备命令如下，隔离依赖不写入根 package.json：

```bash
mkdir -p .work/handoff/hardhat
node --input-type=module -e 'import {writeFileSync} from "node:fs";writeFileSync(".work/handoff/hardhat/package.json",JSON.stringify({name:"bca-hardhat-acceptance",private:true,type:"module"}))'
npm install --prefix .work/handoff/hardhat --save-exact hardhat@3.21.0
export BCA_SOLC_PATH=/absolute/path/to/solc-0.8.35
npm run check:handoff -- hardhat
python3 -m venv .work/handoff/python
.work/handoff/python/bin/python -m pip install slither-analyzer==0.11.6
export BCA_SLITHER_BIN_DIR="$PWD/.work/handoff/python/bin"
npm run check:handoff -- slither
```

`BCA_SOLC_PATH` 省略时 Hardhat 按官方默认下载编译器。Windows 使用 Python venv 的 `Scripts` 目录和对应 solc.exe；优先在 WSL2 验收 Slither。脚本会改写自己的 `.work/handoff/hardhat` 样例，不能指向用户业务工程。

### 3.3 平台与客户端未测项

| 编号 | 必须实际运行的位置 | 操作 | 验收标准 |
| --- | --- | --- | --- |
| L01 | 用户 Windows 11 的 WSL2 Ubuntu 24.04 | 执行 3.2；记录 `uname -a`、`wsl.exe --version`、Node/npm | 全部已满足依赖的命令通过；超时/取消后 descendant.log 不再增长；本地链交易与回执一致；无遗留自有 Anvil/MCP 进程 |
| L02 | Windows 原生 PowerShell 7 + Windows Node | 至少 build、regressions、sessions、schema、setup；有平台二进制后跑 onchain/proxies | `taskkill.exe /PID <owned> /T /F` 实际清理父子孙；500ms 超时应在脚本 3500ms 上界内返回；输出上限/取消均结束；路径含空格和中文的目标项目配置可启动 |
| L03 | 用户实际使用的 Codex / Claude Code | 按下方安装，在真实项目完成 trust/MCP 授权；Codex `codex mcp list`，Claude `/mcp` | 客户端显示 bca 已连接，真正调用 content_cid 成功；重启客户端后仍成功；不是只在官方 SDK 客户端中通过 |
| L04 | macOS 原生，若纳入支持范围 | build、regressions、setup、onchain，记录 arm64/x64 | 原生程序版本、持久运行目录、配置保留、后代清理均通过。没有 Mac 则 BLOCKED，不能由 Linux/WSL 代签 |

在 BCA checkout 打包，再在一个路径含空格/中文的**临时目标项目**执行安装；此目录内先准备 `README.md`：

```bash
# BCA checkout
npm pack
# 临时目标项目；替换为上一步 tgz 的绝对路径
npm exec --yes --package /absolute/path/blockchain-anything-0.3.0.tgz -- bca setup --client both --install
node .bca/runtime/node_modules/blockchain-anything/dist/cli/main.js doctor
```

验收前后比对原 `.mcp.json` / `.codex/config.toml` 的非 BCA 项；已有 BCA env 应保留，备份应可读，第二次 setup 应幂等。删除本次 npm exec 临时依赖或换一个新终端后，从生成的配置启动仍应成功。不要删除用户全局 npm cache。

客户端内调用 `content_cid({"path":"README.md"})`，与 CLI 同文件结果比对 CID/bytes。再问“为什么我的 EVM 交易失败”，没有链/hash 时应要求补充事实，不能编造诊断。`doctor` 的退出 0 只表示诊断命令完成，必须查看 `allPassed` 和逐项状态；不使用的客户端缺失可标 N/A 并说明。

## 4. 真实网络和账户服务待验收总表

当前执行环境未配置 BCA 账户凭据。以下缺口不会因本地回归通过而消失。按表中条件就绪后执行一次真实路径，保留请求类型、脱敏输入、网络/服务、响应、时间、退出码。

### 4.1 共用 MCP 验收方法

1. 从 `examples/services/<name>.json` 复制模板到本机私有配置，补齐环境变量。OAuth 服务由用户在本机交互终端完成已有配置命令的授权；不要把浏览器登录当成 API 成功。
2. 设置 `BCA_MCP_CONFIG`（与 `BCA_MCP_SERVERS` 二选一），先执行：

```bash
node --env-file=.env.local dist/cli/main.js call bridge_servers --input '{}'
node --env-file=.env.local dist/cli/main.js call bridge_refresh --input '{"server":"dune"}'
```

3. 用**本次返回的 inputSchema**选择并调用下表业务工具。静态工具名可能随上游变化，不凭旧文档猜参数。只读工具先由操作者加入对应服务 `readOnlyTools`，不能为了绕过检查给整个服务统一开写权限。

```bash
# TOOL_NAME 和 arguments 按刚刚返回的 Schema 与实际目标替换
node --env-file=.env.local dist/cli/main.js call bridge_call --input '{"server":"dune","tool":"TOOL_NAME","arguments":{}}'
```

4. 连续会话必须在同一个 toolkit 实例或同一个 MCP 服务进程内完成 `bridge_open → bridge_refresh → bridge_call → bridge_close`。不同 CLI 进程不能传递 session ID。
5. PASS 同时要求：真实工具发现成功、至少一次目标业务调用成功、原生结果可核对、错误没有被吞掉。只发现 Schema 记 PARTIAL。新工具保持 discovered_unverified，未经许可不能自动调用。

| 编号 | 服务与模板 | 当前阻塞条件 | 最小业务路径与验收标准 |
| --- | --- | --- | --- |
| A01 | Tenderly / `oauth.json` | OAuth、用户已有项目和交易样本 | 读取或模拟一笔已知失败交易；chain/hash、失败原因/调用树与回执一致；记录模拟条件；不重放发送真实交易 |
| A02 | Alchemy / `alchemy.json` | OAuth / 账户权限 | 使用已有节点读取指定链区块或交易；chain ID、区块/hash 与独立 RPC 一致；不创建收费节点 |
| A03 | thirdweb AI / `thirdweb.json` | BCA_THIRDWEB_SECRET_KEY | 对指定测试网地址/交易做只读分析；返回实际链数据；若只给自然语言则附可核对原始证据 |
| A04 | Chainstack / `chainstack.json` | BCA_CHAINSTACK_API_KEY、已有资源 | 读取既有节点/网络，再完成真实链查询；不得把资源列表当链查询通过 |
| A05 | Nansen / `nansen.json` | BCA_NANSEN_API_KEY 和数据权限 | 查询明确 chain/address 的受支持数据；记录数据时间与字段，不把空结果判为供应商不可用 |
| A06 | Dune / `dune.json` | BCA_DUNE_API_KEY、已有 query/result | 读取已有查询结果和 execution ID；字段/行数与查询定义吻合。付费执行新查询需已有额度授权 |
| A07 | Allium / `allium.json` | BCA_ALLIUM_API_KEY 或 OAuth | 读取 get_skill 后完成一个真实数据查询；技能文本本身只算发现阶段 |
| A08 | Token Terminal / `tokenterminal.json` | OAuth 与数据权限 | 查询明确项目和时间区间指标，返回数值、单位、时间；不得只列目录 |
| A09 | Messari / `messari.json` | OAuth + API 访问权限 | 查询指定资产的真实研究/指标；记录来源与更新时间，权限错误保留原样 |
| A10 | GoPlus / `goplus.json` | BCA_GOPLUS_API_KEY / BCA_GOPLUS_API_SECRET | 对明确 chain/token 做安全查询并保留原始风险项。无风险项不等于审计安全证明；Skills 安装/读取另行记录 |
| A11 | Coinbase Wallet / `coinbase-wallet.json` | OAuth 钱包授权 | 在授权账户只读查询地址、链和余额，与链上读取一致；不要用转账验证连接 |
| A12 | Etherscan 类 MCP | 本仓库无已核对固定预设；需官方端点、凭据和目标 | 先核实当前官方服务，添加操作者配置后刷新；真实获取已验证合约 ABI/源码并匹配链地址。不以 Sourcify 通过替代该服务验收 |

### 4.2 非 MCP、后端和签署路径

先用 `node dist/cli/main.js tools <工具名>` 读取当前严格 Schema；只有目标、账户和授权条件齐备后调用。

| 编号 | 工具 / 范围 | 缺少的真实条件 | 通过标准 |
| --- | --- | --- | --- |
| B01 | `dev_forge_verify` 公共源码上传 | 用户自有已部署测试网目标、对应源码/编译参数、上传授权；新部署还需测试币和钱包授权 | 用真实工程调用下方命令；Sourcify 验证完成；随后 `evm_contract_source` 在固定区块 bytecodeMatched=true；记录链/address/compiler/参数/验证响应 |
| B02 | `hummingbot_status` | BCA_HUMMINGBOT_URL / AUTH、真实 Hummingbot API | 读取运行中的服务状态，与服务端日志或控制台对应；不下单 |
| B03 | `brian_prepare` | BCA_BRIAN_API_KEY、用户指定测试网地址和请求 | SDK 返回可解析的待执行交易，chain/from/to/value/data 与请求一致；未签署、未广播 |
| B04 | `bankr_prompt` / `bankr_job` | BCA_BANKR_API_KEY、明确任务授权 | 优先已有 job 查询；新 prompt 可能交易，必须审阅任务与额度。任务最终状态和链上证据/实际输出一致；超时未知不得自动重发 |
| B05 | `mesh_schema` / `mesh_call` | Heurist API key 与额度授权 | 获取真实工具 Schema/价格，再调用一项实际查询；返回真实结果及费用/请求标识；Schema 成功只计 PARTIAL |
| B06 | GAME 托管 Agent | 托管 API key、已有 Agent 和明确任务 | 官方运行产生一次真实工具调用，并回传与 BCA 原始结果一致；本地 GameFunction 通过不替代托管运行 |
| B07 | elizaOS 完整 runtime | 用户要验收的 runtime 配置、模型/服务凭据、插件工程 | 启动真实宿主，加载 BCA action，执行 CID 或只读链查询；handler/result/宿主记录一致且可正常退出 |
| B08 | Olas / Open Autonomy 完整服务 | 服务配置、部署环境与运行许可 | 在真实服务中消费 BCA MCP 并执行一次业务；服务健康、结果和日志一致；独立 Python MCP 示例不是完整服务部署 |
| B09 | AgentKit / Solana Agent Kit 其他 actions | 用户实际需要的 action、对应插件/钱包/测试币/授权 | 按真实 actions Schema 执行指定测试网任务，回执/状态与链一致。现有钱包信息与 balance 读取通过只覆盖相应 action |
| B10 | Uniswap 官方 Skills 工作流 | 已安装当前官方 Skills、目标网络、钱包及兑换/流动性额度授权 | 先给报价/模拟和滑点、地址；授权后真实测试网回执及余额变化可核对；仅阅读技能不算工作流通过 |
| B11 | `sign_attest` / `sign_revoke` | 测试网 signer、测试币、可用 schema 和逐次授权 | 创建后 `sign_attestation` 读回字段/签发者一致；撤销后原生 revoked 状态为真 |
| B12 | `x402_verify` | 官方测试网支持的有效签署 payload、对应 requirements、必要余额 | 有效授权返回 isValid=true；改金额/收款人/签名应被拒绝；本验收只 verify，不 settle |
| B13 | `ots_verify` | 可用 Bitcoin Core 节点、认证、已确认 .ots 证明与原文件 | 官方客户端确认实际 Bitcoin 区块时间，记录高度/hash；改文件应失败；info 成功或节点连接成功均不足以通过 |
| B14 | `openlineage_emit` | BCA_OPENLINEAGE_URL/TOKEN、真实可查询后端 | 发送合法 RunEvent，后端按 runId 可查到 job、eventType、inputs/outputs/facets；HTTP 2xx 但无法核对落库只计 PARTIAL |
| B15 | Trail of Bits 完整审计工作流 | 具体授权目标工程、审计范围、所需官方工具/Skills | 按技能执行实际分析并交付可复现 finding/无发现范围；扫描成功不等于合约安全。Slither MCP 历史发现/分析已通过，完整审计未代验 |

源码验证命令示例（替换本机真实值；只上传已有合约源码，不自动部署公共链）：

```bash
node --env-file=.env.local dist/cli/main.js call dev_project --input '{"dir":"path/to/project"}'
# .env.local 中设置实际 RPC/CHAIN_ID 和已授权的 BCA_ALLOW_WRITES=true
node --env-file=.env.local dist/cli/main.js call dev_forge_verify --input '{"dir":"path/to/project","contract":"src/MyContract.sol:MyContract","address":"0xYOUR_DEPLOYED_ADDRESS","submit":true}'
node --env-file=.env.local dist/cli/main.js call evm_contract_source --input '{"address":"0xYOUR_DEPLOYED_ADDRESS"}'
```

构造参数存在时按 Schema 传 ABI 编码后的 `constructorArgs`。若源码含未替换 immutable/link references，本地 artifact 精确匹配不支持，应使用官方验证结果；不能删 metadata 或随意改 bytecode 比较规则以“通过”。

### 4.3 功能边界，不能靠补跑标记完成

| 编号 | 范围 | 处理与验收规则 |
| --- | --- | --- |
| U01 | 代理/嵌套调用完整源码定位、交易内或同区块升级、多层/非标准代理 | 当前实现只验收标准单层识别与 partial。需匹配实际执行深度和实现地址后才能另行开发完整定位；维持 complete=false 是正确结果 |
| U02 | Beacon 实现解析 | 当前仅检测 ERC-1967 beacon slot，明确 unsupported；不得声称已定位 beacon 实现源码 |
| U03 | Hardhat 统一部署 | BCA 只复用现有 compile/test；部署交给项目已有脚本。验收宿主脚本需明确工程和网络，不把 BCA 本地 Foundry 部署当 Hardhat 部署 |
| U04 | Seal 解密策略 | 目前只提供 seal_encrypt，缺少解密适配。完整解密需要官方策略合约、用户授权、对应 SDK 路径和新增实现；不能仅凭补 key 标 PASS |
| U05 | Kaito 通用官方 API / GOAT | Kaito 无已核实通用官方适配；GOAT 按现有归档/迁移记录处理。无实现项记 UNSUPPORTED，不创建假入口、不计成功 |
| U06 | 官方供应商真实工具版本新增 | 本地协议变更已通过；外部服务更新仍需实际前后 Schema/version/digest 和业务调用证据。没有上游新增事件时记 NOT OBSERVED，不人为把受控服务写成官方更新 |
| U07 | 任意链/任意 Agent 工作流、媒体信任/VC 吊销、IPFS 公网持久性 | 现有两个工作站是 EVM；离线签名、内容验证和单节点读回各有边界，不能扩张为信任、全链或长期可用性保证 |

## 5. 统一验收与回传规则

状态只用：PASS（目标业务真实通过）、FAIL（条件齐备但结果不符）、BLOCKED（缺具体条件）、PARTIAL（只完成其中阶段）、UNSUPPORTED（当前无实现）、N/A（用户明确不纳入范围）。**缺 key、没机器、没后端不能记 PASS 或无说明 skip。**

必须满足的硬标准：

1. 每条结果绑定实际 HEAD、操作系统/架构、Node/工具版本、执行时间；保存命令、退出码、脱敏输出与原生证据路径。
2. 业务失败如 Solidity/Hardhat 断言失败必须在 CLI/MCP 层体现错误；Slither finding 与扫描执行失败区分。`doctor` 单看 exit 0 不够。
3. 链路径保留 chainId、address、txHash、blockNumber/blockHash、receipt。临时 Anvil 记录注明本地链，不能到公共浏览器验证。
4. 诊断结论只能由实际回执、trace、代码/ABI/sourceMap 支撑；代理/嵌套缺源码位置时明确 partial。RPC 限流/权限/网络错误保持未知，不改成 not_found。
5. 进程超时/取消/输出超限均清理自有子孙；跨平台逐台实测。连接或未知提交失败不得自动重放业务调用。
6. MCP 列表新增需使缓存失效且不扩大授权；凭据/配置变化必须使旧会话失效；用真实上游 Schema，不手写伪响应。
7. 安装可重启、可幂等、保留原配置；依赖持久目录。不得提交测试私钥、API key、OAuth token、完整环境变量或含凭据 URL。
8. 发生失败先保存原始失败证据，局部修复后只跑受影响路径和必要构建/集成检查，不为通过而删断言、降级版本条件或改网络。

本地 Agent 回传文件建议：

```text
LOCAL-ACCEPTANCE.md          # 每个 L/A/B/U 编号的状态、原因、下一步
LOCAL-ACCEPTANCE.json        # 结构化逐项结果
evidence/                   # 脱敏 stdout/stderr、配置结构、回执、截图（如需）
fixes.patch 或开发分支提交     # 有修复才提供，不携带凭据/大依赖
```

每条结构化记录：

```json
{
  "id": "L02",
  "status": "BLOCKED",
  "commit": "实际 git rev-parse HEAD",
  "environment": {"os": "Windows 11", "node": "实际版本"},
  "command": "npm run check:next -- regressions",
  "exitCode": null,
  "expected": "超时后子孙进程结束，标记文件停止增长",
  "actual": "尚未在 Windows 原生 Node 执行",
  "evidence": [],
  "blocker": "需要 Windows 原生 Node 24 和 PowerShell 7",
  "nextAction": "准备环境后执行 L02"
}
```

最终验收结论分开写：①用户实际平台与客户端是否可用；②两个 EVM 工作站的已实现范围是否通过；③全生态尚缺哪些服务/功能。A/B/U 表中未关闭的项必须保留在总表，不能因为核心通过就写“全生态完成”。

可直接给本地 Agent 的指令：

> 按本文获取指定分支并记录 HEAD。优先完成 L01/L02/L03，按条件执行 A/B 表的真实路径，U 表只确认边界或另列开发缺口。每项保存证据和状态，缺条件明确 BLOCKED。遇到真实缺陷局部修复、局部复测并回传提交；不删除断言、不伪造外部服务、不自动重试未知交易、不发布或合并。返回验收表、原始证据索引和仍需用户提供的最小条件。

## 6. 对照资料

- 仓库完整历史范围：`tasks/S2-progress.md`、`docs/acceptance/2026-10-23.md`、`docs/acceptance/2026-10-24.md`。
- 工具准确入参：`node dist/cli/main.js tools <name>`；服务模板：`examples/services/`；平台安装细节：`docs/guides/setup.md`。
- Hardhat 官方本地编译器配置：<https://hardhat.org/docs/cookbook/custom-solidity-compiler>
- Hardhat 官方 Solidity 测试：<https://hardhat.org/docs/guides/testing/using-solidity>
- Slither 官方 JSON 状态定义：<https://github.com/crytic/slither/wiki/JSON-output>

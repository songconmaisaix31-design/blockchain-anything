# Windows 可用性验证与修复

日期：2026-10-29。用户要求测试 Windows 系统可用性并修复发现的问题。

## 基线与范围

- 分支：`codex/bca-ecosystem`，起始提交：`41942002768803b3a56ac1204e58d0f51facbfee`；工作区初始无未提交修改。
- 环境：Windows 11 家庭版 64 位，系统版本 `10.0.26200`，PowerShell 7.6.9，Node.js 24.16.0，npm 11.13.0。
- 验证当前已实现的 CLI、SDK、MCP、EAS/EVM、CID/Kubo 和本机开发工具；使用真实文件、官方 SDK、Anvil 与离线 Kubo。
- 主 Agent 单独负责代码、检查、文档、提交和推送；一个继承当前会话配置的只读子 Agent 检查 Windows 路径、子进程和配置。未启动并行开发轨道。
- 使用 Local Codex 桌面客户端；未切换模型，精确模型发布标识不可核实。

## 执行步骤

1. 读取交接、状态、规格与开发任务，运行现有类型、构建、桥接和真实 smoke 检查。
2. 复现路径边界、环境变量大小写和配置更新问题，在原模块修复并保留必要回归检查。
3. 执行本机 Forge/Cast、solc 与 Skills 的真实操作，记录缺失组件或失败原因。
4. 更新实际验证结果与剩余限制，检查差异，提交并推送当前分支。

## 原开发分支验收记录

以下结果对应 `codex/bca-ecosystem` 的 `3a746f7`，记录其实际依赖和 54 个工具；主线合并后的版本与结果单独记录在下节。

| 验证 | 结果 |
| --- | --- |
| `npm run typecheck`、`npm run build` | 通过 |
| `npm run check:bridge` | 真实 stdio/HTTP、54 个工具、CID、上游错误、同长度配置更新、环境重新展开通过 |
| `npm run smoke -- --scope onchain,core,interfaces` | EAS 生命周期、签名与篡改拒绝、CLI/MCP 通过；chain ID 31337 |
| `npm run smoke -- --scope ipfs,package` | Kubo 0.43.1 离线存取逐字节一致，真实打包安装与入口通过 |
| `npm run smoke -- --scope development` | solc 0.7.3 编译、Cast 四项只读调用、viem 六项调用及 Counter 从 0 到 1 通过 |
| `npm run smoke -- --scope windows,package` | 中文/空格路径、junction 拒绝、技能根目录 junction、环境隔离和修复后打包入口通过 |
| `node dist/cli/main.js call dev_forge_build --input '{"dir":"examples/contracts","timeoutMs":120000}'` | Solidity 0.7.6 真实构建成功 |
| `node dist/cli/main.js call dev_forge_test --input '{"dir":"examples/contracts","offline":true}'` | `CounterTest.testIncrement` 为 `Success` |
| `node dist/cli/main.js call dev_hardhat_compile --input '{"dir":".work/hardhat-check","timeoutMs":120000}'` | 本地 Hardhat 2.22.4 编译实际 Counter 源码成功 |
| `node dist/cli/main.js call dev_slither_analyze --input '{"target":"examples/contracts","timeoutMs":120000}'` | 在隔离 Python 3.12.13 环境运行 Slither 0.11.6，`success:true`；两项版本信息提示，原始退出码 `4294967295` |

Slither 使用 `.work/windows-tools/Scripts` 加入当前进程 PATH。Hardhat 验证项目在忽略的 `.work/hardhat-check`，使用仓库实际 Counter 源码和本地 Hardhat 依赖，编译器由 Hardhat 正常下载。

本轮实际输入为 README 的 6984 字节，raw CID 为 `bafkreifuslw25z7cctxjyf6jeh7pnfoeiwu7vk6fxspesbwof4qt7nnkeq`；Kubo UnixFS CID 为 `bafybeieb5jn5trcncklmil6fkxmdecguk3zihqvwqlnbt3ocwlyrnc6cgu`。服务仅绑定 loopback，已终止本次创建的 Anvil/Kubo 进程。

修复后的实现会按 Windows 名称大小写规则删除子进程敏感环境变量；Solidity import 和技能文件读取使用真实路径限制；MCP 每次读取配置并展开当前环境。回归使用真实文件、junction、Node 子进程和官方 MCP 服务。

Slither 的两项 `solc-version` 提示属于该分支的实际结果。Windows ARM64、Windows PowerShell 5.1、外部 MCP 供应商、公网写入、生产交易和原生 Codex 审计未在该轮验证，npm 公开发布未执行。

## 主线合并

2026-10-29 用户授权修复完整后合入 `main`。合并基线为 `b3ac02c`，Windows 来源提交为 `3a746f7`；保留主线 1.0.0、Node 22/24、solc 0.8.35、安装与依赖修复，以及已有生态接入和实际验收记录。

主 Agent 负责合并和验证，一个只读子 Agent 核查与主线的代码兼容性。敏感变量过滤同时覆盖通用 BCA 凭据名称；Solidity 保留 node_modules 导入、source map、文件大小限制并立即拒绝越界；MCP 检查保留主线只读许可和会话关闭接口。

主线合并后的实际验证：

| 命令 | 结果 |
| --- | --- |
| `npm ci --ignore-scripts --no-audit --no-fund --prefer-offline --registry=https://registry.npmjs.org` | 按主线锁文件安装 922 个包成功 |
| `npm run typecheck`、`npm run build` | 通过 |
| `npm run smoke -- --scope windows,development,interfaces` | Windows 路径与全部敏感名称大小写隔离通过；solc 0.8.35 编译、真实 Anvil Cast/viem、125 个工具的 CLI/MCP 入口通过 |
| `npm run check:bridge` | 125 个工具，真实 stdio/HTTP、同长度配置更新和环境重新展开通过 |
| `npm run check:sessions` | 官方 OpenZeppelin MCP 的 ERC20 调用、会话复用、凭据变更失效、断开与显式重连通过 |
| `npm run check:s2` | 真实离线 SDK 的 VC 签名与篡改拒绝、DID、Sui、x402、CCXT、Arweave、GAME 和 eliza 检查通过 |
| `node dist/cli/main.js call dev_solidity_compile --input '{"path":"examples/contracts/src/ExampleToken.sol"}'` | solc 0.8.35 成功解析实际 OpenZeppelin 依赖并编译 ExampleToken |
| `tsc --noEmit --target ES2023 --module NodeNext --moduleResolution NodeNext --strict --skipLibCheck --esModuleInterop scripts/smoke.ts scripts/check-bridge.ts` | 验证脚本类型检查通过 |
| `git diff --cached --check` | 通过 |

本轮主线使用的 README raw CID 为 `bafkreietii5tnc6hj2xwj7nyyhzc7zbio2kie3ky37evjdx4375m3i335a`。本次 Anvil 进程已终止。源码及锁文件保留在原工作区；前轮两份可重建的安装副本保留在 `D:/bca-windows-validation-3a746f7/smoke-cQ7OC1` 与 `D:/bca-windows-validation-3a746f7/smoke-NzZmEC`，相应 `.work` 目录中的包文件与日志保留。

本轮未重新执行完整 setup 安装矩阵、其他系统版本、客户端 UI、账户型服务或公共链写入；上游依赖剩余告警继续由 issue #6 跟踪。公开发布与生产交易未执行。

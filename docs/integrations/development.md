# 开发工具

更新日期：2026-10-29。实现位于 `src/development/`，全部使用真实本机 CLI 或官方编译器，不提供任意 shell 执行器。

## 工具

| 工具 | 作用 | 边界 |
| --- | --- | --- |
| `dev_status` | 检测 Forge/Cast/Anvil/Slither/Hardhat 与 solc | 不安装、不联网 |
| `dev_solidity_compile` | 用本机 solc 编译工作根目录内的 `.sol` | 当前安装版本 0.7.3；import 限定在 `BCA_WORKING_ROOT` |
| `dev_forge_build` | `forge build --json` | 项目目录限定在工作根目录；可 `offline` |
| `dev_forge_test` | `forge test --json` | 同上；可 `matchPath` |
| `dev_hardhat_compile` | 项目本地 `node_modules/hardhat` 的 `compile` | 不安装依赖、不替换编译器 |
| `dev_slither_analyze` | `slither <target> --json -` | 需要本机安装 Slither |
| `dev_cast_chain_id` | `cast chain-id` 并核对 `BCA_CHAIN_ID` | 使用配置的 RPC |
| `dev_cast_block_number` | `cast block-number` | 使用配置的 RPC |
| `dev_cast_balance` | `cast balance` | 返回 wei 字符串 |
| `dev_cast_call` | `cast call ... --json` | 只读；函数签名和参数由 Schema 限制 |
| `dev_skill_list` | 递归发现 `BCA_SKILLS_ROOT`（默认 `~/.agents/skills`）下的 `SKILL.md` | 不解析、不改写技能 |
| `dev_skill_read` | 读取指定技能的 `SKILL.md` | 只允许技能目录名，拒绝路径穿越 |

子进程使用固定命令与参数，`shell:false`，超时与输出上限可配；默认不把 `BCA_PRIVATE_KEY` 和 MCP 凭据传给子进程。

敏感环境变量过滤忽略名称大小写。Solidity import 与技能读取在读取前解析真实路径并核对根目录范围；拒绝跨盘符路径与指向根目录外的 junction。技能根目录本身可以是 junction，其实际目标作为读取边界。

## 示例项目

`examples/contracts/` 是一个最小 Foundry 项目：

- `src/Counter.sol` — 离线 solc 可编译的示例。
- `test/Counter.t.sol` — Forge 测试。
- `foundry.toml` — 标准配置。

## 实际验证（2026-10-29）

- `dev_status`：Forge/Cast/Anvil 1.7.1、Hardhat 本地依赖、solc 0.7.3 被正确识别；Slither 位于本轮隔离的 Python 环境。
- `dev_solidity_compile` 编译 `Counter.sol` 成功，返回 ABI 与 bytecode，无诊断。
- `dev_skill_list` / `dev_skill_read` 读取本机 `~/.agents/skills` 成功。
- `dev_forge_build` 使用 Solidity 0.7.6 实际编译成功；`dev_forge_test` 离线运行 `CounterTest.testIncrement` 成功。
- `dev_cast_*` 的 chain ID、区块号、余额和只读合约调用均在真实 Anvil 上通过。
- `dev_hardhat_compile` 通过本地 Hardhat 2.22.4 编译实际 Counter 源码，使用正常下载的 Solidity 0.7.6。
- Slither 0.11.6 安装于 `.work/windows-tools`；把其 `Scripts` 加入当前进程 PATH 后，`dev_slither_analyze` 对 Foundry 示例完成真实分析，返回 `success:true`、两项 `solc-version` 信息提示及原始非零退出码 `4294967295`。结果没有删除发现项。

```powershell
$env:PATH = (Join-Path (Get-Location) '.work/windows-tools/Scripts') + [IO.Path]::PathSeparator + $env:PATH
node dist/cli/main.js call dev_slither_analyze --input '{"target":"examples/contracts","timeoutMs":120000}'
```

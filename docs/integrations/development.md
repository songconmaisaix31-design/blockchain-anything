# 开发工具

更新日期：2026-10-23。实现位于 `src/development/`，全部使用真实本机 CLI 或官方编译器，不提供任意 shell 执行器。

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

## 示例项目

`examples/contracts/` 是一个最小 Foundry 项目：

- `src/Counter.sol` — 离线 solc 可编译的示例。
- `test/Counter.t.sol` — Forge 测试。
- `foundry.toml` — 标准配置。

## 实际验证（2026-10-23）

- `dev_status`：Forge/Cast/Anvil 1.7.1、Hardhat 本地依赖、solc 0.7.3 被正确识别；Slither 未安装返回 `null`。
- `dev_solidity_compile` 编译 `Counter.sol` 成功，返回 ABI 与 bytecode，无诊断。
- `dev_skill_list` / `dev_skill_read` 读取本机 `~/.agents/skills` 成功。
- `dev_forge_build`（`offline:true`）真实返回失败：本机没有与 `^0.7.0` 匹配的 solc；网络被代理阻断，Forge 无法自动下载编译器。这是环境限制，工具没有伪造成功。
- `dev_cast_*` 已按固定参数实现；本机 DSH 会话对 Anvil 的 TCP 连接返回 `EADDRINUSE`（curl 可连），因此 Cast 调用尚未在本会话复测。该限制不影响普通终端中的 Cast。
- Slither 未安装，`dev_slither_analyze` 会明确失败并提示安装。

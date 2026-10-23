# 合约开发与官方 Skills

开发入口直接运行本机成熟工具，不提供通用 shell 执行器。

| 工具 | 上游 / 行为 |
| --- | --- |
| dev_status | 检测 Forge/Cast/Anvil/Slither/Hardhat 与 solc |
| dev_solidity_compile | solc 0.8.35，返回 ABI/bytecode/官方诊断；import 限工作根目录及其 node_modules |
| dev_forge_build / dev_forge_test | forge build/test --json；支持 offline、matchPath |
| dev_hardhat_compile | 读取项目已安装 Hardhat 的 package.json bin，兼容不同 CLI 布局 |
| dev_slither_analyze | slither --json -；保留 findings 和退出码，可设 BCA_SOLC_PATH |
| dev_cast_chain_id/block_number/balance/call | 官方 Cast 只读操作；核对 RPC chain ID |
| dev_skill_list / dev_skill_read | 读取实际安装的 SKILL.md，限制读取大小与目录边界 |

Forge/Cast 优先使用已安装的官方平台二进制，避免 Foundry npm 1.7.1 启动脚本丢失失败退出码。其他情况使用 PATH 中的本机程序。进程采用固定参数、shell=false、超时和输出上限。开发工具会执行项目配置、构建或分析命令，应只用于操作者信任的项目；文件边界检查不是进程沙箱。

`examples/contracts/` 包含 Counter 与引用 OpenZeppelin ERC20 的 ExampleToken。离线 solc 编译 ExampleToken、Forge Counter 测试已通过。Slither 对 Counter 的真实分析成功并返回一个 solc-version 提示，保留 exitCode=255 和原始 detector，未把它当成无问题报告。Hardhat 适配已实现，本轮没有安装独立 Hardhat 项目做编译验收。

## Skills 安装与读取

安装复用 [skills CLI](https://github.com/vercel-labs/skills)，BCA 只读取原文件。先选定需要的官方技能，再在操作者指定的工作目录安装，例如：

```sh
npx --yes skills@1.7.4 add https://github.com/OpenZeppelin/openzeppelin-skills --skill setup-solidity-contracts --agent codex --copy -y
BCA_SKILLS_ROOT=.agents/skills node dist/cli/main.js call dev_skill_list --input '{}'
BCA_SKILLS_ROOT=.agents/skills node dist/cli/main.js call dev_skill_read --input '{"name":"setup-solidity-contracts"}'
```

默认根目录是 ~/.agents/skills；项目安装时显式设置 BCA_SKILLS_ROOT。`--copy` 让内容位于所选根目录内。外部符号链接不会作为可读取技能放行；BCA 不改写技能中的安装、授权和检查要求。

| 来源 | 原生接入方式 | 验证范围 |
| --- | --- | --- |
| [OpenZeppelin](https://github.com/OpenZeppelin/openzeppelin-skills) | 上述 skills CLI | 本轮安装并读取 setup-solidity-contracts |
| [Trail of Bits](https://github.com/trailofbits/skills) | skills CLI 或其官方插件安装 | 通用读取入口就绪，未运行完整审计工作流 |
| [Alchemy](https://www.alchemy.com/docs/build-with-ai) | skills add alchemyplatform/skills | 未执行账户相关操作 |
| [Uniswap](https://developers.uniswap.org/docs/uniswap-ai/skills) | 官方 Uniswap AI installer / Skills | 按官方安装后指向根目录；未执行兑换/部署 |
| [GoPlus](https://github.com/GoPlusSecurity/goplus-mcp) | 官方 MCP 与技能安装说明 | MCP 配置就绪；Skills 源与实际安装仍待核实 |
| [Allium](https://docs.allium.so/ai/mcp/overview) | bridge_call 调用原生 get_skill | 待服务凭据 |
| [Heurist](https://github.com/heurist-network/heurist-mesh-skill) | 官方仓库 Skill，skills CLI 安装 | 读取入口就绪，Mesh 服务需 key |

技能读取和工作流执行分别验收，不将“目录中出现一个 SKILL.md”当作交易或审计流程已通过。

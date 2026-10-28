# BCA 当前状态

更新日期：2026-10-29。当前分支 `codex/bca-ecosystem`，提供 54 个工具。Windows 11 上的真实验证和局部修复已完成，详细记录见 [Windows 验证任务](tasks/windows-availability.md)。

## Windows 验证

环境：Windows 11 64 位 `10.0.26200`、PowerShell 7.6.9、Node.js 24.16.0、npm 11.13.0、Forge/Cast/Anvil 1.7.1、Kubo 0.43.1。

| 命令或操作 | 实际结果 |
| --- | --- |
| `npm run typecheck`、`npm run build` | 通过 |
| `npm run check:bridge` | 54 个工具；真实 stdio 与 Streamable HTTP 调用、错误传播、同长度配置修改、环境变量重新展开通过 |
| `npm run smoke -- --scope onchain,core,interfaces` | 真实 EAS 注册、声明、读取、撤销；个人消息与链下签名、篡改拒绝；CLI 和 MCP 通过 |
| `npm run smoke -- --scope ipfs,package` | Kubo 离线 add/read 逐字节一致；真实 npm 包安装后 CLI/MCP 通过 |
| `npm run smoke -- --scope development` | solc 编译、真实 Anvil Counter 部署和递增、Cast 四个工具、viem 六个工具通过 |
| `npm run smoke -- --scope windows,package` | 中文/空格路径、junction 边界、混合大小写环境变量隔离；修复后的包入口通过 |
| `dev_forge_build`、`dev_forge_test` | 真实 Solidity 0.7.6 编译和 `CounterTest.testIncrement` 通过 |
| `dev_hardhat_compile` | 本地 Hardhat 2.22.4 使用 0.7.6 编译实际 Counter 源码成功 |
| `dev_slither_analyze` | Slither 0.11.6 返回 `success:true`，保留两项 `solc-version` 信息提示及原始退出码 `4294967295` |
| `dev_skill_list` / `dev_skill_read` | 本机技能发现、读取及目录边界检查通过 |

本轮修复：开发工具对子进程的敏感环境变量过滤忽略名称大小写；Solidity import 和技能读取核对真实路径、拒绝跨盘符与 junction 越界；MCP 每次读取当前配置并展开当前环境变量。

## S2 进度

| 内容 | 状态 |
| --- | --- |
| S1：EAS/EVM、CID/Kubo | 20 个工具，真实本地验证通过 |
| MCP 桥接 | 6 个工具，真实 stdio/Streamable HTTP 验证通过 |
| 开发工具 | 12 个工具；本机 Forge、Cast、Hardhat、Slither、solc 和 Skills 已运行 |
| viem 与 EAS 扩展 | 6 个 viem 工具与 10 个 EAS 扩展；EAS 批量、时间戳、Delegated、PrivateData 的已有实际结果见 [S2 进度](tasks/S2-progress.md) |
| 外部 MCP 供应商真实调用 | 未完成；Alchemy 手机验证仍需用户完成 |
| Sign/SAS/Sui/Aptos/Walrus/Seal/Arweave、来源/身份、钱包/Agent | 未开始 |
| main 合并 | 未执行；Windows 修复保留在当前开发分支 |

## 真实限制与未执行操作

- Slither 安装在隔离环境 `.work/windows-tools`，使用时需将其 `Scripts` 加入当前进程 PATH；示例采用的 Solidity 0.7.x 有两项版本信息提示。
- Hardhat 实测版本为本机安装的 2.22.4；Windows 验证限定本机 Windows 11、PowerShell 7 和 Node.js 24，未验证 Windows ARM64、Windows PowerShell 5.1 或其他系统版本。
- npm 和 GitHub 本次均可连接；外部 MCP 供应商未在本轮重新验证，不能据此判定供应商调用可用。
- 公共测试网写入、生产交易、npm 公开发布和原生 Codex 控制器审计未执行；包保持 `private: true`。

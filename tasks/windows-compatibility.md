# Windows 适配验证

日期：2026-10-25。用户要求测试公开仓库的 Windows 适配性。基线为 main 的 `ff807f434f5132b0bc044bb0460b07de5b091500`，原工作区干净。

## 分工

| 轨道 | Agent / Worktree / Branch | write_paths |
| --- | --- | --- |
| 实际运行和最终检查 | 当前 Codex / 当前工作区 / `codex/windows-compatibility` | `.work/`、本文件、`docs/acceptance/2026-10-25-windows.md`、必要的当前状态说明 |
| 独立兼容性审查 | Codex 子 Agent `windows_audit` / `C:/Users/DW/orca/workspaces/blockchain-anything/bca-windows-audit` / `bca-windows-audit` | 独立 Worktree 的 `.work/`；业务源码只读，发现提交 Handoff |

当前会话模型由宿主继承，未指定其他模型。没有并行业务开发。审查轨道不修改源码，不运行原生 Agent 模型任务、不读取凭据、不执行公共链交易。

## 实际验证范围

1. 核对 Node/npm/PowerShell/Windows 版本，安装 lockfile 依赖并运行类型和构建检查。
2. 检查既有脚本的实际操作，运行适用的 CLI/MCP、项目初始化和编译测试、进程清理、连接生命周期检查。
3. 在 `.work/` 的隔离项目中验证打包安装、配置、Windows 路径和本地链；只执行已授权的本地操作。
4. 按结果区分产品问题、检查脚本问题、环境缺项；报告具体命令和实际结果。原生控制器审计、需要账户的服务和未运行的平台单独标记。

报告以实际执行结果为准。测试请求不扩大为生态开发；发现的问题保留可重现证据，必要修复按任务现有授权和互斥文件范围处理。

## 执行记录

独立审查已完成并 Handoff，源码未改动，无需代码集成。主轨道实测结果及未通过项目集中在 [Windows 报告](../docs/acceptance/2026-10-25-windows.md)，同时更新 README、HANDOFF、STATUS 和安装指引中的当前平台状态。报告通过同一审查 Agent 的只读复核。

官方 registry 下的真实 tarball 持久安装、安装后的 CLI/MCP、重复 setup 和 Counter 创建/编译/测试均通过。默认 checkout 安装及其他已复现问题保留失败状态。源码、依赖清单和 lockfile 未修改；本次提交交付测试报告及相关文档。

实测客户端为当前 Codex 会话和继承宿主模型的 `windows_audit` 子 Agent；Orca CLI 1.4.230 创建审查 Worktree。没有另外启动开发客户端或执行原生模型验证任务。测试使用 PowerShell 7.6.6、Node 24.16.0，程序和 SDK 版本见报告。

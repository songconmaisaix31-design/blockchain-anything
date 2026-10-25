# REA 产品结构参考

核查日期：2026-10-23。参考 [morluto/rea](https://github.com/morluto/rea)，读取基准 Commit 为 `9eb829aca34be36ff112826337996f6139f82eff`。该 Commit 的 `package.json` 标记版本 `6.7.0`；这项观察只描述源码版本。

## 已读取的依据

完整读取仓库 README、`package.json` 和 LICENSE，检索源码与文档目录，并读取下列设计及入口中与本任务相关的内容：

- [README](https://github.com/morluto/rea/blob/9eb829aca34be36ff112826337996f6139f82eff/README.md)：安装、Agent 入口、CLI、实际案例和能力说明。
- [架构图源文件](https://github.com/morluto/rea/blob/9eb829aca34be36ff112826337996f6139f82eff/docs/architecture.mermaid)：入口、业务、领域、适配和组合层。
- [工具设计](https://github.com/morluto/rea/blob/9eb829aca34be36ff112826337996f6139f82eff/docs/tool-design.md)：工具按用户问题组织，输入严格校验，结果呈现能力和限制。
- [CLI 文档](https://github.com/morluto/rea/blob/9eb829aca34be36ff112826337996f6139f82eff/docs/cli.md)：CLI 与 MCP 使用相同业务工作流；CLI 每次调用独立。
- [MCP 合约文档](https://github.com/morluto/rea/blob/9eb829aca34be36ff112826337996f6139f82eff/docs/mcp-contracts.md)：结构化结果、错误、能力发现及 stdio/HTTP 传输。
- [CLI 入口](https://github.com/morluto/rea/blob/9eb829aca34be36ff112826337996f6139f82eff/src/cli.ts)和 [MCP 服务入口](https://github.com/morluto/rea/blob/9eb829aca34be36ff112826337996f6139f82eff/src/server/createServer.ts)：领域功能分组注册、依赖注入和共享服务。
- [依赖与发布入口](https://github.com/morluto/rea/blob/9eb829aca34be36ff112826337996f6139f82eff/package.json)：Incur、官方 MCP client/server、Zod、成熟格式库，两个可执行入口。

## BCA 的对应设计

| REA 的可观察产品结构 | BCA 的设计建议 |
| --- | --- |
| 一个安装包，提供终端和 Agent 入口 | 一个包提供 `bca`、`bca mcp` 和 SDK exports |
| `setup`、`doctor`、配套 Skill | 配置预览、能力检查、按任务组织的使用说明 |
| CLI/MCP 共用 application 层 | 共用同一个 SDK 工具目录与执行函数 |
| 各种分析引擎通过 provider 接入 | 官方 EAS、ethers、CID 和 IPFS 客户端分别适配 |
| 结构化结果附带事实、覆盖范围和限制 | 返回实际 UID、CID、chain ID、回执和已执行检查的范围 |
| 按实际后端能力声明支持范围 | 指定网络、合约版本和操作能力；缺失能力明确失败 |
| 任务指南和已验证案例帮助 Agent 选择工具 | 内容寻址、Schema 编码、声明发布、查询和撤销的指南 |

当前实现采用共享工具目录与 SDK 适配结构，保留底层协议的原生标识。REA 的原生引擎、逆向解析器和调查记录设施没有被引入仓库。BCA 的内容摘要使用现有 CID 与密码学库。

REA 的 MIT 许可证允许在遵循其条件时复用代码。本轮只参考结构和公开接口，未复制其实现。将来如需复用源码，逐项评估与 BCA 的业务适配并保留版权及第三方许可。

## v1 对标更新（2026-10-25）

本轮读取 REA Commit [`8e6a95788688439baeeec8e54c9b3e845226f79d`](https://github.com/morluto/rea/tree/8e6a95788688439baeeec8e54c9b3e845226f79d) 的 README、工具设计与安装文档相关部分，取其可直接改善 BCA 使用体验的入口：

- setup 同时准备 MCP 和客户端可自动读取的工作流指引。
- 问题可以检索完整工具目录，再按需查看 Schema、补全参数和调用。
- 新项目从创建、编译、测试起步；已有项目沿用原工具。
- 上游 MCP 的新工具通过实时发现接入，沿用原 Schema 和授权边界。

本轮只增加这些实际入口，复用现有适配和执行器，没有引入新的调度器、数据存储、评分或审计框架。

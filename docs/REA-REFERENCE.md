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
| CLI/MCP 共用 application 层 | 签署、验证、提交、撤销和组合逻辑只实现一次 |
| 各种分析引擎通过 provider 接入 | 声明服务、链、存储、签署器、身份与 ZK 验证器分别适配 |
| 结构化结果附带事实、覆盖范围和限制 | 验证报告分项说明完整性、签名、状态、授权、最终性与可用性 |
| 按实际后端能力声明支持范围 | 指定网络、合约版本和操作能力；缺失能力明确失败 |
| 任务指南和已验证案例帮助 Agent 选择工具 | 登记对象、签署执行声明、撤销授权、核验组合关系的指南 |

上述映射是 BCA 的设计推导。REA 的原生引擎、逆向解析器和调查记录设施没有被引入仓库。BCA 的业务内容摘要采用现有 CID 和密码学库。只维护协议所需的对象、声明、授权与链上回执，不增加开发过程的完成证明系统。

REA 的 MIT 许可证允许在遵循其条件时复用代码。本轮只参考结构和公开接口，未复制其实现。将来如需复用源码，逐项评估与 BCA 的业务适配并保留版权及第三方许可。

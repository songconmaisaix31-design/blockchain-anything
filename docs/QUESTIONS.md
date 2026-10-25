# 用户决定

更新日期：2026-10-25。

用户已阅读本文件并明确回复“审批通过”“开始开发”。同一条消息确定：尽可能复用已有区块链基础设施，BCA 只做 blockchain 工具聚合；运行发现错误后局部修改、局部测试，只做够用的测试。以下决定按这次指令执行。

| 编号 | 已确认决定 |
| --- | --- |
| D01 | 名称 BCA（Blockchain-Anything），Slogan 为 `Tokenize nothing, attest everything.` |
| D02 | 参考 [morluto/rea](https://github.com/morluto/rea) 的产品入口和适配结构 |
| D03 | TypeScript、Node.js 24、单一 npm 包；Incur CLI 与官方 MCP SDK 共用工具实现 |
| D04 | 通过官方 EAS SDK 接入 EAS/EVM；使用 ethers、multiformats 和 IPFS Kubo RPC 客户端 |
| D05 | 身份、签名、声明、撤销和授权遵循所接协议；保留原生标识，不建设自有协议层 |
| D06 | README 覆盖为工具聚合定位；同步更新规格、开发要求和状态 |
| D07 | 开发、实际运行、必要验证、提交和推送已授权；远程为 `songconmaisaix31-design/blockchain-anything` |
| D08 | 只做够用的测试；错误在发生位置修复并仅复测相关部分 |
| D09 | 通过 Orca CLI 安排互斥文件范围；Worker 固定分支和 Worktree，负责开发、验证、返修、提交和推送 |
| D10 | 接入用户补充的完整生态清单，真实验证通过后合并主线；S2 记录逐项完成状态 |
| D11 | 可使用 OpenCode 与 DeepSeek 官方 Flash 模型承担开发工作，不使用 Alibaba 路由 |
| D12 | 使用本机浏览器登录态及 Google 账户完成官方登录和服务验证 |
| D13 | 审阅并删减无法推进真实任务的过度工程化，继续按够用验证、局部修复的规则开发，优先精简和易用 |

## 操作边界

- 本地真实 EVM 执行器可以部署官方 EAS 合约，测试实际交易、签名和撤销。
- 公共测试网采用 Base Sepolia；没有测试钱包和余额时保留未执行状态，本地结果不替代公共网络验收。
- 包名暂用本地项目名 `blockchain-anything`，保持 `private: true`；没有执行 npm 公开发布。
- 不读取或发布实际用户私密作品、API 凭证和生产密钥，不执行生产交易。
- 原生 Codex 事件审计属于单独的控制器集成验证。若执行，继续遵守真实 SQLite、实际 HTTP、原生会话文件、逐一核对 event_id 和关闭原生文件/命令工具规则；普通 MCP SDK 检查不冒充该结果。

本轮实现不再等待方案审批。新的生产部署、付费服务或公开发布操作按具体结果另行处理。

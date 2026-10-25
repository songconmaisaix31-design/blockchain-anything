# BCA 工具聚合规格

更新日期：2026-10-25。授权与范围见 [QUESTIONS.md](QUESTIONS.md)。

## 产品边界

BCA 将成熟区块链 SDK 的常用操作提供给 CLI、MCP 和 TypeScript 调用者。实现范围是参数校验、配置读取、SDK 适配、结果序列化和错误传播。网络、账户、声明、内容和撤销使用原协议语义。

- 对象内容使用标准 CID；声明使用 EAS UID；身份使用原生链账户。
- 版本和组合关系通过 EAS Schema 字段及 `refUID` 表达。验证结论以具体声明、签名和链状态为限。
- 文件哈希说明内容一致，签名说明签署账户，链上记录说明交易与状态。关于来源、质量和实体身份的陈述需要调用者判断可信度。
- API 凭证只允许保存描述和外部密钥引用，不将秘密写入声明或公开存储。
- S2 扩展到 Sui、Aptos、Solana/SAS 与 Sign Protocol，沿用各 SDK 的原生语义；自有身份、授权、Hash 和智能合约系统不属于工具聚合实现。

## 成熟组件

Node.js 24、TypeScript ESM、Incur、官方 MCP TypeScript SDK、EAS 官方 SDK、ethers v6、multiformats、kubo-rpc-client、Zod。固定实际依赖版本并提交 lockfile。运行 API 以安装版本的官方说明和类型声明为准。

## 必要操作

工具采用 `<family>_<operation>` 名称；每项有说明、严格输入 Schema、读写标记和执行函数。

| 工具组 | 操作 | 返回与边界 |
| --- | --- | --- |
| EVM | 网络/区块、原生币余额、交易回执、个人消息签名验证 | 保留 chain ID、区块/交易哈希、地址和状态；金额使用十进制字符串 |
| EAS Schema | 编码、解码、查询、注册 | 官方 SchemaEncoder/SchemaRegistry，不自写 ABI parser |
| EAS 声明 | 发布、读取、撤销、链下签署与验证 | 原生 UID、交易哈希/回执；有效期、recipient、refUID 沿用 EAS 语义 |
| 内容 | 实际文件 CID、CID 解析 | raw CID 使用文件原字节；与 UnixFS 根 CID 分开标记 |
| IPFS | 添加实际文件、读取内容 | add 使用原生 UnixFS 语义，返回节点 CID；读取限制最大字节数 |
| 发现 | 工具目录、配置状态、必要连接检查 | 区分已实现、已配置和连接已验证；缺配置时实际调用立即失败 |

公共 API 不接收私钥。签署从进程显式配置读取，输出、错误和日志不得包含秘密。环境变量签署仅面向受控本地开发；生产签署器需接入成熟钱包或密钥设施。

链下验证只报告已执行的签名和签名域检查；没有检查撤销、时间戳和信任时不得声称整份声明可信。个人消息验证限定 EOA 恢复语义，不冒充 EIP-1271 验证。

## 配置和交易

- 进程配置 RPC、预期 chain ID、EAS/SchemaRegistry 地址；实际调用核对 chain ID 和合约代码，不匹配立即失败。
- Base Sepolia 部署地址从 EAS 官方来源确认；本地链明确提供实际部署地址。禁止默认主网测试。
- 写入需进程开启写入能力、签署器配置和调用参数的提交意图。未配置时保留查询能力并明确报告写入不可用。
- 使用 SDK 构造和提交交易，等待明确回执。未知提交结果后不自动重试业务写入；错误保留已有交易哈希供查询。
- 工具说明注明公开链上字段和 IPFS add 的内容传输效果。
- 文件路径限定在配置的工作根目录，拒绝越界和符号链接逃逸；不提供任意命令执行。
- 服务 URL 来自操作者配置，工具调用者不能传入任意 URL。

## 入口和结构

`src/toolkit.ts` 导出 `createToolkit()`。共享工具目录和 `invoke(name, input)`，实现分布于 providers、bridge、development、chains、storage、wallets、agents、trading、provenance、identity。目录只列实际实现操作；配置、真实验证和受信范围另行记录。

CLI 提供 `bca find "问题" --dir <项目>`、`bca tools`、`bca call <name> --input '<JSON>'`、`bca <family> <operation> --input '<JSON>'` 和 `bca mcp`，结构化返回，错误退出码非零。MCP 使用官方 SDK 注册同一工具目录，stdio 的 stdout 只输出协议内容。SDK 导出相同 toolkit。

MCP 服务入口为 stdio，createMcpServer 可交给官方 SDK HTTP handler 托管；外部 MCP 客户端支持 stdio/Streamable HTTP。OAuth 复用 mcp-remote。公开托管 HTTP 服务、多租户、权限发行、跨链桥、全球信誉和自研通用 ZK 不属于本轮工具包范围。

S2 来源验证调用官方 CLI 或 verifier ABI；钱包使用 Safe/x402；Agent 框架提供兼容入口，不实现上层任务循环。详细支持边界见 integrations 与 tasks/S2-progress.md。默认不结算支付、不下单、不部署公共链合约。

## 验证和交付

一次类型/构建检查和真实操作检查；发现错误后只修复、复测相关部分。保留一个真实 smoke 入口，不建设大型测试框架、覆盖率指标和模拟服务。

检查实际文件 CID；真实 EVM 上官方 EAS Schema 注册、声明、查询、撤销；链下签名及篡改拒绝；CLI 和官方 MCP client 发现/调用；实际 Kubo add/read；打包后入口。真实本地节点结果标明网络，未完成的公共测试网和原生 Codex 验证如实记录。

## 0.3 工作站增量

共享目录携带来源/版本、目标、工作站与影响元数据，`capability_list` 默认返回能力摘要和配置状态，指定 `name` 或 `details:true` 获取完整 Schema。业务结果由实际调用返回，历史验收放在验收文档。`workstation_list/search/guide` 提供可解释的中英文规则匹配，不调用额外模型或向量服务；不支持的任务返回空候选，链/供应商冲突保持歧义。

`setup` 和 `doctor` 通过同一 toolkit 实现；安装产物持久到项目 `.bca`，客户端配置保留其他条目、备份并保持幂等。显式会话由 toolkit 持有，Schema/配置/凭据变化使快照或连接失效，不自动重放业务写入。具体运行与未测范围见 [2026-10-24 验收](acceptance/2026-10-24.md)。

## v1 产品入口

`capability_search` 按问题搜索完整目录，可指定 `server` 查询已配置 MCP 的最新工具。`project_init` 在新目录创建 Counter / OpenZeppelin ERC20；`project_run` 识别 Foundry/Hardhat 并调用已有编译/测试适配。CLI 提供 `find / init / build / test / connect`。

`bridge_configure` 只保存官方预设和凭据环境变量引用，默认配置为项目 `.bca/mcp.json`；现有显式环境配置优先。setup 在所选客户端的 AGENTS.md / CLAUDE.md 添加工作流入口并保留其他文本。包的 prepare 脚本支持 Git 源码安装，继续保持 private。

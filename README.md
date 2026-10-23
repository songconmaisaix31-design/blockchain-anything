# BCA · Blockchain-Anything

**Tokenize nothing, attest everything.**

BCA 是面向开发者和 AI Agent 的区块链工具聚合项目。一个 TypeScript 包，同时提供 CLI、MCP 和 SDK，复用成熟的声明协议、公链客户端和内容存储工具。

文档、数据集、模型、Agent 定义、工作流和事件都可以通过现有协议记录内容摘要、发布声明、引用前序声明及查询撤销状态。BCA 保留原生链账户、EAS UID、交易哈希和 CID，不建设自有链、代币、身份协议或 Hash 格式。

## 已实现的工具

CLI 和 MCP 共用同一份目录与执行函数，提供 **20 个工具**。

| 工具组 | 数量 | 能力 | 复用的基础设施 |
| --- | --- | --- | --- |
| EVM | 5 | 配置状态、网络/区块、余额、回执、EIP-191 消息验签 | ethers |
| EAS | 10 | Schema 编解码/查询/注册、连接检查、声明发布/查询/撤销、链下签名/验签 | EAS 官方 SDK 与官方合约 |
| Content | 2 | 实际文件 CID、CID 解析 | multiformats、CIDv1/raw、SHA-256 |
| IPFS | 3 | 节点状态、文件添加、内容读取 | kubo-rpc-client、Kubo |

文件的 raw CID 与 IPFS UnixFS 根 CID 分别返回。签名和内容摘要各自说明已执行的验证范围；发布者关于来源、质量和现实身份的声明仍需调用者判断可信度。

## 安装与使用

使用 Node.js 24 LTS；当前支持基线为 24.16.0。从仓库源码安装：

```sh
npm ci
npm run build
node dist/cli/main.js tools
node dist/cli/main.js tools content_cid
node dist/cli/main.js content cid --input '{"path":"README.md"}'
node dist/cli/main.js call evm_status --input '{}'
```

JSON 参数示例适用于 Bash 和 PowerShell 7。需要短命令时可运行 `npm link`，随后使用 `bca`。

`bca tools <name>` 返回完整输入 Schema 和读写标记。无网络配置时仍可计算 CID、编解码 Schema、验证个人消息。错误返回非零退出码。

## MCP 与 SDK

三个入口启动相同的官方 MCP stdio 服务：

```sh
node dist/mcp/main.js
node dist/cli/main.js mcp
node dist/cli/main.js --mcp
```

支持 `mcpServers` 格式的客户端可以使用以下配置，将目录替换为本机绝对路径：

```json
{
  "mcpServers": {
    "bca": {
      "command": "node",
      "args": ["C:/projects/blockchain-anything/dist/mcp/main.js"],
      "env": {
        "BCA_WORKING_ROOT": "C:/projects/blockchain-anything",
        "BCA_ALLOW_WRITES": "false"
      }
    }
  }
}
```

在已安装本地包的应用中使用相同的 SDK：

```ts
import { createToolkit } from 'blockchain-anything';

const toolkit = createToolkit();
const result = await toolkit.invoke('content_cid', { path: 'README.md' });
```

完整调用示例见 [使用指南](docs/guides/usage.md)。

## 网络、存储与签署配置

根据 [.env.example](.env.example) 配置实际服务，并显式加载环境文件：

```sh
node --env-file=.env dist/cli/main.js eas status --input '{}'
```

- EVM：`BCA_RPC_URL`、`BCA_CHAIN_ID`。
- EAS：`BCA_EAS_ADDRESS`、`BCA_SCHEMA_REGISTRY_ADDRESS`。
- IPFS：`BCA_IPFS_URL`。
- 文件范围：`BCA_WORKING_ROOT`，并设置文件与读取大小限制。
- 写入：默认关闭；需要 `BCA_ALLOW_WRITES=true` 和调用中的 `submit:true`。EAS 写入及签署还需要受控本地开发签署器。

网络没有隐式默认值。每次链调用核对实际 chain ID，EAS 调用还核对合约代码、Registry 关联与版本。交易只广播一次；等待回执失败时保留交易哈希供查询。

私钥仅从受控本地进程配置读取，不作为 CLI 或 MCP 参数传递。生产钱包和密钥设施尚未接入。链上声明字段公开，IPFS add 会向配置的节点传输文件。详细配置及返回语义见 [适配器指南](docs/guides/providers.md)。

## 开发要求

- 尽可能复用成熟区块链基础设施、官方 SDK 和库。项目代码集中在配置、参数转换、错误传播与入口适配。
- CLI、MCP 与 SDK 共用实现，保留原协议语义和标识。
- 错误在发生位置报告，不返回伪造成功结果，不自动替换后端或重试业务写入。
- 使用真实文件、SDK 和节点，禁止 mock、伪造 API 或虚构原生协议。
- 只做够用的测试：运行必要主路径，发现错误后局部修改、局部复测；保留必要的类型和构建检查。
- 修改文件遵守互斥所有权，使用文件编辑工具；开发、检查、返修和交付由对应 Worker 持续负责。

## 支持边界与项目文档

当前工具覆盖 EAS/EVM、CID 和 Kubo；MCP 传输为 stdio。链下验签明确返回尚未执行的撤销、时间戳、有效期和信任检查。包保持 `private: true`。

实际验证命令、运行环境和未执行事项见 [STATUS](STATUS.md)，按需复测方法见 [运行检查指南](docs/guides/verification.md)。公共测试网写入、生产交易、npm 公开发布及原生 Codex 控制器事件审计分别记录，普通 MCP client 检查不替代原生控制器审计。

- [产品规格](docs/SPEC.md) · [工具与公链资料](docs/TOOLBOX.md)
- [REA 结构参考](docs/REA-REFERENCE.md) · [已审批决定](docs/QUESTIONS.md)
- [开发任务](docs/TASKS.md) · [本轮执行记录](tasks/S1-toolkit.md) · [交接](HANDOFF.md)

## 许可证

[MIT](LICENSE)。第三方组件保留各自的许可和署名。

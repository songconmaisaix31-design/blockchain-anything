# BCA · Blockchain-Anything

**Tokenize nothing, attest everything.**

BCA 把成熟的区块链工具接到统一的 **TypeScript SDK、CLI 和 MCP** 入口。生成合约用 OpenZeppelin，编译测试用 Foundry，安全分析用 Slither，链交互用官方 SDK，数据查询接供应商 MCP，钱包与 Agent 沿用已有框架。

我们只做工具聚合：配置、输入校验、参数转换、结果返回。保留上游 ABI、交易哈希、EAS UID、CID、DID 和证明格式；不建设自有链、代币、钱包、跨链桥或证明协议。

## S2 能力

当前目录有 **104 个工具**，三个入口共用实现。工具数量表示已提供调用入口；逐项真实验证结果见 [S2 接入清单](tasks/S2-progress.md)。

| 工具组 | 数量 | 复用与能力 |
| --- | ---: | --- |
| EVM / viem | 11 | ethers、viem：链、区块、余额、回执、日志、只读合约调用、消息验签 |
| EAS | 20 | 官方 SDK：Schema、声明、撤销、链下签名、批量、delegation、时间戳、PrivateData |
| 内容 / IPFS | 5 | multiformats、Kubo：raw CID、UnixFS add/read |
| 外部 MCP | 7 | 官方 MCP SDK：发现、调用、资源、提示；HTTP / stdio |
| 合约开发 / Skills | 12 | solc 0.8.35、Forge/Cast、Hardhat、Slither、已安装官方 Skills |
| 其他链与声明 | 14 | Sui、Aptos、Solana Kit、SAS、Sign Protocol |
| 存储与隐私 | 7 | Walrus HTTP、Seal SDK、arweave-js |
| 钱包与支付 | 5 | Safe 查询/交易准备、x402 解码/授权验证 |
| 市场与交易服务 | 4 | CCXT 公开行情、Hummingbot 状态 |
| 来源与身份 | 12 | OTS、RISC Zero verifier、Cosign、SLSA、in-toto、C2PA、OpenLineage、did:key、VC-JWT、cheqd |
| Agent 与意图服务 | 7 | AgentKit / Solana Agent Kit actions、Brian、Bankr、Heurist Mesh |

另提供 elizaOS action、官方 GAME Function、OpenAI function schema 和 Python MCP 消费示例，便于 Olas 等上层 Agent 调用 BCA。宿主框架负责模型、任务循环和钱包授权。

## 快速开始

需要 Node.js 24（>=24.16.0，<25）。仓库暂保持 `private: true`，从源码运行：

```sh
npm ci
npm run build
node dist/cli/main.js tools
node dist/cli/main.js tools content_cid
node dist/cli/main.js call content_cid --input '{"path":"README.md"}'
node dist/cli/main.js call dev_solidity_compile --input '{"path":"examples/contracts/src/ExampleToken.sol"}'
```

`tools <name>` 返回完整输入 Schema 与读写标记。也可以运行 `npm link` 后使用 `bca`。参数示例适用于 Bash / PowerShell 7。

配置参考 [.env.example](.env.example)，按需要填入服务。显式加载环境文件：

```sh
node --env-file=.env dist/cli/main.js call eas_status --input '{}'
```

## 接入已有 MCP

公开示例同时连接 CoinGecko 与 OpenZeppelin Contracts MCP：

```sh
BCA_MCP_CONFIG=examples/services/public.json node dist/cli/main.js call bridge_discover --input '{"server":"coingecko"}'
BCA_MCP_CONFIG=examples/services/public.json node dist/cli/main.js call bridge_call --input '{"server":"coingecko","tool":"search_docs","arguments":{"query":"simple price endpoint","language":"typescript"}}'
```

先发现上游工具与 Schema，再按返回值调用。OpenZeppelin 通过固定版本的官方进程运行；首次启动需要下载 npm 包。Dune、Nansen、Allium、thirdweb、Chainstack、GoPlus 和 OAuth 服务的配置见 [服务指南](docs/integrations/services.md) 与 [示例](examples/services/)。

BCA 读取标准 `mcpServers` JSON。HTTP 凭据由操作者配置；OAuth 复用 `mcp-remote`。上游未明确标为只读的工具，需要 `BCA_ALLOW_WRITES=true` 和本次 `submit:true`。

## MCP 与 SDK

```sh
node dist/mcp/main.js
# 等价入口
node dist/cli/main.js mcp
node dist/cli/main.js --mcp
```

MCP 客户端配置：

```json
{
  "mcpServers": {
    "bca": {
      "command": "node",
      "args": ["/absolute/path/blockchain-anything/dist/mcp/main.js"],
      "env": {
        "BCA_WORKING_ROOT": "/absolute/path/blockchain-anything",
        "BCA_ALLOW_WRITES": "false"
      }
    }
  }
}
```

在本地安装此包的应用中：

```ts
import { createToolkit, asFunctionTools } from 'blockchain-anything';

const toolkit = createToolkit();
const result = await toolkit.invoke('content_cid', { path: 'README.md' });
const functions = asFunctionTools(toolkit);
```

## 使用边界

- EVM 操作核对配置的 chain ID；其他链使用明确配置的 RPC。金额和大整数保留字符串，原生协议标识不改写。
- 链写入、签署、上传及可能执行交易的 Agent 调用需要写入开关和 `submit:true`。本地编译/测试会写构建产物；这些开发命令在工作目录内执行。
- 私钥只从受控本地开发环境读取。Safe 入口只准备交易，x402 入口不结算，CCXT 入口只读取公开市场数据。
- CID 表示内容一致，验签表示签名有效，来源工具按其原生报告返回。验证范围、信任、撤销和网络确认分别说明。
- 文件读取拒绝目录越界和符号链接逃逸。配置的 SDK 工厂、Hardhat 配置、Forge 项目与 in-toto layout 都是可执行代码，应由操作者管理。
- 不自动重试业务写入。超时或进程异常可能发生在提交后，应先查询原生交易或任务状态。

## 开发约定

优先使用成熟的官方 SDK、CLI、MCP 与 Skills；适配层保持薄。依赖固定版本并提交 lockfile。只做够用的验证：运行必要路径，出现问题就在对应位置修复、局部复测，不堆测试框架和覆盖率指标。

本轮已实际运行 EAS 生命周期、Kubo 文件往返、CLI/MCP 与打包安装、Safe 官方合约、Hardhat/Cast、Sign/SAS/多链读取、Walrus 测试网上传读回、Seal 加密、RISC Zero 链上验证，以及 Cosign/SLSA/in-toto/C2PA 来源工具。验收发现的 Safe 本地网络配置缺口已局部修复。详细输入、结果、失败原因和剩余服务条件见 [2026-10-23 验收报告](docs/acceptance/2026-10-23.md)；104 个工具表示入口数量，尚未全部业务验收。

- [实际验证与限制](STATUS.md) · [S2 逐项进度](tasks/S2-progress.md) · [复测指南](docs/guides/verification.md)
- [服务与 MCP](docs/integrations/services.md) · [开发与 Skills](docs/integrations/development.md) · [链与存储](docs/integrations/chains-storage.md)
- [钱包与 Agent](docs/integrations/wallets-agents.md) · [来源与身份](docs/integrations/provenance.md)
- [已审批决定](docs/QUESTIONS.md) · [规格](docs/SPEC.md) · [交接](HANDOFF.md)

## 许可证

BCA 使用 [MIT](LICENSE)。第三方组件保留各自许可；例如 OpenZeppelin Contracts MCP 通过独立进程调用，遵循其 AGPL-3.0-only 许可。

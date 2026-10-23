# BCA · Blockchain Anything

**在已有 Agent 中提出区块链开发问题，找到工作站，调用成熟工具，核对真实结果。**

BCA 为 Codex、Claude Code 与其他 MCP 宿主提供统一的 TypeScript、CLI 和 MCP 入口。宿主负责对话、代码编辑、任务循环与授权；BCA 负责发现能力、检查条件、转换参数、管理连接和返回证据。继续复用官方 SDK、CLI、MCP 与 Skills。

## 两个工作站

| 工作站 | 可以提出的问题 | 实际路径 |
| --- | --- | --- |
| EVM 交易诊断 | “这笔交易为什么回滚？” | 交易/回执 → 固定区块代理识别 → 本地产物或 Sourcify v2 → RPC trace → 错误参数、源码位置和缺口 |
| EVM 合约开发与验证 | “帮我开发并验证一个 ERC20 合约” | 读取原项目 → OpenZeppelin 合约/官方生成器 → Foundry 编译、相关测试 → 本机 Anvil 部署 → 链上读取 |

真实验收：OpenZeppelin ERC20 失败交易解码为 `ERC20InsufficientBalance`，结合实际 trace 和匹配编译产物定位到源码；Foundry 编译/测试/部署后读回 `totalSupply=1000`。公共测试网部署、源码上传验证、Tenderly 账户调用和原生客户端 UI 授权仍需条件。现有 Hardhat 工程可编译/测试，部署沿用宿主的原脚本。详见 [本轮验收](docs/acceptance/2026-10-24.md)。

## 一条接入命令

需要 **Node >=24.16.0 <25** 和 npm。当前版本 `0.3.0` 保持 `private:true`，**尚未发布公共 npm 包**。从开发分支构建实际产物：

```sh
npm ci
npm run build
npm pack
```

在要接入的项目目录内执行（将路径替换为上一步生成的真实文件）：

```sh
npm exec --yes --package /absolute/path/blockchain-anything-0.3.0.tgz -- bca setup --client both --install
```

该命令把 BCA 安装到项目 `.bca/runtime`，按需准备官方固定版本 Foundry，生成 `.mcp.json`、`.codex/config.toml` 和 `BCA-WORKFLOW.md`。保留其他服务和已有 BCA 环境变量，改动前备份，重复运行不重复添加条目。默认关闭写入；随后在客户端信任项目并批准 MCP 配置。客户端授权状态不会被写成“已连接”。

只生成配置、复用当前安装：`node dist/cli/main.js setup --client both`。选择单个工作站：`--workstation evm-diagnose` 或 `--workstation evm-develop`。Windows 11 推荐在 WSL2 内同时安装 Node、BCA 和 Agent 客户端；Linux 本轮实测，原生 Windows/macOS 未验收。详见 [安装与诊断](docs/guides/setup.md)。

## 从问题找到工具

```sh
node dist/cli/main.js workstation search --input '{"query":"这笔交易为什么失败了","context":{"chainId":"31337","hash":"<真实交易哈希>"}}'
node dist/cli/main.js workstation guide --input '{"id":"evm-develop","context":{"dir":"examples/contracts"}}'
node dist/cli/main.js capability list --input '{}'
node dist/cli/main.js doctor
```

检索返回匹配原因、真实步骤、必需/可选/缺失能力、待明确事实和替代路径。未支持的问题返回空候选；指定的链或供应商不匹配时保留歧义，不自动改目标。匹配、计划、执行分别记录。

`capability_list` 保留完整目录，运行状态单独表达。默认只检查配置和本机文件；`doctor --connect` 才连接配置的 EVM，`doctor --server <name>` 才连接指定 MCP。配置、连接和业务验证分别记录。

## 调用与结果

```sh
node dist/cli/main.js tools viem_logs
node dist/cli/main.js call content_cid --input '{"path":"README.md"}'
node --env-file=.env dist/cli/main.js call workstation_diagnose --input '{"hash":"<真实交易哈希>","artifact":"compiled.json"}'
node dist/cli/main.js mcp
```

```ts
import { createToolkit } from 'blockchain-anything';
const toolkit = createToolkit();
try {
  const matches = await toolkit.invoke('workstation_search', {
    query: 'compile my Solidity contract', context: { dir: 'contracts' },
  });
  // 宿主补全事实并执行已授权步骤。
} finally {
  await toolkit.close();
}
```

编译/测试返回兼容原字段的 `taskStatus`：`succeeded`、`business_failed`、`execution_failed`。CLI 对业务失败退出 2、执行失败退出 1；MCP 同时设置 `isError` 并保留诊断。Slither 成功扫描后发现问题仍保留 findings，不等于扫描器执行失败。

交易状态区分 `confirmed`、`failed`、`pending`、`not_found`、`receipt_unavailable`。RPC 错误报告失败阶段和未知状态；禁止据此重发写入。

## 接入官方 MCP

按 [服务指南](docs/integrations/services.md) 配置 `BCA_MCP_CONFIG` 或 `BCA_MCP_SERVERS`。连续调用使用 `bridge_open → bridge_refresh → bridge_call → bridge_close`；SDK/MCP 同一会话可复用连接，独立 CLI 进程不能共用会话 ID。无 session 参数的旧调用继续按单次连接工作。

能力刷新保留原 Schema、描述与版本，记录摘要变化；新增工具保持“发现/未验证”。上游只读注解仅供参考。少量已核对的官方工具有明确映射；其他工具需操作者配置精确 `readOnlyTools` 许可，或通过写入开关及 `submit:true`。详见 [工作站与会话](docs/guides/workstations.md)。

## 保留的能力与边界

现有 EAS、IPFS/Kubo、Sui、Aptos、Solana/SAS、Sign、Walrus、Seal、Arweave、Safe、x402、CCXT、身份与来源验证适配继续保留。历史验收范围见 [S2 清单](tasks/S2-progress.md)，未在本轮重复验证全部生态。

- 保留上游 ABI、交易哈希、UID、CID、DID 与证明格式；不新建链、钱包、签名算法或通用 Agent 运行时。
- 本地部署入口仅支持 loopback Anvil、31337/1337、明确发送地址；公共链继续沿用宿主钱包授权。
- 全局写开关和 `submit` 表示进程许可与调用意图，不等于逐笔用户授权。未知提交状态不自动重试。
- 源码与 trace 不全时输出部分结果。标准代理识别仅涵盖单层 ERC-1967 implementation slot 和 ERC-1167；beacon、自定义模式、同交易升级与嵌套失败保留未验证项。
- POSIX 子进程使用独立进程组清理，涵盖继承该进程组的后代；主动脱离进程组的守护进程不在本轮保证范围。Windows `taskkill /T` 分支尚未实测。
- 路径限定在工作根目录；项目配置/本地官方工具属于操作者管理的代码。BCA 不自动安装互联网上任意命令。

[开发决定](docs/QUESTIONS.md) · [规格](docs/SPEC.md) · [本轮验收与剩余条件](docs/acceptance/2026-10-24.md) · [安装](docs/guides/setup.md) · [工作站](docs/guides/workstations.md)

MIT。各上游组件保留自身许可证；OpenZeppelin Contracts MCP 独立进程遵循其 AGPL-3.0-only 许可。

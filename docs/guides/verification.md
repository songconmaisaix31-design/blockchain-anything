# 真实操作检查

使用 Node.js `>=22.12.0 <23 || >=24.0.0 <25`、lockfile 固定依赖、已安装的官方 Anvil 和 Kubo。脚本通过实际 README 字节生成 raw CID，将 CID 与原字节编码进 EAS 声明。Anvil 部署 npm 依赖中官方编译的 SchemaRegistry/EAS 合约；Kubo 使用隔离仓库与 `daemon --offline`，所有监听地址限定为 loopback。

```powershell
npm ci --ignore-scripts --no-audit --no-fund
npm run typecheck
npm run build
$env:ANVIL_BIN = 'C:/Users/DW/.local/bin/anvil.exe'
$env:KUBO_BIN = 'C:/Users/DW/Documents/ChatGPT/blockchain-anything/.work/kubo-dist/kubo/ipfs.exe'
npm run smoke
```

`ANVIL_BIN` 与 `KUBO_BIN` 接受实际可执行文件路径。未设置时使用 PATH 中的 `anvil`、`ipfs`；缺失会明确失败。脚本不下载服务二进制，服务日志、Kubo 数据及 npm 安装产物保留于忽略的 `.work/smoke-*`。Windows 子进程隐藏窗口，`finally` 仅终止本次创建的服务；官方 MCP client 负责关闭自己创建的 stdio 服务。

默认范围为 `onchain,ipfs,package`，可按故障位置仅复测相关范围：

```powershell
npm run smoke -- --scope onchain
npm run smoke -- --scope ipfs
npm run smoke -- --scope package
```

| 范围 | 实际操作 |
| --- | --- |
| `onchain` | chain/balance、官方合约部署、Schema 编解码和注册/读取、attest/get/receipt/revoke，以及链上 revocationTime 改变 |
| `ipfs` | Kubo 状态、UnixFS add/read、逐字节一致、raw 与 UnixFS CID 语义，以及超限读取拒绝 |
| `package` | npm pack 后在隔离目录安装真实依赖，运行包内 CLI 的 JSON 结果和非零错误，通过官方 MCP client 发现全部工具、调用 CID 和接收结构化错误 |
| `core` | 本地真实部署下的 EIP-191 恢复、篡改消息失败、EAS v2 链下签署/验签及篡改拒绝、未检查项标志、配置 chain ID 不匹配拒绝 |
| `interfaces` | 对当前 dist 执行与安装包相同的 CLI/官方 MCP client 检查 |
| `windows` | 真实 Windows 中文/空格路径、Solidity import 与技能读取的 junction 边界、技能根目录 junction、混合大小写敏感环境变量隔离 |
| `development` | 真实 Anvil 上 solc 编译/部署 Counter、Cast 四项只读调用和 viem 六项操作，核对 Counter 从 0 到 1 |

每次运行均核对实际 README 的 raw CID、字节数与 SHA-256。`core` 和 `interfaces` 用于相关代码变更后的回归检查；可通过逗号选择多个范围。打包检查需要已生成的 `dist`，因此从新 checkout 运行前须完成构建。

本地 Anvil 结果、官方 MCP SDK 结果、公共测试网结果和原生 Codex 控制器审计分别记录。此脚本没有执行公共网络写入、生产交易、npm 公开发布或原生 Codex SQLite/HTTP/会话/event_id 审计。

## Windows 专项检查

```powershell
npm run smoke -- --scope windows
npm run smoke -- --scope development
npm run check:bridge
```

`windows` 必须在真实 Windows 上运行，使用仓库合约和 README 的实际内容，在 `.work/smoke-*` 中创建目录与 junction。`development` 需要 PATH 中的 Cast，以及 `ANVIL_BIN` 或 PATH 中的 Anvil；直接使用正常 RPC 传输。桥接检查还验证配置文件同长度修改与当前环境变量重新展开。

2026-10-29 的 Windows 环境、验证命令与实际结果见 [Windows 验证任务](../../tasks/windows-availability.md)。主线使用 solc 0.8.35；原开发分支使用的 0.7.x 编译结果作为历史记录单独保留。

## S1 历史结果（2026-10-23）

Node.js 24.19.0、Anvil 1.7.1、Kubo 0.43.1 环境中，`npm run typecheck` 和 `npm run build` 通过。`npm run smoke -- --scope onchain` 通过真实链上完整生命周期，chain ID 为 31337，撤销后 `revocationTime` 从 0 变为非零。`npm run smoke -- --scope ipfs` 通过离线 add/read 的逐字节比较与超限拒绝。本次检查输入为提交 `2209990` 中 README 的实际 2909 字节，声明内容使用这份文件及其 CID；下面记录的 CID 对应这份检查输入。

- raw CID：`bafkreiefjeegc5xnx2knis66exzrrso7lqbctlzyge25kvzd3kyhw3pzw4`。
- UnixFS CID：`bafybeietlxhfid2ziy6cnes7ak6rr3bbwh2ptro3a6ighlayfay2bdhzb4`。

`npm run smoke -- --scope package` 通过：npm pack 的真实产物在隔离目录安装后，包内 CLI 返回正确 CID JSON，错误输入退出码为 1；官方 MCP client 发现 20 个工具，CID 调用及结构化错误检查通过，协议错误和 stderr 均为空。

公共 Base Sepolia 单独执行 `node dist/cli/main.js call eas_status --input '{}'`，RPC 为 `https://sepolia.base.org`，chain ID 明确设置为 84532，写入关闭并清除私钥配置。地址读取自官方 eas-contracts 的 `deployments/base-sepolia` JSON：EAS `0x4200000000000000000000000000000000000021`、Registry `0x4200000000000000000000000000000000000020`。实际返回版本分别为 `1.4.1-beta.3`、`1.3.1-beta.2`，连接、合约代码与 Registry 关联检查全部通过。

A 的核心签名与配置拒绝检查，以及 B 的标准 CLI/三个 stdio 入口检查已在交付时通过。集成使用其记录，未重复执行完整 `core`、`interfaces` 范围。

## S2 局部检查

当前主路径结果与未验证项目见 [STATUS](../../STATUS.md)。只选修改涉及的范围：

```sh
npm run build
npm run check:bridge
npm run check:s2
```

check:s2 只使用真实离线 SDK，覆盖新增密码学/序列化和框架转换边界；check:bridge 使用真实官方 MCP stdio/HTTP 服务。它们不替代有凭据的供应商验收。SDK 工厂隔离入口需要先构建 dist。

新增服务配置后，先运行 bridge_discover 并选一个符合授权范围的真实工具；CLI/SDK 新路径仅调用该项。编译错误在对应配置或 import 处修复后复测该命令；Slither finding 保留在结果中，不靠忽略警告取得假成功。

本次完整真实验收、样本标识、失败与局部复测见 [2026-10-23 报告](../acceptance/2026-10-23.md)。不需要为文档或单点修复重跑全部供应商。

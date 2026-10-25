# 安装与诊断

版本 0.3.0。BCA 尚未公开发布 npm；用真实本地产物接入。开发分支仍为 `codex/bca-s2-complete`，不合并 main。

## Windows 11 + WSL2

在同一个 WSL2 环境运行 Node 24.16+、npm 和 Codex/Claude Code，使用 Linux 项目路径。Windows 浏览器/编辑器可以打开该项目；Windows 原生客户端不能直接执行 WSL 路径。当前验证环境为 Linux x64，未执行 WSL2 宿主或 Windows 原生验收。

```bash
# 在 BCA checkout 中
npm ci
npm run build
npm pack
# 切换到自己的目标项目，路径按本机修改
cd /home/you/projects/your-project
npm exec --yes --package /home/you/blockchain-anything/blockchain-anything-0.3.0.tgz -- bca setup --client both --install
```

`--install` 将当前包重打包后放进 `.bca/runtime`，使配置不依赖 npm 临时执行目录。Foundry 固定到官方 `@foundry-rs/{forge,cast,anvil}@1.7.1`，优先复用安装或 PATH 程序。编译器和应用依赖沿用原项目；例如已有 Foundry 工程应保留原 `solc_version` 和 remappings。没有合约工程时，由宿主创建小型项目并安装指定版本 OpenZeppelin，BCA 不覆盖现有工程。

新增直接运行依赖仅为固定版本 `smol-toml@1.4.2`，用于正确读写 Codex TOML。保留其他字段和服务器；TOML 排版与注释可能被规范化，原文件保存在 `.bca-backup-*`。已有 BCA 的 RPC、环境变量和写开关保持原值。

项目内运行已安装 CLI：

```bash
node .bca/runtime/node_modules/blockchain-anything/dist/cli/main.js doctor
```

没有参数时不会连接所有远程服务。连接检查：

```bash
BCA_RPC_URL=http://127.0.0.1:8545 BCA_CHAIN_ID=31337 \
  node .bca/runtime/node_modules/blockchain-anything/dist/cli/main.js doctor --connect
BCA_MCP_CONFIG=/absolute/path/services.json \
  node .bca/runtime/node_modules/blockchain-anything/dist/cli/main.js doctor --server openzeppelin
```

`doctor` 区分程序/配置存在与实际连接，能力目录只按状态汇总。只检查本次目录中已有配置的客户端；未配置的另一个客户端不构成失败。没有 Foundry 项目时，缺少 Foundry 程序记为 `optional_unavailable`；`allPassed` 表示本次适用检查没有失败，不表示全部生态可用。诊断本身成功退出不表示 `allPassed=true`；脚本应读取每项状态。没有客户端可执行程序时，依然可以验证生成的 MCP 配置启动 BCA 并读取本地 CID。此验证不等于已经在客户端 UI 内授予信任。

## 客户端核对

- Codex：读取项目 `.codex/config.toml` 中 `[mcp_servers.bca]`，只在信任的项目启用项目配置。运行 `codex mcp list` 核对。
- Claude Code：读取 `.mcp.json` 中 `mcpServers.bca`，首次使用完成项目 MCP 批准；在 `/mcp` 查看实际连接。
- 在客户端执行一次 `content_cid({"path":"BCA-WORKFLOW.md"})`，预期返回真实 CID；再提出“帮我诊断一笔 EVM 失败交易”，预期先要求链与交易哈希。

配置凭据由操作者在受控环境/客户端设置，不写入仓库。将 `.mcp.json`、`.codex/config.toml` 及备份中可能存在的个人凭据排除出提交；本轮产物只使用临时测试配置。

## Windows 原生复验（未实测）

在 PowerShell 7 和 Node 24.16+ 中：

```powershell
npm ci
npm run build
npm run check:next -- regressions
npm run check:sessions
# 给实际 tgz 路径加引号；在目标项目执行
npm exec --yes --package "C:\path\blockchain-anything-0.3.0.tgz" -- bca setup --client both --install
node .bca/runtime/node_modules/blockchain-anything/dist/cli/main.js doctor
```

`check:next -- regressions` 会启动自己拥有的子孙进程，验证超时/取消后文件停止增长、输出超限结束、普通命令成功，以及 CLI/MCP 编译失败状态。Windows 分支使用系统 `taskkill.exe /PID <本次PID> /T /F`；若清理不能在 2 秒内确认，必须看到明确错误，不应留下继续写文件的后代。

收集 `node -v`、`npm -v`、`$PSVersionTable.PSVersion`、脚本 stdout/stderr、`.work/next/result-regressions.json`。若失败，保存 `.work/next/descendant.log` 的文件大小变化和任务 PID；不要附环境变量全量、私钥或 Token。本地链工作流另运行 `npm run check:next -- onchain`，需要该平台 Foundry 与 solc 0.8.35。

官方配置参考：
- https://developers.openai.com/codex/mcp
- https://code.claude.com/docs/en/mcp
- https://github.com/foundry-rs/foundry/tree/master/npm

# 依赖安全状态

2026-10-27，跟踪 [issue #6](https://github.com/songconmaisaix31-design/blockchain-anything/issues/6)。审计是依赖树告警统计，不等同于每一条 BCA 功能均可被利用。

本轮升级 `smol-toml` 到 1.9.1，锁定 `protobufjs` 7.6.3 和 CCXT 使用的 `undici` 7.30.1。保留官方 SDK 与原有调用接口，未执行 `npm audit fix --force`。protobufjs 的旧 6.x 使用者通过 override 升级，验证 cheqd 生成的查询消息编解码与 SDK 导入；完整 cheqd 远程网络业务仍需另外验证。

`npm-shrinkwrap.json` 随 tarball 分发，使依赖修复同时作用于 checkout 和 setup 安装的持久运行目录。普通 package-lock 不随包分发，子包的 overrides 也不能约束宿主的依赖解析。

本轮 `npm audit --json --registry=https://registry.npmjs.org`：原始树 51 项（1 critical / 17 high / 13 moderate / 20 low）；修改后 47 项（0 critical / 14 high / 13 moderate / 20 low）。不同 npm 版本和公告更新时间可能影响统计。

## 剩余依赖

| 路径 | 剩余问题与处理范围 |
| --- | --- |
| cheqd 的旧 CosmJS CJS 依赖 | axios、elliptic、旧签名库等告警；BCA 的 cheqd 接口仅查询 DID，不接收签名私钥。需要上游迁移其兼容依赖。 |
| EAS SDK → eas-contracts → Hardhat | undici 5、adm-zip、serialize-javascript、tmp 等；BCA 的内置 Foundry 安装不调用 Hardhat 下载器，已有 Hardhat 项目仍执行自己的工具配置。保留告警，不能将依赖存在视为无风险。 |
| Sign SDK / x402 → zod 3 | 上游 Schema 仍依赖旧主版本，不直接强换 zod 4；需要上游兼容升级。 |
| Solana web3 / jayson、旧 uuid 等 | 保留上游兼容依赖；相关远程输入与凭据仅提供给实际需要的服务。 |

BCA 不提供加载任意 protobuf schema / JSON descriptor 的接口。protobufjs critical 公告要求攻击者控制被加载的 schema；本轮仍升级依赖以移除该漏洞版本：[GHSA-xq3m-2v4x-88gg](https://github.com/advisories/GHSA-xq3m-2v4x-88gg)。7.6.3 同时覆盖后续 schema 名称冲突修复：[GHSA-f38q-mgvj-vph7](https://github.com/advisories/GHSA-f38q-mgvj-vph7)。

## 复查

```sh
npm ci
npm audit --json --registry=https://registry.npmjs.org
npm run check:s2
npm run check:setup
```

CI 对 critical 告警阻断，并运行真实包安装与 MCP / 合约检查；high 告警继续由 #6 跟踪，尚未设置为已清零的门槛。无凭据的检查不代替账户型服务验证。

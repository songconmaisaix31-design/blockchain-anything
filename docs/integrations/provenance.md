# Provenance 与身份生态接入（轨道 P）

更新日期：2026-10-23。基线：`b76a569fd0d052530dd7d3e5d262a2aa01aee82c`。

本轨道只做成熟组件的聚合适配，不实现自有协议、身份、哈希、manifest、调度器或证明系统。所有工具通过 `defineTool` 返回 `ToolImplementation`，由 `src/provenance/index.ts` 的 `provenanceTools()` 统一导出。集成 Agent 负责把该工厂加入 `src/toolkit.ts`、正式依赖、lockfile、CLI/MCP 和 `.env.example`。

## 状态摘要

| 项目 | 适配 | 实际调用 | 结论/边界 |
| --- | --- | --- | --- |
| OpenTimestamps | `opentimestamps@0.4.9` 官方 JS 实现 | 验证官方 `hello-world.txt.ots`，Bitcoin 区块 358391 | 只做解析/验证；不 stamp/upgrade，不向公共日历提交 |
| RISC Zero | 官方 `IRiscZeroVerifier` 合约 + Sepolia RPC | 官方 v3.0.0 Groth16 fixture 通过，篡改 journal revert | 不生成证明；不证明 image ID 来源 |
| cheqd | `@cheqd/sdk@5.5.1` + 官方 resolver | 解析 testnet DID 并通过 SDK 规格校验 | 未做账本写入/状态列表（需要 fee payer 与 ncheq） |
| W3C VC | `@digitalbazaar/vc@7.3.0` + Data Integrity | 本地签发并验证 VC 2.0，篡改被拒绝 | 使用临时 Ed25519 密钥；不检查状态/撤销/发行者信任 |
| in-toto | 官方 `in-toto==3.1.0` CLI、`in-toto-attestation==0.9.3` | 真实签名 link 验签、Statement v1 结构校验 | 不验证 layout 策略、阈值或产物哈希；不验证 DSSE 签名 |
| SLSA | 官方 `slsa-verifier v2.7.1` | 验证官方 slsa-verifier Windows 产物及其 provenance | 依赖 Sigstore TUF/Rekor；不审计源码 |
| Sigstore/Cosign | 官方 `cosign v3.1.4` | 验证官方 cosign checksums 的 keyless bundle | 只验证；不签名/上传；未监控透明日志 |
| OpenLineage | 官方 `openlineage-python==1.54.0` | 通过官方 FileTransport 发射 RunEvent | 未接 Marquez/collector；不验证下游接收 |
| C2PA | 官方 `c2patool v0.28.2` | 对官方样例签名并验证 manifest | 使用内置测试证书，`signingCredential.untrusted`，不能当生产身份 |

## 依赖与安装

### Node.js 直接依赖

以 `npm install --no-save --package-lock=false` 实际安装；`package.json`/`package-lock.json` 未被本轨道修改。集成 Agent 需要把下列包写入正式依赖并重新生成 lockfile：

| 包 | 实际版本 | 用途 |
| --- | --- | --- |
| `opentimestamps` | 0.4.9 | 官方 OpenTimestamps JavaScript 实现（解析/验证） |
| `@cheqd/sdk` | 5.5.1 | cheqd DID 文档规格校验、DID 费用/钱包类型 |
| `@digitalbazaar/vc` | 7.3.0 | W3C VC issue/verify |
| `@digitalbazaar/data-integrity` | 2.5.0 | DataIntegrityProof |
| `@digitalbazaar/eddsa-rdfc-2022-cryptosuite` | 1.3.0 | `eddsa-rdfc-2022` cryptosuite |
| `@digitalbazaar/ed25519-multikey` | 1.3.1 | Ed25519 Multikey 生成/签名 |
| `@digitalbazaar/credentials-context` | 3.2.0 | VC v1/v2 官方 JSON-LD context |
| `@digitalbazaar/data-integrity-context` | 2.0.1 | Data Integrity context |
| `@digitalbazaar/multikey-context` | 2.0.1 | Multikey context |
| `@digitalbazaar/security-context` | 1.0.1 | Security context |

`@cheqd/sdk` 的传递依赖会安装 `@cheqd/ts-proto`、`@cosmjs/*` 等；其中 `@cosmjs/crypto@0.30.1` 的弃用提示已在上游存在，不能由本轨道替换。`opentimestamps` 的 `package.json` `main` 字段与实际文件名不一致，Node 24 会打印 `DEP0128` 警告，但实际解析/验证可用。`@digitalbazaar/*` 未提供完整 TypeScript 类型，本轨道在 `src/provenance/types/vendor.d.ts` 增加了仅覆盖所用 API 的本地声明。

### Python 依赖

使用项目内 `.work/venv`，未安装全局包：

```powershell
python -m venv .work/venv
.work/venv/Scripts/python -m pip install "in-toto==3.1.0" "in-toto-attestation==0.9.3" "openlineage-python==1.54.0"
```

实际安装版本：`in-toto 3.1.0`、`in-toto-attestation 0.9.3`、`openlineage-python 1.54.0`；传递依赖包括 `securesystemslib 1.6.0`、`protobuf 7.36.2`、`cryptography 50.0.2`。`opentimestamps-client 0.7.2` 与 Python `opentimestamps 0.4.5` 仅为交叉核对安装，不是本适配的运行依赖。

### 官方二进制

| 工具 | 版本/平台 | 来源 | SHA-256 |
| --- | --- | --- | --- |
| cosign | v3.1.4 windows/amd64 | <https://github.com/sigstore/cosign/releases/download/v3.1.4/cosign-windows-amd64.exe> | `cbe953787074611f1334cbf37dc1cf953995bb8c45398eb4fc7bb781d29c1f2a` |
| slsa-verifier | v2.7.1 windows/amd64 | <https://github.com/slsa-framework/slsa-verifier/releases/download/v2.7.1/slsa-verifier-windows-amd64.exe> | `1d8f61ad747ecc3d375d2a563cebf2991748b7da1a9bda9a500804c3c499e3c0` |
| c2patool | v0.28.2 windows/amd64 | <https://github.com/contentauth/c2patool/releases/download/v0.28.2/v0.28.2-x86_64-pc-windows-msvc.zip> | exe `b970c119c95539896c9a2a05b1bb160dce7da6874bafad08815c2bd6538f01e1`；zip `64ffece01fe6407f239e07e9fa5b4a335f8d4b01e326b09cab97e4c26891cc95` |

二进制放在 `.work/bin/`（已忽略），未提交到仓库。`cosign` 的 checksum 已与官方 `cosign_checksums.txt` 第 27 行比对一致。`slsa-verifier` 的 provenance 来自同一官方 release，见 `examples/provenance/README.md`。

### 环境变量

| 变量 | 必需 | 说明 |
| --- | --- | --- |
| `BCA_WORKING_ROOT` | 否 | 文件根目录，默认当前工作目录；所有工具输入路径限制在此目录 |
| `BCA_TIMEOUT_MS` | 否 | 默认操作超时；二进制网络验证至少使用 120 秒 |
| `BCA_MAX_FILE_BYTES` | 否 | 读取文件上限 |
| `BCA_COSIGN_PATH` | 否 | 默认 `cosign` |
| `BCA_SLSA_VERIFIER_PATH` | 否 | 默认 `slsa-verifier` |
| `BCA_C2PATOOL_PATH` | 否 | 默认 `c2patool` |
| `BCA_IN_TOTO_SIGN_PATH` | 否 | 默认 `in-toto-sign` |
| `BCA_PYTHON_PATH` | 否 | 默认 `python`；必须能导入 `in-toto-attestation`/`openlineage-python` |
| `BCA_SIGSTORE_HOME` | 否 | cosign/slsa-verifier 的 TUF 缓存目录；本机默认 `C:\Users\DW\.sigstore` 不可写，测试使用 `.work/home` |
| `BCA_RISC0_VERIFIER` | RISC Zero 工具必需 | 官方 `IRiscZeroVerifier` 合约地址；本测试为 Sepolia v3.0.0 `0x2a098988600d87650Fb061FfAff08B97149Fa84D` |
| `BCA_CHEQD_RESOLVER_URL` | 否 | 默认 `https://resolver.cheqd.net/1.0/identifiers` |
| `BCA_RPC_URL` | RISC Zero 工具必需 | JSON-RPC；只读 `eth_chainId`/`eth_getCode`/`eth_call` |
| `BCA_CHAIN_ID` | 否 | 设置后 RISC Zero 工具会核对链 ID |
| `C2PA_SIGN_CERT` / `C2PA_PRIVATE_KEY` | 否 | 由 c2patool 直接读取；仅操作者本地开发用，本轨道测试未使用，工具不回显 |

缺少某个服务的配置只会在调用该服务的工具时失败，不会阻止其他工具创建或调用。`readProvenanceConfig` 不在工厂构建阶段校验 URL/地址。

## 工具目录

`provenanceTools(config?: Config): ToolImplementation[]` 导出 14 个工具：

| 工具 | 只读 | 输入 | 实际行为 |
| --- | --- | --- | --- |
| `ots_inspect` | 是 | `proofPath` | 官方库解析 `.ots`，返回哈希、Bitcoin/Litecoin 高度、pending、官方 `info` 文本 |
| `ots_verify` | 是 | `proofPath`, `targetPath` | 按证明的哈希算法重算文件哈希，查询区块浏览器验证完整 attestation |
| `risc0_verify_receipt` | 是 | `seal`, `imageId`, `journal` 或 `journalHex` | 校验链 ID/合约代码后 `eth_call` 官方验证合约 |
| `sigstore_verify_blob` | 是 | `blobPath`, `bundlePath`, `certificateIdentity`, `certificateOidcIssuer`, `timeoutMs?` | `cosign verify-blob` 校验 bundle、Fulcio 身份和 Rekor |
| `slsa_verify_artifact` | 是 | `artifactPath`, `provenancePath`, `sourceUri`, `sourceTag?`, `builderId?`, `printProvenance?` | `slsa-verifier verify-artifact` 校验摘要、provenance 与 source 策略 |
| `intoto_verify_link` | 是 | `linkPath`, `publicKeyPath` | `in-toto-sign --verify` 校验 link 元数据签名 |
| `intoto_validate_statement` | 是 | `statementPath` | 官方 protobuf 解析并校验 in-toto Statement v1 |
| `openlineage_emit` | 否 | `jobNamespace`, `jobName`, `eventType`, `runId?`, `eventTime?`, `inputs?`, `outputs?`, `producer?` | 官方 Python 客户端构造并通过 FileTransport 发射 RunEvent，返回原始事件 |
| `c2pa_sign` | 否 | `sourcePath`, `manifestPath`, `outputPath` | 官方 c2patool 写入 manifest；默认内置测试证书 |
| `c2pa_verify` | 是 | `path` | 官方 c2patool 读取/验证 manifest，返回状态与失败码 |
| `cheqd_resolve_did` | 是 | `did` | 官方 resolver 解析 + `@cheqd/sdk` 规格校验 |
| `cheqd_validate_did_document` | 是 | `path` | 离线校验 cheqd DID 文档 JSON |
| `vc_issue` | 否 | `issuer`, `subject`, `claims?`, `validFrom?`, `validUntil?` | 本地生成 Ed25519 密钥并签发 VC 2.0 DataIntegrityProof |
| `vc_verify` | 是 | `credential`, `publicKey`, `controllerDocument?` | 官方 vc 库验证签名与有效期 |

所有路径均限制在 `BCA_WORKING_ROOT`；输出文件拒绝覆盖；所有外部命令使用固定参数数组、`shell: false`、超时和输出上限，不提供任意命令执行。

## 逐项接入记录

### OpenTimestamps

- 组件：官方 `opentimestamps` npm 包 0.4.9（官方 README 说明 0.4.6 起包名由 `javascript-opentimestamps` 改为 `opentimestamps`；本轨道实际使用 0.4.9）。
- 官方来源：<https://github.com/opentimestamps/javascript-opentimestamps>；许可 LGPL-3.0。
- 实际调用：
  - `ots_inspect` 解析 `node_modules/opentimestamps/examples/hello-world.txt.ots`，得到 SHA-256 `03ba204e50d126e4674c005e04d82e84c21366780af1f43bd54a37816b6ab340` 和 Bitcoin 高度 358391。
  - `ots_verify` 验证同一官方样例，返回 `{ bitcoin: { height: 358391, timestamp: 1432827678 } }`。
- 边界：验证使用库内置区块浏览器 lite-client；日志明确 “assuming block ... is valid”。这不是本地 Bitcoin 全节点验证，也不证明文件内容真实性。工具不提供 stamp/upgrade，因为那会向公共日历提交哈希并修改证明；本轨道未执行。
- 限制：包较旧，`main` 字段错误导致 Node 24 弃用警告；无官方类型声明，使用本地最小声明。

### RISC Zero

- 组件：官方 `IRiscZeroVerifier` Solidity 验证合约；Sepolia 部署表与 `risc0-ethereum` 测试 fixture。
- 官方来源：<https://github.com/risc0/risc0-ethereum>（main 提交 `1d19771dc82531dced48fe7ff2e27bf6ad38bd59`，2026-10-22）。
- 实际调用：
  - fixture：`contracts/test/TestReceiptV3_0.sol` 的官方 Groth16 receipt，journal 为 UTF-8 `just a simple receipt`，image ID `0x11d264...`。
  - verifier：Sepolia 3.0.0 `0x2a098988600d87650Fb061FfAff08B97149Fa84D`；router `0x925d8331ddc0a1F0d96E68CF073DFE1d92b69187`。
  - `risc0_verify_receipt` 先核对 chain ID 11155111 和合约代码，再 `eth_call` `verify(bytes,bytes32,bytes32)`；官方 receipt 返回 `0x`（成功），篡改 journal 后 revert `0x439cc0cd`（`VerificationFailed()`）。
- 边界：只验证 Groth16 seal 对给定 image ID 与 `sha256(journal)` 的有效性；不证明 image ID 对应哪个 guest 程序，也不解释 journal 的业务含义。验证合约为操作者配置的信任根。
- 未完成：当前 main 的 `TestReceiptV5_0` fixture 未能在 Sepolia 5.0.0-rc.1 验证器上通过；部署表将该验证器标记为 `stopped = true`，且其 selector `0x3dfd9e0e` 与当前 fixture seal 前缀 `0xc27d1bc0` 不一致。本机没有 RISC Zero 官方 Windows 证明工具链（`cargo-risczero` v3.0.6 release 仅 linux/darwin），未生成 v5 本地 receipt，也未部署本地 v5 verifier。v5 状态保持未完成。

### cheqd

- 组件：官方 `@cheqd/sdk` 5.5.1；官方 resolver `https://resolver.cheqd.net/1.0/identifiers`；官方文档 <https://docs.cheqd.io/product/studio/status-lists>、<https://docs.cheqd.io/product/studio/dids/resolve-did>。
- 实际调用：
  - `cheqd_resolve_did` 解析 `did:cheqd:testnet:b003df6f-ec8e-48dd-9a2b-7011c5cf0a5e`，返回 DID 文档、版本元数据和 1 个 `Ed25519VerificationKey2018` 验证方法。
  - `cheqd_validate_did_document` 对同一文档的本地副本执行 SDK 规格校验，`valid: true`。
  - 文档版本 ID：`1838d661-447a-4cb6-8020-65a1b7849166`；官方 resolver 响应中包含多个 DID-Linked Resource 元数据。
- 边界：`validateSpecCompliantPayload` 只校验结构与 cheqd 规格，不检查 DID 方法前缀或账本状态；适配器额外检查 `did:cheqd:mainnet|testnet` 和文档 `id` 一致性。resolver 是托管服务，结果不是独立账本证明。
- 未完成：未在账本创建/更新 DID，未创建 Status List 或 DID-Linked Resource，因为需要 fee payer 助记词、ncheq 余额和链上写入；未接入 Veramo/Credo 的完整凭证签发。公共测试网写入不在授权范围。

### W3C VC

- 组件：`@digitalbazaar/vc` 7.3.0、`@digitalbazaar/data-integrity` 2.5.0、`@digitalbazaar/eddsa-rdfc-2022-cryptosuite` 1.3.0、`@digitalbazaar/ed25519-multikey` 1.3.1，以及 Digital Bazaar 官方 contexts。
- 规范：W3C Verifiable Credentials Data Model 2.0 Recommendation（2025-05-15）<https://www.w3.org/TR/vc-data-model-2.0/>；Data Integrity 1.0；`eddsa-rdfc-2022`。
- 实际调用：
  - `vc_issue` 生成临时 Ed25519 Multikey，签发 `@context: https://www.w3.org/ns/credentials/v2` 的 VC，证明类型 `DataIntegrityProof`，cryptosuite `eddsa-rdfc-2022`。
  - `vc_verify` 使用返回的公钥文档验证成功；篡改 `credentialSubject.id` 后 `verified: false`。
- 边界：签名只证明持有本次临时私钥；`issuer` 字段本身不建立外部身份。密钥未发布/锚定，未检查 `credentialStatus`、撤销列表、发行者授权或声明真实性。未实现 Presentation、JWT/SD-JWT 或持久密钥管理。

### in-toto / SLSA

- in-toto 组件：官方 Python `in-toto 3.1.0`（CLI `in-toto-record`、`in-toto-sign`）与 `in-toto-attestation 0.9.3`（protobuf `Statement v1`）。
- 实际调用：
  - 用官方 CLI 生成 Ed25519 密钥、对 `examples/provenance/fixtures/intoto-artifact.txt` 执行 `in-toto-record start/stop`，得到真实签名 link；`intoto_verify_link` 用 `in-toto-sign --verify` 验签通过（keyid `14bd27dd...`）。
  - `intoto_validate_statement` 用官方 protobuf 定义解析 `Statement v1`，校验 subject digest、predicate type 和 predicate，返回 `subjectCount=1`、`predicateType=https://slsa.dev/provenance/v1`。
- 边界：link 工具只验证 metadata 签名，不验证 layout 授权、阈值、step 顺序或产物哈希；statement 工具只验证结构，不验证 DSSE 签名。DSSE/attestation 签名由 Sigstore/Cosign 路径单独处理。
- SLSA 组件：官方 `slsa-verifier v2.7.1`，来源 <https://github.com/slsa-framework/slsa-verifier>。
- 实际调用：验证官方 `slsa-verifier-windows-amd64.exe` 及其 `.intoto.jsonl`，`--source-uri github.com/slsa-framework/slsa-verifier` 通过；验证器输出 TUF/Rekor 验证、builder `https://github.com/slsa-framework/slsa-github-generator/.github/workflows/builder_go_slsa3.yml@refs/tags/v2.0.0`、commit `ea584f4502babc6f60d9bc799dbbb13c1caa9ee6`。
- 边界：依赖 Sigstore TUF/Rekor 在线信任根；验证 provenance 的签名和 source 策略，不审计源代码或构建逻辑。

### Sigstore / Cosign

- 组件：官方 `cosign v3.1.4` windows/amd64。
- 实际调用：验证官方 release 的 `cosign_checksums.txt` 与 `cosign_checksums.txt.sigstore.json` bundle；身份 `keyless@projectsigstore.iam.gserviceaccount.com`，OIDC issuer `https://accounts.google.com`；cosign 输出 `Verified OK`。
- 额外核对：下载的 `cosign.exe` SHA-256 为 `cbe953...`，与官方 `cosign_checksums.txt` 第 27 行一致。
- 边界：验证签名、Fulcio 身份策略、Rekor 透明日志包含关系；不评价产物质量、构建可复现性或签名者是否应被信任。未签名、未上传、未做 tlog 监控。
- 环境：本机默认 `C:\Users\DW\.sigstore` 不可写；通过 `BCA_SIGSTORE_HOME` 把 cosign 的 TUF 缓存定向到 `.work/home`，未修改全局配置。验证过程中观察到一次 `tuf-repo-cdn.sigstore.dev` 的 EOF，重试后通过；工具本身不吞错，仍会向调用者传播真实失败。

### OpenLineage

- 组件：官方 `openlineage-python 1.54.0`，`FileTransport`。
- 实际调用：`openlineage_emit` 构造 `RunEvent`（`START`/`COMPLETE` 等）、`Job`、`Run`、输入/输出 `Dataset`，通过官方 FileTransport 写出事件；工具读取并返回事件 JSON。事件包含 `schemaURL: https://openlineage.io/spec/1-0-5/OpenLineage.json#/definitions/RunEvent`，`run.facets.tags` 包含 `openlineage_client_version=1.54.0`。
- 边界：未连接 Marquez 或其他 collector；FileTransport 只证明官方客户端成功序列化并写出事件，不证明下游接收/持久化。临时目录在 `.work` 下，调用结束即删除。

### C2PA

- 组件：官方 `c2patool v0.28.2` windows/amd64。
- 实际调用：
  - `c2pa_sign` 对官方 `sample/image.jpg` 和 `sample/test.json` 生成 `.work/fixtures/...jpg`；c2patool 使用内置测试证书，明确提示 “Using default private key and signing certificate. This is only valid for development.”
  - `c2pa_verify` 返回 `validationState: Valid`，成功码包含 `claimSignature.validated`、`assertion.dataHash.match`、`timeStamp.validated`，失败码包含 `signingCredential.untrusted`，`signingCredentialTrusted: false`。
- 边界：签名和内容哈希由 c2patool 验证；内置测试证书不受信任，不能作为生产身份。`validationState=Valid` 与签名证书不受信任可同时存在。未接生产签名服务、TSA 或自定义信任锚；操作者可通过 `C2PA_SIGN_CERT`/`C2PA_PRIVATE_KEY` 提供开发证书，但本测试未使用。

## 实际验证

运行：

```powershell
npx tsx scripts/check-provenance.ts
```

最近一次完整结果（2026-10-23）：

```text
PASS ots_inspect (18ms) block=358391 hash=sha256
PASS ots_verify (5511ms) bitcoin=[{"chain":"bitcoin","timestamp":1432827678,"height":358391}]
PASS risc0_verify_receipt (9529ms) chain=11155111 verifier=0x2a098988600d87650Fb061FfAff08B97149Fa84D tamper=VerificationFailed()
RETRY sigstore_verify_blob ... tuf-repo-cdn.sigstore.dev ... EOF
PASS sigstore_verify_blob (attempt 2) (3966ms) Verified OK
PASS slsa_verify_artifact (13212ms) PASSED: SLSA verification passed
PASS intoto_verify_link (406ms) signature verified
PASS intoto_validate_statement (163ms) https://in-toto.io/Statement/v1 subjects=1 predicate=https://slsa.dev/provenance/v1
PASS openlineage_emit (745ms) runId=d8fe7c0d-... schema=https://openlineage.io/spec/1-0-5/OpenLineage.json#/definitions/RunEvent
PASS c2pa_sign_and_verify (2205ms) state=Valid trusted=false failure=signingCredential.untrusted
PASS cheqd_resolve_did (3977ms) did:cheqd:testnet:b003df6f-ec8e-48dd-9a2b-7011c5cf0a5e methods=1
PASS cheqd_validate_did_document (2ms) did:cheqd:testnet:b003df6f-ec8e-48dd-9a2b-7011c5cf0a5e methods=1
PASS vc_issue_and_verify (24ms) proof=DataIntegrityProof/eddsa-rdfc-2022 tamper=rejected

All provenance checks passed.
```

本轮还执行了：

```powershell
npx tsc --noEmit
npm run build
git diff --check
```

均通过。Sigstore 的 TUF 重试是公开网络的一次瞬时 EOF，不是代码 mock 或 fallback；重试逻辑只在测试脚本中，工具仍将真实失败传播给调用者。

## 安全与信任边界

- 不接收私钥作为工具输入；C2PA 的开发证书只能由操作者通过 c2patool 自己的环境变量提供，工具不回显。
- W3C VC 的 Ed25519 私钥仅在单次 `vc_issue` 内存中存在；返回公钥文档供本地验证，密钥不落盘。
- 文件路径通过 `realpath` 限制在 `BCA_WORKING_ROOT`；拒绝符号链接逃逸；输出文件 `wx` 创建，拒绝覆盖。
- 外部命令使用 `spawn` 参数数组和 `shell: false`；没有任意命令/任意 URL 工具；超时、输出上限、子进程关闭。
- OpenTimestamps 官方库会把 lite-client 日志写到 stdout；`ots_verify` 在调用期间只过滤以 `Lite-client verification` 开头的这一行，避免污染 MCP stdio 协议，不影响其他输出。
- W3C VC 的 issue/verify 使用现有超时配置包裹；底层 jsonld 网络上下文加载超时后调用者收到明确错误。
- 错误由共享 `safeError` 继续处理；本轨道不打印环境变量值或签名私钥。
- RISC Zero/cheqd/Sigstore/SLSA/OpenTimestamps 只读；C2PA 和 VC 只做本地测试产物；没有公共链写入、资金划转、生产部署、付费订阅或 npm 发布。
- `BCA_SIGSTORE_HOME`、`BCA_RPC_URL`、resolver 等均由操作者配置；调用者不能传入任意服务 URL。
- 未修改 OpenCode、DeepSeek 或任何全局模型设置。

## 未完成与真实限制

1. **cheqd 账本写入**：未创建 DID、Status List 或 DID-Linked Resource；需要 fee payer 助记词、ncheq 和测试网资金。凭证签发只做了本地 W3C VC 路径，未走 cheqd Studio/Veramo/Credo。
2. **RISC Zero v5**：当前 main 的 v5 fixture 未在 Sepolia 5.0.0-rc.1 验证器上通过；该验证器在官方部署表中标记 stopped。没有 Windows 官方 proving 工具链，未本地生成/验证 v5 receipt。已验证的是官方 v3.0.0 fixture。
3. **C2PA 生产签名**：只使用内置测试证书；未接生产 HSM/远程签名、TSA 信任锚或自定义 trust list。
4. **Sigstore/SLSA 完整供应链策略**：未做签名、tlog 监控、源码审计或策略引擎；只验证了官方 release 的产物/provenance。
5. **W3C VC 状态**：未检查 `credentialStatus`、Bitstring Status List、撤销、发行者信任或 Presentation；未持久化密钥。
6. **OpenLineage 下游**：未接 collector/Marquez；只验证官方客户端发射与事件对象。
7. **OpenTimestamps 写入**：未 stamp/upgrade，未向公共日历提交；只验证官方既有证明。
8. **in-toto 布局**：未验证 layout、阈值、step 顺序或磁盘产物哈希；未验证 DSSE 签名。
9. **集成**：`src/toolkit.ts`、`src/cli/`、`src/mcp/`、`package.json`、`package-lock.json` 未由本轨道修改；由集成 Agent 接入 `provenanceTools(config)` 并统一依赖。原生 Codex 控制器审计未执行。

## 集成说明

集成 Agent 在 `src/toolkit.ts` 中增加：

```ts
import { provenanceTools } from './provenance/index.js';

const implementations = [
  ...evmTools(config),
  ...easTools(config),
  ...contentTools(config),
  ...ipfsTools(config),
  ...provenanceTools(config),
];
```

`provenanceTools()` 也支持零参调用（默认 `readConfig()`），但 `createToolkit()` 应显式传入同一个 `config`，保证工作根目录和超时一致。CLI/MCP 不需要新增分支；加入 toolkit 后自动出现在工具目录。

正式依赖按“Node.js 直接依赖”表写入 `package.json`，重新生成 `package-lock.json`；Python 依赖和三个官方二进制作为运行环境要求写入部署/使用文档，不进入 npm 包。`examples/provenance/` 提供可复现的 fixture 和命令；`scripts/check-provenance.ts` 是集成后的必要检查入口。

## 来源与许可

| 组件 | 来源 | 许可 |
| --- | --- | --- |
| OpenTimestamps JS | <https://github.com/opentimestamps/javascript-opentimestamps> | LGPL-3.0 |
| RISC Zero Ethereum | <https://github.com/risc0/risc0-ethereum> | Apache-2.0 |
| cheqd SDK | <https://github.com/cheqd/sdk> | Apache-2.0 |
| Digital Bazaar VC | <https://github.com/digitalbazaar/vc> | BSD-3-Clause |
| in-toto | <https://github.com/in-toto/in-toto> | Apache-2.0 |
| in-toto attestation | <https://github.com/in-toto/attestation> | Apache-2.0 |
| slsa-verifier | <https://github.com/slsa-framework/slsa-verifier> | Apache-2.0 |
| cosign | <https://github.com/sigstore/cosign> | Apache-2.0 |
| OpenLineage | <https://github.com/OpenLineage/OpenLineage> | Apache-2.0 |
| c2patool | <https://github.com/contentauth/c2patool> | Apache-2.0 / MIT |

所有官方文档和 release 的读取日期为 2026-10-23。`opentimestamps` 的 LGPL-3.0 依赖以 npm 包形式使用；若最终分发形式需要满足 LGPL 的替换/重新链接要求，由集成 Agent 在发布审查中确认。

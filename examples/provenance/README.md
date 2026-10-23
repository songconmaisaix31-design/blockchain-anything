# Provenance 示例与复现

本目录提供轨道 P 的真实测试输入和复现命令。所有测试产物只在本机 `.work/` 下生成；不向公共链、公共日历、透明日志或 npm 发布任何内容。

## 1. 安装 Node 依赖

在仓库根目录：

```powershell
npm ci
npm install --no-save --package-lock=false `
  opentimestamps@0.4.9 `
  "@cheqd/sdk@5.5.1" `
  "@digitalbazaar/vc@7.3.0" `
  "@digitalbazaar/data-integrity@2.5.0" `
  "@digitalbazaar/eddsa-rdfc-2022-cryptosuite@1.3.0" `
  "@digitalbazaar/ed25519-multikey@1.3.1" `
  "@digitalbazaar/credentials-context@3.2.0" `
  "@digitalbazaar/data-integrity-context@2.0.1" `
  "@digitalbazaar/multikey-context@2.0.1" `
  "@digitalbazaar/security-context@1.0.1"
```

`--no-save --package-lock=false` 不修改 `package.json`/`package-lock.json`；正式依赖由集成 Agent 写入。

## 2. Python 环境

```powershell
python -m venv .work/venv
.work/venv/Scripts/python -m pip install --upgrade pip
.work/venv/Scripts/python -m pip install "in-toto==3.1.0" "in-toto-attestation==0.9.3" "openlineage-python==1.54.0"
```

## 3. 官方二进制

```powershell
New-Item -ItemType Directory -Force .work/bin, .work/fixtures, .work/home | Out-Null

curl.exe -L -o .work/bin/cosign.exe `
  "https://github.com/sigstore/cosign/releases/download/v3.1.4/cosign-windows-amd64.exe"

curl.exe -L -o .work/bin/slsa-verifier.exe `
  "https://github.com/slsa-framework/slsa-verifier/releases/download/v2.7.1/slsa-verifier-windows-amd64.exe"

curl.exe -L -o .work/fixtures/slsa-verifier-windows-amd64.exe.intoto.jsonl `
  "https://github.com/slsa-framework/slsa-verifier/releases/download/v2.7.1/slsa-verifier-windows-amd64.exe.intoto.jsonl"

curl.exe -L -o .work/fixtures/cosign_checksums.txt `
  "https://github.com/sigstore/cosign/releases/download/v3.1.4/cosign_checksums.txt"
curl.exe -L -o .work/fixtures/cosign_checksums.txt.sigstore.json `
  "https://github.com/sigstore/cosign/releases/download/v3.1.4/cosign_checksums.txt.sigstore.json"

curl.exe -L -o .work/fixtures/c2patool.zip `
  "https://github.com/contentauth/c2patool/releases/download/v0.28.2/v0.28.2-x86_64-pc-windows-msvc.zip"
Expand-Archive -Force .work/fixtures/c2patool.zip .work/bin/c2patool
```

校验已记录的 SHA-256：

```powershell
Get-FileHash .work/bin/cosign.exe -Algorithm SHA256
# cbe953787074611f1334cbf37dc1cf953995bb8c45398eb4fc7bb781d29c1f2a

Get-FileHash .work/bin/slsa-verifier.exe -Algorithm SHA256
# 1d8f61ad747ecc3d375d2a563cebf2991748b7da1a9bda9a500804c3c499e3c0

Get-FileHash .work/bin/c2patool/c2patool/c2patool.exe -Algorithm SHA256
# b970c119c95539896c9a2a05b1bb160dce7da6874bafad08815c2bd6538f01e1
```

版本核对：

```powershell
.work/bin/cosign.exe version
.work/bin/slsa-verifier.exe version
.work/bin/c2patool/c2patool/c2patool.exe --version
```

## 4. 设置环境并运行检查

```powershell
$env:BCA_COSIGN_PATH = (Resolve-Path .work/bin/cosign.exe).Path
$env:BCA_SLSA_VERIFIER_PATH = (Resolve-Path .work/bin/slsa-verifier.exe).Path
$env:BCA_C2PATOOL_PATH = (Resolve-Path .work/bin/c2patool/c2patool/c2patool.exe).Path
$env:BCA_IN_TOTO_SIGN_PATH = (Resolve-Path .work/venv/Scripts/in-toto-sign.exe).Path
$env:BCA_PYTHON_PATH = (Resolve-Path .work/venv/Scripts/python.exe).Path
$env:BCA_SIGSTORE_HOME = (Resolve-Path .work/home).Path
$env:BCA_RISC0_VERIFIER = "0x2a098988600d87650Fb061FfAff08B97149Fa84D"
$env:BCA_RPC_URL = "https://ethereum-sepolia-rpc.publicnode.com"
$env:BCA_CHAIN_ID = "11155111"
$env:BCA_CHEQD_RESOLVER_URL = "https://resolver.cheqd.net/1.0/identifiers"

npx tsx scripts/check-provenance.ts
```

预期 14 项全通过。Sigstore/SLSA/OTS/RISC Zero/cheqd 验证依赖公开网络；测试脚本对这几项做最多 3 次重试，工具本身不吞错。

## 5. 工具级示例

集成前可以直接用 `tsx` 调用工厂；集成后通过 `bca call`/MCP 使用相同输入：

```ts
import { provenanceTools } from './src/provenance/index.js';
const tool = provenanceTools().find((item) => item.name === 'vc_issue')!;
const issued = await tool.execute({
  issuer: 'did:example:issuer',
  subject: 'did:example:subject',
  claims: { 'https://schema.org/name': 'Example' },
});
console.log(issued.credential);
```

常用输入：

- `ots_verify`: `{ "proofPath": "file.txt.ots", "targetPath": "file.txt" }`
- `risc0_verify_receipt`: `{ "seal": "0x…", "imageId": "0x…", "journalHex": "0x…" }`
- `sigstore_verify_blob`: `{ "blobPath": "artifact", "bundlePath": "artifact.sigstore.json", "certificateIdentity": "…", "certificateOidcIssuer": "https://accounts.google.com" }`
- `slsa_verify_artifact`: `{ "artifactPath": "artifact", "provenancePath": "artifact.intoto.jsonl", "sourceUri": "github.com/owner/repo" }`
- `intoto_verify_link`: `{ "linkPath": "build.link", "publicKeyPath": "key.pub" }`
- `intoto_validate_statement`: `{ "statementPath": "statement.json" }`
- `openlineage_emit`: `{ "jobNamespace": "ns", "jobName": "job", "eventType": "COMPLETE" }`
- `c2pa_sign`: `{ "sourcePath": "input.jpg", "manifestPath": "manifest.json", "outputPath": "signed.jpg" }`
- `c2pa_verify`: `{ "path": "signed.jpg" }`
- `cheqd_resolve_did`: `{ "did": "did:cheqd:testnet:…" }`
- `cheqd_validate_did_document`: `{ "path": "did-document.json" }`
- `vc_issue`: `{ "issuer": "did:example:issuer", "subject": "did:example:subject", "claims": { "https://schema.org/name": "Example" } }`
- `vc_verify`: `{ "credential": { … }, "publicKey": { … } }`

## 6. Fixture 来源

| 文件 | 来源/生成方式 |
| --- | --- |
| `fixtures/risc0-v3-receipt.json` | 官方 `risc0/risc0-ethereum` `contracts/test/TestReceiptV3_0.sol`（main `1d19771dc82531dced48fe7ff2e27bf6ad38bd59`，Apache-2.0）；journal 为 UTF-8 `just a simple receipt` |
| `fixtures/intoto-artifact.txt` | 本地生成的 33 字节测试文件 |
| `fixtures/intoto-key.pub` | 本地生成的 Ed25519 公钥；私钥未提交 |
| `fixtures/intoto-link.link` | 官方 `in-toto-record`/`in-toto-sign` 生成的真实签名 link；记录 artifact 的 SHA-256 `40f5ca95…` |
| `fixtures/intoto-statement.json` | 本地生成的 in-toto Statement v1，subject 为同一 artifact；predicate type `https://slsa.dev/provenance/v1` |
| `fixtures/cheqd-did-document.json` | 官方 cheqd resolver 返回的 `did:cheqd:testnet:b003df6f-ec8e-48dd-9a2b-7011c5cf0a5e` DID 文档；版本 ID `1838d661-447a-4cb6-8020-65a1b7849166`，2026-10-23 获取 |
| OpenTimestamps | 使用 `opentimestamps@0.4.9` 包内官方 `examples/hello-world.txt` 与 `.ots` |
| Sigstore/SLSA/C2PA | 对应官方 release 的 checksums/checksums bundle、provenance 和 c2patool `sample/` 文件 |

## 7. 限制

- 测试只覆盖本适配产生的路径，不重复上游库的完整测试套件。
- C2PA 内置测试证书不受信任；`validationState=Valid` 与 `signingCredential.untrusted` 同时出现是预期结果。
- RISC Zero 验证的是官方 v3.0.0 fixture，不是 v5；v5 当前未通过，见 `docs/integrations/provenance.md`。
- cheqd 未做账本写入/Status List；需要 fee payer 与 ncheq。
- 所有公开网络验证均可能因网络瞬时失败；工具传播真实错误，测试脚本有限重试。

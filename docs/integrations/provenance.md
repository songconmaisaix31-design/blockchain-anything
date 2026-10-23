# 来源与身份

BCA 将验证工作交给成熟工具，保留它们各自的结论，不合成一个泛化的“可信分数”。

| 组件 | 工具 | 需要的原生输入 / 配置 |
| --- | --- | --- |
| [OpenTimestamps](https://github.com/opentimestamps/opentimestamps-client) | ots_info、ots_verify | 安装 ots；.ots 与原文件；verify 还需官方客户端可用的 Bitcoin 数据源 |
| [Sigstore/Cosign](https://docs.sigstore.dev/cosign/verifying/verify/) | cosign_verify_blob | cosign 二进制、文件、bundle；显式公钥，或证书 identity+issuer |
| [SLSA verifier](https://github.com/slsa-framework/slsa-verifier) | slsa_verify | slsa-verifier、产物、provenance、预期 sourceUri，可选 sourceTag |
| [in-toto](https://in-toto.readthedocs.io/en/latest/command-line-tools/in-toto-verify.html) | intoto_verify | in-toto-verify、layout、签署公钥与 link 目录；inspection 会执行命令，要求写入开关与 submit |
| [C2PA](https://github.com/contentauth/c2patool) | c2pa_inspect | c2patool、媒体文件；返回原生 manifest 和 validation_status |
| [RISC Zero](https://github.com/risc0/risc0-ethereum/blob/main/contracts/src/IRiscZeroVerifier.sol) | risc0_verify | BCA_RPC_URL、BCA_CHAIN_ID、BCA_RISC0_VERIFIER；官方 seal、imageId、journalDigest；eth_call，不发交易 |
| [OpenLineage](https://openlineage.io/docs/integrations/about/) | openlineage_emit | 原生 RunEvent JSON 文件；BCA_OPENLINEAGE_URL、可选 TOKEN；发送 /api/v1/lineage，保留 facets |
| [did:key](https://github.com/ceramicnetwork/js-did/tree/main/packages/key-did-resolver) | did_key_resolve | 原生 did:key，离线解析 |
| [W3C VC-JWT](https://github.com/decentralized-identity/did-jwt-vc) | vc_verify_jwt | did-jwt-vc 校验签名和时间，当前解析器为 did:key |
| [cheqd](https://github.com/cheqd/sdk) | cheqd_did | BCA_CHEQD_RPC_URL，原生 did:cheqd 与可选 versionId |

`provenance_status` 检查官方二进制是否在 PATH；BCA 不自动下载执行程序。

RISC Zero 调用的是操作者选定的官方 verifier 合约，检查网络和代码存在后调用其原生 ABI；不是自研通用 ZK verifier。操作者负责从官方部署表选择合约并理解该部署的信任边界。

VC 返回 issuerTrusted=false、revocationChecked=false。C2PA 成功解析不代表内容陈述真实。OTS info 仅解析证明、返回 verified=false；verify 才请求时间戳验证。in-toto layout 属于可信代码，目录限制不阻止其 inspection 执行系统命令。

## 2026-10-23 验证

真实临时 Ed25519 密钥签发 VC-JWT：验签通过，篡改拒绝；did:key 解析通过。官方 OpenTimestamps 仓库 hello-world.txt.ots 经 ots_info 解析成功（指向 Bitcoin block 358391），未执行 Bitcoin 时间确认。

Cosign、SLSA、in-toto、C2PA 原生验证命令已适配，本轮缺已安装程序与配套真实签名样本；RISC Zero 缺匹配部署的有效 proof；cheqd 缺选定 RPC/DID；OpenLineage 缺操作者后端。以上不标为已验收。命令成功、网络确认、签发者信任分别保留原生含义。

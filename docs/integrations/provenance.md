# 来源与身份

BCA 将验证工作交给成熟工具，保留它们各自的结论，不合成一个泛化的“可信分数”。

| 组件 | 工具 | 需要的原生输入 / 配置 |
| --- | --- | --- |
| [OpenTimestamps](https://github.com/opentimestamps/opentimestamps-client) | ots_info、ots_verify | 安装 ots；.ots 与原文件；verify 还需官方客户端可用的 Bitcoin 数据源 |
| [Sigstore/Cosign](https://docs.sigstore.dev/cosign/verifying/verify/) | cosign_verify_blob | cosign 二进制、文件、bundle；显式公钥，或证书 identity+issuer |
| [SLSA verifier](https://github.com/slsa-framework/slsa-verifier) | slsa_verify | slsa-verifier、产物、provenance、预期 sourceUri，可选 sourceTag |
| [in-toto](https://in-toto.readthedocs.io/en/latest/command-line-tools/in-toto-verify.html) | intoto_verify | in-toto-verify、layout、签署公钥与 link 目录；inspection 会执行命令，要求写入开关与 submit |
| [C2PA](https://github.com/contentauth/c2patool) | c2pa_inspect | c2patool、媒体文件；返回原生 manifest 和 validation_results / validation_status |
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

追加实际验收：Cosign v3.1.4 的官方二进制/bundle、SLSA v2.7.1 的官方二进制/provenance、in-toto 实际任务的签署 layout/link 均通过原生验证；C2PA 官方 C.jpg 返回有效签名/内容 hash，报告同时保留 signingCredential.untrusted。RISC Zero 官方 V3 proof 在 Base Sepolia 验证合约上通过，错误 journalDigest 被拒绝；cheqd 测试网 DID 查询通过。

ots_verify 已实际执行，因没有 Bitcoin 节点 cookie/rpcpassword 而失败，未确认 Bitcoin 时间。OpenLineage 仍缺后端。详见 [本轮验收报告](../acceptance/2026-10-23.md)。

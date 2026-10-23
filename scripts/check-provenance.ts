import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { provenanceTools } from '../src/provenance/index.js';

// The check uses the locally downloaded official binaries and Python packages.
// Override any BCA_* variable to point at other installations.
process.env.BCA_COSIGN_PATH ??= resolve('.work/bin/cosign.exe');
process.env.BCA_SLSA_VERIFIER_PATH ??= resolve('.work/bin/slsa-verifier.exe');
process.env.BCA_C2PATOOL_PATH ??= resolve('.work/bin/c2patool/c2patool/c2patool.exe');
process.env.BCA_IN_TOTO_SIGN_PATH ??= resolve('.work/venv/Scripts/in-toto-sign.exe');
process.env.BCA_PYTHON_PATH ??= resolve('.work/venv/Scripts/python.exe');
process.env.BCA_SIGSTORE_HOME ??= resolve('.work/home');
process.env.BCA_RISC0_VERIFIER ??= '0x2a098988600d87650Fb061FfAff08B97149Fa84D';
process.env.BCA_RPC_URL ??= 'https://ethereum-sepolia-rpc.publicnode.com';
process.env.BCA_CHAIN_ID ??= '11155111';
process.env.BCA_CHEQD_RESOLVER_URL ??= 'https://resolver.cheqd.net/1.0/identifiers';

const tools = provenanceTools();
const byName = new Map(tools.map((tool) => [tool.name, tool]));
const failures: string[] = [];

function tool(name: string) {
  const found = byName.get(name);
  if (!found) throw new Error(`工具未导出：${name}`);
  return found;
}

async function invoke(name: string, input: unknown): Promise<any> {
  return await tool(name).execute(input);
}

async function check(name: string, run: () => Promise<string>, attempts = 1): Promise<void> {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const started = Date.now();
    try {
      const detail = await run();
      console.log(`PASS ${name}${attempt > 1 ? ` (attempt ${attempt})` : ''} (${Date.now() - started}ms) ${detail}`);
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (attempt < attempts) {
        console.warn(`RETRY ${name} (${Date.now() - started}ms) ${message}`);
        await new Promise((resolve) => setTimeout(resolve, 2000));
        continue;
      }
      failures.push(`${name}: ${message}`);
      console.error(`FAIL ${name} (${Date.now() - started}ms) ${message}`);
    }
  }
}

if (tools.length !== 14) failures.push(`期望 14 个工具，实际 ${tools.length}`);

await check('ots_inspect', async () => {
  const result = await invoke('ots_inspect', {
    proofPath: 'node_modules/opentimestamps/examples/hello-world.txt.ots',
  });
  if (!result.complete || result.bitcoin.length === 0) throw new Error('官方样例没有完整 Bitcoin attestation');
  return `block=${result.bitcoin[0].height} hash=${result.hashAlgorithm}`;
});

await check('ots_verify', async () => {
  const result = await invoke('ots_verify', {
    proofPath: 'node_modules/opentimestamps/examples/hello-world.txt.ots',
    targetPath: 'node_modules/opentimestamps/examples/hello-world.txt',
  });
  if (!result.verified) throw new Error(result.reason ?? '未验证');
  return `bitcoin=${JSON.stringify(result.attestations)}`;
}, 3);

await check('risc0_verify_receipt', async () => {
  const fixture = JSON.parse(readFileSync('examples/provenance/fixtures/risc0-v3-receipt.json', 'utf8'));
  const good = await invoke('risc0_verify_receipt', {
    seal: fixture.seal,
    imageId: fixture.imageId,
    journalHex: fixture.journalHex,
  });
  if (!good.verified) throw new Error(`官方 receipt 未通过：${JSON.stringify(good)}`);
  const bad = await invoke('risc0_verify_receipt', {
    seal: fixture.seal,
    imageId: fixture.imageId,
    journalHex: `0x${Buffer.from('tampered').toString('hex')}`,
  });
  if (bad.verified) throw new Error('篡改 journal 后仍通过');
  return `chain=${good.chainId} verifier=${good.verifier} tamper=${bad.revert ?? bad.revertData}`;
}, 3);

await check('sigstore_verify_blob', async () => {
  const result = await invoke('sigstore_verify_blob', {
    blobPath: '.work/fixtures/cosign_checksums.txt',
    bundlePath: '.work/fixtures/cosign_checksums.txt.sigstore.json',
    certificateIdentity: 'keyless@projectsigstore.iam.gserviceaccount.com',
    certificateOidcIssuer: 'https://accounts.google.com',
    timeoutMs: 180_000,
  });
  if (!result.verified) throw new Error('cosign 未返回 verified');
  return result.output.split('\n')[0] ?? 'Verified';
}, 3);

await check('slsa_verify_artifact', async () => {
  const result = await invoke('slsa_verify_artifact', {
    artifactPath: '.work/bin/slsa-verifier.exe',
    provenancePath: '.work/fixtures/slsa-verifier-windows-amd64.exe.intoto.jsonl',
    sourceUri: 'github.com/slsa-framework/slsa-verifier',
    timeoutMs: 180_000,
  });
  if (!result.verified) throw new Error('SLSA 未返回 verified');
  return result.output.split('\n').filter(Boolean).at(-1) ?? 'PASSED';
}, 2);

await check('intoto_verify_link', async () => {
  const result = await invoke('intoto_verify_link', {
    linkPath: 'examples/provenance/fixtures/intoto-link.link',
    publicKeyPath: 'examples/provenance/fixtures/intoto-key.pub',
  });
  if (!result.verified) throw new Error(`in-toto link 验签失败：${result.output}`);
  return 'signature verified';
});

await check('intoto_validate_statement', async () => {
  const result = await invoke('intoto_validate_statement', {
    statementPath: 'examples/provenance/fixtures/intoto-statement.json',
  });
  if (!result.valid) throw new Error(`statement 校验失败：${result.error}`);
  return `${result.type} subjects=${result.subjectCount} predicate=${result.predicateType}`;
});

await check('openlineage_emit', async () => {
  const result = await invoke('openlineage_emit', {
    jobNamespace: 'bca.provenance.check',
    jobName: 'run',
    eventType: 'COMPLETE',
    inputs: [{ namespace: 'file:///bca', name: 'input.txt' }],
    outputs: [{ namespace: 'file:///bca', name: 'output.txt' }],
  });
  if (!result.emitted || result.event.eventType !== 'COMPLETE') throw new Error('未发射 COMPLETE 事件');
  return `runId=${result.runId} schema=${result.event.schemaURL}`;
});

await check('c2pa_sign_and_verify', async () => {
  const outputPath = `.work/fixtures/check-c2pa-${randomUUID()}.jpg`;
  const signed = await invoke('c2pa_sign', {
    sourcePath: '.work/bin/c2patool/c2patool/sample/image.jpg',
    manifestPath: '.work/bin/c2patool/c2patool/sample/test.json',
    outputPath,
  });
  if (!signed.signed) throw new Error('C2PA 签名未返回 signed');
  const verified = await invoke('c2pa_verify', { path: outputPath });
  if (verified.validationState !== 'Valid') throw new Error(`validationState=${verified.validationState}`);
  if (!verified.signatureValid || !verified.dataHashValid) throw new Error('签名或内容哈希未通过');
  if (verified.signingCredentialTrusted) throw new Error('内置测试证书不应被报告为受信任');
  return `state=${verified.validationState} trusted=${verified.signingCredentialTrusted} failure=${verified.failureCodes.join(',')}`;
});

await check('cheqd_resolve_did', async () => {
  const did = 'did:cheqd:testnet:b003df6f-ec8e-48dd-9a2b-7011c5cf0a5e';
  const result = await invoke('cheqd_resolve_did', { did });
  if (!result.validation.valid) throw new Error('DID 文档未通过 cheqd SDK 校验');
  return `${result.document.id} methods=${result.validation.verificationMethods.length}`;
}, 3);

await check('cheqd_validate_did_document', async () => {
  const result = await invoke('cheqd_validate_did_document', {
    path: 'examples/provenance/fixtures/cheqd-did-document.json',
  });
  if (!result.valid) throw new Error('本地 DID 文档未通过 cheqd SDK 校验');
  return `${result.did} methods=${result.verificationMethods.length}`;
});

await check('vc_issue_and_verify', async () => {
  const issued = await invoke('vc_issue', {
    issuer: 'did:example:bca-issuer',
    subject: 'did:example:bca-subject',
    claims: { 'https://schema.org/name': 'BCA provenance check' },
  });
  const verified = await invoke('vc_verify', {
    credential: issued.credential,
    publicKey: issued.publicKey,
  });
  if (!verified.verified) throw new Error(`VC 验证失败：${JSON.stringify(verified.errors)}`);
  const tampered = structuredClone(issued.credential);
  tampered.credentialSubject.id = 'did:example:attacker';
  const rejected = await invoke('vc_verify', { credential: tampered, publicKey: issued.publicKey });
  if (rejected.verified) throw new Error('篡改后的 VC 仍通过');
  return `proof=${issued.credential.proof.type}/${issued.credential.proof.cryptosuite} tamper=rejected`;
});

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed:`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log('\nAll provenance checks passed.');
}

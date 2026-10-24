import { z } from 'zod';
import type { Config } from '../config.js';
import { requireWrites } from '../config.js';
import { defineTool } from '../types.js';
import { addressSchema, bytesSchema, uidSchema, submitSchema } from '../providers/common.js';
import { readWorkingFile } from '../providers/files.js';
import { endpointEnv, requestBytes } from '../providers/http.js';
import { resolveWorkingDir, resolveWorkingPath, run, runVersion } from '../development/exec.js';

const path = z.string().min(1);

async function verifiedCommand(config: Config, command: string, args: string[], cwd?: string) {
  const result = await run(command, args, { cwd: cwd ?? await resolveWorkingDir(config), timeoutMs: config.timeoutMs, maxBytes: config.maxReadBytes });
  if (result.exitCode !== 0) throw new Error(`${command} 验证失败 (${result.exitCode})：${result.stderr || result.stdout}`);
  return { exitCode: 0, stdout: result.stdout, stderr: result.stderr };
}

export function provenanceTools(config: Config) {
  return [
    defineTool('provenance_status', '检查已安装的官方来源验证程序；不自动安装。', z.strictObject({}), true,
      async () => {
        const cwd = await resolveWorkingDir(config);
        const names = ['ots', 'cosign', 'slsa-verifier', 'in-toto-verify', 'c2patool'];
        return Object.fromEntries(await Promise.all(names.map(async (name) => [name, await runVersion(name, cwd, config.timeoutMs)])));
      }),
    defineTool('ots_info', '官方 OpenTimestamps 客户端解析 .ots 证明；不声称已确认 Bitcoin 时间。', z.strictObject({ proof: path }), true,
      async ({ proof }) => ({ ...await verifiedCommand(config, 'ots', ['info', await resolveWorkingPath(config, proof)]), verified: false })),
    defineTool('ots_verify', '官方 OpenTimestamps 客户端验证文件和 .ots，保留原生验证报告。', z.strictObject({ proof: path, file: path }), true,
      async ({ proof, file }) => verifiedCommand(config, 'ots', ['verify', '-f', await resolveWorkingPath(config, file), await resolveWorkingPath(config, proof)])),
    defineTool('cosign_verify_blob', '官方 Cosign 根据显式公钥或证书身份验证 Sigstore bundle 与文件。', z.strictObject({ file: path, bundle: path, publicKey: path.optional(), identity: z.string().min(1).optional(), issuer: z.url().optional() }), true,
      async ({ file, bundle, publicKey, identity, issuer }) => {
        if ((!publicKey && !(identity && issuer)) || (publicKey && (identity || issuer))) throw new Error('选择 publicKey，或同时提供 identity 和 issuer');
        const args = ['verify-blob', '--bundle', await resolveWorkingPath(config, bundle)];
        if (publicKey) args.push('--key', await resolveWorkingPath(config, publicKey));
        else args.push('--certificate-identity', identity!, '--certificate-oidc-issuer', issuer!);
        args.push(await resolveWorkingPath(config, file));
        return { ...await verifiedCommand(config, 'cosign', args), verified: true };
      }),
    defineTool('slsa_verify', '官方 slsa-verifier 检查构建产物、来源证明和预期源仓库。', z.strictObject({ file: path, provenance: path, sourceUri: z.string().min(1), sourceTag: z.string().min(1).optional() }), true,
      async ({ file, provenance, sourceUri, sourceTag }) => {
        const args = ['verify-artifact', await resolveWorkingPath(config, file), '--provenance-path', await resolveWorkingPath(config, provenance), '--source-uri', sourceUri];
        if (sourceTag) args.push('--source-tag', sourceTag);
        return { ...await verifiedCommand(config, 'slsa-verifier', args), verified: true };
      }),
    defineTool('intoto_verify', '官方 in-toto 验证供应链 layout 和 links。layout 的 inspection 可执行命令，仅用于操作者信任的工作区，需显式授权。', z.strictObject({ layout: path, keys: z.array(path).min(1).max(16), dir: path.default('.'), submit: submitSchema }), false,
      async ({ layout, keys, dir }) => {
        requireWrites(config, false);
        const cwd = await resolveWorkingDir(config, dir);
        return { ...await verifiedCommand(config, 'in-toto-verify', ['--layout', await resolveWorkingPath(config, layout), '--verification-keys', ...await Promise.all(keys.map((key) => resolveWorkingPath(config, key)))], cwd), verified: true };
      }),
    defineTool('c2pa_inspect', '官方 c2patool 读取并验证媒体 manifest；返回完整原生 validation_status，不将命令成功等同于内容可信。', z.strictObject({ file: path }), true,
      async ({ file }) => {
        const result = await verifiedCommand(config, 'c2patool', [await resolveWorkingPath(config, file), '--detailed']);
        return { report: JSON.parse(result.stdout), stderr: result.stderr };
      }),
    defineTool('risc0_verify', '通过 viem 调用操作者配置的官方 IRiscZeroVerifier.verify；eth_call 验证 Groth16 seal，不提交交易。', z.strictObject({ seal: bytesSchema, imageId: uidSchema, journalDigest: uidSchema }), true,
      async ({ seal, imageId, journalDigest }) => {
        const { createPublicClient, http, parseAbi } = await import('viem');
        const address = addressSchema.parse(process.env.BCA_RISC0_VERIFIER) as `0x${string}`;
        const client = createPublicClient({ transport: http(endpointEnv('BCA_RPC_URL'), { timeout: config.timeoutMs, retryCount: 0 }) });
        if (!config.chainId || BigInt(await client.getChainId()) !== config.chainId) throw new Error('RISC Zero RPC 与 BCA_CHAIN_ID 不匹配');
        if (!await client.getCode({ address })) throw new Error('RISC Zero verifier 地址没有合约');
        await client.readContract({ address, abi: parseAbi(['function verify(bytes seal, bytes32 imageId, bytes32 journalDigest) view']), functionName: 'verify', args: [seal as `0x${string}`, imageId as `0x${string}`, journalDigest as `0x${string}`] });
        return { verified: true, verifier: address, chainId: config.chainId, imageId, journalDigest };
      }),
    defineTool('openlineage_emit', '通过 OpenLineage 官方 HTTP 协议提交已有 RunEvent 文件，保留原生 facets。', z.strictObject({ path, submit: submitSchema }), false,
      async ({ path: file }) => {
        requireWrites(config, false);
        const bytes = await readWorkingFile(config, file);
        z.object({ eventType: z.enum(['START', 'RUNNING', 'COMPLETE', 'ABORT', 'FAIL', 'OTHER']), eventTime: z.iso.datetime({ offset: true }), run: z.object({ runId: z.uuid() }), job: z.object({ namespace: z.string().min(1), name: z.string().min(1) }), producer: z.url(), schemaURL: z.url() }).parse(JSON.parse(bytes.toString('utf8')));
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (process.env.BCA_OPENLINEAGE_TOKEN) headers.Authorization = `Bearer ${process.env.BCA_OPENLINEAGE_TOKEN}`;
        await requestBytes(config, `${endpointEnv('BCA_OPENLINEAGE_URL')}/api/v1/lineage`, { method: 'POST', headers, body: new Uint8Array(bytes) });
        return { accepted: true };
      }),
  ];
}

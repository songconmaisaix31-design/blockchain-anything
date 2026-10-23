import { z } from 'zod';
import type { Config } from '../config.js';
import { defineTool } from '../types.js';
import { readProvenanceConfig } from './config.js';
import { resolveExisting } from './files.js';
import { binaryTimeout, toolEnvironment } from './binaries.js';
import { commandOutput, requireSuccess, runCommand } from './exec.js';

export function sigstoreTools(config: Config) {
  const provenance = readProvenanceConfig(config);
  return [
    defineTool('sigstore_verify_blob', '使用官方 cosign 对工作根目录内的 blob 和 Sigstore bundle 执行真实 verify-blob；强制校验 Fulcio 证书身份、OIDC issuer、Rekor 透明日志包含证明和 blob 签名。',
      z.strictObject({
        blobPath: z.string().min(1),
        bundlePath: z.string().min(1),
        certificateIdentity: z.string().min(1),
        certificateOidcIssuer: z.string().url(),
        timeoutMs: z.number().int().positive().max(300_000).optional(),
      }),
      true,
      async ({ blobPath, bundlePath, certificateIdentity, certificateOidcIssuer, timeoutMs }) => {
        const blob = await resolveExisting(provenance, blobPath);
        const bundle = await resolveExisting(provenance, bundlePath);
        const env = await toolEnvironment(provenance);
        const result = await runCommand(provenance.cosignPath, [
          'verify-blob',
          '--bundle', bundle,
          '--certificate-identity', certificateIdentity,
          '--certificate-oidc-issuer', certificateOidcIssuer,
          blob,
        ], { timeoutMs: binaryTimeout(provenance, timeoutMs), env });
        requireSuccess('cosign', result, 'Sigstore 验证失败');
        return {
          verified: true,
          tool: 'cosign',
          blobPath,
          bundlePath,
          certificateIdentity,
          certificateOidcIssuer,
          output: commandOutput(result),
          trustBoundary: '验证了签名、Fulcio 身份策略和 Rekor 透明日志包含关系；不评价产物质量、构建可复现性或签名者是否应被信任。',
        };
      }),
  ];
}

import { z } from 'zod';
import type { Config } from '../config.js';
import { defineTool } from '../types.js';
import { readProvenanceConfig } from './config.js';
import { resolveExisting } from './files.js';
import { binaryTimeout, toolEnvironment } from './binaries.js';
import { commandOutput, requireSuccess, runCommand } from './exec.js';

const sourceUri = z.string().regex(/^github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/, '必须为 github.com/<owner>/<repo>');

export function slsaTools(config: Config) {
  const provenance = readProvenanceConfig(config);
  return [
    defineTool('slsa_verify_artifact', '使用官方 slsa-verifier 对 artifact 和 in-toto/SLSA provenance 执行真实验证：校验产物摘要、DSSE 签名、Sigstore 透明日志和 source URI 策略。',
      z.strictObject({
        artifactPath: z.string().min(1),
        provenancePath: z.string().min(1),
        sourceUri,
        sourceTag: z.string().regex(/^[A-Za-z0-9._/-]+$/).optional(),
        builderId: z.string().min(1).optional(),
        printProvenance: z.boolean().optional(),
        timeoutMs: z.number().int().positive().max(300_000).optional(),
      }),
      true,
      async ({ artifactPath, provenancePath, sourceUri: uri, sourceTag, builderId, printProvenance, timeoutMs }) => {
        const artifact = await resolveExisting(provenance, artifactPath);
        const prov = await resolveExisting(provenance, provenancePath);
        const env = await toolEnvironment(provenance);
        const args = [
          'verify-artifact', artifact,
          '--provenance-path', prov,
          '--source-uri', uri,
        ];
        if (sourceTag) args.push('--source-tag', sourceTag);
        if (builderId) args.push('--builder-id', builderId);
        if (printProvenance) args.push('--print-provenance');
        const result = await runCommand(provenance.slsaVerifierPath, args, { timeoutMs: binaryTimeout(provenance, timeoutMs), env });
        requireSuccess('slsa-verifier', result, 'SLSA 验证失败');
        return {
          verified: true,
          tool: 'slsa-verifier',
          artifactPath,
          provenancePath,
          sourceUri: uri,
          sourceTag: sourceTag ?? null,
          builderId: builderId ?? null,
          output: commandOutput(result),
          trustBoundary: '验证了 provenance 的签名、透明日志和 source URI 策略以及产物摘要；不评价源代码质量或构建逻辑是否正确。',
        };
      }),
  ];
}

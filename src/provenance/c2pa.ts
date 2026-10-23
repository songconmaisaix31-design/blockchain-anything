import { z } from 'zod';
import type { Config } from '../config.js';
import { defineTool } from '../types.js';
import { readProvenanceConfig } from './config.js';
import { resolveExisting, resolveOutput } from './files.js';
import { binaryTimeout } from './binaries.js';
import { commandOutput, requireSuccess, runCommand } from './exec.js';

interface C2paReport {
  validation_state?: string;
  active_manifest?: string;
  manifests?: Record<string, { signature_info?: { alg?: string; issuer?: string; common_name?: string; time?: string } }>;
  validation_results?: {
    activeManifest?: {
      success?: Array<{ code?: string; explanation?: string }>;
      informational?: Array<{ code?: string; explanation?: string }>;
      failure?: Array<{ code?: string; explanation?: string }>;
    };
  };
}

function parseReport(stdout: string): C2paReport {
  try {
    return JSON.parse(stdout) as C2paReport;
  } catch {
    throw new Error(`c2patool 输出不是 JSON：${stdout.slice(0, 500)}`);
  }
}

function summarize(report: C2paReport) {
  const active = report.active_manifest;
  const results = report.validation_results?.activeManifest;
  const successCodes = (results?.success ?? []).map((item) => item.code).filter((code): code is string => Boolean(code));
  const failureCodes = (results?.failure ?? []).map((item) => item.code).filter((code): code is string => Boolean(code));
  const informationalCodes = (results?.informational ?? []).map((item) => item.code).filter((code): code is string => Boolean(code));
  const signer = active && report.manifests ? report.manifests[active]?.signature_info : undefined;
  return {
    validationState: report.validation_state ?? null,
    activeManifest: active ?? null,
    successCodes,
    failureCodes,
    informationalCodes,
    signer: signer ? {
      algorithm: signer.alg ?? null,
      issuer: signer.issuer ?? null,
      commonName: signer.common_name ?? null,
      time: signer.time ?? null,
    } : null,
    signingCredentialTrusted: !failureCodes.includes('signingCredential.untrusted'),
    signatureValid: successCodes.includes('claimSignature.validated'),
    dataHashValid: successCodes.includes('assertion.dataHash.match'),
  };
}

export function c2paTools(config: Config) {
  const provenance = readProvenanceConfig(config);
  return [
    defineTool('c2pa_sign', '使用官方 c2patool 将 C2PA manifest 写入工作根目录内的媒体文件并生成新文件；默认使用 c2patool 内置测试证书，操作者可通过 C2PA_SIGN_CERT/C2PA_PRIVATE_KEY 提供真实证书。',
      z.strictObject({
        sourcePath: z.string().min(1),
        manifestPath: z.string().min(1),
        outputPath: z.string().min(1),
        timeoutMs: z.number().int().positive().max(300_000).optional(),
      }),
      false,
      async ({ sourcePath, manifestPath, outputPath, timeoutMs }) => {
        const source = await resolveExisting(provenance, sourcePath);
        const manifest = await resolveExisting(provenance, manifestPath);
        const output = await resolveOutput(provenance, outputPath);
        const result = await runCommand(provenance.c2patoolPath, [source, '-m', manifest, '-o', output], {
          timeoutMs: binaryTimeout(provenance, timeoutMs),
        });
        requireSuccess('c2patool', result, 'C2PA 签名失败');
        const report = parseReport(result.stdout);
        const summary = summarize(report);
        const signerMode = process.env.C2PA_SIGN_CERT && process.env.C2PA_PRIVATE_KEY
          ? 'operator-environment'
          : 'builtin-test-cert';
        return {
          signed: true,
          tool: 'c2patool',
          sourcePath,
          manifestPath,
          outputPath,
          signerMode,
          developmentSigner: signerMode === 'builtin-test-cert',
          ...summary,
          trustBoundary: '签名和内容哈希由 c2patool 校验；内置测试证书不受信任，不能作为生产身份。validationState=Valid 与 signingCredential.untrusted 可同时出现。',
        };
      }),
    defineTool('c2pa_verify', '使用官方 c2patool 读取并验证工作根目录内媒体文件的 C2PA manifest，返回官方验证状态、成功/失败码、签名者和内容哈希结果。',
      z.strictObject({
        path: z.string().min(1),
        timeoutMs: z.number().int().positive().max(300_000).optional(),
      }),
      true,
      async ({ path, timeoutMs }) => {
        const file = await resolveExisting(provenance, path);
        const result = await runCommand(provenance.c2patoolPath, [file], {
          timeoutMs: binaryTimeout(provenance, timeoutMs),
        });
        requireSuccess('c2patool', result, 'C2PA 验证失败');
        const report = parseReport(result.stdout);
        return {
          verified: report.validation_state === 'Valid',
          tool: 'c2patool',
          path,
          ...summarize(report),
          trustBoundary: 'validationState 由 c2patool 依据内置信任锚和证书状态给出；signingCredential.untrusted 表示签名证书未被信任，不等于签名或内容哈希无效。',
        };
      }),
  ];
}

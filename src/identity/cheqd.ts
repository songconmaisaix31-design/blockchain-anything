import { z } from 'zod';
import { validateSpecCompliantPayload } from '@cheqd/sdk';
import type { Config } from '../config.js';
import { defineTool } from '../types.js';
import { readProvenanceConfig, requireEndpoint } from '../provenance/config.js';
import { readWorkingJson } from '../provenance/files.js';

const DID_PATTERN = /^did:cheqd:(mainnet|testnet):[A-Za-z0-9._:-]+$/;

function assertDid(did: string): { network: string } {
  const match = DID_PATTERN.exec(did);
  if (!match) throw new Error('必须为 did:cheqd:mainnet|testnet:<method-specific-id>');
  return { network: match[1] ?? 'unknown' };
}

function validateDocument(document: Record<string, unknown>, did: string) {
  if (document.id !== did) throw new Error(`DID 文档 id 与请求不一致：${String(document.id)}`);
  const result = validateSpecCompliantPayload(document as any);
  if (!result.valid) throw new Error(`cheqd DID 文档未通过 SDK 规格校验：${result.error ?? '未知原因'}`);
  return result;
}

export function cheqdTools(config: Config) {
  const provenance = readProvenanceConfig(config);
  return [
    defineTool('cheqd_resolve_did', '通过 cheqd 官方 resolver 解析 did:cheqd DID，并使用官方 @cheqd/sdk 的 validateSpecCompliantPayload 校验 DID 文档结构；返回解析元数据与验证方法。',
      z.strictObject({
        did: z.string().min(1),
        timeoutMs: z.number().int().positive().max(120_000).optional(),
      }),
      true,
      async ({ did, timeoutMs }) => {
        const { network } = assertDid(did);
        const resolver = requireEndpoint(provenance.cheqdResolverUrl, 'BCA_CHEQD_RESOLVER_URL');
        const url = `${resolver}/${did}`;
        let response: Response;
        try {
          response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs ?? provenance.timeoutMs) });
        } catch (error) {
          const cause = error instanceof Error && error.cause ? `: ${String(error.cause)}` : '';
          throw new Error(`cheqd resolver 请求失败${cause}`);
        }
        const body = await response.json().catch(() => undefined) as
          | { didDocument?: Record<string, unknown>; didDocumentMetadata?: unknown; didResolutionMetadata?: { error?: string; contentType?: string } }
          | undefined;
        if (!response.ok) {
          const reason = body?.didResolutionMetadata?.error ?? `HTTP ${response.status}`;
          throw new Error(`cheqd resolver 解析失败：${reason}`);
        }
        if (body?.didResolutionMetadata?.error) throw new Error(`cheqd resolver 解析失败：${body.didResolutionMetadata.error}`);
        if (!body?.didDocument) throw new Error('cheqd resolver 响应缺少 didDocument');
        const validation = validateDocument(body.didDocument, did);
        return {
          did,
          network,
          resolver: resolver,
          document: body.didDocument,
          metadata: body.didDocumentMetadata ?? null,
          validation: {
            valid: validation.valid,
            verificationMethods: validation.protobufVerificationMethod ?? [],
            checkedBy: '@cheqd/sdk validateSpecCompliantPayload',
          },
          trustBoundary: 'DID 文档来自操作者配置的官方 resolver；SDK 只校验文档结构与 cheqd 规格，不独立验证账本交易、发行者身份或服务端点可信度。',
        };
      }),
    defineTool('cheqd_validate_did_document', '使用官方 @cheqd/sdk 校验工作根目录内的 cheqd DID 文档 JSON 是否符合 cheqd 规格，并检查 did:cheqd 方法与文档 id。',
      z.strictObject({ path: z.string().min(1) }),
      true,
      async ({ path }) => {
        const value = await readWorkingJson(provenance, path);
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('DID 文档必须为 JSON 对象');
        const document = value as Record<string, unknown>;
        if (typeof document.id !== 'string') throw new Error('DID 文档缺少字符串 id');
        const { network } = assertDid(document.id);
        const validation = validateDocument(document, document.id);
        return {
          path,
          did: document.id,
          network,
          valid: validation.valid,
          verificationMethods: validation.protobufVerificationMethod ?? [],
          trustBoundary: '只做结构与 cheqd 规格校验；未查询账本，不能据此确认 DID 已注册、已撤销或由某主体控制。',
        };
      }),
  ];
}

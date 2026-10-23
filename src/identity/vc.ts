import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import * as vc from '@digitalbazaar/vc';
import { DataIntegrityProof } from '@digitalbazaar/data-integrity';
import { cryptosuite } from '@digitalbazaar/eddsa-rdfc-2022-cryptosuite';
import * as Ed25519Multikey from '@digitalbazaar/ed25519-multikey';
import { contexts as credentialsContexts } from '@digitalbazaar/credentials-context';
import { contexts as dataIntegrityContexts } from '@digitalbazaar/data-integrity-context';
import { contexts as multikeyContexts } from '@digitalbazaar/multikey-context';
import { contexts as securityContexts } from '@digitalbazaar/security-context';
import type { Config } from '../config.js';
import { defineTool } from '../types.js';

const bundledContexts = new Map<string, unknown>();
for (const source of [credentialsContexts, dataIntegrityContexts, multikeyContexts, securityContexts]) {
  for (const [url, document] of source) bundledContexts.set(url, document);
}

async function documentLoader(url: string): Promise<{ contextUrl: string | null; documentUrl: string; document: unknown }> {
  const bundled = bundledContexts.get(url);
  if (bundled) return { contextUrl: null, documentUrl: url, document: bundled };
  return vc.defaultDocumentLoader(url);
}

const keyDocument = z.strictObject({
  '@context': z.string().optional(),
  id: z.string().min(1),
  type: z.literal('Multikey'),
  controller: z.string().min(1),
  publicKeyMultibase: z.string().min(1),
});

const claims = z.record(z.string().url(), z.union([z.string(), z.number(), z.boolean()]));

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} 超过 ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function vcTools(config: Config) {
  return [
    defineTool('vc_issue', '使用官方 @digitalbazaar/vc 与 eddsa-rdfc-2022 DataIntegrityProof 在本地生成 Ed25519 密钥并签署 W3C VC 2.0 凭证；返回凭证、公钥和签发身份边界。',
      z.strictObject({
        issuer: z.string().min(1).refine((value) => !value.includes('#'), 'issuer 不得包含 fragment').refine((value) => value.startsWith('did:') || /^https?:\/\//.test(value), 'issuer 必须为 DID 或 HTTP(S) URI'),
        subject: z.string().min(1),
        claims: claims.optional(),
        validFrom: z.string().min(1).optional(),
        validUntil: z.string().min(1).optional(),
      }),
      false,
      async ({ issuer, subject, claims: extraClaims, validFrom, validUntil }) => {
        if (extraClaims && Object.hasOwn(extraClaims, 'id')) throw new Error('claims 不得包含 id，subject 由 subject 字段决定');
        const key = await Ed25519Multikey.generate({ controller: issuer });
        const publicKey = await key.export({ publicKey: true, includeContext: true });
        const suite = new DataIntegrityProof({ signer: key.signer(), cryptosuite });
        const credential = {
          '@context': ['https://www.w3.org/ns/credentials/v2'],
          id: `urn:uuid:${randomUUID()}`,
          type: ['VerifiableCredential'],
          issuer,
          validFrom: validFrom ?? new Date().toISOString(),
          ...(validUntil ? { validUntil } : {}),
          credentialSubject: { id: subject, ...(extraClaims ?? {}) },
        };
        const signed = await withTimeout(vc.issue({ credential, suite, documentLoader }), config.timeoutMs, 'VC 签发');
        return {
          credential: signed,
          publicKey,
          suite: 'DataIntegrityProof/eddsa-rdfc-2022',
          issuerAnchoring: 'ephemeral-local-key-not-published',
          trustBoundary: '签名证明持有本次生成的 Ed25519 私钥；密钥未发布或锚定，issuer 字段本身不建立外部身份信任。凭证未检查状态或撤销。',
        };
      }),
    defineTool('vc_verify', '使用官方 @digitalbazaar/vc 验证 W3C VC 的 DataIntegrityProof 签名和有效期；调用者需提供签发时返回的公钥文档。不检查 credentialStatus、撤销或发行者信任。',
      z.strictObject({
        credential: z.record(z.string(), z.unknown()),
        publicKey: keyDocument,
        controllerDocument: z.record(z.string(), z.unknown()).optional(),
      }),
      true,
      async ({ credential, publicKey, controllerDocument }) => {
        const controllerDoc = controllerDocument ?? {
          '@context': ['https://www.w3.org/ns/did/v1', 'https://w3id.org/security/multikey/v1'],
          id: publicKey.controller,
          assertionMethod: [publicKey],
        };
        const local = new Map<string, unknown>([
          [publicKey.id, publicKey],
          [publicKey.controller, controllerDoc],
        ]);
        const loader = async (url: string) => {
          const found = local.get(url);
          if (found) return { contextUrl: null, documentUrl: url, document: found };
          return documentLoader(url);
        };
        const suite = new DataIntegrityProof({ cryptosuite });
        const result = await withTimeout(
          vc.verifyCredential({ credential, suite, documentLoader: loader }),
          config.timeoutMs,
          'VC 验证',
        );
        const rawErrors = result.error?.errors;
        const errors = Array.isArray(rawErrors)
          ? rawErrors.map((item: any) => item?.message ?? String(item))
          : result.error?.message ? [result.error.message] : [];
        return {
          verified: Boolean(result.verified),
          results: Array.isArray(result.results)
            ? result.results.map((item: any) => ({ verified: Boolean(item.verified), error: item.error?.message ?? null }))
            : [],
          errors,
          checks: {
            proofRequired: true,
            signatureChecked: true,
            validityPeriodChecked: true,
            credentialStatusChecked: false,
            revocationChecked: false,
            issuerTrustChecked: false,
          },
          trustBoundary: '验证了 DataIntegrityProof/eddsa-rdfc-2022 签名与凭证有效期；未检查 credentialStatus、撤销列表、发行者授权或声明真实性。',
        };
      }),
  ];
}

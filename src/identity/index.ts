import { z } from 'zod';
import type { Config } from '../config.js';
import { defineTool } from '../types.js';
import { endpointEnv } from '../providers/http.js';

export function identityTools(config: Config) {
  return [
    defineTool('did_key_resolve', '成熟 key-did-resolver 离线解析 did:key。', z.strictObject({ did: z.string().startsWith('did:key:') }), true,
      async ({ did }) => {
        const { Resolver } = await import('did-resolver');
        const { getResolver } = await import('key-did-resolver');
        const result = await new Resolver(getResolver()).resolve(did);
        if (result.didResolutionMetadata.error) throw new Error(`DID 解析失败：${result.didResolutionMetadata.error}`);
        return result;
      }),
    defineTool('vc_verify_jwt', 'did-jwt-vc 校验 W3C VC-JWT 签名与有效期，支持 did:key；不代表签发者受信或吊销状态已检查。', z.strictObject({ jwt: z.string().min(1).max(262144) }), true,
      async ({ jwt }) => {
        const { Resolver } = await import('did-resolver');
        const { getResolver } = await import('key-did-resolver');
        const { verifyCredential } = await import('did-jwt-vc');
        const verified = await verifyCredential(jwt, new Resolver(getResolver()));
        return { verified: verified.verified, issuer: verified.issuer, credential: verified.verifiableCredential, issuerTrusted: false, revocationChecked: false };
      }),
    defineTool('cheqd_did', '通过官方 cheqd SDK 查询原生 DID 文档及版本元数据。', z.strictObject({ did: z.string().regex(/^did:cheqd:(?:mainnet|testnet):[a-zA-Z0-9-]+$/), versionId: z.string().optional() }), true,
      async ({ did, versionId }) => {
        const { CheqdQuerier, setupDidExtension } = await import('@cheqd/sdk');
        const client = await CheqdQuerier.connectWithExtensions(endpointEnv('BCA_CHEQD_RPC_URL'), setupDidExtension);
        if (!('did' in client)) throw new Error('cheqd SDK DID extension 未加载');
        return versionId ? client.did.didDocVersion(did, versionId) : client.did.didDoc(did);
      }),
  ];
}

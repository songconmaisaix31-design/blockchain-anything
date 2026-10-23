import {
  fetchMaybeAttestation,
  fetchMaybeCredential,
  fetchMaybeSchema,
  findAttestationPda,
  findCredentialPda,
  findSchemaPda,
  SOLANA_ATTESTATION_SERVICE_PROGRAM_ADDRESS,
  deserializeAttestationData,
} from '@solana/attestation';
import { address, createSolanaRpc, type Address } from '@solana/kit';
import { z } from 'zod';
import { defineTool } from '../types.js';
import { httpUrl } from './env.js';

let cached: { key: string; rpc: ReturnType<typeof createSolanaRpc> } | undefined;

function solanaRpc() {
  const endpoint = httpUrl('BCA_SOLANA_RPC_URL', true);
  if (cached?.key === endpoint) return cached.rpc;
  const rpc = createSolanaRpc(endpoint);
  cached = { key: endpoint, rpc };
  return rpc;
}

const solanaAddress = z.string().refine((value) => {
  try {
    address(value);
    return true;
  } catch {
    return false;
  }
}, '必须为 Solana 地址（base58）');

function utf8(value: ArrayLike<number>): string {
  return new TextDecoder().decode(Uint8Array.from(value)).replace(/\0+$/u, '');
}

/** Solana Attestation Service 官方 TypeScript 客户端只读工具。 */
export function sasTools() {
  return [
    defineTool('sas_status', '通过配置的 Solana RPC 检查官方 SAS 程序账户与当前 slot；不执行交易。', z.strictObject({}), true,
      async () => {
        const rpc = solanaRpc();
        const account = await rpc.getAccountInfo(SOLANA_ATTESTATION_SERVICE_PROGRAM_ADDRESS, { encoding: 'base64' }).send();
        if (!account.value) throw new Error('SAS 程序账户在配置的网络上不存在');
        if (!account.value.executable) throw new Error('SAS 账户不是可执行程序');
        const slot = await rpc.getSlot().send();
        return {
          rpcConfigured: true,
          connectionVerified: true,
          programId: SOLANA_ATTESTATION_SERVICE_PROGRAM_ADDRESS,
          executable: account.value.executable,
          owner: account.value.owner,
          slot: slot.toString(),
        };
      }),

    defineTool('sas_credential_get', '由发行方 authority 与名称派生 SAS Credential PDA 并读取链上账户。',
      z.strictObject({ authority: solanaAddress, name: z.string().min(1) }), true,
      async ({ authority, name }) => {
        const rpc = solanaRpc();
        const [pda] = await findCredentialPda({ authority: address(authority), name });
        const account = await fetchMaybeCredential(rpc as never, pda);
        if (!account.exists) return { found: false, address: pda, programId: SOLANA_ATTESTATION_SERVICE_PROGRAM_ADDRESS };
        return {
          found: true,
          address: pda,
          programId: SOLANA_ATTESTATION_SERVICE_PROGRAM_ADDRESS,
          credential: {
            discriminator: account.data.discriminator,
            authority: account.data.authority,
            name: utf8(account.data.name),
            nameHex: Buffer.from(account.data.name as Uint8Array).toString('hex'),
            authorizedSigners: account.data.authorizedSigners,
          },
        };
      }),

    defineTool('sas_schema_get', '由 Credential、名称与版本派生 SAS Schema PDA 并读取字段布局。',
      z.strictObject({
        credential: solanaAddress,
        name: z.string().min(1),
        version: z.number().int().nonnegative(),
      }), true,
      async ({ credential, name, version }) => {
        const rpc = solanaRpc();
        const [pda] = await findSchemaPda({ credential: address(credential), name, version });
        const account = await fetchMaybeSchema(rpc as never, pda);
        if (!account.exists) return { found: false, address: pda, programId: SOLANA_ATTESTATION_SERVICE_PROGRAM_ADDRESS };
        return {
          found: true,
          address: pda,
          programId: SOLANA_ATTESTATION_SERVICE_PROGRAM_ADDRESS,
          schema: {
            discriminator: account.data.discriminator,
            credential: account.data.credential,
            name: account.data.name,
            description: account.data.description,
            layout: account.data.layout,
            fieldNames: account.data.fieldNames,
            isPaused: account.data.isPaused,
            version: account.data.version,
          },
        };
      }),

    defineTool('sas_attestation_get', '由 Credential、Schema 与 nonce 派生 SAS Attestation PDA，读取账户并按 Schema 解码数据。',
      z.strictObject({
        credential: solanaAddress,
        schema: solanaAddress,
        nonce: solanaAddress,
      }), true,
      async ({ credential, schema, nonce }) => {
        const rpc = solanaRpc();
        const [pda] = await findAttestationPda({
          credential: address(credential),
          schema: address(schema),
          nonce: address(nonce),
        });
        const account = await fetchMaybeAttestation(rpc as never, pda);
        if (!account.exists) return { found: false, address: pda, programId: SOLANA_ATTESTATION_SERVICE_PROGRAM_ADDRESS };
        const schemaAccount = await fetchMaybeSchema(rpc as never, address(schema) as Address);
        let decoded: unknown = null;
        if (schemaAccount.exists) {
          try {
            decoded = deserializeAttestationData(schemaAccount.data, account.data.data);
          } catch (error) {
            decoded = { decodingError: error instanceof Error ? error.message : 'Schema 数据解码失败' };
          }
        }
        return {
          found: true,
          address: pda,
          programId: SOLANA_ATTESTATION_SERVICE_PROGRAM_ADDRESS,
          attestation: {
            discriminator: account.data.discriminator,
            nonce: account.data.nonce,
            credential: account.data.credential,
            schema: account.data.schema,
            signer: account.data.signer,
            expiry: account.data.expiry,
            tokenAccount: account.data.tokenAccount,
            dataHex: Buffer.from(account.data.data).toString('hex'),
            data: decoded,
          },
          schemaFound: schemaAccount.exists,
        };
      }),
  ];
}
